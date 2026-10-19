import { prisma } from "@/app/lib/db";
import type { StockMovementReason } from "@rf-intelligence/db";

export interface StockInfo {
  onHand: number;
  reserved: number;
  available: number;
}

export interface InventoryProviderOptions {
  orderId?: string;
  actorId?: string;
  notes?: string;
  client?: unknown;
}

export class InventoryError extends Error {
  constructor(message: string, public readonly code: string = "INVENTORY_ERROR") {
    super(message);
    this.name = "InventoryError";
  }
}

export class ZeroFloorViolationError extends InventoryError {
  constructor(message = "Cannot adjust inventory below zero: backorders are not enabled for this organization") {
    super(message, "ZERO_FLOOR_VIOLATION");
    this.name = "ZeroFloorViolationError";
  }
}

export class InsufficientStockError extends InventoryError {
  constructor(message = "Insufficient stock available for this operation") {
    super(message, "INSUFFICIENT_STOCK");
    this.name = "InsufficientStockError";
  }
}

export class ErpNotConfiguredError extends InventoryError {
  constructor(message = "ERP inventory provider is not configured: missing ERP_INVENTORY_URL or ERP_API_KEY") {
    super(message, "ERP_NOT_CONFIGURED");
    this.name = "ErpNotConfiguredError";
  }
}

type ClientWithSettings = {
  organizationSettings?: {
    findUnique: (args: { where: { organizationId: string }; select?: { featureFlagsJson: boolean } }) => Promise<{ featureFlagsJson?: string | null } | null>;
  };
};

type ClientWithInventory = {
  inventoryLevel: {
    findUnique: (args: { where: { organizationId_productId: { organizationId: string; productId: string } } }) => Promise<{ id: string; onHand: number; reserved: number } | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<{ id: string; onHand: number; reserved: number }>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string; onHand: number; reserved: number }>;
    upsert: (args: { where: { organizationId_productId: { organizationId: string; productId: string } }; update: Record<string, unknown>; create: Record<string, unknown> }) => Promise<{ id: string; onHand: number; reserved: number }>;
  };
  stockMovement: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  organizationSettings?: ClientWithSettings["organizationSettings"];
};

/**
 * Checks whether the organization explicitly permits backorders via its
 * featureFlagsJson setting. Defaults to false (strict zero-floor enforcement).
 */
export async function doesOrgAllowBackorder(
  organizationId: string,
  client: unknown = prisma,
): Promise<boolean> {
  const c = client as ClientWithSettings;
  if (!c?.organizationSettings?.findUnique) return false;

  try {
    const settings = await c.organizationSettings.findUnique({
      where: { organizationId },
      select: { featureFlagsJson: true },
    });

    if (!settings?.featureFlagsJson) return false;
    const flags = JSON.parse(settings.featureFlagsJson) as Record<string, unknown>;
    return Boolean(flags.allowBackorder || flags.allowBackorders);
  } catch {
    return false;
  }
}

export interface InventoryProvider {
  /**
   * Retrieves current stock level (onHand, reserved, available).
   */
  getStock(organizationId: string, productId: string, client?: unknown): Promise<StockInfo>;

  /**
   * Reserves stock for an in-flight order. Increases reserved count.
   * Decrements available stock. Cannot drop available below zero unless backorders allowed.
   */
  reserve(
    organizationId: string,
    productId: string,
    quantity: number,
    options?: InventoryProviderOptions,
  ): Promise<void>;

  /**
   * Releases previously reserved stock (e.g. order cancelled or draft abandoned).
   */
  release(
    organizationId: string,
    productId: string,
    quantity: number,
    options?: InventoryProviderOptions,
  ): Promise<void>;

  /**
   * Commits stock fulfillment for an order.
   * Decrements onHand and releases corresponding reservation. Writes StockMovement(FULFILLMENT).
   */
  commit(
    organizationId: string,
    productId: string,
    quantity: number,
    options?: InventoryProviderOptions,
  ): Promise<void>;

  /**
   * Adjusts stock level manually or via ERP sync.
   * Writes StockMovement and updates InventoryLevel in one transaction.
   * Enforces zero-floor rule unless backorder is enabled for the organization.
   */
  adjust(
    organizationId: string,
    productId: string,
    delta: number,
    options: InventoryProviderOptions & { reason: StockMovementReason },
  ): Promise<StockInfo>;
}

/**
 * Default Local Database Inventory Provider.
 * Enforces single-tenant isolation, atomic transactions, movement logs, and zero-floor checks.
 */
