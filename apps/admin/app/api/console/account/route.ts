import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import { hashPassword, verifyPassword } from "@/lib/password";
import { recordAuditEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const admin = await prisma.rfAdminUser.findUnique({
    where: { id: auth.session.adminId },
    select: {
      id: true,
      name: true,
      email: true,
      mfaEnabled: true,
      mfaEnrolledAt: true,
      createdAt: true,
    },
  });

  if (!admin) {
    return Response.json({ error: "Admin not found" }, { status: 404 });
  }

  return Response.json({ ok: true, admin });
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const admin = await prisma.rfAdminUser.findUnique({
    where: { id: auth.session.adminId },
  });

  if (!admin) {
    return Response.json({ error: "Admin not found" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = (payload ?? {}) as {
    currentPassword?: unknown;
    newName?: unknown;
    newEmail?: unknown;
    newPassword?: unknown;
  };

  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newName = typeof body.newName === "string" ? body.newName.trim() : "";
  const newEmail = typeof body.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!currentPassword) {
    return Response.json(
      { error: "Current password is required to save account changes." },
      { status: 400 },
    );
  }

  // Verify current password
  const verifyCurrent = await verifyPassword(currentPassword, admin.passwordHash);
  if (!verifyCurrent.valid) {
    return Response.json({ error: "Current password is incorrect." }, { status: 401 });
  }

  const dataToUpdate: Parameters<typeof prisma.rfAdminUser.update>[0]["data"] = {};

  if (newName && newName !== admin.name) {
    dataToUpdate.name = newName;
  }

  if (newEmail && newEmail !== admin.email) {
    if (!newEmail.includes("@")) {
      return Response.json({ error: "Invalid email address." }, { status: 400 });
    }
    const conflict = await prisma.rfAdminUser.findUnique({
      where: { email: newEmail },
    });
    if (conflict) {
      return Response.json({ error: "This email address is already in use." }, { status: 400 });
    }
    dataToUpdate.email = newEmail;
  }

  if (newPassword) {
    if (newPassword.length < 12) {
      return Response.json(
        { error: "New password must be at least 12 characters long." },
        { status: 400 },
      );
    }
    dataToUpdate.passwordHash = await hashPassword(newPassword);
  }

  if (Object.keys(dataToUpdate).length === 0) {
    return Response.json({ ok: true, message: "No changes requested." });
  }

  const updated = await prisma.rfAdminUser.update({
    where: { id: admin.id },
    data: dataToUpdate,
    select: { id: true, name: true, email: true },
  });

  await recordAuditEvent(
    {
      adminId: admin.id,
      action: "rf_admin.credentials_updated",
      entityType: "rf_admin_user",
      entityId: admin.id,
      targetEmail: updated.email,
      succeeded: true,
    },
    request,
  );

  return Response.json({
    ok: true,
    message: "Account details updated successfully.",
    admin: updated,
  });
}
