"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import {
  Boxes,
  Search,
  Plus,
  Upload,
  Download,
  AlertTriangle,
  Edit2,
  Trash2,
  X,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/app/lib/utils";

interface ProductStock {
  onHand: number;
  reserved: number;
  available: number;
  isReorderNeeded: boolean;
}

interface ProductAliasItem {
  id: string;
  alias: string;
}

interface CustomerPriceItem {
  id: string;
  priceMinor: number;
  customer?: {
    id: string;
    name: string;
    company?: string | null;
  } | null;
}

interface DiscountRuleItem {
  id: string;
  scope: string;
  type: string;
  value: number;
  customer?: {
    id: string;
    name: string;
    company?: string | null;
  } | null;
}

export interface ProductItem {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  unit: string;
  basePriceMinor: number;
  taxRateBps: number;
  isActive: boolean;
  reorderLevel: number;
  stock?: ProductStock;
  aliases?: ProductAliasItem[];
  customerPrices?: CustomerPriceItem[];
  discountRules?: DiscountRuleItem[];
  updatedAt?: string;
}

interface CustomerOption {
  id: string;
  name: string;
  company?: string | null;
}

interface ImportRowError {
  row: number;
  field: string;
  message: string;
}

interface ImportPreviewRow {
  action: "CREATE" | "UPDATE";
  sku: string;
  name: string;
  basePriceMinor: number;
  stock: number;
}

