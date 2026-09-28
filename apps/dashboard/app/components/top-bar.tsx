"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Search, Bell, ChevronDown, Building2, LogOut, Settings, User } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { Input } from "@/app/components/ui/input";
import { Avatar, AvatarFallback } from "@/app/components/ui/avatar";
import { Badge } from "@/app/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/app/lib/format";
import {
  useOrgRealtime,
  type RealtimeEvent,
} from "@/app/lib/realtime/use-org-realtime";
import { useSession } from "@/app/providers/session-provider";

// ─── Page title map ───────────────────────────────────────────────────────────

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/projects": "Projects",
  "/ai-insights": "AI Insights",
  "/ask-rf": "Ask RF",
  "/conversations": "Customer Conversations",
  "/reports": "Reports & Documents",
  "/messages": "Messages",
  "/team": "Team & Account",
};

function usePageTitle() {
  const pathname = usePathname();
  for (const [prefix, title] of Object.entries(PAGE_TITLES)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return title;
  }
  return "Dashboard";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function OrgIndicator() {
  const { session } = useSession();
  const org = session?.organization;

  return (
    <div className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs text-[var(--text-secondary)] select-none">
      <Building2 aria-hidden className="size-3.5 text-[var(--text-muted)]" />
      <span className="hidden sm:inline max-w-[140px] truncate font-medium text-[var(--text-primary)]">
        {org?.name ?? "Acme Corp"}
      </span>
      <Badge variant="accent" className="hidden sm:inline-flex py-0 px-1 text-[10px]">
        {org?.plan ?? "Enterprise"}
      </Badge>
    </div>
  );
}

interface ApiNotification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

import useSWR from "swr";

const notificationsFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load notifications");
  return res.json() as Promise<{
    notifications: ApiNotification[];
    unreadCount: number;
  }>;
};

import { AlertToast } from "@/app/components/ui/alert-toast";
import { AnimatePresence } from "framer-motion";

interface ToastNotification {
  id: string;
  title: string;
  body: string;
  type?: string;
  linkHref?: string;
}

