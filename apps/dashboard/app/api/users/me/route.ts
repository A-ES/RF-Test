import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME_LENGTH = 120;
const INITIALS_RE = /^[A-Za-z]{1,3}$/;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      jobTitle: true,
      avatarInitials: true,
      isRFTeam: true,
      createdAt: true,
    },
  });
  if (!user) return json({ error: "User not found" }, 404);

  return json({ user });
}

/**
 * Update the signed-in user's own profile (name, email, avatarInitials).
 * Email uniqueness is enforced by the DB unique constraint; we surface a
 * friendly 409 when it conflicts.
 */
export async function PATCH(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const name =
    typeof body.name === "string" ? body.name.trim() : undefined;
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  const avatarInitials =
    typeof body.avatarInitials === "string"
      ? body.avatarInitials.trim().toUpperCase()
      : undefined;
  const jobTitle =
    typeof body.jobTitle === "string" ? body.jobTitle.trim() : undefined;

  if (name === undefined && email === undefined && avatarInitials === undefined && jobTitle === undefined) {
    return json({ error: "Provide at least one of: name, email, avatarInitials, jobTitle" }, 400);
  }
  if (name !== undefined && (name.length === 0 || name.length > MAX_NAME_LENGTH)) {
    return json({ error: `Name must be 1–${MAX_NAME_LENGTH} characters` }, 400);
  }
  if (email !== undefined && !email.includes("@")) {
    return json({ error: "Invalid email address" }, 400);
  }
  if (avatarInitials !== undefined && !INITIALS_RE.test(avatarInitials)) {
    return json({ error: "avatarInitials must be 1–3 letters" }, 400);
  }

  try {
    const user = await prisma.user.update({
      where: { id: session.userId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(avatarInitials !== undefined ? { avatarInitials } : {}),
        ...(jobTitle !== undefined ? { jobTitle } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        jobTitle: true,
        avatarInitials: true,
        updatedAt: true,
      },
    });

    return json({ user });
  } catch (err: unknown) {
    // Prisma unique constraint violation code
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return json({ error: "That email is already in use" }, 409);
    }
    throw err;
  }
}
