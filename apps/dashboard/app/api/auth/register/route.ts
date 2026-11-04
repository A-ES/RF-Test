import { createHash } from "node:crypto";
import { prisma } from "@/app/lib/db";
import { setSessionCookie } from "@/app/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let body: { name?: string; email?: string; password?: string; organizationName?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const orgName = typeof body.organizationName === "string" ? body.organizationName.trim() : "";

  if (!name || !email || !password) {
    return Response.json({ error: "Name, email, and password are required" }, { status: 400 });
  }

  if (!email.includes("@")) {
    return Response.json({ error: "A valid email address is required" }, { status: 400 });
  }

  if (password.length < 6) {
    return Response.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    return Response.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const passwordHash = createHash("sha256").update(password).digest("hex");
  const avatarInitials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  // Create new organization with plan="None" (unsubscribed first-time user)
  const organization = await prisma.organization.create({
    data: {
      name: orgName || `${name}'s Organization`,
      plan: "None",
    },
    select: { id: true },
  });

  // Create user as ADMIN of the new tenant
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name,
      email,
      passwordHash,
      role: "ADMIN",
      avatarInitials,
    },
    select: { id: true },
  });

  // Initialize onboarding record at Step 1 (Plan Selection)
  await prisma.organizationOnboarding.create({
    data: {
      organizationId: organization.id,
      currentStep: 1,
      completed: false,
    },
  });

  await setSessionCookie(user.id);

  return Response.json({
    ok: true,
    redirectTo: "/onboarding/plan",
  });
}
