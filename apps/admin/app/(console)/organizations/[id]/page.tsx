/**
 * /console/organizations/[id] — Organization detail
 *
 * Shows: org identity, user roster, 30-day usage metrics, subscription status.
 * Does NOT expose client business data (conversations, projects, documents).
 * Links to the settings and subscription sub-pages for editable actions.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import {
  SectionHeader,
  StatCard,
  Card,
  Badge,
  Table,
  Thead,
  Th,
  Tbody,
  Tr,
  Td,
  Button,
  KV,
  Divider,
} from "@/components/ui";
import { formatDate, formatDateTime, pct } from "@/lib/utils";
import { ArrowLeft, Settings, CreditCard, Users } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await props.params;
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { name: true },
  });
  return { title: org?.name ?? "Organization" };
}

export default async function OrganizationDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireRfAdminSession();
  if (!auth.ok) redirect("/login");

  const { id } = await props.params;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      plan: true,
      createdAt: true,
      updatedAt: true,
      users: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isRFTeam: true,
          createdAt: true,
        },
      },
      subscriptions: {
        select: {
          status: true,
          seats: true,
          currentPeriodEnd: true,
          trialEndsAt: true,
          cancelAtPeriodEnd: true,
          plan: { select: { name: true, slug: true, interval: true, priceCents: true, currency: true } },
        },
        take: 1,
      },
      settings: {
        select: {
          aiModel: true,
          autoReplyEnabled: true,
          featureFlagsJson: true,
          confidenceThreshold: true,
          escalationThreshold: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!org) notFound();

  const [totalMessages, messages30d, aiMessages30d, humanMessages30d, convByStatus] =
    await Promise.all([
      prisma.customerMessage.count({ where: { organizationId: id } }),
      prisma.customerMessage.count({
        where: { organizationId: id, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.customerMessage.count({
        where: { organizationId: id, sender: "AI", createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.customerMessage.count({
        where: { organizationId: id, sender: "EMPLOYEE", createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.customerConversation.groupBy({
        by: ["status"],
        where: { organizationId: id },
        _count: { id: true },
      }),
    ]);

  const sub = org.subscriptions[0] ?? null;
  const statusMap = Object.fromEntries(convByStatus.map((r) => [r.status, r._count.id]));
  const totalConvs = convByStatus.reduce((s, r) => s + r._count.id, 0);

  // Feature flags — parse JSON safely
  let featureFlags: Record<string, boolean> = {};
  try {
    featureFlags = JSON.parse(org.settings?.featureFlagsJson ?? "{}") as Record<string, boolean>;
  } catch { /* noop */ }
  const flagEntries = Object.entries(featureFlags);

  function subTone(s?: string | null) {
    const map: Record<string, "success" | "info" | "warning" | "muted"> = {
      ACTIVE: "success", TRIALING: "info", PAST_DUE: "warning",
      PAUSED: "warning", CANCELED: "muted",
    };
    return map[s ?? ""] ?? ("default" as const);
  }

  function roleTone(r: string) {
    if (r === "CLIENT_ADMIN" || r === "ADMIN") return "danger" as const;
    return "default" as const;
  }

  return (
    <div className="flex flex-col gap-6 p-8 max-w-6xl">
      {/* Back + header */}
      <div className="flex flex-col gap-3">
        <Link
          href="/console/organizations"
          className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors w-fit"
        >
          <ArrowLeft className="size-3" aria-hidden="true" />
          All organizations
        </Link>
        <SectionHeader eyebrow={`/ ${id}`} title={org.name}>
          <div className="flex items-center gap-2">
            <Link href={`/console/organizations/${id}/settings`}>
              <Button size="sm" variant="secondary">
                <Settings className="size-3" aria-hidden="true" />
                AI Settings
              </Button>
            </Link>
            <Link href={`/console/organizations/${id}/subscription`}>
              <Button size="sm" variant="secondary">
                <CreditCard className="size-3" aria-hidden="true" />
                Subscription
              </Button>
            </Link>
          </div>
        </SectionHeader>
      </div>

      {/* Usage stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Messages (30d)" value={messages30d} sub="customer messages" />
        <StatCard label="All-time messages" value={totalMessages} />
        <StatCard
          label="AI resolution (30d)"
          value={pct(aiMessages30d, aiMessages30d + humanMessages30d)}
          sub={`${aiMessages30d} AI / ${humanMessages30d} human`}
          accent
        />
        <StatCard label="Total conversations" value={totalConvs} sub="all time" />
      </div>

      {/* Conversation breakdown */}
      <Card>
        <h2 className="mb-3 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
          Conversations by status
        </h2>
        <div className="flex flex-wrap gap-2">
          {convByStatus.length === 0 ? (
            <span className="text-sm text-[var(--text-muted)]">No conversations yet</span>
          ) : (
            convByStatus.map((r) => (
              <div
                key={r.status}
                className="flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5"
              >
                <span className="text-xs text-[var(--text-muted)]">{r.status}</span>
                <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
                  {r._count.id}
                </span>
              </div>
            ))
          )}
          {totalConvs > 0 && statusMap["HUMAN_ESCALATION"] !== undefined && (
            <div className="flex items-center gap-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-1.5">
              <span className="text-xs text-amber-400">escalation rate</span>
              <span className="font-mono text-sm font-semibold text-amber-400">
                {pct(statusMap["HUMAN_ESCALATION"] ?? 0, totalConvs)}
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* Org identity */}
      <Card>
        <h2 className="mb-3 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
          Organization
        </h2>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-[var(--border)]">
          <KV label="ID" value={org.id} mono />
          <KV label="Name" value={org.name} />
          <KV label="Plan tier" value={org.plan} />
          <KV label="Created" value={formatDate(org.createdAt)} />
          <KV label="Last updated" value={formatDateTime(org.updatedAt)} />
        </dl>
      </Card>

      {/* Subscription card */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Subscription
          </h2>
          <Link href={`/console/organizations/${id}/subscription`}>
            <Button size="sm" variant="ghost">Manage →</Button>
          </Link>
        </div>
        {sub ? (
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-[var(--border)]">
            <KV label="Status" value={sub.status} />
            <KV label="Plan" value={sub.plan?.name ?? "—"} />
            <KV label="Seats" value={sub.seats} />
            <KV label="Interval" value={sub.plan?.interval ?? "—"} />
            <KV
              label="Period end"
              value={formatDate(sub.currentPeriodEnd)}
            />
            {sub.trialEndsAt && (
              <KV label="Trial ends" value={formatDate(sub.trialEndsAt)} />
            )}
            {sub.cancelAtPeriodEnd && (
              <KV label="Cancel at period end" value="yes" />
            )}
          </dl>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">No subscription on record.</p>
        )}
      </Card>

      {/* AI settings snapshot */}
      {org.settings && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
              AI Configuration
            </h2>
            <Link href={`/console/organizations/${id}/settings`}>
              <Button size="sm" variant="ghost">Edit →</Button>
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-[var(--border)]">
            <KV label="Model" value={org.settings.aiModel} mono />
            <KV label="Auto-reply" value={org.settings.autoReplyEnabled ? "enabled" : "disabled"} />
            <KV
              label="Confidence threshold"
              value={org.settings.confidenceThreshold.toFixed(2)}
              mono
            />
            <KV
              label="Escalation threshold"
              value={org.settings.escalationThreshold.toFixed(2)}
              mono
            />
          </dl>
          {flagEntries.length > 0 && (
            <>
              <Divider className="my-3" />
              <h3 className="mb-2 text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
                Feature flags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {flagEntries.map(([key, val]) => (
                  <Badge key={key} tone={val ? "success" : "muted"}>
                    {key}: {val ? "on" : "off"}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {/* User roster */}
      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Users className="size-4" aria-hidden="true" />
          Users ({org.users.length})
        </h2>
        <Table>
          <Thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>RF team</Th>
              <Th>Joined</Th>
            </tr>
          </Thead>
          <Tbody>
            {org.users.map((user) => (
              <Tr key={user.id}>
                <Td>
                  <span className="text-sm text-[var(--text-primary)]">{user.name}</span>
                </Td>
                <Td mono>{user.email}</Td>
                <Td>
                  <Badge tone={roleTone(user.role)}>{user.role}</Badge>
                </Td>
                <Td>
                  {user.isRFTeam ? (
                    <Badge tone="info">RF team</Badge>
                  ) : (
                    <span className="text-[var(--text-muted)] text-xs">—</span>
                  )}
                </Td>
                <Td mono>{formatDate(user.createdAt)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </div>
  );
}
