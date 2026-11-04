const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
require('dotenv').config({ path: './apps/dashboard/.env' });

const prisma = new PrismaClient();

function getSecret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not configured");
  return s;
}

function sign(payload) {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function createInviteToken(invitationId, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({ iid: invitationId, iat: now })
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

async function main() {
  const pendingInvs = await prisma.invitation.findMany({
    where: { status: 'PENDING' }
  });

  console.log(`Regenerating tokens for ${pendingInvs.length} exposed pending invitations...`);

  for (const inv of pendingInvs) {
    const oldTokenShort = inv.token.slice(0, 15) + '...';
    const newToken = createInviteToken(inv.id);
    const newTokenShort = newToken.slice(0, 15) + '...';

    await prisma.invitation.update({
      where: { id: inv.id },
      data: { token: newToken }
    });

    console.log(`[REVOKED & REGENERATED] ID: ${inv.id} (${inv.email}): Old: ${oldTokenShort} -> New: ${newTokenShort}`);
  }

  console.log('Done! All previously exposed tokens have been invalidated and safely refreshed.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
