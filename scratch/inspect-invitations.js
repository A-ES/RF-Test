const fs = require('fs');
const env = fs.readFileSync('apps/dashboard/.env', 'utf8');
for (const l of env.split(/\r?\n/)) {
  const m = l.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const invites = await prisma.invitation.findMany({
    select: {
      id: true,
      email: true,
      status: true,
      role: true,
      jobTitle: true,
      token: true,
      createdAt: true,
      expiresAt: true,
    },
  });
  console.log("Current Invitations in DB:", invites);
  await prisma.$disconnect();
}

check();