interface ImportPreviewData {
  dryRun: boolean;
  totalRows: number;
  validCount: number;
  createdCount: number;
  updatedCount: number;
  errorCount: number;
  errors: ImportRowError[];
  preview: ImportPreviewRow[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${res.status}`);
  }
  return res.json();
};

function formatCurrency(paise: number) {
  return (paise / 100).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
}

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [adjustingProduct, setAdjustingProduct] = useState<ProductItem | null>(null);

  // SWR products fetching
  const queryParams = new URLSearchParams();
  if (search) queryParams.set("search", search);
  if (statusFilter === "ACTIVE") queryParams.set("isActive", "true");
  if (statusFilter === "INACTIVE") queryParams.set("isActive", "false");

  const { data, isLoading, mutate } = useSWR(
    `/api/products?${queryParams.toString()}`,
    fetcher,
  );

  const products: ProductItem[] = useMemo(() => data?.products ?? [], [data]);

  // Aggregate KPIs
  const totalProducts = products.length;
  const activeProducts = products.filter((p) => p.isActive).length;
  const lowStockProducts = products.filter((p) => p.stock?.isReorderNeeded).length;
  const totalAvailableUnits = products.reduce((acc, p) => acc + (p.stock?.available ?? 0), 0);

  return (
    <div className="mx-auto max-w-[1300px] space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
            / catalog &amp; pricing
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)] mt-1">
            Product Catalog &amp; SKU Management
          </h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Central repository of hardware products, aliases, contracted pricing, and stock thresholds for RF matching.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <a
            href="/seed-products.csv"
            download="rf-catalog-template.csv"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            CSV Template
          </a>

          <button
            onClick={() => setIsImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors shadow-sm"
          >
            <Upload className="w-3.5 h-3.5 text-[var(--accent)]" />
            Import CSV
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[var(--accent)] text-white hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Product
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <p className="text-xs text-[var(--text-muted)] font-medium">Total Products</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{totalProducts}</p>
        </div>
        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <p className="text-xs text-[var(--text-muted)] font-medium">Active SKUs</p>
          <p className="text-2xl font-bold text-emerald-500 mt-1">{activeProducts}</p>
        </div>
        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <p className="text-xs text-[var(--text-muted)] font-medium">Available Units</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{totalAvailableUnits}</p>
        </div>
        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <p className="text-xs text-[var(--text-muted)] font-medium">Reorder Required</p>
          <p className={cn("text-2xl font-bold mt-1", lowStockProducts > 0 ? "text-amber-500" : "text-[var(--text-primary)]")}>
            {lowStockProducts}
          </p>
        </div>
      </div>

      {/* ── Search & Filter Controls ── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search by SKU, product name, or alias..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--background)] p-0.5 text-xs font-medium">
            <button
              onClick={() => setStatusFilter("ALL")}
              className={cn("px-2.5 py-1 rounded-md transition-colors", statusFilter === "ALL" ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] font-semibold shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]")}
            >
              All
            </button>
            <button
              onClick={() => setStatusFilter("ACTIVE")}
              className={cn("px-2.5 py-1 rounded-md transition-colors", statusFilter === "ACTIVE" ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] font-semibold shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]")}
            >
              Active
            </button>
            <button
              onClick={() => setStatusFilter("INACTIVE")}
              className={cn("px-2.5 py-1 rounded-md transition-colors", statusFilter === "INACTIVE" ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] font-semibold shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]")}
            >
              Inactive
            </button>
          </div>

          <button
            onClick={() => void mutate()}
            title="Refresh"
            className="p-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Product Table ── */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)] font-medium">
                <th className="py-3 px-4">SKU</th>
                <th className="py-3 px-4">Product Name &amp; Description</th>
                <th className="py-3 px-4 text-right">Price</th>
                <th className="py-3 px-4 text-center">On Hand</th>
                <th className="py-3 px-4 text-center">Available</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Reorder Flag</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-[var(--text-primary)]">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[var(--text-muted)]">
                    Loading catalog products...
                  </td>
                </tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[var(--text-muted)]">
                    <Boxes className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    No products found. Import a CSV or create a product to get started.
                  </td>
                </tr>
              ) : (
                products.map((product) => {
                  const onHand = product.stock?.onHand ?? 0;
                  const available = product.stock?.available ?? 0;
                  const isReorderNeeded = product.stock?.isReorderNeeded;

                  return (
                    <tr
                      key={product.id}
                      className="hover:bg-[var(--surface-elevated)] transition-colors group"
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-[var(--accent)]">
                        {product.sku}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-[var(--text-primary)]">{product.name}</div>
                        {product.description && (
                          <div className="text-[11px] text-[var(--text-muted)] line-clamp-1 mt-0.5">
                            {product.description}
                          </div>
                        )}
                        {product.aliases && product.aliases.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {product.aliases.slice(0, 3).map((a: ProductAliasItem) => (
                              <span
                                key={a.id}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-[var(--background)] border border-[var(--border)] text-[var(--text-muted)]"
                              >
                                {a.alias}
                              </span>
                            ))}
                            {product.aliases.length > 3 && (
                              <span className="text-[10px] text-[var(--text-muted)]">
                                +{product.aliases.length - 3} more
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-medium">
                        {formatCurrency(product.basePriceMinor)}
                        <span className="text-[10px] text-[var(--text-muted)] ml-1">/{product.unit}</span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-semibold">
                        {onHand}
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-semibold">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-[11px]",
                            available <= 0
                              ? "bg-rose-500/10 text-rose-500"
                              : isReorderNeeded
                              ? "bg-amber-500/10 text-amber-500"
                              : "bg-emerald-500/10 text-emerald-500",
                          )}
                        >
                          {available}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
                            product.isActive
                              ? "bg-emerald-500/10 text-emerald-500"
                              : "bg-zinc-500/10 text-zinc-400",
                          )}
                        >
                          {product.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isReorderNeeded ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-500 border border-amber-500/20">
                            <AlertTriangle className="w-3 h-3" />
                            Reorder
                          </span>
                        ) : (
                          <span className="text-[11px] text-[var(--text-muted)]">Normal</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setSelectedProduct(product);
                              setIsEditDrawerOpen(true);
                            }}
                            className="p-1.5 rounded-md hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            title="Edit Product, Aliases & Contract Prices"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setAdjustingProduct(product)}
                            className="px-2 py-1 rounded-md text-[11px] font-medium border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] transition-colors"
                          >
                            Adjust Stock
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Edit Drawer (Aliases + Contract Prices) ── */}
      {isEditDrawerOpen && selectedProduct && (
        <EditProductDrawer
          product={selectedProduct}
          onClose={() => {
            setIsEditDrawerOpen(false);
            setSelectedProduct(null);
          }}
          onUpdated={() => void mutate()}
        />
      )}

      {/* ── Create Product Modal ── */}
      {isCreateModalOpen && (
        <CreateProductModal
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={() => {
            setIsCreateModalOpen(false);
            void mutate();
          }}
        />
      )}

      {/* ── CSV Import Dialog ── */}
      {isImportModalOpen && (
        <ImportCsvModal
          onClose={() => setIsImportModalOpen(false)}
          onImported={() => {
            setIsImportModalOpen(false);
            void mutate();
          }}
        />
      )}

      {/* ── Stock Adjustment Dialog ── */}
      {adjustingProduct && (
        <StockAdjustmentDialog
          product={adjustingProduct}
          onClose={() => setAdjustingProduct(null)}
          onAdjusted={() => {
            setAdjustingProduct(null);
            void mutate();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit Product Drawer (General, Aliases & Customer-Specific Pricing)
// ─────────────────────────────────────────────────────────────────────────────

function EditProductDrawer({
  product,
  onClose,
  onUpdated,
}: {
  product: ProductItem;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"DETAILS" | "ALIASES" | "PRICES">("DETAILS");

  // Fetch full details
  const { data, mutate } = useSWR(`/api/products/${product.id}`, fetcher);
  const detail = data?.product || product;

  // General fields
  const [name, setName] = useState(detail.name || "");
  const [description, setDescription] = useState(detail.description || "");
  const [unit, setUnit] = useState(detail.unit || "PCS");
  const [basePriceRupees, setBasePriceRupees] = useState(
    ((detail.basePriceMinor || 0) / 100).toFixed(2),
  );
  const [taxRateBps, setTaxRateBps] = useState(detail.taxRateBps || 1800);
  const [reorderLevel, setReorderLevel] = useState(detail.reorderLevel || 10);
  const [isActive, setIsActive] = useState(Boolean(detail.isActive));
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Alias field
  const [newAlias, setNewAlias] = useState("");
  const [aliasError, setAliasError] = useState("");

  // Customer Price field
  const [newCustId, setNewCustId] = useState("");
  const [newCustPriceRupees, setNewCustPriceRupees] = useState("");
  const [priceError, setPriceError] = useState("");

  // Fetch customers for price assignment
  const { data: custData } = useSWR("/api/customers", fetcher);
  const customers = custData?.customers || [];

  async function handleSaveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg("");

    try {
      const priceMinor = Math.round(Number(basePriceRupees) * 100);
      const res = await fetch(`/api/products/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          unit,
          basePriceMinor: priceMinor,
          taxRateBps: Number(taxRateBps),
          reorderLevel: Number(reorderLevel),
          isActive,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update product");
      }

