import { prisma } from "./index";
import type { CounterKey, PrismaClient, Prisma } from "@prisma/client";

/**
 * Race-free, atomic sequence generator per organization and counter key.
 *
 * Concurrency Safety:
 * Powered by PostgreSQL atomic upsert (`INSERT ... ON CONFLICT DO UPDATE SET nextValue = nextValue + 1 RETURNING nextValue`).
 * Row-level locking on the `@@unique([organizationId, key])` constraint guarantees
 * that two concurrent transactions can NEVER obtain the same sequence number.
 *
 * @param organizationId Tenant identifier
 * @param key CounterKey ("ORDER" | "INVOICE" | "DRAFT")
 * @param client Optional PrismaClient or TransactionClient
 * @returns The uniquely allocated sequential integer (1, 2, 3...)
 */
export async function nextNumber(
  organizationId: string,
  key: CounterKey,
  client: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<number> {
  const counter = await client.orgCounter.upsert({
    where: {
      organizationId_key: {
        organizationId,
        key,
      },
    },
    create: {
      organizationId,
      key,
      nextValue: 2,
    },
    update: {
      nextValue: {
        increment: 1,
      },
    },
    select: {
      nextValue: true,
    },
  });

  return counter.nextValue - 1;
}

/**
 * Formats a sequential number with a prefix and zero-padded length.
 * e.g. formatSequenceNumber(1, "INV-2026-", 4) -> "INV-2026-0001"
 */
export function formatSequenceNumber(
  num: number,
  prefix = "",
  padLength = 4,
): string {
  return `${prefix}${num.toString().padStart(padLength, "0")}`;
}
