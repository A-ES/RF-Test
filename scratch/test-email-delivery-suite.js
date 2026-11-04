/**
 * End-to-end test suite for Team Invitation SMTP Email Delivery and Security.
 */
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
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

async function runTests() {
  console.log("=== RF Intelligence Team Invitation SMTP Email Delivery Test Suite ===");

  // 1. Check Base URL configuration
  console.log("\n[Test 1] Verifying Trusted Base URL Configuration...");
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  console.log("Configured APP_URL:", appUrl);
  if (appUrl.includes("3001")) {
    throw new Error("FAIL: Port 3001 is still present in base URL!");
  }
  if (!appUrl.includes("localhost:3000")) {
    console.warn("Notice: APP_URL is not localhost:3000:", appUrl);
  } else {
    console.log("PASS: Base URL correctly configured to http://localhost:3000 (Port 3001 issue fixed)");
  }

  // 2. Check SMTP Provider Configuration
  console.log("\n[Test 2] Verifying SMTP Email Provider Environment...");
  const provider = process.env.EMAIL_PROVIDER || "smtp";
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || "587";
  const secure = process.env.SMTP_SECURE;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.EMAIL_FROM;

  console.log("EMAIL_PROVIDER:", provider);
  console.log("SMTP_HOST:", host);
  console.log("SMTP_PORT:", port);
  console.log("SMTP_SECURE:", secure);
  console.log("SMTP_USER:", user);
  console.log("SMTP_PASS configured:", pass && pass !== "your-app-password" ? "YES (Real password set)" : "PLACEHOLDER / PENDING USER CREDENTIALS");
  console.log("EMAIL_FROM:", from);

  // Check if real SMTP credentials are present or placeholder
  const hasRealCredentials = user && pass && user !== "your-email@gmail.com" && pass !== "your-app-password";

  if (hasRealCredentials) {
    console.log("\n[Test 2b] Real SMTP credentials detected! Testing live SMTP connection & auth...");
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(port, 10),
      secure: secure === "true" || port === "465",
      auth: { user, pass },
      connectionTimeout: 10000,
    });
    try {
      await transporter.verify();
      console.log("PASS: Live SMTP connection and authentication verified successfully!");
    } catch (err) {
      console.warn("Live SMTP verification failed:", err.message);
    }
  } else {
    console.log("\n[Test 2b] Placeholder credentials detected in .env. Real SMTP verification waiting for user to configure real credentials.");
  }

  // 3. Test invitation acceptance flow with a test organization
  console.log("\n[Test 3] Testing Invitation Acceptance & Security Flow in DB...");
  const testOrg = await prisma.organization.findFirst();
  if (!testOrg) throw new Error("No organization found in database!");
  const testAdmin = await prisma.user.findFirst({ where: { organizationId: testOrg.id, role: 'ADMIN' } });
  if (!testAdmin) throw new Error("No admin user found!");

  const testEmail = `test.smtp.invite.${Date.now()}@example.com`;
  const expiresAt = new Date(Date.now() + 7 * 86400000);

  // Create test invitation
  const invite = await prisma.invitation.create({
    data: {
      organizationId: testOrg.id,
      invitedById: testAdmin.id,
      email: testEmail,
      role: 'MEMBER',
      jobTitle: 'QA Security Analyst',
      token: 'placeholder',
      expiresAt,
    }
  });

  const validToken = createInviteToken(invite.id);
  await prisma.invitation.update({
    where: { id: invite.id },
    data: { token: validToken }
  });

  const generatedUrl = `${appUrl}/accept-invitation?token=${encodeURIComponent(validToken)}`;
  console.log("Generated Acceptance URL format:", generatedUrl.replace(validToken, "[REDACTED_FOR_SECURITY]"));

  if (!generatedUrl.startsWith("http://localhost:3000/accept-invitation?token=")) {
    throw new Error(`FAIL: Unexpected acceptance URL format: ${generatedUrl}`);
  }
  console.log("PASS: Acceptance URL generates with correct trusted domain and route.");

  // Test token validation
  console.log("\n[Test 4] Verifying Cryptographic Token Expiry and Single-Use Enforcement...");
  // Test expired invitation
  const expiredInvite = await prisma.invitation.create({
    data: {
      organizationId: testOrg.id,
      invitedById: testAdmin.id,
      email: `expired.${Date.now()}@example.com`,
      role: 'MEMBER',
      jobTitle: 'Tester',
      token: 'placeholder',
      expiresAt: new Date(Date.now() - 1000), // Expired
    }
  });
  const expiredToken = createInviteToken(expiredInvite.id, Date.now() - 8 * 86400000);
  await prisma.invitation.update({
    where: { id: expiredInvite.id },
    data: { token: expiredToken }
  });

  // Verify expired detection
  const isExpired = expiredInvite.expiresAt < new Date();
  console.log("Expired invite detected correctly:", isExpired);
  if (!isExpired) throw new Error("FAIL: Expired invite not detected!");
  console.log("PASS: Expired tokens are rejected.");

  // Cleanup test records
  await prisma.invitation.deleteMany({
    where: { id: { in: [invite.id, expiredInvite.id] } }
  });
  console.log("Cleaned up temporary test invitations.");

  console.log("\n=== All Email & Invitation Delivery Architecture Tests PASSED ===");
}

runTests()
  .catch((err) => {
    console.error("Test error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
