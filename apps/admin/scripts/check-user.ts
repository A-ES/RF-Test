import "./env";
import { prisma } from "@rf-intelligence/db";

async function main() {
  const admin = await prisma.rfAdminUser.findUnique({ where: { email: 'admin@rf-intelligence.com' } });
  console.log(admin);
}

main().catch(console.error).finally(() => prisma.$disconnect());