export class LocalDbInventoryProvider implements InventoryProvider {
  async getStock(organizationId: string, productId: string, client: unknown = prisma): Promise<StockInfo> {
    const c = client as ClientWithInventory;
    const level = await c.inventoryLevel.findUnique({
      where: {
        organizationId_productId: {
          organizationId,
          productId,
        },
      },
    });

    const onHand = level?.onHand ?? 0;
    const reserved = level?.reserved ?? 0;
    return {
      onHand,
      reserved,
      available: onHand - reserved,
    };
  }

  async reserve(
    organizationId: string,
    productId: string,
    quantity: number,
    options: InventoryProviderOptions = {},
  ): Promise<void> {
    if (quantity <= 0) return;

    const run = async (tx: unknown) => {
      const c = tx as ClientWithInventory;
      const allowBackorder = await doesOrgAllowBackorder(organizationId, c);
      const level = await c.inventoryLevel.findUnique({
        where: { organizationId_productId: { organizationId, productId } },
      });

      const currentOnHand = level?.onHand ?? 0;
      const currentReserved = level?.reserved ?? 0;
      const available = currentOnHand - currentReserved;

      if (!allowBackorder && available < quantity) {
        throw new InsufficientStockError(
          `Insufficient available stock to reserve. Available: ${available}, Required: ${quantity}`,
        );
      }

      await c.inventoryLevel.upsert({
        where: { organizationId_productId: { organizationId, productId } },
        update: { reserved: { increment: quantity } },
        create: {
          organizationId,
          productId,
          onHand: 0,
          reserved: quantity,
        },
      });

      await c.stockMovement.create({
        data: {
          organizationId,
          productId,
          delta: 0,
          reason: "ORDER_RESERVE",
          orderId: options.orderId ?? null,
          actorId: options.actorId ?? null,
        },
      });
    };

    if (options.client) {
      await run(options.client);
    } else {
      await prisma.$transaction(run as (tx: unknown) => Promise<void>);
    }
  }

  async release(
    organizationId: string,
    productId: string,
    quantity: number,
    options: InventoryProviderOptions = {},
  ): Promise<void> {
    if (quantity <= 0) return;

    const run = async (tx: unknown) => {
      const c = tx as ClientWithInventory;
      const level = await c.inventoryLevel.findUnique({
        where: { organizationId_productId: { organizationId, productId } },
      });

      const currentReserved = level?.reserved ?? 0;
      const releaseQty = Math.min(currentReserved, quantity);

      if (level && releaseQty > 0) {
        await c.inventoryLevel.update({
          where: { id: level.id },
          data: { reserved: { decrement: releaseQty } },
        });

        await c.stockMovement.create({
          data: {
            organizationId,
            productId,
            delta: 0,
            reason: "ORDER_RELEASE",
            orderId: options.orderId ?? null,
            actorId: options.actorId ?? null,
          },
        });
      }
    };

    if (options.client) {
      await run(options.client);
    } else {
      await prisma.$transaction(run as (tx: unknown) => Promise<void>);
    }
  }

  async commit(
    organizationId: string,
    productId: string,
    quantity: number,
    options: InventoryProviderOptions = {},
  ): Promise<void> {
    if (quantity <= 0) return;

    const run = async (tx: unknown) => {
      const c = tx as ClientWithInventory;
      const allowBackorder = await doesOrgAllowBackorder(organizationId, c);
      const level = await c.inventoryLevel.findUnique({
        where: { organizationId_productId: { organizationId, productId } },
      });

      const currentOnHand = level?.onHand ?? 0;
      const currentReserved = level?.reserved ?? 0;

      if (!allowBackorder && currentOnHand < quantity) {
        throw new InsufficientStockError(
          `Insufficient stock to fulfill order. On hand: ${currentOnHand}, Required: ${quantity}`,
        );
      }

      const releaseReserved = Math.min(currentReserved, quantity);

      if (level) {
        await c.inventoryLevel.update({
          where: { id: level.id },
          data: {
            onHand: { decrement: quantity },
            reserved: releaseReserved > 0 ? { decrement: releaseReserved } : undefined,
          },
        });
      } else {
        await c.inventoryLevel.create({
          data: {
            organizationId,
            productId,
            onHand: -quantity,
            reserved: 0,
          },
        });
      }

      await c.stockMovement.create({
        data: {
          organizationId,
          productId,
          delta: -quantity,
          reason: "FULFILLMENT",
          orderId: options.orderId ?? null,
          actorId: options.actorId ?? null,
        },
      });
    };

    if (options.client) {
      await run(options.client);
    } else {
      await prisma.$transaction(run as (tx: unknown) => Promise<void>);
    }
  }

