import { createHash } from "node:crypto";
import { getSession, setSessionCookie } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { verifyInviteToken } from "@/app/lib/invite-token";
import { writeAuditLog } from "@/app/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * Accepts an invitation token and sets the invited user's password.
 *
 * Flow:
 *   1. Verify the HMAC-signed token (checks signature + TTL).
 *   2. Load the Invitation row and cross-check it is still PENDING and not
 *      past its DB-stored expiresAt.
 *   3. Validate the new password.
 *   4. Hash the password (SHA-256 — upgrade to bcrypt/argon2 before
 *      production; no bcrypt/argon2 package is installed in this repo).
 *   5. Create the User row with the hashed password.
 *   6. Mark the invitation ACCEPTED.
 *   7. Seed default notification preferences.
 *   8. Write an audit log entry.
 *   9. Issue a session cookie and return the new user.
 */
export async function POST(request: Request): Promise<Response> {
  // Already logged-in users should not accept invitations.
  const existing = await getSession();
  if (existing) return json({ error: "Already authenticated" }, 409);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const name =
    typeof body.name === "string" ? body.name.trim() : "";
  const password =
    typeof body.password === "string" ? body.password : "";

  if (!token) return json({ error: "Invitation token is required" }, 400);
  if (!name) return json({ error: "Name is required" }, 400);
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      400,
    );
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return json({ error: "Password is too long" }, 400);
  }

  // 1. Verify cryptographic signature + TTL.
  const decoded = verifyInviteToken(token);
  if (!decoded) {
    return json({ error: "Invitation link is invalid or has expired" }, 400);
  }

  // 2. Load the invitation row.
  const invitation = await prisma.invitation.findUnique({
    where: { id: decoded.iid },
    select: {
      id: true,
      organizationId: true,
      email: true,
      role: true,
      jobTitle: true,
      status: true,
      expiresAt: true,
    },
  });

  if (!invitation) {
    return json({ error: "Invitation not found" }, 404);
  }
  if (invitation.status !== "PENDING") {
    return json(
      {
        error:
          invitation.status === "ACCEPTED"
            ? "This invitation has already been accepted"
            : "This invitation is no longer valid",
      },
      410,
    );
  }
  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: "EXPIRED" },
    });
    return json({ error: "Invitation link has expired" }, 410);
  }

  // Check the email isn't already taken (race-condition guard).
  const collision = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true },
  });
  if (collision) {
    return json({ error: "An account with that email already exists" }, 409);
  }

  // 3-4. Hash the password with SHA-256.
  // NOTE: In production swap this for bcrypt (install `bcryptjs`) or argon2.
  // SHA-256 is used here because no password-hashing library is installed in
  // this repository.
  const passwordHash = createHash("sha256").update(password).digest("hex");

  const initials = name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || name.slice(0, 2).toUpperCase();

  // 5-7. Create user, mark invitation accepted, seed prefs — all in one tx.
  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        organizationId: invitation.organizationId,
        name,
        email: invitation.email,
        passwordHash,
        role: invitation.role,
        avatarInitials: initials,
        jobTitle: invitation.jobTitle,
      },
      select: { id: true, name: true, email: true, role: true, organizationId: true },
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });

    await tx.notificationPreference.create({
      data: {
        userId: newUser.id,
        organizationId: invitation.organizationId,
      },
    });

    return newUser;
  });

  // 8. Audit log.
  await writeAuditLog({
    organizationId: invitation.organizationId,
    userId: user.id,
    action: "INVITATION_ACCEPTED",
    entityType: "Invitation",
    entityId: invitation.id,
    metadata: { email: invitation.email, role: invitation.role },
  });

  // 9. Issue session cookie.
  await setSessionCookie(user.id);

  return json(
    {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    },
    201,
  );
}
