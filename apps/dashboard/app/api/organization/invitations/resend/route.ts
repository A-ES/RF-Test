import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { writeAuditLog } from "@/app/lib/audit";
import { createInviteToken } from "@/app/lib/invite-token";
import { sendEmail } from "@/app/lib/email";
import { rateLimit } from "@/app/lib/rate-limit";
import { getAppUrl } from "@/app/lib/url";
import { renderInvitationEmail } from "@/app/lib/email-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * Resend an invitation email for a pending invitation or for a user with null passwordHash.
 * - Admin only.
 * - Supports invitation lookup by ID (UI table flow) or by email (re-invite / unhashed user flow).
 * - Refreshes the cryptographic token and resets the 7-day expiration window.
 * - Safely dispatches via the configured provider (SMTP or console).
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (session.role !== "ADMIN") return json({ error: "Forbidden" }, 403);

  const rl = rateLimit(`resend-invite:${session.userId}`, 15, 60_000);
  if (!rl.allowed) {
    return json({ error: "Too many resend attempts — please wait a moment" }, 429);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const invitationId = typeof body.id === "string" ? body.id.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!invitationId && !email) {
    return json({ error: "Invitation ID or email is required" }, 400);
  }

  let invitation: {
    id: string;
    email: string;
    role: "ADMIN" | "MEMBER" | "READ_ONLY";
    jobTitle?: string | null;
    expiresAt: Date;
    organization?: { name: string } | null;
  } | null = null;

  if (invitationId) {
    invitation = await prisma.invitation.findFirst({
      where: {
        id: invitationId,
        organizationId: session.organizationId,
        status: "PENDING",
      },
      include: {
        organization: { select: { name: true } },
      },
    });

    if (!invitation) {
      return json({ error: "Pending invitation not found or already accepted" }, 404);
    }
  } else {
    if (!email.includes("@")) {
      return json({ error: "A valid email address is required" }, 400);
    }

    // Look for existing user with null passwordHash in this org
    const existingUser = await prisma.user.findFirst({
      where: { email, organizationId: session.organizationId },
      select: { id: true, name: true, role: true, jobTitle: true, passwordHash: true },
    });

    if (existingUser && existingUser.passwordHash != null) {
      return json({ error: "This user has already set their password" }, 400);
    }

    const role = existingUser?.role ?? "MEMBER";
    const jobTitle = existingUser?.jobTitle ?? null;

    // Revoke any existing PENDING invites for this email in this org
    await prisma.invitation.updateMany({
      where: {
        organizationId: session.organizationId,
        email,
        status: "PENDING",
      },
      data: { status: "REVOKED" },
    });

    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    invitation = await prisma.invitation.create({
      data: {
        organizationId: session.organizationId,
        invitedById: session.userId,
        email,
        role,
        jobTitle,
        token: "pending",
        expiresAt,
      },
      include: {
        organization: { select: { name: true } },
      },
    });
  }

  // Refresh expiration date and generate a fresh cryptographic token
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const token = createInviteToken(invitation.id);

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: {
      token,
      expiresAt,
    },
  });

  const appUrl = getAppUrl(request);
  const acceptUrl = `${appUrl}/accept-invitation?token=${encodeURIComponent(token)}`;

  const orgName = invitation.organization?.name || "RF Intelligence";
  const emailContent = renderInvitationEmail({
    recipientName: undefined,
    inviterName: session.name,
    organizationName: orgName,
    jobTitle: invitation.jobTitle || undefined,
    role: invitation.role,
    acceptUrl,
    expiresDays: 7,
  });

  const emailResult = await sendEmail({
    to: invitation.email,
    subject: emailContent.subject,
    body: emailContent.text,
    html: emailContent.html,
  });

  await writeAuditLog({
    organizationId: session.organizationId,
    userId: session.userId,
    action: "INVITATION_RESENT",
    entityType: "Invitation",
    entityId: invitation.id,
    metadata: {
      email: invitation.email,
      role: invitation.role,
      jobTitle: invitation.jobTitle,
      emailDelivered: emailResult.delivered,
      provider: emailResult.provider,
      providerMessageId: emailResult.providerMessageId,
    },
  }).catch(() => {});

  if (!emailResult.delivered) {
    return json(
      {
        ok: false,
        error: emailResult.error || "Provider failed to accept the email",
        emailDelivery: {
          delivered: false,
          status: "FAILED",
          provider: emailResult.provider,
          error: emailResult.error,
        },
      },
      502,
    );
  }

  return json({
    ok: true,
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      jobTitle: invitation.jobTitle,
      expiresAt: expiresAt.toISOString(),
    },
    emailDelivery: {
      delivered: true,
      status: "DELIVERED",
      provider: emailResult.provider,
      providerMessageId: emailResult.providerMessageId,
    },
  });
}