  async adjust(
    organizationId: string,
    productId: string,
    delta: number,
    options: InventoryProviderOptions & { reason: StockMovementReason },
  ): Promise<StockInfo> {
    const run = async (tx: unknown): Promise<StockInfo> => {
      const c = tx as ClientWithInventory;
      const allowBackorder = await doesOrgAllowBackorder(organizationId, c);
      const level = await c.inventoryLevel.findUnique({
        where: { organizationId_productId: { organizationId, productId } },
      });

      const currentOnHand = level?.onHand ?? 0;
      const newOnHand = currentOnHand + delta;

      // CRITICAL ZERO-FLOOR ENFORCEMENT
      if (newOnHand < 0 && !allowBackorder) {
        throw new ZeroFloorViolationError(
          `Cannot adjust inventory below zero: current on-hand is ${currentOnHand}, requested delta is ${delta} (resulting in ${newOnHand}). Backorders are not enabled for this organization.`,
        );
      }

      const updatedLevel = await c.inventoryLevel.upsert({
        where: { organizationId_productId: { organizationId, productId } },
        update: { onHand: newOnHand },
        create: {
          organizationId,
          productId,
          onHand: newOnHand,
          reserved: 0,
        },
      });

      await c.stockMovement.create({
        data: {
          organizationId,
          productId,
          delta,
          reason: options.reason,
          orderId: options.orderId ?? null,
          actorId: options.actorId ?? null,
        },
      });

      return {
        onHand: updatedLevel.onHand,
        reserved: updatedLevel.reserved,
        available: updatedLevel.onHand - updatedLevel.reserved,
      };
    };

    if (options.client) {
      return run(options.client);
    } else {
      return prisma.$transaction(run as (tx: unknown) => Promise<StockInfo>);
    }
  }
}

/**
 * Stub ERP Inventory Provider.
 * Reads ERP configuration from environment variables and throws clear 'not configured' errors.
 */
export class ErpInventoryProvider implements InventoryProvider {
  private readonly apiUrl: string | undefined;
  private readonly apiKey: string | undefined;

  constructor() {
    this.apiUrl = process.env.ERP_INVENTORY_URL;
    this.apiKey = process.env.ERP_API_KEY;
  }

  private assertConfigured(): void {
    if (!this.apiUrl || !this.apiKey) {
      throw new ErpNotConfiguredError(
        "ERP inventory provider is not configured: missing ERP_INVENTORY_URL or ERP_API_KEY",
      );
    }
    throw new ErpNotConfiguredError(
      "ERP inventory provider is not configured: external ERP integration connector is not implemented",
    );
  }

  async getStock(
    _organizationId: string,
    _productId: string,
    _options?: InventoryProviderOptions,
  ): Promise<StockInfo> {
    this.assertConfigured();
    throw new ErpNotConfiguredError();
  }

  async reserve(
    _organizationId: string,
    _productId: string,
    _quantity: number,
    _options?: InventoryProviderOptions,
  ): Promise<void> {
    this.assertConfigured();
  }

  async release(
    _organizationId: string,
    _productId: string,
    _quantity: number,
    _options?: InventoryProviderOptions,
  ): Promise<void> {
    this.assertConfigured();
  }

  async commit(
    _organizationId: string,
    _productId: string,
    _quantity: number,
    _options?: InventoryProviderOptions,
  ): Promise<void> {
    this.assertConfigured();
  }

  async adjust(
    _organizationId: string,
    _productId: string,
    _delta: number,
    _options: InventoryProviderOptions & { reason: StockMovementReason },
  ): Promise<StockInfo> {
    this.assertConfigured();
    throw new ErpNotConfiguredError();
  }
}

let activeProvider: InventoryProvider | null = null;

/**
 * Returns the configured inventory provider instance.
 * Defaults to LocalDbInventoryProvider unless INVENTORY_PROVIDER=erp is set in the environment.
 */
export function getInventoryProvider(): InventoryProvider {
  if (activeProvider) {
    return activeProvider;
  }
  if (process.env.INVENTORY_PROVIDER === "erp") {
    return new ErpInventoryProvider();
  }
  return new LocalDbInventoryProvider();
}

/**
 * Test seam: sets or resets the inventory provider instance.
 */
export function setInventoryProvider(provider: InventoryProvider | null): void {
  activeProvider = provider;
}
