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
  Plus,
  SlidersHorizontal,
  Layers,
  ChevronRight,
  TrendingUp,
  Building2,
  AlertCircle,
  X,
  Sparkles,
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
      {/* Header skeleton */}
      <div className="space-y-3">
        <div className="h-3.5 w-28 bg-[var(--surface-elevated)] rounded" />
        <div className="h-10 w-72 sm:w-96 bg-[var(--surface-elevated)] rounded-lg" />
        <div className="h-4 w-60 bg-[var(--surface-elevated)] rounded" />
      </div>

      {/* Tabs skeleton */}
      <div className="h-11 w-full max-w-md bg-[var(--surface-elevated)] rounded-xl" />

      {/* KPI grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-32 rounded-xl border border-white/5 bg-[var(--surface-elevated)]"
          />
        ))}
      </div>

      {/* Chart & Table skeletons */}
      <div className="h-64 rounded-xl border border-white/5 bg-[var(--surface-elevated)]" />
      <div className="h-96 rounded-xl border border-white/5 bg-[var(--surface-elevated)]" />
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
  const { data: statsData, mutate: mutateStats } = useSWR(
    "/api/inventory/stats",
    fetcher
  );

  // 4. Fetch Suppliers & Purchase Orders
  const { data: supData } = useSWR(
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

  const hasActiveFilters =
    Boolean(searchQuery) ||
    selectedCategory !== "ALL" ||
    selectedLocation !== "ALL" ||
    selectedStatus !== "ALL";

  const clearAllFilters = () => {
    setSearchQuery("");
    setSelectedCategory("ALL");
    setSelectedLocation("ALL");
    setSelectedStatus("ALL");
  };

  if (itemsLoading && !itemsData) {
    return <InventorySkeleton />;
  }

  const stockByLocationData = statsData?.byLocation ?? [];
  const totalStockValue = statsData?.totalStockValue ?? 0;
  const totalSkus = statsData?.totalSkus ?? items.length;
  const lowStockCount = statsData?.lowStockCount ?? 0;
  const deadStockCount = statsData?.deadStockCount ?? 0;
  const expiringCount = statsData?.expiringCount ?? 0;

  return (
    <div className="mx-auto max-w-[1200px] space-y-8 pb-10">
      {/* ── Main Dashboard-Style Header ── */}
      <header className="relative w-full overflow-hidden pb-1">
        {/* Subtle red radial glow for depth matching /dashboard */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -left-12 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(242,78,75,0.12)_0%,transparent_70%)] blur-2xl"
        />

        <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-5">
          <div>
            <p className="dash-eyebrow mb-2">/ INVENTORY &amp; PROCUREMENT</p>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-[var(--text-primary)]">
              Warehouse Stock &amp;{" "}
              <span className="bg-gradient-to-r from-[#F24E4B] via-[#FB7185] to-[#F97316] bg-clip-text text-transparent bg-[length:200%_auto]">
                Inventory.
              </span>
            </h1>

            {/* Contextual Live Summary Bar */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs sm:text-sm text-[var(--text-muted)] font-medium">
              <span className="font-mono text-[var(--text-secondary)] font-semibold">
                ${totalStockValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Total Value
              </span>
              <span className="text-[var(--border-strong)]">·</span>
              <span>{totalSkus} Active SKUs</span>
              <span className="text-[var(--border-strong)]">·</span>

              {/* Status pill badges */}
              {lowStockCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-950/30 px-2.5 py-0.5 text-xs font-semibold text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  <span>{lowStockCount} low stock</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Stock optimal</span>
                </span>
              )}

              {expiringCount > 0 && (
                <>
                  <span className="text-[var(--border-strong)]">·</span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-950/30 px-2.5 py-0.5 text-xs font-semibold text-purple-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                    <span>{expiringCount} expiring soon</span>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Quick Actions Cluster */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsCategoryModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] hover:bg-[var(--surface)] text-xs font-semibold text-[var(--text-primary)] transition-all hover:border-[var(--border-strong)]"
            >
              <Layers className="size-3.5 text-[var(--text-muted)]" />
              <span>Categories</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAddItemOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold hover:opacity-90 transition-all shadow-md shadow-[#F24E4B]/20"
            >
              <Plus className="size-3.5" />
              <span>Add Item</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Seamless Module Tab Navigation Bar ── */}
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <nav className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--surface-elevated)] border border-[var(--border)]" aria-label="Inventory navigation">
          <button
            type="button"
            onClick={() => setActiveTab("STOCK")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all",
              activeTab === "STOCK"
                ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-strong)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            )}
          >
            <Package className={cn("size-3.5", activeTab === "STOCK" ? "text-[var(--accent)]" : "text-[var(--text-muted)]")} />
            <span>Stock Overview</span>
            <span className="ml-0.5 rounded-full bg-[var(--surface-elevated)] px-1.5 py-0.2 text-[10px] font-mono border border-white/5">
              {totalSkus}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("MOVEMENTS")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all",
              activeTab === "MOVEMENTS"
                ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-strong)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            )}
          >
            <Clock className={cn("size-3.5", activeTab === "MOVEMENTS" ? "text-[var(--accent)]" : "text-[var(--text-muted)]")} />
            <span>Stock Movements</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("SUPPLIERS_POS")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all",
              activeTab === "SUPPLIERS_POS"
                ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm border border-[var(--border-strong)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            )}
          >
            <Building2 className={cn("size-3.5", activeTab === "SUPPLIERS_POS" ? "text-[var(--accent)]" : "text-[var(--text-muted)]")} />
            <span>Suppliers &amp; POs</span>
            {purchaseOrders.length > 0 && (
              <span className="ml-0.5 rounded-full bg-[var(--surface-elevated)] px-1.5 py-0.2 text-[10px] font-mono border border-white/5">
                {purchaseOrders.length}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* ── TAB 1: STOCK OVERVIEW ── */}
      {activeTab === "STOCK" && (
        <div className="space-y-8 animate-in fade-in duration-200">
          {/* 1. Dashboard-Themed Bento KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Valuation */}
            <div className="w-full h-full bg-[#0D0E12] border-[2px] border-black dark:border-white/20 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[5px_5px_0px_0px_rgba(255,255,255,0.08)] relative flex flex-col p-5 transition-all duration-200 overflow-hidden rounded-xl hover:border-white/40 hover:shadow-[7px_7px_0px_0px_rgba(242,78,75,0.3)]">
              <div className="absolute inset-0 opacity-[0.05] pointer-events-none z-0 bg-[radial-gradient(#fff_1.5px,transparent_1.5px)] [background-size:10px_10px]" />
              <div className="flex items-start justify-between gap-2 mb-3 border-b border-white/10 pb-2.5 z-10">
                <div>
                  <h3 className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)] font-semibold">
                    Total Valuation
                  </h3>
                  <p className="text-2xl sm:text-3xl font-black tracking-tight text-[var(--text-primary)] mt-1 font-mono">
                    ${totalStockValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <DollarSign className="size-4" />
                </span>
              </div>
              <div className="relative z-10 flex items-center gap-1.5 text-xs font-mono text-emerald-400 mt-auto">
                <TrendingUp className="size-3" />
                <span>Across {totalSkus} active SKUs</span>
              </div>
            </div>

            {/* Card 2: Low Stock */}
            <div className="w-full h-full bg-[#0D0E12] border-[2px] border-black dark:border-white/20 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[5px_5px_0px_0px_rgba(255,255,255,0.08)] relative flex flex-col p-5 transition-all duration-200 overflow-hidden rounded-xl hover:border-white/40 hover:shadow-[7px_7px_0px_0px_rgba(242,78,75,0.3)]">
              <div className="absolute inset-0 opacity-[0.05] pointer-events-none z-0 bg-[radial-gradient(#fff_1.5px,transparent_1.5px)] [background-size:10px_10px]" />
              <div className="flex items-start justify-between gap-2 mb-3 border-b border-white/10 pb-2.5 z-10">
                <div>
                  <h3 className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)] font-semibold">
                    Low Stock Items
                  </h3>
                  <p className="text-2xl sm:text-3xl font-black tracking-tight text-[var(--text-primary)] mt-1 font-mono">
                    {lowStockCount} <span className="text-xs text-[var(--text-muted)] font-normal">SKUs</span>
                  </p>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  <AlertTriangle className="size-4" />
                </span>
              </div>
              <div className="relative z-10 flex items-center gap-1.5 text-xs font-mono mt-auto">
                {lowStockCount > 0 ? (
                  <span className="text-amber-400">Restock purchase order recommended</span>
                ) : (
                  <span className="text-emerald-400">All SKU stock levels healthy</span>
                )}
              </div>
            </div>

            {/* Card 3: Dead Stock */}
            <div className="w-full h-full bg-[#0D0E12] border-[2px] border-black dark:border-white/20 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[5px_5px_0px_0px_rgba(255,255,255,0.08)] relative flex flex-col p-5 transition-all duration-200 overflow-hidden rounded-xl hover:border-white/40 hover:shadow-[7px_7px_0px_0px_rgba(242,78,75,0.3)]">
              <div className="absolute inset-0 opacity-[0.05] pointer-events-none z-0 bg-[radial-gradient(#fff_1.5px,transparent_1.5px)] [background-size:10px_10px]" />
              <div className="flex items-start justify-between gap-2 mb-3 border-b border-white/10 pb-2.5 z-10">
                <div>
                  <h3 className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)] font-semibold">
                    Dead Stock (60d)
                  </h3>
                  <p className="text-2xl sm:text-3xl font-black tracking-tight text-[var(--text-primary)] mt-1 font-mono">
                    {deadStockCount} <span className="text-xs text-[var(--text-muted)] font-normal">SKUs</span>
                  </p>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-400">
                  <Clock className="size-4" />
                </span>
              </div>
              <div className="relative z-10 text-xs font-mono text-[var(--text-muted)] mt-auto">
                No stock movement recorded in 60 days
              </div>
            </div>

            {/* Card 4: Expiring Soon */}
            <div className="w-full h-full bg-[#0D0E12] border-[2px] border-black dark:border-white/20 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[5px_5px_0px_0px_rgba(255,255,255,0.08)] relative flex flex-col p-5 transition-all duration-200 overflow-hidden rounded-xl hover:border-white/40 hover:shadow-[7px_7px_0px_0px_rgba(242,78,75,0.3)]">
              <div className="absolute inset-0 opacity-[0.05] pointer-events-none z-0 bg-[radial-gradient(#fff_1.5px,transparent_1.5px)] [background-size:10px_10px]" />
              <div className="flex items-start justify-between gap-2 mb-3 border-b border-white/10 pb-2.5 z-10">
                <div>
                  <h3 className="font-mono text-xs uppercase tracking-widest text-[var(--text-muted)] font-semibold">
                    Expiring Soon
                  </h3>
                  <p className="text-2xl sm:text-3xl font-black tracking-tight text-[var(--text-primary)] mt-1 font-mono">
                    {expiringCount} <span className="text-xs text-[var(--text-muted)] font-normal">SKUs</span>
                  </p>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400">
                  <CalendarDays className="size-4" />
                </span>
              </div>
              <div className="relative z-10 text-xs font-mono text-purple-400 mt-auto">
                {expiringCount > 0 ? "Expires in next 30 days" : "No batches expiring soon"}
              </div>
            </div>
          </div>

          {/* 2. Location Distribution Chart Card (Matching Bento Style) */}
          <div className="w-full bg-[#0D0E12] border-[2px] border-black dark:border-white/20 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] dark:shadow-[5px_5px_0px_0px_rgba(255,255,255,0.08)] rounded-xl p-5 sm:p-6 space-y-4 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.04] pointer-events-none z-0 bg-[radial-gradient(#fff_1.5px,transparent_1.5px)] [background-size:10px_10px]" />

            <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2">
                  <MapPin className="size-4 text-[var(--accent)]" />
                  Stock Distribution by Location
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Breakdown of Healthy, Low, and Out-of-Stock SKUs across fulfillment hubs.
                </p>
              </div>

              {/* Per-location valuation pills */}
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                {stockByLocationData.map((loc: any) => (
                  <span
                    key={loc.locationId}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--surface-elevated)] border border-[var(--border)] text-[var(--text-secondary)]"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                    <span>{loc.locationCode}:</span>
                    <strong className="text-[var(--text-primary)]">${loc.stockValue.toLocaleString()}</strong>
                  </span>
                ))}
              </div>
            </div>

            <div className="relative z-10 h-60 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stockByLocationData} barGap={6}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
                  <XAxis dataKey="locationCode" stroke="#71717a" fontSize={11} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0D0E12",
                      borderColor: "rgba(255,255,255,0.15)",
                      borderRadius: "8px",
                      fontSize: "12px",
                      color: "#fff",
                      boxShadow: "0 10px 25px -5px rgba(0,0,0,0.5)",
                    }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: "12px", fontSize: "12px" }}
                  />
                  <Bar dataKey="healthy" fill="rgb(16,185,129)" radius={[4, 4, 0, 0]} name="Healthy Stock" />
                  <Bar dataKey="low" fill="rgb(245,158,11)" radius={[4, 4, 0, 0]} name="Low Stock" />
                  <Bar dataKey="out" fill="rgb(244,63,94)" radius={[4, 4, 0, 0]} name="Out of Stock" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 3. Reorganized Search, Filter & Table Area */}
          <div className="space-y-4">
            {/* Integrated Toolbar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-[var(--surface)] p-3.5 rounded-xl border border-[var(--border)]">
              {/* Search Bar */}
              <div className="relative flex-1 min-w-[260px]">
                <Search className="absolute left-3 top-2.5 size-4 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Search by SKU, product name, or barcode..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] pl-9 pr-8 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Filters Cluster */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Category Filter */}
                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                  <Filter className="size-3.5 text-[var(--text-muted)]" />
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="bg-transparent font-mono focus:outline-none text-[var(--text-primary)] text-xs cursor-pointer"
                  >
                    <option value="ALL" className="bg-[#0D0E12] text-white">All Categories</option>
                    {categories.map((c: any) => (
                      <option key={c.id} value={c.id} className="bg-[#0D0E12] text-white">
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Location Filter */}
                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                  <MapPin className="size-3.5 text-[var(--text-muted)]" />
                  <select
                    value={selectedLocation}
                    onChange={(e) => setSelectedLocation(e.target.value)}
                    className="bg-transparent font-mono focus:outline-none text-[var(--text-primary)] text-xs cursor-pointer"
                  >
                    <option value="ALL" className="bg-[#0D0E12] text-white">All Locations</option>
                    {locations.map((l: any) => (
                      <option key={l.id} value={l.id} className="bg-[#0D0E12] text-white">
                        {l.code} ({l.name})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)]">
                  <SlidersHorizontal className="size-3.5 text-[var(--text-muted)]" />
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="bg-transparent font-mono focus:outline-none text-[var(--text-primary)] text-xs cursor-pointer"
                  >
                    <option value="ALL" className="bg-[#0D0E12] text-white">All Statuses</option>
                    <option value="HEALTHY" className="bg-[#0D0E12] text-white">Healthy</option>
                    <option value="LOW" className="bg-[#0D0E12] text-white">Low Stock</option>
                    <option value="OUT" className="bg-[#0D0E12] text-white">Out of Stock</option>
                    <option value="OVERSTOCKED" className="bg-[#0D0E12] text-white">Overstocked</option>
                    <option value="EXPIRING" className="bg-[#0D0E12] text-white">Expiring Soon</option>
                  </select>
                </div>

                {/* Clear filters shortcut */}
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="flex items-center gap-1 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--accent)] px-2 py-1.5 rounded transition-colors"
                  >
                    <X className="size-3" />
                    <span>Reset</span>
                  </button>
                )}
              </div>
            </div>

            {/* Error Message */}
            {itemsError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 flex items-center justify-between text-xs text-rose-400">
                <div className="flex items-center gap-2">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>Failed to load inventory items: {itemsError.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => mutateItems()}
                  className="rounded-md bg-rose-500/20 px-3 py-1 font-semibold hover:bg-rose-500/30 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Empty State */}
            {!itemsError && items.length === 0 && !itemsLoading ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-12 text-center space-y-3">
                <Package className="size-10 text-[var(--text-muted)] mx-auto opacity-50" />
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">No inventory items found</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {hasActiveFilters
                      ? "No items match your active search or filter criteria."
                      : "No inventory items recorded yet in this workspace. Add your first SKU to begin tracking."}
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 pt-2">
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--surface-elevated)] hover:bg-[var(--surface)] text-xs text-[var(--text-primary)] border border-[var(--border)] transition-colors"
                    >
                      Clear Filters
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsAddItemOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-[var(--accent)] text-white text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Plus className="size-3.5" />
                    <span>Add Item</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Enhanced Data Table */
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
                            className="px-4 py-3.5 cursor-pointer max-w-xs"
                          >
                            <p className="font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate">
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
                              <span className="text-emerald-400 font-bold">+</span>
                              <span className="text-rose-400 font-bold">−</span>
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

      {/* ── TAB 2: STOCK MOVEMENTS AUDIT LOG ── */}
      {activeTab === "MOVEMENTS" && (
        <div className="animate-in fade-in duration-200">
          <StockMovementsView />
        </div>
      )}

      {/* ── TAB 3: SUPPLIERS & PURCHASE ORDERS ── */}
      {activeTab === "SUPPLIERS_POS" && (
        <div className="animate-in fade-in duration-200">
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