function NotificationBell() {
  const { session } = useSession();
  const orgId = session?.organization?.id ?? null;
  const currentUserId = session?.user?.id ?? null;

  const [toasts, setToasts] = React.useState<ToastNotification[]>([]);

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const { data: notifData, mutate: reloadNotifications } = useSWR(
    session ? "/api/notifications?limit=20" : null,
    notificationsFetcher,
    {
      dedupingInterval: 30_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );

  const notifications = notifData?.notifications ?? [];
  const unreadCount = notifData?.unreadCount ?? 0;

  const load = React.useCallback(async () => {
    await reloadNotifications();
  }, [reloadNotifications]);

  const handleRealtime = React.useCallback(
    (event: RealtimeEvent) => {
      if (event.name === "notification:new") {
        const payload = event.data as {
          title?: string;
          body?: string;
          type?: string;
          linkHref?: string;
          recipientIds?: string[];
        };

        // Check if targeted specifically to this user or org-wide
        if (
          !payload.recipientIds ||
          (currentUserId && payload.recipientIds.includes(currentUserId))
        ) {
          // Immediately reload / update badge count
          void load();

          // Show floating toast alert immediately
          const toastId = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          const newToast: ToastNotification = {
            id: toastId,
            title: payload.title ?? "New Notification",
            body: payload.body ?? "",
            type: payload.type ?? "GENERAL",
            linkHref: payload.linkHref,
          };

          setToasts((prev) => [...prev.slice(-4), newToast]);

          // Auto dismiss toast after 6s
          setTimeout(() => {
            removeToast(toastId);
          }, 6000);
        }
      }
    },
    [load, currentUserId, removeToast],
  );

  const { live } = useOrgRealtime(orgId, "notifications", handleRealtime);

  // If realtime is connected, do NOT poll.
  // Otherwise poll only while document is visible, with jitter.
  React.useEffect(() => {
    if (live || !session) return;

    let timer: NodeJS.Timeout;
    const schedulePoll = () => {
      const jitter = Math.floor(Math.random() * 5000);
      timer = setTimeout(() => {
        if (typeof document !== "undefined" && document.visibilityState === "visible") {
          void load();
        }
        schedulePoll();
      }, 30000 + jitter);
    };

    schedulePoll();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [live, session, load]);

  const markAllRead = React.useCallback(async () => {
    void reloadNotifications(
      (prev) => (prev ? { unreadCount: 0, notifications: prev.notifications.map((n) => ({ ...n, read: true })) } : prev),
      false,
    );
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      void load();
    }
  }, [reloadNotifications, load]);

  return (
    <>
      {/* Toast Alert Popups Container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        <AnimatePresence>
          {toasts.map((toast) => {
            const isCritical =
              toast.type === "HUMAN_ESCALATION" ||
              toast.type === "HIGH_PRIORITY_ISSUE" ||
              toast.type === "FAILED_JOB";
            const isWarning = toast.type === "INSIGHT_ALERT";

            return (
              <div key={toast.id} className="pointer-events-auto w-full">
                <AlertToast
                  title={toast.title}
                  description={toast.body}
                  variant={isCritical ? "error" : isWarning ? "warning" : "info"}
                  styleVariant="filled"
                  severityTag={toast.type ? toast.type.replace(/_/g, " ") : "ALERT"}
                  action={
                    toast.linkHref
                      ? { label: "Open", href: toast.linkHref }
                      : undefined
                  }
                  onClose={() => removeToast(toast.id)}
                />
              </div>
            );
          })}
        </AnimatePresence>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
            suppressHydrationWarning
            className="relative flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            <Bell aria-hidden className="size-4" />
            {unreadCount > 0 && (
              <span
                aria-hidden
                className="absolute right-1.5 top-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-[var(--accent)] animate-pulse"
              />
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-80">
          <div className="flex items-center justify-between px-2 py-1.5">
            <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[11px] font-medium text-[var(--accent)] hover:text-[var(--accent-hover)]"
              >
                Mark all read
              </button>
            )}
          </div>
          <DropdownMenuSeparator />
          {notifications.length === 0 && (
            <p className="px-3 py-3 text-xs text-[var(--text-muted)]">
              You&apos;re all caught up.
            </p>
          )}
          {notifications.map((n) => (
            <DropdownMenuItem key={n.id} className="flex-col items-start gap-0.5 py-2.5">
              <div className="flex w-full items-start justify-between gap-2">
                <span
                  className={cn(
                    "text-xs font-medium leading-snug",
                    n.read
                      ? "text-[var(--text-secondary)]"
                      : "text-[var(--text-primary)]"
                  )}
                >
                  {!n.read && (
                    <span
                      aria-hidden
                      className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)] align-middle"
                    />
                  )}
                  {n.title}
                </span>
                <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                  {formatRelativeTime(n.createdAt)}
                </span>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] leading-snug">
                {n.body}
              </p>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="justify-center text-xs text-[var(--accent)] hover:text-[var(--accent-hover)]">
            View all notifications
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function UserMenu() {
  const { session } = useSession();
  const user = session?.user;

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((p) => p[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    } catch {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="User menu"
          suppressHydrationWarning
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm outline-none transition-colors hover:bg-[var(--surface-elevated)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-[10px]">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden md:block text-xs font-medium text-[var(--text-primary)] max-w-[120px] truncate">
            {user?.name ?? "User"}
          </span>
          <ChevronDown aria-hidden className="hidden md:block size-3 text-[var(--text-muted)]" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        <div className="px-2 py-2">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">
            {user?.name ?? "User"}
          </p>
          <p className="text-xs text-[var(--text-muted)] truncate">
            {user?.email ?? ""}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2">
          <User aria-hidden className="size-4" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2">
          <Settings aria-hidden className="size-4" /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="gap-2 text-[var(--dash-status-error)] focus:text-[var(--dash-status-error)] cursor-pointer"
        >
          <LogOut aria-hidden className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

interface TopBarProps {
  sidebarCollapsed: boolean;
}

export function TopBar({ sidebarCollapsed }: TopBarProps) {
  const title = usePageTitle();

  return (
    <header
      aria-label="Top bar"
      style={{
        height: "var(--dash-topbar-height)",
        background: "var(--dash-topbar-bg)",
        borderBottom: "1px solid var(--dash-topbar-border)",
        backdropFilter: "blur(var(--glass-blur))",
        WebkitBackdropFilter: "blur(var(--glass-blur))",
        display: "flex",
        alignItems: "center",
        gap: 12,
        paddingInline: 16,
        position: "sticky",
        top: 0,
        zIndex: 30,
        marginLeft: sidebarCollapsed
          ? "var(--dash-sidebar-collapsed)"
          : "var(--dash-sidebar-width)",
        transition: "margin-left 200ms cubic-bezier(0.16,1,0.3,1)",
      }}
    >
      {/* Page title */}
      <h1 className="hidden sm:block shrink-0 text-sm font-semibold text-[var(--text-primary)] tracking-tight min-w-[120px]">
        {title}
      </h1>

      {/* Spacer / Search */}
      <div className="flex flex-1 items-center gap-2 max-w-xs">
        <div className="relative w-full">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[var(--text-muted)]"
          />
          <Input
            type="search"
            placeholder="Search…"
            aria-label="Global search"
            className="h-7 pl-8 text-xs bg-[var(--surface)] border-[var(--border)]"
          />
        </div>
      </div>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-1">
        <OrgIndicator />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
