import { prisma } from "@rf-intelligence/db";
import { clientIpFromHeaders } from "./ip-allowlist";

/**
 * Append-only trail of privileged actions in the RF Admin console.
 *
 * `AdminAuditLog` is deliberately denormalized: `organizationId` is a plain
 * string with no foreign key, and `targetEmail` is copied in, so a record still
 * reads correctly after the organization or user it refers to is deleted. An
 * audit trail that disappears with the data it describes is not an audit trail.
 *
 * The console's own credential may only INSERT here (see
 * packages/db/prisma/admin-role.sql), so this is append-only from the app's
 * point of view.
 */

export interface AuditEvent {
  adminId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  organizationId?: string | null;
  targetEmail?: string | null;
  metadata?: Record<string, unknown> | null;
  succeeded?: boolean;
}

export async function recordAuditEvent(
  event: AuditEvent,
  request?: Request,
): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId: event.adminId ?? null,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        organizationId: event.organizationId ?? null,
        targetEmail: event.targetEmail ?? null,
        metadataJson: event.metadata ? JSON.stringify(event.metadata) : null,
        ipAddress: request ? clientIpFromHeaders(request.headers) : null,
        userAgent: request?.headers.get("user-agent") ?? null,
        succeeded: event.succeeded ?? true,
      },
    });
  } catch (error) {
    // An audit write must never take down the action it is recording, and must
    // never leak database detail to the caller. Log loudly instead.
    console.error("[rf-admin] failed to write audit event", {
      action: event.action,
      entityType: event.entityType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