      void mutate();
      onUpdated();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleAddAlias(e: React.FormEvent) {
    e.preventDefault();
    if (!newAlias.trim()) return;
    setAliasError("");

    try {
      const res = await fetch(`/api/products/${detail.id}/aliases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: newAlias.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add alias");
      }

      setNewAlias("");
      void mutate();
      onUpdated();
    } catch (err: unknown) {
      setAliasError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteAlias(aliasId: string) {
    try {
      const res = await fetch(`/api/products/${detail.id}/aliases/${aliasId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        void mutate();
        onUpdated();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAddCustomerPrice(e: React.FormEvent) {
    e.preventDefault();
    if (!newCustId || !newCustPriceRupees) return;
    setPriceError("");

    try {
      const res = await fetch("/api/products/customer-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: newCustId,
          productId: detail.id,
          priceMinor: Math.round(Number(newCustPriceRupees) * 100),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add customer price");
      }

      setNewCustId("");
      setNewCustPriceRupees("");
      void mutate();
      onUpdated();
    } catch (err: unknown) {
      setPriceError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDeleteCustomerPrice(priceId: string) {
    try {
      const res = await fetch(`/api/products/customer-prices/${priceId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        void mutate();
        onUpdated();
      }
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs">
      <div className="w-full max-w-xl h-full bg-[var(--surface)] border-l border-[var(--border)] flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)] bg-[var(--surface-elevated)]">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-[var(--accent)]">{detail.sku}</span>
              <span className="text-xs text-[var(--text-muted)]">•</span>
              <span className="text-xs text-[var(--text-muted)]">{detail.unit}</span>
            </div>
            <h2 className="text-base font-bold text-[var(--text-primary)] mt-0.5">{detail.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[var(--border)] px-4 bg-[var(--surface)] text-xs font-medium">
          <button
            onClick={() => setActiveTab("DETAILS")}
            className={cn(
              "py-2.5 px-3 border-b-2 transition-colors",
              activeTab === "DETAILS"
                ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            Product Details
          </button>
          <button
            onClick={() => setActiveTab("ALIASES")}
            className={cn(
              "py-2.5 px-3 border-b-2 transition-colors",
              activeTab === "ALIASES"
                ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            SKU Aliases ({detail.aliases?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("PRICES")}
            className={cn(
              "py-2.5 px-3 border-b-2 transition-colors",
              activeTab === "PRICES"
                ? "border-[var(--accent)] text-[var(--accent)] font-semibold"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            Customer Contract Pricing ({detail.customerPrices?.length || 0})
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 text-xs">
          {activeTab === "DETAILS" && (
            <form onSubmit={handleSaveDetails} className="space-y-4">
              {errorMsg && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-[var(--text-muted)] font-medium mb-1">Product Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-[var(--text-muted)] font-medium mb-1">Description</label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[var(--text-muted)] font-medium mb-1">Base Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={basePriceRupees}
                    onChange={(e) => setBasePriceRupees(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div>
                  <label className="block text-[var(--text-muted)] font-medium mb-1">Unit of Measure</label>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[var(--text-muted)] font-medium mb-1">Tax Rate (BPS)</label>
                  <input
                    type="number"
                    min="0"
                    value={taxRateBps}
                    onChange={(e) => setTaxRateBps(Number(e.target.value))}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">1800 BPS = 18.00% GST</p>
                </div>
                <div>
                  <label className="block text-[var(--text-muted)] font-medium mb-1">Reorder Level</label>
                  <input
                    type="number"
                    min="0"
                    value={reorderLevel}
                    onChange={(e) => setReorderLevel(Number(e.target.value))}
                    required
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded border-[var(--border)] text-[var(--accent)]"
                  />
                  <span className="text-[var(--text-primary)] font-medium">Product is Active</span>
                </label>
              </div>

              <div className="pt-4 border-t border-[var(--border)] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          )}

          {activeTab === "ALIASES" && (
            <div className="space-y-4">
              <p className="text-[var(--text-muted)]">
                Aliases allow RF Intelligence AI to match natural speech or misspelled customer queries directly to this SKU.
              </p>

              <form onSubmit={handleAddAlias} className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. 5g outdoor antenna"
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90"
                >
                  Add Alias
                </button>
              </form>

              {aliasError && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-[11px]">
                  {aliasError}
                </div>
              )}

              <div className="space-y-2 mt-4">
                <h3 className="font-semibold text-[var(--text-primary)]">Assigned Aliases</h3>
                {(!detail.aliases || detail.aliases.length === 0) ? (
                  <p className="text-[var(--text-muted)] py-4 text-center">No aliases added yet.</p>
                ) : (
                  <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--background)]">
                    {detail.aliases.map((a: ProductAliasItem) => (
                      <li key={a.id} className="flex items-center justify-between p-2.5">
                        <span className="font-mono text-[var(--text-primary)]">{a.alias}</span>
                        <button
                          onClick={() => handleDeleteAlias(a.id)}
                          className="p-1 text-[var(--text-muted)] hover:text-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {activeTab === "PRICES" && (
            <div className="space-y-4">
              <p className="text-[var(--text-muted)]">
                Negotiated contract pricing overrides the base price automatically when drafting orders for selected customers.
              </p>

              <form onSubmit={handleAddCustomerPrice} className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] space-y-3">
                <h3 className="font-semibold text-[var(--text-primary)]">Add Customer Contract Price</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[var(--text-muted)] mb-1">Customer</label>
                    <select
                      value={newCustId}
                      onChange={(e) => setNewCustId(e.target.value)}
                      required
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
                    >
                      <option value="">Select Customer...</option>
                      {customers.map((c: CustomerOption) => (
                        <option key={c.id} value={c.id}>
                          {c.company || c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[var(--text-muted)] mb-1">Contract Price (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Special price"
                      value={newCustPriceRupees}
                      onChange={(e) => setNewCustPriceRupees(e.target.value)}
                      required
                      className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
                    />
                  </div>
                </div>

                {priceError && (
                  <div className="p-2 rounded bg-rose-500/10 text-rose-500 text-[11px]">
                    {priceError}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90"
                  >
                    Save Contract Price
                  </button>
                </div>
              </form>

              <div className="space-y-2 mt-4">
                <h3 className="font-semibold text-[var(--text-primary)]">Active Contract Prices</h3>
                {(!detail.customerPrices || detail.customerPrices.length === 0) ? (
                  <p className="text-[var(--text-muted)] py-4 text-center">No customer overrides configured.</p>
                ) : (
                  <table className="w-full text-left border border-[var(--border)] rounded-lg overflow-hidden">
                    <thead className="bg-[var(--surface-elevated)] text-[var(--text-muted)]">
                      <tr>
                        <th className="py-2 px-3">Customer</th>
                        <th className="py-2 px-3 text-right">Contract Price</th>
                        <th className="py-2 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] bg-[var(--background)]">
                      {detail.customerPrices.map((cp: CustomerPriceItem) => (
                        <tr key={cp.id}>
                          <td className="py-2 px-3 font-medium text-[var(--text-primary)]">
                            {cp.customer?.company || cp.customer?.name}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-500">
                            {formatCurrency(cp.priceMinor)}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              onClick={() => handleDeleteCustomerPrice(cp.id)}
                              className="p-1 text-[var(--text-muted)] hover:text-rose-500"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Product Modal
// ─────────────────────────────────────────────────────────────────────────────

function CreateProductModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("PCS");
  const [priceRupees, setPriceRupees] = useState("");
  const [taxRateBps, setTaxRateBps] = useState(1800);
  const [stock, setStock] = useState(0);
  const [reorderLevel, setReorderLevel] = useState(10);
  const [aliases, setAliases] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    try {
      const priceMinor = Math.round(Number(priceRupees) * 100);
      const parsedAliases = aliases
        .split(/[;,|]/)
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean);

      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: sku.trim().toUpperCase(),
          name: name.trim(),
          description: description.trim() || undefined,
          unit: unit.trim() || "PCS",
          basePriceMinor: priceMinor,
          taxRateBps: Number(taxRateBps),
          initialStock: Number(stock),
          reorderLevel: Number(reorderLevel),
          aliases: parsedAliases,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create product");
      }

      onCreated();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 text-xs">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <h2 className="text-base font-bold text-[var(--text-primary)]">Add New Catalog Product</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[var(--text-muted)] mb-1 font-medium">SKU *</label>
              <input
                type="text"
                placeholder="e.g. ANT-5G-EXT-400"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                required
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] font-mono uppercase"
              />
            </div>
            <div>
              <label className="block text-[var(--text-muted)] mb-1 font-medium">Unit</label>
              <input
                type="text"
                placeholder="PCS"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                required
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[var(--text-muted)] mb-1 font-medium">Product Name *</label>
            <input
              type="text"
              placeholder="e.g. 5G High-Gain Outdoor Directional Antenna"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
            />
          </div>

          <div>
            <label className="block text-[var(--text-muted)] mb-1 font-medium">Description</label>
            <textarea
              rows={2}
              placeholder="Technical specs, frequency band, connectors..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[var(--text-muted)] mb-1 font-medium">Base Price (₹) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="12500.00"
                value={priceRupees}
                onChange={(e) => setPriceRupees(e.target.value)}
                required
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="block text-[var(--text-muted)] mb-1 font-medium">Tax Rate (BPS)</label>
              <input
                type="number"
                min="0"
                value={taxRateBps}
                onChange={(e) => setTaxRateBps(Number(e.target.value))}
                required
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[var(--text-muted)] mb-1 font-medium">Initial Stock Quantity</label>
              <input
                type="number"
                min="0"
                value={stock}
                onChange={(e) => setStock(Number(e.target.value))}
                required
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="block text-[var(--text-muted)] mb-1 font-medium">Reorder Alert Level</label>
              <input
                type="number"
                min="0"
                value={reorderLevel}
                onChange={(e) => setReorderLevel(Number(e.target.value))}
                required
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[var(--text-muted)] mb-1 font-medium">Aliases (Semicolon separated)</label>
            <input
              type="text"
              placeholder="5g antenna; directional antenna; outdoor panel"
              value={aliases}
              onChange={(e) => setAliases(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
            />
          </div>

          <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV Import Modal (Dry-Run Preview + Row-Level Errors + Live Upsert)
// ─────────────────────────────────────────────────────────────────────────────

function ImportCsvModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [csvText, setCsvText] = useState("");
  const [previewData, setPreviewData] = useState<ImportPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      const text = await f.text();
      setCsvText(text);
      setPreviewData(null);
    }
  };

  async function handleDryRun() {
    if (!csvText.trim()) return;
    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvContent: csvText, dryRun: true }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to preview import");
      }
      setPreviewData(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleApplyImport() {
    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvContent: csvText, dryRun: false }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }
      onImported();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 text-xs">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div>
            <h2 className="text-base font-bold text-[var(--text-primary)]">Import Products &amp; Stock via CSV</h2>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Upserts catalog products by SKU and initializes stock movements.
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500">
              {errorMsg}
            </div>
          )}

          {!previewData ? (
            <div className="space-y-3">
              <div className="border-2 border-dashed border-[var(--border)] rounded-xl p-6 text-center hover:border-[var(--accent)] transition-colors">
                <Upload className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2" />
                <p className="font-medium text-[var(--text-primary)]">Upload CSV file</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  Drag and drop or select a .csv file from your computer
                </p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="mt-3 text-xs"
                />
              </div>

              <div>
                <label className="block text-[var(--text-muted)] font-medium mb-1">
                  Or paste CSV contents directly:
                </label>
                <textarea
                  rows={6}
                  placeholder="sku,name,description,unit,price,taxRate,stock,reorderLevel,aliases&#10;ANT-5G-EXT-400,5G Directional Antenna,,PCS,12500,18%,45,10,5g antenna"
                  value={csvText}
                  onChange={(e) => {
                    setCsvText(e.target.value);
                    setPreviewData(null);
                  }}
                  className="w-full font-mono text-[11px] p-3 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Validation Summary */}
              <div className="grid grid-cols-3 gap-2.5">
                <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)]">
                  <p className="text-[10px] text-[var(--text-muted)]">Total Rows</p>
                  <p className="text-lg font-bold text-[var(--text-primary)]">{previewData.totalRows}</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)]">
                  <p className="text-[10px] text-[var(--text-muted)]">Valid Rows</p>
                  <p className="text-lg font-bold text-emerald-500">{previewData.validCount}</p>
                </div>
                <div className="p-3 rounded-lg bg-[var(--background)] border border-[var(--border)]">
                  <p className="text-[10px] text-[var(--text-muted)]">Row Errors</p>
                  <p className={cn("text-lg font-bold", previewData.errorCount > 0 ? "text-rose-500" : "text-zinc-400")}>
                    {previewData.errorCount}
                  </p>
                </div>
              </div>

              {/* Row-Level Errors List */}
              {previewData.errors && previewData.errors.length > 0 && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 space-y-1.5">
                  <p className="font-semibold text-rose-500 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4" />
                    Validation Errors (Fix in CSV before importing)
                  </p>
                  <ul className="divide-y divide-rose-500/15 max-h-36 overflow-y-auto">
                    {previewData.errors.map((err: ImportRowError, idx: number) => (
                      <li key={idx} className="py-1 text-[11px] text-rose-400">
                        Row {err.row}: <span className="font-mono text-rose-300">[{err.field}]</span> {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Preview Table */}
              {previewData.preview && previewData.preview.length > 0 && (
                <div className="space-y-2">
                  <p className="font-semibold text-[var(--text-primary)]">Parsed Row Preview</p>
                  <div className="max-h-48 overflow-y-auto border border-[var(--border)] rounded-lg">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-[var(--surface-elevated)] text-[var(--text-muted)]">
                        <tr>
                          <th className="p-2">Action</th>
                          <th className="p-2">SKU</th>
                          <th className="p-2">Name</th>
                          <th className="p-2 text-right">Price</th>
                          <th className="p-2 text-right">Stock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] bg-[var(--background)]">
                        {previewData.preview.map((row: ImportPreviewRow, i: number) => (
                          <tr key={i}>
                            <td className="p-2">
                              <span
                                className={cn(
                                  "px-1.5 py-0.5 rounded text-[9px] font-semibold",
                                  row.action === "CREATE"
                                    ? "bg-emerald-500/15 text-emerald-500"
                                    : "bg-sky-500/15 text-sky-500",
                                )}
                              >
                                {row.action}
                              </span>
                            </td>
                            <td className="p-2 font-mono text-[var(--accent)]">{row.sku}</td>
                            <td className="p-2 truncate max-w-xs">{row.name}</td>
                            <td className="p-2 text-right">{formatCurrency(row.basePriceMinor)}</td>
                            <td className="p-2 text-right font-mono">{row.stock}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-[var(--border)] flex justify-between items-center">
          {previewData ? (
            <button
              onClick={() => setPreviewData(null)}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              ← Edit CSV text
            </button>
          ) : <div />}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
            >
              Cancel
            </button>

            {!previewData ? (
              <button
                type="button"
                onClick={handleDryRun}
                disabled={loading || !csvText.trim()}
                className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Validating..." : "Preview Import"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleApplyImport}
                disabled={loading || previewData.errorCount > 0}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-500 disabled:opacity-50"
              >
                {loading ? "Importing..." : "Confirm & Apply Import"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stock Adjustment Dialog with Reason
// ─────────────────────────────────────────────────────────────────────────────

function StockAdjustmentDialog({
  product,
  onClose,
  onAdjusted,
}: {
  product: ProductItem;
  onClose: () => void;
  onAdjusted: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("ADJUSTMENT");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const currentOnHand = product.stock?.onHand ?? 0;
  const numDelta = Number(delta) || 0;
  const resultingOnHand = currentOnHand + numDelta;

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!numDelta) return;
    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          delta: numDelta,
          reason,
          notes,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Stock adjustment failed");
      }

      onAdjusted();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl p-6 text-xs">
        <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
          <div>
            <span className="font-mono text-xs font-semibold text-[var(--accent)]">{product.sku}</span>
            <h2 className="text-base font-bold text-[var(--text-primary)]">Adjust Stock Level</h2>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleAdjust} className="mt-4 space-y-4">
          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500">
              {errorMsg}
            </div>
          )}

          {/* Current vs Resulting */}
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--background)]">
            <div>
              <p className="text-[10px] text-[var(--text-muted)]">Current On Hand</p>
              <p className="text-xl font-mono font-bold text-[var(--text-primary)]">{currentOnHand}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-muted)]">Resulting On Hand</p>
              <p className={cn("text-xl font-mono font-bold", resultingOnHand < 0 ? "text-rose-500" : "text-emerald-500")}>
                {resultingOnHand}
              </p>
            </div>
          </div>

          {resultingOnHand < 0 && (
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[11px] flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Adjusting below zero will fail unless backorders are enabled for your organization.
            </div>
          )}

          <div>
            <label className="block text-[var(--text-muted)] mb-1 font-medium">
              Stock Delta (+ for addition, - for deduction) *
            </label>
            <input
              type="number"
              placeholder="e.g. +10 or -5"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] font-mono text-base"
            />
          </div>

          <div>
            <label className="block text-[var(--text-muted)] mb-1 font-medium">Adjustment Reason *</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
            >
              <option value="ADJUSTMENT">Manual Stock Count Adjustment</option>
              <option value="ERP_SYNC">ERP Integration Sync</option>
              <option value="ORDER_RELEASE">Order Return / Stock Release</option>
            </select>
          </div>

          <div>
            <label className="block text-[var(--text-muted)] mb-1 font-medium">Reference Notes (Optional)</label>
            <input
              type="text"
              placeholder="e.g. Q4 Physical Audit discrepancy"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)]"
            />
          </div>

          <div className="pt-3 border-t border-[var(--border)] flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !numDelta}
              className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Recording..." : "Save Adjustment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
