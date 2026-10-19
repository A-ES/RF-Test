"use client";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import {
  Package,
  Search,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  DollarSign,
  AlertTriangle,
  Clock,
  CalendarDays,
  MapPin,
  RefreshCw,
  Plus,
  SlidersHorizontal,
  Layers,
  ChevronRight,
  TrendingUp,
  Building2,
  FileCheck2,
  ArrowDownRight,
  ArrowUpRight,
  AlertCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { cn } from "@/app/lib/utils";
import {
  ItemDetailSlideover,
  INVENTORY_STATUS_CONFIG,
} from "@/app/components/inventory/item-detail-slideover";
import { StockAdjustModal } from "@/app/components/inventory/stock-adjust-modal";
import { CategoryModal } from "@/app/components/inventory/category-modal";
import { AddItemSlideover } from "@/app/components/inventory/add-item-slideover";
import { SuppliersPOView } from "@/app/components/inventory/suppliers-po-view";
import { StockMovementsView } from "@/app/components/inventory/movements-view";
import type { InventoryStatus } from "@/app/lib/inventory-status";

// Standard SWR fetcher
const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${res.status}`);
  }
  return res.json();
};

function InventorySkeleton() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-3.5 w-24 bg-[var(--surface-elevated)] rounded" />
        <div className="h-8 w-64 sm:w-80 bg-[var(--surface-elevated)] rounded-lg" />
        <div className="h-4 w-96 bg-[var(--surface-elevated)] rounded" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-28 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]"
          />
        ))}
      </div>

      <div className="h-64 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]" />
      <div className="h-80 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]" />
    </div>
  );
}

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<"STOCK" | "MOVEMENTS" | "SUPPLIERS_POS">("STOCK");

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [selectedLocation, setSelectedLocation] = useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");

  // Sorting state
  const [sortField, setSortField] = useState<"sku" | "name" | "category" | "onHand" | "status" | "price">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Modals & Slide-overs
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [adjustingItem, setAdjustingItem] = useState<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    onHand: number;
  } | null>(null);

  // 1. Fetch Categories
  const { data: catData, mutate: mutateCategories } = useSWR(
    "/api/inventory/categories",
    fetcher
  );
  const categories = useMemo(() => catData?.categories ?? [], [catData]);

  // 2. Fetch Locations
  const { data: locData } = useSWR("/api/inventory/locations", fetcher);
  const locations = useMemo(() => locData?.locations ?? [], [locData]);

  // 3. Fetch Inventory Stats (KPIs + Location Distribution)
  const { data: statsData, mutate: mutateStats, error: statsError } = useSWR(
    "/api/inventory/stats",
    fetcher
  );

  // 4. Fetch Suppliers & Purchase Orders
  const { data: supData, mutate: mutateSuppliers } = useSWR(
    "/api/inventory/suppliers",
    fetcher
  );
  const suppliers = useMemo(() => supData?.suppliers ?? [], [supData]);

  const { data: poData, mutate: mutatePOs } = useSWR(
    "/api/inventory/purchase-orders",
    fetcher
  );
  const purchaseOrders = useMemo(() => poData?.purchaseOrders ?? [], [poData]);

  // 5. Fetch Items with filters in SWR key for automatic re-fetching
  const itemsKey = useMemo(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("search", searchQuery);
    if (selectedCategory !== "ALL") params.set("categoryId", selectedCategory);
    if (selectedLocation !== "ALL") params.set("locationId", selectedLocation);
    if (selectedStatus !== "ALL") params.set("status", selectedStatus);
    params.set("sort", sortField === "price" ? "unitPrice" : sortField);
    params.set("order", sortOrder);
    return `/api/inventory/items?${params.toString()}`;
  }, [searchQuery, selectedCategory, selectedLocation, selectedStatus, sortField, sortOrder]);

  const {
    data: itemsData,
    error: itemsError,
    isLoading: itemsLoading,
    mutate: mutateItems,
  } = useSWR(itemsKey, fetcher, { keepPreviousData: true });

  const items: any[] = useMemo(() => itemsData?.items ?? [], [itemsData]);

  // Handle Sort Toggle
  const handleSortToggle = (field: typeof sortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  // Optimistic stock adjust callback
  const handleStockAdjustSuccess = (updatedItem: any) => {
    // Refresh stats & items
    void mutateStats();
    void mutateItems((current: any) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((i: any) =>
          i.id === updatedItem.id ? { ...i, ...updatedItem } : i
        ),
      };
    }, true);
  };

  if (itemsLoading && !itemsData) {
    return <InventorySkeleton />;
  }

  const stockByLocationData = statsData?.byLocation ?? [];

  return (
    <div className="mx-auto max-w-[1200px] space-y-8">
      {/* ── Main Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="dash-eyebrow">/ inventory &amp; procurement</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)] mt-1">
            Warehouse Stock &amp; Dark Store Inventory
          </h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Monitor real-time SKU balances, reorder points, low stock alerts, and quick stock in/out adjustments.
          </p>
        </div>

        {/* Action Controls & Top Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCategoryModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] hover:bg-[var(--surface)] text-xs font-semibold text-[var(--text-primary)] transition-colors"
          >
            <Layers className="size-3.5 text-[var(--text-muted)]" />
            <span>Manage Categories</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAddItemOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[var(--accent)] text-black text-xs font-bold hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus className="size-3.5" />
            <span>+ Add Item</span>
          </button>

          {/* Top-Level Module Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)] ml-1">
            <button
              type="button"
              onClick={() => setActiveTab("STOCK")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-colors",
                activeTab === "STOCK"
                  ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-strong)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              <Package className="size-3.5 text-[var(--accent)]" />
              <span>Stock Overview</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("MOVEMENTS")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-colors",
                activeTab === "MOVEMENTS"
                  ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-strong)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              <Clock className="size-3.5 text-[var(--accent)]" />
              <span>Stock Movements</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("SUPPLIERS_POS")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-lg transition-colors",
                activeTab === "SUPPLIERS_POS"
                  ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-strong)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              )}
            >
              <Building2 className="size-3.5 text-[var(--accent)]" />
              <span>Suppliers &amp; POs</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── TAB 1: INVENTORY STOCK OVERVIEW ── */}
      {activeTab === "STOCK" && (
        <div className="space-y-8 animate-in fade-in duration-150">
          {/* 1. KPI Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3 shadow-sm hover:border-[var(--border-strong)] transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Total Stock Value
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <DollarSign className="size-4" />
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold font-mono tracking-tight text-[var(--text-primary)]">
                  ${(statsData?.totalStockValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400 mt-1">
                  <TrendingUp className="size-3" />
                  <span>Across {statsData?.totalSkus ?? items.length} active SKUs</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3 shadow-sm hover:border-[var(--border-strong)] transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Low Stock Items
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  <AlertTriangle className="size-4" />
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold font-mono tracking-tight text-[var(--text-primary)]">
                  {statsData?.lowStockCount ?? 0} <span className="text-xs text-[var(--text-muted)] font-normal">SKUs</span>
                </p>
                <p className="text-[11px] text-amber-400 font-mono mt-1">
                  {(statsData?.lowStockCount ?? 0) > 0 ? "Requires restock PO" : "Stock levels optimal"}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3 shadow-sm hover:border-[var(--border-strong)] transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Dead Stock Items
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400">
                  <Clock className="size-4" />
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold font-mono tracking-tight text-[var(--text-primary)]">
                  {statsData?.deadStockCount ?? 0} <span className="text-xs text-[var(--text-muted)] font-normal">SKUs</span>
                </p>
                <p className="text-[11px] text-[var(--text-muted)] font-mono mt-1">
                  Idle (no movement in 60d)
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3 shadow-sm hover:border-[var(--border-strong)] transition-all">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Expiring Soon
                </span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400">
                  <CalendarDays className="size-4" />
                </span>
              </div>
              <div>
                <p className="text-2xl font-bold font-mono tracking-tight text-[var(--text-primary)]">
                  {statsData?.expiringCount ?? 0} <span className="text-xs text-[var(--text-muted)] font-normal">SKUs</span>
                </p>
                <p className="text-[11px] text-purple-400 font-mono mt-1">
                  Expires within 30 days
                </p>
              </div>
            </div>
          </div>

          {/* 2. Stock-by-Location Bar Chart */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
                  <MapPin className="size-4 text-[var(--accent)]" />
                  Stock Distribution by Location
                </h2>
                <p className="text-xs text-[var(--text-muted)]">
                  Comparative breakdown of Healthy, Low, and Out-of-stock items across fulfillment centers.
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono text-[var(--text-muted)]">
                {stockByLocationData.map((loc: any) => (
                  <span key={loc.locationId} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                    {loc.locationCode}: <strong className="text-[var(--text-primary)]">${loc.stockValue.toLocaleString()}</strong>
                  </span>
                ))}
              </div>
            </div>

            <div className="h-56 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stockByLocationData} barGap={6}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="locationCode" stroke="#71717a" fontSize={11} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      borderColor: "#3f3f46",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "#fff",
                    }}
                  />
                  <Legend />
                  <Bar dataKey="healthy" fill="rgb(16,185,129)" radius={[4, 4, 0, 0]} name="Healthy Stock" />
                  <Bar dataKey="low" fill="rgb(245,158,11)" radius={[4, 4, 0, 0]} name="Low Stock" />
                  <Bar dataKey="out" fill="rgb(244,63,94)" radius={[4, 4, 0, 0]} name="Out of Stock" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 3. Sortable & Filterable Table Section */}
          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-[var(--surface)] p-4 rounded-xl border border-[var(--border)]">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-2.5 size-4 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Search by SKU, product name, or barcode..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] pl-9 pr-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                  <Filter className="size-3.5 text-[var(--text-muted)]" />
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="bg-transparent font-mono focus:outline-none text-[var(--text-primary)]"
                  >
                    <option value="ALL">All Categories</option>
                    {categories.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                  <MapPin className="size-3.5 text-[var(--text-muted)]" />
                  <select
                    value={selectedLocation}
                    onChange={(e) => setSelectedLocation(e.target.value)}
                    className="bg-transparent font-mono focus:outline-none text-[var(--text-primary)]"
                  >
                    <option value="ALL">All Locations</option>
                    {locations.map((l: any) => (
                      <option key={l.id} value={l.id}>
                        {l.code} ({l.name})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                  <SlidersHorizontal className="size-3.5 text-[var(--text-muted)]" />
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="bg-transparent font-mono focus:outline-none text-[var(--text-primary)]"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="HEALTHY">Healthy</option>
                    <option value="LOW">Low Stock</option>
                    <option value="OUT">Out of Stock</option>
                    <option value="OVERSTOCKED">Overstocked</option>
                    <option value="EXPIRING">Expiring Soon</option>
                  </select>
                </div>
              </div>
            </div>

            {itemsError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 flex items-center justify-between text-xs text-rose-400">
                <div className="flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>Failed to load inventory items: {itemsError.message}</span>
                </div>
                <button
                  onClick={() => mutateItems()}
                  className="rounded-md bg-rose-500/20 px-3 py-1 font-semibold hover:bg-rose-500/30"
                >
                  Retry
                </button>
              </div>
            )}

            {items.length === 0 && !itemsLoading ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center space-y-3">
                <Package className="size-10 text-[var(--text-muted)] mx-auto opacity-50" />
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">No inventory items found</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {searchQuery || selectedCategory !== "ALL" || selectedStatus !== "ALL"
                      ? "No items match your active search or filter criteria."
                      : "No inventory items yet in this store. Add your first item to begin tracking stock."}
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setSelectedCategory("ALL");
                      setSelectedLocation("ALL");
                      setSelectedStatus("ALL");
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--surface-elevated)] hover:bg-[var(--surface)] text-xs text-[var(--text-primary)] border border-[var(--border)] transition-colors"
                  >
                    Clear Filters
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddItemOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--accent)] text-black text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Plus className="size-3.5" />
                    <span>+ Add First Item</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-x-auto shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--surface-elevated)] border-b border-[var(--border)] font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)] select-none">
                    <tr>
                      <th
                        onClick={() => handleSortToggle("sku")}
                        className="px-4 py-3 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                      >
                        <div className="flex items-center gap-1">
                          <span>SKU</span>
                          {sortField === "sku" ? (
                            sortOrder === "asc" ? <ArrowUp className="size-3 text-[var(--accent)]" /> : <ArrowDown className="size-3 text-[var(--accent)]" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </div>
                      </th>

                      <th
                        onClick={() => handleSortToggle("name")}
                        className="px-4 py-3 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                      >
                        <div className="flex items-center gap-1">
                          <span>Item Name</span>
                          {sortField === "name" ? (
                            sortOrder === "asc" ? <ArrowUp className="size-3 text-[var(--accent)]" /> : <ArrowDown className="size-3 text-[var(--accent)]" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </div>
                      </th>

                      <th
                        onClick={() => handleSortToggle("category")}
                        className="px-4 py-3 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                      >
                        <div className="flex items-center gap-1">
                          <span>Category</span>
                          {sortField === "category" ? (
                            sortOrder === "asc" ? <ArrowUp className="size-3 text-[var(--accent)]" /> : <ArrowDown className="size-3 text-[var(--accent)]" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </div>
                      </th>

                      <th className="px-4 py-3">Location Breakdown</th>

                      <th
                        onClick={() => handleSortToggle("onHand")}
                        className="px-4 py-3 text-right cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Total On Hand</span>
                          {sortField === "onHand" ? (
                            sortOrder === "asc" ? <ArrowUp className="size-3 text-[var(--accent)]" /> : <ArrowDown className="size-3 text-[var(--accent)]" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </div>
                      </th>

                      <th
                        onClick={() => handleSortToggle("price")}
                        className="px-4 py-3 text-right cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Unit Price</span>
                          {sortField === "price" ? (
                            sortOrder === "asc" ? <ArrowUp className="size-3 text-[var(--accent)]" /> : <ArrowDown className="size-3 text-[var(--accent)]" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </div>
                      </th>

                      <th
                        onClick={() => handleSortToggle("status")}
                        className="px-4 py-3 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                      >
                        <div className="flex items-center gap-1">
                          <span>Status</span>
                          {sortField === "status" ? (
                            sortOrder === "asc" ? <ArrowUp className="size-3 text-[var(--accent)]" /> : <ArrowDown className="size-3 text-[var(--accent)]" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" />
                          )}
                        </div>
                      </th>

                      <th className="px-4 py-3 text-center">Quick Stock</th>
                      <th className="px-3 py-3 text-center">Detail</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[var(--border)]">
                    {items.map((item) => {
                      const status: InventoryStatus = item.status || "HEALTHY";
                      const statusCfg = INVENTORY_STATUS_CONFIG[status] || INVENTORY_STATUS_CONFIG.HEALTHY;
                      const itemStock = item.stockLevels ?? [];

                      return (
                        <tr
                          key={item.id}
                          className="group hover:bg-[var(--surface-elevated)]/60 transition-colors"
                        >
                          <td
                            onClick={() => setSelectedItemId(item.id)}
                            className="px-4 py-3.5 font-mono font-semibold text-[var(--accent)] whitespace-nowrap cursor-pointer"
                          >
                            {item.sku}
                          </td>

                          <td
                            onClick={() => setSelectedItemId(item.id)}
                            className="px-4 py-3.5 cursor-pointer"
                          >
                            <p className="font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                              {item.name}
                            </p>
                            {item.description && (
                              <p className="text-[11px] text-[var(--text-muted)] line-clamp-1 mt-0.5">
                                {item.description}
                              </p>
                            )}
                          </td>

                          <td className="px-4 py-3.5 font-mono text-[var(--text-muted)] whitespace-nowrap">
                            <span className="rounded bg-[var(--surface-elevated)] px-2 py-0.5 text-[10px] uppercase border border-[var(--border)]">
                              {item.category}
                            </span>
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {locations.map((loc: any) => {
                                const sl = itemStock.find((s: any) => s.locationId === loc.id);
                                const qty = sl?.onHand ?? 0;
                                return (
                                  <span
                                    key={loc.id}
                                    className={cn(
                                      "font-mono text-[10px] px-1.5 py-0.5 rounded border",
                                      qty > 0
                                        ? "bg-[var(--surface-elevated)] text-[var(--text-secondary)] border-[var(--border)]"
                                        : "bg-black/20 text-[var(--text-muted)] opacity-50 border-transparent"
                                    )}
                                    title={`${loc.name}: ${qty} ${item.unit}`}
                                  >
                                    {loc.code}: <strong>{qty}</strong>
                                  </span>
                                );
                              })}
                            </div>
                          </td>

                          <td className="px-4 py-3.5 text-right font-mono font-bold text-[var(--text-primary)] whitespace-nowrap">
                            {item.onHand} <span className="text-[10px] text-[var(--text-muted)] font-normal">{item.unit}</span>
                          </td>

                          <td className="px-4 py-3.5 text-right font-mono text-[var(--text-primary)] whitespace-nowrap">
                            ${Number(item.unitPrice).toFixed(2)}
                          </td>

                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span
                              className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase border"
                              style={{
                                background: statusCfg.bg,
                                color: statusCfg.text,
                                borderColor: statusCfg.border,
                              }}
                            >
                              <span
                                aria-hidden
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ background: statusCfg.dot }}
                              />
                              {statusCfg.label}
                            </span>
                          </td>

                          {/* Quick Stock In / Out Button */}
                          <td className="px-4 py-3.5 whitespace-nowrap text-center">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAdjustingItem(item);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--surface-elevated)] hover:bg-[var(--surface)] text-[var(--text-primary)] border border-[var(--border-strong)] text-[11px] font-semibold transition-colors"
                            >
                              <span className="text-emerald-400">+</span>
                              <span className="text-rose-400">−</span>
                              <span>Adjust</span>
                            </button>
                          </td>

                          <td
                            onClick={() => setSelectedItemId(item.id)}
                            className="px-3 py-3.5 text-center cursor-pointer"
                          >
                            <ChevronRight className="size-4 text-[var(--text-muted)] group-hover:text-[var(--accent)] group-hover:translate-x-0.5 transition-all" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 2: SUPPLIERS & PURCHASE ORDERS ── */}
      {activeTab === "SUPPLIERS_POS" && (
        <div className="animate-in fade-in duration-150">
          <SuppliersPOView
            suppliers={suppliers}
            purchaseOrders={purchaseOrders}
            items={items}
            locations={locations}
            onSendPO={async (poId) => {
              await fetch(`/api/inventory/purchase-orders/${poId}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "SENT" }),
              });
              void mutatePOs();
            }}
            onCreatePO={async (newPOData) => {
              await fetch(`/api/inventory/purchase-orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(newPOData),
              });
              void mutatePOs();
            }}
            onReceivePO={async (poId, locationId) => {
              await fetch(`/api/inventory/purchase-orders/${poId}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "RECEIVED", targetLocationId: locationId }),
              });
              void mutatePOs();
              void mutateStats();
              void mutateItems();
            }}
          />
        </div>
      )}

      {/* ── TAB 3: STOCK MOVEMENTS AUDIT LOG ── */}
      {activeTab === "MOVEMENTS" && (
        <div className="space-y-6">
          <StockMovementsView />
        </div>
      )}

      {/* ── Slide-Over Detail Component (Connected to DB API) ── */}
      <ItemDetailSlideover
        itemId={selectedItemId}
        locations={locations}
        onClose={() => setSelectedItemId(null)}
        onItemUpdated={(updated) => {
          void mutateStats();
          void mutateItems((curr: any) => {
            if (!curr) return curr;
            return {
              ...curr,
              items: curr.items.map((i: any) => (i.id === updated.id ? { ...i, ...updated } : i)),
            };
          }, true);
        }}
        onOpenStockAdjust={(itm) => {
          setAdjustingItem(itm);
        }}
      />

      {/* ── Add Item Slideover ── */}
      <AddItemSlideover
        isOpen={isAddItemOpen}
        categories={categories}
        locations={locations}
        onClose={() => setIsAddItemOpen(false)}
        onItemCreated={(newItem) => {
          void mutateStats();
          void mutateItems((curr: any) => {
            if (!curr) return curr;
            return {
              ...curr,
              items: [newItem, ...curr.items],
            };
          }, true);
        }}
        onOpenAddCategory={() => setIsCategoryModalOpen(true)}
      />

      {/* ── Manage Categories Modal ── */}
      <CategoryModal
        isOpen={isCategoryModalOpen}
        categories={categories}
        onClose={() => setIsCategoryModalOpen(false)}
        onCategoryCreated={(newCat) => {
          void mutateCategories((curr: any) => {
            if (!curr) return { categories: [newCat] };
            return {
              categories: [...curr.categories, newCat].sort((a: any, b: any) =>
                a.name.localeCompare(b.name)
              ),
            };
          }, true);
        }}
      />

      {/* ── Quick Stock In/Out Modal ── */}
      <StockAdjustModal
        isOpen={Boolean(adjustingItem)}
        item={adjustingItem}
        locations={locations}
        onClose={() => setAdjustingItem(null)}
        onSuccess={handleStockAdjustSuccess}
      />
    </div>
  );
}
