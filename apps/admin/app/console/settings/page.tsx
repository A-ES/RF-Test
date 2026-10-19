import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import { SettingsView } from "./settings-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account Settings",
};

export default async function SettingsPage() {
  const auth = await requireRfAdminSession();
  if (!auth.ok) {
    redirect("/login");
  }

  const admin = await prisma.rfAdminUser.findUnique({
    where: { id: auth.session.adminId },
    select: {
      id: true,
      name: true,
      email: true,
      mfaEnabled: true,
      mfaEnrolledAt: true,
    },
  });

  if (!admin) {
    redirect("/login");
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <SettingsView
        initialAdmin={{
          id: admin.id,
          name: admin.name,
          email: admin.email,
          mfaEnabled: admin.mfaEnabled,
          mfaEnrolledAt: admin.mfaEnrolledAt?.toISOString() ?? null,
        }}
      />
    </div>
  );
}
