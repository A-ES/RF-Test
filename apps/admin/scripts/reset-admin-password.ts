import { prisma } from "@rf-intelligence/db";
import { hashPassword } from "../lib/password";

async function main() {
  const email = process.argv[2];
  const newPassword = process.argv[3];
  
  if (!email || !newPassword) {
    console.error("Usage: pnpm admin:reset-password <email> <new-password>");
    process.exit(1);
  }

  const admin = await prisma.rfAdminUser.findUnique({ where: { email } });
  if (!admin) {
    console.error(`Admin with email ${email} not found.`);
    const allAdmins = await prisma.rfAdminUser.findMany({ select: { email: true } });
    console.log("Existing admins:", allAdmins.map(a => a.email).join(", "));
    process.exit(1);
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.rfAdminUser.update({
    where: { email },
    data: { passwordHash }
  });

  console.log(`Password reset successfully for ${email}.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
