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
const VALID_ROLES = ["ADMIN", "MEMBER"] as const;
type InviteRole = (typeof VALID_ROLES)[number];

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * List pending invitations for this organization (Admin only).
 * Includes seat consumption metrics.
 */
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (session.role !== "ADMIN") return json({ error: "Forbidden" }, 403);

  const [invitations, org, memberCount] = await Promise.all([
    prisma.invitation.findMany({
      where: {
        organizationId: session.organizationId,
        status: "PENDING",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        jobTitle: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.organization.findUnique({
      where: { id: session.organizationId },
      select: {
        id: true,
        plan: true,
        subscriptions: {
          where: { status: "ACTIVE" },
          include: { plan: true },
          take: 1,
        },
      },
    }),
    prisma.user.count({
      where: {
        organizationId: session.organizationId,
        id: { not: session.userId },
      },
    }),
  ]);

  const activeSub = org?.subscriptions[0];
  const planSlug = activeSub?.plan?.slug ?? (org?.plan === "Enterprise" ? "enterprise" : "rf-pro");
  const maxAdditionalSeats =
    org?.plan === "Enterprise" || org?.id === "org_acme"
      ? 50
      : planSlug === "rf-ultra"
      ? 10
      : 4;

  const pendingCount = invitations.length;
  const totalUsed = memberCount + pendingCount;
  const availableSeats = Math.max(0, maxAdditionalSeats - totalUsed);

  return json({
    invitations,
    seats: {
      planName: activeSub?.plan?.name ?? (org?.plan || "RF Pro"),
      maxAdditionalSeats,
      activeMembers: memberCount,
      pendingInvitations: pendingCount,
      totalUsed,
      availableSeats,
    },
  });
}

/**
 * Send an invitation email to a new team member (Admin only).
 * - Enforces seat limits server-side.
 * - Stores professional role (jobTitle).
 * - Rate-limited to 10 invites per admin per minute.
 * - Creates cryptographic HMAC signed token.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (session.role !== "ADMIN") return json({ error: "Forbidden" }, 403);

  const rl = rateLimit(`invite:${session.userId}`, 10, 60_000);
  if (!rl.allowed) {
    return json({ error: "Too many requests — try again shortly" }, 429);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name =
    typeof body.name === "string" ? body.name.trim() : "";
  const jobTitle =
    typeof body.jobTitle === "string" ? body.jobTitle.trim() : "";
  const roleRaw =
    typeof body.role === "string" ? body.role.trim().toUpperCase() : "MEMBER";

  if (!email || !email.includes("@")) {
    return json({ error: "A valid email address is required" }, 400);
  }
  if (!jobTitle) {
    return json({ error: "A professional role is required" }, 400);
  }
  if (!VALID_ROLES.includes(roleRaw as InviteRole)) {
    return json({ error: `Security role must be one of: ${VALID_ROLES.join(", ")}` }, 400);
  }
  const role = roleRaw as InviteRole;

  // Block inviting self
  if (email === session.email.toLowerCase()) {
    return json({ error: "You cannot invite your own email address" }, 400);
  }

  // Block inviting an email that already belongs to an existing user
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { organizationId: true },
  });
  if (existingUser) {
    if (existingUser.organizationId === session.organizationId) {
      return json({ error: "That person is already an active member of your organization" }, 409);
    }
    return json({ error: "That email is already registered to another account" }, 409);
  }

  // Enforce plan seat limits server-side
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: {
      name: true,
      plan: true,
      subscriptions: {
        where: { status: "ACTIVE" },
        include: { plan: true },
        take: 1,
      },
    },
  });

  const activeSub = org?.subscriptions[0];
  const planSlug = activeSub?.plan?.slug ?? (org?.plan === "Enterprise" ? "enterprise" : "rf-pro");
  const maxAdditionalSeats =
    org?.plan === "Enterprise" || session.organizationId === "org_acme"
      ? 50
      : planSlug === "rf-ultra"
      ? 10
      : 4;

  const [memberCount, pendingCount] = await Promise.all([
    prisma.user.count({
      where: {
        organizationId: session.organizationId,
        id: { not: session.userId },
      },
    }),
    prisma.invitation.count({
      where: {
        organizationId: session.organizationId,
        status: "PENDING",
      },
    }),
  ]);

  const totalUsed = memberCount + pendingCount;
  if (totalUsed >= maxAdditionalSeats) {
    return json(
      {
        error: `Your ${activeSub?.plan?.name ?? "selected"} plan limit has been reached (${totalUsed}/${maxAdditionalSeats} seats used). Upgrade to add more members.`,
        seatsUsed: totalUsed,
        maxAdditionalSeats,
      },
      400
    );
  }

  // Revoke any existing PENDING invites for this email in this org so only one token is live
  await prisma.invitation.updateMany({
    where: {
      organizationId: session.organizationId,
      email,
      status: "PENDING",
    },
    data: { status: "REVOKED" },
  });

  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  // Create the invitation row with jobTitle
  const invitation = await prisma.invitation.create({
    data: {
      organizationId: session.organizationId,
      invitedById: session.userId,
      email,
      role,
      jobTitle,
      token: "pending",
      expiresAt,
    },
    select: { id: true, email: true, role: true, jobTitle: true, expiresAt: true },
  });

  // Sign the token with the invitation id embedded
  const token = createInviteToken(invitation.id);

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { token },
  });

  const appUrl = getAppUrl(request);
  const acceptUrl = `${appUrl}/accept-invitation?token=${encodeURIComponent(token)}`;

  // Render responsive HTML + plain-text invitation templates
  const emailContent = renderInvitationEmail({
    recipientName: name,
    inviterName: session.name,
    organizationName: org?.name ?? "RF Intelligence",
    jobTitle,
    role,
    acceptUrl,
    expiresDays: 7,
  });

  // Send invitation email through configured provider (SMTP or console)
  const emailResult = await sendEmail({
    to: email,
    subject: emailContent.subject,
    body: emailContent.text,
    html: emailContent.html,
  });

  await writeAuditLog({
    organizationId: session.organizationId,
    userId: session.userId,
    action: "INVITATION_SENT",
    entityType: "Invitation",
    entityId: invitation.id,
    metadata: {
      email,
      role,
      jobTitle,
      emailDelivered: emailResult.delivered,
      provider: emailResult.provider,
      providerMessageId: emailResult.providerMessageId,
    },
  });

  return json(
    {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        jobTitle: invitation.jobTitle,
        expiresAt: invitation.expiresAt.toISOString(),
      },
      emailDelivery: {
        delivered: emailResult.delivered,
        status: emailResult.delivered ? "DELIVERED" : "FAILED",
        provider: emailResult.provider,
        providerMessageId: emailResult.providerMessageId,
        error: emailResult.error,
      },
      seats: {
        maxAdditionalSeats,
        totalUsed: totalUsed + 1,
        availableSeats: Math.max(0, maxAdditionalSeats - (totalUsed + 1)),
      },
    },
    201
  );
}

/**
 * Revoke a pending invitation (Admin only).
 * Frees up the consumed seat immediately.
 */
export async function DELETE(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (session.role !== "ADMIN") return json({ error: "Forbidden" }, 403);

  const url = new URL(request.url);
  let id = url.searchParams.get("id");

  if (!id) {
    try {
      const body = await request.json();
      id = typeof body.id === "string" ? body.id : null;
    } catch {
      // ignore
    }
  }

  if (!id) {
    return json({ error: "Invitation ID is required" }, 400);
  }

  const invitation = await prisma.invitation.findFirst({
    where: { id, organizationId: session.organizationId, status: "PENDING" },
  });

  if (!invitation) {
    return json({ error: "Pending invitation not found" }, 404);
  }

  await prisma.invitation.update({
    where: { id },
    data: { status: "REVOKED" },
  });

  await writeAuditLog({
    organizationId: session.organizationId,
    userId: session.userId,
    action: "INVITATION_REVOKED",
    entityType: "Invitation",
    entityId: id,
    metadata: { email: invitation.email },
  }).catch(() => {});

  return json({ ok: true, revokedId: id });
}
