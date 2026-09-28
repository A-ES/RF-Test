/**
 * /console/organizations/[id]/settings
 *
 * Edit AI model/prompt configuration and feature flags for one organization.
 * Uses a Server Action (form) so no extra client-side JS is required.
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
  FormField,
  Input,
  Textarea,
  Button,
  Divider,
} from "@/components/ui";
import { ArrowLeft, Save } from "lucide-react";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await props.params;
  const org = await prisma.organization.findUnique({ where: { id }, select: { name: true } });
  return { title: `${org?.name ?? "Organization"} — AI Settings` };
}

export default async function OrgSettingsPage(props: {
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

  const settings = await prisma.organizationSettings.findUnique({
    where: { organizationId: id },
  });

  // ── Server Action ──────────────────────────────────────────────────────────
  async function saveSettings(formData: FormData) {
    "use server";
    const innerAuth = await requireRfAdminSession();
    if (!innerAuth.ok) redirect("/login");

    const update: Record<string, unknown> = {
      aiProvider: (formData.get("aiProvider") as string | null)?.trim() || "deepseek",
      aiModel: (formData.get("aiModel") as string | null)?.trim() || "deepseek-chat",
      aiSystemPrompt: (formData.get("aiSystemPrompt") as string | null) ?? "",
      aiTemperature: Math.min(2, Math.max(0, parseFloat((formData.get("aiTemperature") as string) || "0.2"))),
      aiMaxTokens: Math.min(32_768, Math.max(128, parseInt((formData.get("aiMaxTokens") as string) || "2048", 10))),
      aiContextWindow: Math.min(40, Math.max(1, parseInt((formData.get("aiContextWindow") as string) || "6", 10))),
      confidenceThreshold: Math.min(1, Math.max(0, parseFloat((formData.get("confidenceThreshold") as string) || "0.75"))),
      escalationThreshold: Math.min(1, Math.max(0, parseFloat((formData.get("escalationThreshold") as string) || "0.6"))),
      autoReplyEnabled: formData.get("autoReplyEnabled") === "true",
      featureFlagsJson: (() => {
        const raw = (formData.get("featureFlagsJson") as string | null) ?? "{}";
        try { JSON.parse(raw); return raw; } catch { return "{}"; }
      })(),
    };

    const rawRetention = formData.get("dataRetentionDays") as string | null;
    if (rawRetention && rawRetention.trim() !== "") {
      update.dataRetentionDays = Math.max(1, parseInt(rawRetention, 10));
    } else {
      update.dataRetentionDays = null;
    }

    const result = await prisma.organizationSettings.upsert({
      where: { organizationId: id },
      create: { organizationId: id, ...update },
      update,
    });

    await recordAuditEvent({
      adminId: innerAuth.session.adminId,
      action: "org_settings.updated",
      entityType: "OrganizationSettings",
      entityId: result.id,
      organizationId: id,
      metadata: update,
    });

    redirect(`/console/organizations/${id}/settings?saved=1`);
  }

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
          eyebrow="/ ai settings"
          title={`${org.name} — AI Configuration`}
          description="Changes take effect immediately on the next inbound message."
        />
      </div>

      {saved && (
        <div className="rounded border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          Settings saved successfully.
        </div>
      )}

      <form action={saveSettings} className="flex flex-col gap-5">
        <Card>
          <h2 className="mb-4 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Model
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="AI Provider" htmlFor="aiProvider">
              <Input
                id="aiProvider"
                name="aiProvider"
                defaultValue={settings?.aiProvider ?? "deepseek"}
                placeholder="deepseek"
              />
            </FormField>
            <FormField label="Model name" htmlFor="aiModel">
              <Input
                id="aiModel"
                name="aiModel"
                defaultValue={settings?.aiModel ?? "deepseek-chat"}
                placeholder="deepseek-chat"
              />
            </FormField>
            <FormField label="Temperature (0–2)" htmlFor="aiTemperature">
              <Input
                id="aiTemperature"
                name="aiTemperature"
                type="number"
                min={0}
                max={2}
                step={0.05}
                defaultValue={settings?.aiTemperature ?? 0.2}
              />
            </FormField>
            <FormField label="Max tokens" htmlFor="aiMaxTokens">
              <Input
                id="aiMaxTokens"
                name="aiMaxTokens"
                type="number"
                min={128}
                max={32768}
                step={128}
                defaultValue={settings?.aiMaxTokens ?? 2048}
              />
            </FormField>
            <FormField label="Context window (messages)" htmlFor="aiContextWindow">
              <Input
                id="aiContextWindow"
                name="aiContextWindow"
                type="number"
                min={1}
                max={40}
                defaultValue={settings?.aiContextWindow ?? 6}
              />
            </FormField>
            <FormField
              label="Data retention days"
              htmlFor="dataRetentionDays"
              hint="Leave blank to use default retention."
            >
              <Input
                id="dataRetentionDays"
                name="dataRetentionDays"
                type="number"
                min={1}
                defaultValue={settings?.dataRetentionDays ?? ""}
                placeholder="no limit"
              />
            </FormField>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
            System Prompt
          </h2>
          <FormField label="AI system prompt" htmlFor="aiSystemPrompt">
            <Textarea
              id="aiSystemPrompt"
              name="aiSystemPrompt"
              rows={6}
              defaultValue={settings?.aiSystemPrompt ?? ""}
              placeholder="You are a helpful support assistant for…"
            />
          </FormField>
        </Card>

        <Card>
          <h2 className="mb-4 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Thresholds
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="Confidence threshold (0–1)"
              htmlFor="confidenceThreshold"
              hint="AI replies below this score are withheld pending review."
            >
              <Input
                id="confidenceThreshold"
                name="confidenceThreshold"
                type="number"
                min={0}
                max={1}
                step={0.05}
                defaultValue={settings?.confidenceThreshold ?? 0.75}
              />
            </FormField>
            <FormField
              label="Escalation threshold (0–1)"
              htmlFor="escalationThreshold"
              hint="Replies below this score trigger HUMAN_ESCALATION."
            >
              <Input
                id="escalationThreshold"
                name="escalationThreshold"
                type="number"
                min={0}
                max={1}
                step={0.05}
                defaultValue={settings?.escalationThreshold ?? 0.6}
              />
            </FormField>
          </div>
          <Divider className="my-4" />
          <FormField label="Auto-reply enabled" htmlFor="autoReplyEnabled">
            <select
              id="autoReplyEnabled"
              name="autoReplyEnabled"
              defaultValue={String(settings?.autoReplyEnabled ?? true)}
              className="rounded border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled (human-only)</option>
            </select>
          </FormField>
        </Card>

        <Card>
          <h2 className="mb-4 text-xs font-mono uppercase tracking-widest text-[var(--text-muted)]">
            Feature Flags
          </h2>
          <FormField
            label="Feature flags JSON"
            htmlFor="featureFlagsJson"
            hint='JSON object of boolean flags, e.g. {"inventory": true, "reports": false}'
          >
            <Textarea
              id="featureFlagsJson"
              name="featureFlagsJson"
              rows={4}
              defaultValue={settings?.featureFlagsJson ?? "{}"}
              placeholder="{}"
            />
          </FormField>
        </Card>

        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)]">
            {settings?.updatedAt
              ? `Last updated ${formatDateTime(settings.updatedAt)}`
              : "No settings saved yet"}
          </span>
          <Button type="submit" variant="primary">
            <Save className="size-3.5" aria-hidden="true" />
            Save settings
          </Button>
        </div>
      </form>
    </div>
  );
}
