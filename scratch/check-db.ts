import { prisma } from "../packages/db/index";

async function main() {
  console.log("Checking DB connection...");
  try {
    const roles = await prisma.$queryRaw<{ rolname: string }[]>`SELECT rolname FROM pg_roles WHERE rolname = 'rf_admin_app'`;
    console.log("Roles found:", roles);
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    console.log("Tables found:", tables.map(t => t.tablename));
  } catch (err: any) {
    console.error("DB Error:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
