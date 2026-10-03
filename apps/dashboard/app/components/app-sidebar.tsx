"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  Package,
  Sparkles,
  MessageCircleQuestion,
  MessagesSquare,
  FileText,
  MessageSquare,
  Users,
  ChevronLeft,
  ChevronRight,
  LogOut,
  CheckSquare,
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { Separator } from "@/app/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/app/components/ui/tooltip";

// ─── Nav definition ──────────────────────────────────────────────────────────

const NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Projects",
    href: "/projects",
    icon: FolderKanban,
  },
  {
    label: "Tasks & Actions",
    href: "/tasks",
    icon: CheckSquare,
  },
  {
    label: "Inventory",
    href: "/inventory",
    icon: Package,
  },
  {
    label: "AI Insights",
    href: "/ai-insights",
    icon: Sparkles,
  },
  {
    label: "Ask RF",
    href: "/ask-rf",
    icon: MessageCircleQuestion,
  },
  {
    label: "Customer Conversations",
    href: "/conversations",
    icon: MessagesSquare,
  },
  {
    label: "Reports & Documents",
    href: "/reports",
    icon: FileText,
  },
  {
    label: "Messages",
    href: "/messages",
    icon: MessageSquare,
  },
  {
    label: "Team & Account",
    href: "/team",
    icon: Users,
  },
] as const;

// ─── Props ────────────────────────────────────────────────────────────────────

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = React.useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        aria-label="Main navigation"
        data-collapsed={collapsed}
        style={{
          width: collapsed
            ? "var(--dash-sidebar-collapsed)"
            : "var(--dash-sidebar-width)",
          background: "var(--dash-sidebar-bg)",
          borderRight: "1px solid var(--dash-sidebar-border)",
          display: "flex",
          flexDirection: "column",
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 40,
          transition: "width 200ms cubic-bezier(0.16,1,0.3,1)",
          overflow: "hidden",
        }}
      >
        {/* ── Logo row ── */}
        <div
          style={{
            height: "var(--dash-topbar-height)",
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            padding: collapsed ? "0 14px" : "0 16px",
            gap: 10,
            borderBottom: "1px solid var(--dash-sidebar-border)",
          }}
        >
          <Image
            src="/logo.png"
            alt="RF Intelligence"
            width={28}
            height={19}
            className="shrink-0 object-contain"
            priority
          />
          {!collapsed && (
            <span
              className="truncate text-sm font-semibold text-[var(--text-primary)] tracking-tight"
              style={{ fontFamily: "var(--font-geist-sans, system-ui)" }}
            >
              RF Intelligence
            </span>
          )}
        </div>

        {/* ── Nav ── */}
        <nav
          aria-label="Primary"
          className="flex flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden py-3"
          style={{ padding: collapsed ? "12px 8px" : "12px 8px" }}
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));

            const linkContent = (
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
                  collapsed && "justify-center px-2",
                  isActive
                    ? "bg-[rgba(242,78,75,0.10)] text-[var(--accent)] font-medium"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]"
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    "size-[18px] shrink-0 transition-colors",
                    isActive
                      ? "text-[var(--accent)]"
                      : "text-[var(--text-muted)] group-hover:text-[var(--text-primary)]"
                  )}
                />
                {!collapsed && (
                  <span className="truncate">{item.label}</span>
                )}
                {/* Active indicator bar */}
                {isActive && !collapsed && (
                  <span
                    aria-hidden
                    className="ml-auto h-4 w-0.5 rounded-full bg-[var(--accent)]"
                  />
                )}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }

            return <React.Fragment key={item.href}>{linkContent}</React.Fragment>;
          })}
        </nav>

        {/* ── Footer / collapse toggle ── */}
        <div
          style={{
            borderTop: "1px solid var(--dash-sidebar-border)",
            padding: "8px",
            flexShrink: 0,
          }}
        >
          <Separator className="mb-2 bg-[var(--dash-sidebar-border)]" />

          {/* Logout */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  disabled={loggingOut}
                  aria-label="Sign out"
                  className="flex w-full items-center justify-center rounded-md px-2 py-2 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-rose-400 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-40"
                >
                  <LogOut aria-hidden className="size-4 shrink-0" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Sign out</TooltipContent>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              suppressHydrationWarning
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-rose-400 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-40"
            >
              <LogOut aria-hidden className="size-4 shrink-0" />
              <span>{loggingOut ? "Signing out…" : "Sign out"}</span>
            </button>
          )}

          {/* Collapse toggle */}
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            suppressHydrationWarning
            className={cn(
              "mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
              collapsed && "justify-center"
            )}
          >
            {collapsed ? (
              <ChevronRight aria-hidden className="size-4 shrink-0" />
            ) : (
              <>
                <ChevronLeft aria-hidden className="size-4 shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
