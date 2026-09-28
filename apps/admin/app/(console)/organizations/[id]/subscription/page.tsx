/**
 * /console/organizations/[id]/subscription
 *
 * View and manage a client organization's subscription: plan, status,
 * seats, trial end, period end, cancellation flag.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit";
import {
  SectionHeader,
  Card,
  Badge,
  FormField,
  Input,
  Button,
  KV,
  Divider,
} from "@/components/ui";
import { ArrowLeft, Save } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await props.params;
  const org = await prisma.organization.findUnique({ where: { id }, select: { name: true } });
  return { title: `${org?.name ?? "Organization"} — Subscription` };
}

type SubStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELED";

const STATUS_TONES: Record<SubStatus, "success" | "info" | "warning" | "muted"> = {
  ACTIVE: "success",
  TRIALING: "info",
  PAST_DUE: "warning",
  PAUSED: "warning",
  CANCELED: "muted",
};

export default async function OrgSubscriptionPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireRfAdminSession();
  if (!auth.ok) redirect("/login");

  const { id } = await props.params;
  const sp = await props.searchParams;
  const saved = sp.saved === "1";

  const org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!org) notFound();

  const [sub, plans] = await Promise.all([
    prisma.subscription.findUnique({
      where: { organizationId: id },
      include: { plan: true },
    }),
    prisma.plan.findMany({
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, slug: true, priceCents: true, currency: true, interval: true, isActive: true },
    }),
  ]);

  // ── Server Action ──────────────────────────────────────────────────────────
  async function saveSubscription(formData: FormData) {
    "use server";
    const innerAuth = await requireRfAdminSession();
    if (!innerAuth.ok) redirect("/login");

    const planId = formData.get("planId") as string | null;
    const status = (formData.get("status") as string | null)?.toUpperCase();
    const seats = parseInt((formData.get("seats") as string) || "1", 10);
    const cancelAtPeriodEnd = formData.get("cancelAtPeriodEnd") === "true";
    const trialEndsAtRaw = formData.get("trialEndsAt") as string | null;
    const currentPeriodEndRaw = formData.get("currentPeriodEnd") as string | null;

    const update: Record<string, unknown> = {
      seats: Math.max(1, seats),
      cancelAtPeriodEnd,
    };

    if (planId) update.planId = planId;
    if (status) {
      update.status = status;
      if (status === "CANCELED") update.canceledAt = new Date();
    }
    if (trialEndsAtRaw) {
      const d = new Date(trialEndsAtRaw);
      if (!isNaN(d.getTime())) update.trialEndsAt = d;
    }
    if (currentPeriodEndRaw) {
      const d = new Date(currentPeriodEndRaw);
      if (!isNaN(d.getTime())) update.currentPeriodEnd = d;
    }

    const existing = await prisma.subscription.findUnique({
      where: { organizationId: id },
      select: { id: true },
    });
    const now = new Date();

    const periodEnd =
      (update.currentPeriodEnd as Date | undefined) ??
      new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // planId is required for subscription create — if none supplied, skip create
    const newPlanId = update.planId as string | undefined;

    const result = existing
      ? await prisma.subscription.update({
          where: { organizationId: id },
          data: update,
        })
      : newPlanId
        ? await prisma.subscription.create({
            data: {
              organizationId: id,
              planId: newPlanId,
              status: update.status as Parameters<typeof prisma.subscription.create>[0]["data"]["status"],
              seats: (update.seats as number | undefined) ?? 1,
              cancelAtPeriodEnd: (update.cancelAtPeriodEnd as boolean | undefined) ?? false,
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              trialEndsAt: update.trialEndsAt as Date | undefined,
              canceledAt: update.canceledAt as Date | undefined,
            },
          })
        : null;

    if (!result) {
      // No subscription record and no planId supplied — redirect without saving
      redirect(`/console/organizations/${id}/subscription?error=missing_plan`);
    }

    await recordAuditEvent({
      adminId: innerAuth.session.adminId,
      action: "subscription.updated",
      entityType: "Subscription",
      entityId: result.id,
      organizationId: id,
      metadata: update,
    });

    redirect(`/console/organizations/${id}/subscription?saved=1`);
  }

  const subTone = STATUS_TONES[(sub?.status ?? "ACTIVE") as SubStatus] ?? "default";

  return (
    <div className="flex flex-col gap-6 p-8 max-w-3xl">
      <div className="flex flex-col gap-3">
        <Link
          href={`/console/organizations/${id}`}
          className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors w-fit"
        >
          <ArrowLeft className="size-3" aria-hidden="true" />
          {org.name}
        </Link>
        <SectionHeader
          eyebrow="/ subscription"
          title={`${org.name} — Subscription`}
          description="Manage the plan, billing period, seat count, and subscription status."
        />
      </div>

      {saved && (
        <div className="rounded border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          Subscription updated successfully.
        </div>
      )}

      {/* Current snapshot */}
      {sub && (
        <Card>
          <h2 className="mb-3 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Current subscription
          </h2>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-[var(--border)]">
            <KV label="Status" value={sub.status} />
            <KV label="Plan" value={sub.plan?.name ?? "—"} />
            <KV label="Seats" value={sub.seats} mono />
            <KV label="Interval" value={sub.plan?.interval ?? "—"} />
            <KV label="Period start" value={formatDate(sub.currentPeriodStart)} mono />
            <KV label="Period end" value={formatDate(sub.currentPeriodEnd)} mono />
            {sub.trialEndsAt && <KV label="Trial ends" value={formatDate(sub.trialEndsAt)} mono />}
            <KV label="Cancel at period end" value={sub.cancelAtPeriodEnd ? "yes" : "no"} />
            {sub.canceledAt && <KV label="Canceled at" value={formatDateTime(sub.canceledAt)} mono />}
            {sub.externalCustomerId && <KV label="External customer ID" value={sub.externalCustomerId} mono />}
            {sub.externalSubscriptionId && <KV label="External subscription ID" value={sub.externalSubscriptionId} mono />}
          </dl>
          <div className="mt-3 flex items-center gap-2">
            <Badge tone={subTone}>{sub.status}</Badge>
            {sub.cancelAtPeriodEnd && <Badge tone="warning">cancels at period end</Badge>}
          </div>
        </Card>
      )}

      {/* Edit form */}
      <form action={saveSubscription} className="flex flex-col gap-5">
        <Card>
          <h2 className="mb-4 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Update subscription
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Plan" htmlFor="planId">
              <select
                id="planId"
                name="planId"
                defaultValue={sub?.planId ?? ""}
                className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              >
                <option value="">— no plan —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.isActive}>
                    {p.name} ({p.interval}, {(p.priceCents / 100).toFixed(0)}{" "}
                    {p.currency.toUpperCase()}){!p.isActive ? " [inactive]" : ""}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Status" htmlFor="status">
              <select
                id="status"
                name="status"
                defaultValue={sub?.status ?? "TRIALING"}
                className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              >
                <option value="TRIALING">Trialing</option>
                <option value="ACTIVE">Active</option>
                <option value="PAST_DUE">Past due</option>
                <option value="PAUSED">Paused</option>
                <option value="CANCELED">Canceled</option>
              </select>
            </FormField>

            <FormField label="Seats" htmlFor="seats">
              <Input
                id="seats"
                name="seats"
                type="number"
                min={1}
                defaultValue={sub?.seats ?? 1}
              />
            </FormField>

            <FormField label="Cancel at period end" htmlFor="cancelAtPeriodEnd">
              <select
                id="cancelAtPeriodEnd"
                name="cancelAtPeriodEnd"
                defaultValue={String(sub?.cancelAtPeriodEnd ?? false)}
                className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              >
                <option value="false">No</option>
                <option value="true">Yes — cancel at end of period</option>
              </select>
            </FormField>

            <FormField
              label="Trial ends at"
              htmlFor="trialEndsAt"
              hint="Leave blank to keep existing value."
            >
              <Input
                id="trialEndsAt"
                name="trialEndsAt"
                type="date"
                defaultValue={
                  sub?.trialEndsAt
                    ? new Date(sub.trialEndsAt).toISOString().split("T")[0]
                    : ""
                }
              />
            </FormField>

            <FormField
              label="Current period end"
              htmlFor="currentPeriodEnd"
              hint="Override the billing period end date."
            >
              <Input
                id="currentPeriodEnd"
                name="currentPeriodEnd"
                type="date"
                defaultValue={
                  sub?.currentPeriodEnd
                    ? new Date(sub.currentPeriodEnd).toISOString().split("T")[0]
                    : ""
                }
              />
            </FormField>
          </div>
        </Card>

        <Divider />

        <div className="flex justify-end">
          <Button type="submit" variant="primary">
            <Save className="size-3.5" aria-hidden="true" />
            Save subscription
          </Button>
        </div>
      </form>
    </div>
  );
}
