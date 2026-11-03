const fs = require('fs');
const envContent = fs.readFileSync('c:/Users/Sameer Walikar/Desktop/avi/apps/dashboard/.env', 'utf8');
for (const line of envContent.split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

const { PrismaClient } = require('c:/Users/Sameer Walikar/Desktop/avi/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    console.log("Adding customer table columns if missing...");
    const stmts = [
      'ALTER TABLE customers ADD COLUMN IF NOT EXISTS "paymentTermsDays" INTEGER;',
      'ALTER TABLE customers ADD COLUMN IF NOT EXISTS "taxId" TEXT;',
      'ALTER TABLE customers ADD COLUMN IF NOT EXISTS "orderReference" TEXT;',
      'ALTER TABLE customers ADD COLUMN IF NOT EXISTS "lastInteractionAt" TIMESTAMP(3);',
      'ALTER TABLE customers ADD COLUMN IF NOT EXISTS "internalNotes" TEXT;',
      'ALTER TABLE customers ADD COLUMN IF NOT EXISTS "assignedEmployeeId" TEXT;'
    ];

    for (const sql of stmts) {
      await prisma.$executeRawUnsafe(sql);
      console.log("Executed:", sql);
    }
    
    console.log("Customer table columns verified.");
  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
