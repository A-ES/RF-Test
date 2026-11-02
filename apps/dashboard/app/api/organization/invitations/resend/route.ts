import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { writeAuditLog } from "@/app/lib/audit";
import { createInviteToken } from "@/app/lib/invite-token";
import { sendEmail } from "@/app/lib/email";
import { rateLimit } from "@/app/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * Resend an invitation to a team member whose passwordHash is null or whose invitation is pending.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);
  if (session.role !== "ADMIN") return json({ error: "Forbidden" }, 403);

  const rl = rateLimit(`resend-invite:${session.userId}`, 10, 60_000);
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

  if (!email || !email.includes("@")) {
    return json({ error: "A valid email address is required" }, 400);
  }

  // Look for existing user with null passwordHash or an existing invitation in this org
  const existingUser = await prisma.user.findFirst({
    where: { email, organizationId: session.organizationId },
    select: { id: true, name: true, role: true, passwordHash: true },
  });

  if (existingUser && existingUser.passwordHash != null) {
    return json({ error: "This user has already set their password" }, 400);
  }

  const role = existingUser?.role ?? "MEMBER";

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

  const invitation = await prisma.invitation.create({
    data: {
      organizationId: session.organizationId,
      invitedById: session.userId,
      email,
      role,
      token: "pending",
      expiresAt,
    },
    select: { id: true, email: true, role: true, expiresAt: true },
  });

  const token = createInviteToken(invitation.id);

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { token },
  });

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
  const acceptUrl = `${appUrl}/accept-invitation?token=${encodeURIComponent(token)}`;

  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    select: { name: true },
  });

  await sendEmail({
    to: email,
    subject: `Your invitation to join ${org?.name ?? "RF Intelligence"}`,
    body: [
      `Hi there,`,
      ``,
      `${session.name} has resent your invitation to access ${org?.name ?? "RF Intelligence"}.`,
      ``,
      `Set your password here:`,
      acceptUrl,
      ``,
      `This link expires in 7 days.`,
    ].join("\n"),
  });

  await writeAuditLog({
    organizationId: session.organizationId,
    userId: session.userId,
    action: "INVITATION_RESENT",
    entityType: "Invitation",
    entityId: invitation.id,
    metadata: { email, role },
  });

  return json({
    ok: true,
    invitation: {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt.toISOString(),
    },
  });
}
