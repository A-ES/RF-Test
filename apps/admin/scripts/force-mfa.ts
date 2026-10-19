import "./env";
import { prisma } from "@rf-intelligence/db";
import { encryptSecret } from "../lib/crypto";
import { generateTotpSecret, otpauthUri } from "../lib/totp";

async function main() {
  let email = (process.argv[2] || process.env.RF_ADMIN_EMAIL || "").trim().toLowerCase();
  
  if (!email) {
    const defaultAdmin = await prisma.rfAdminUser.findFirst({
      orderBy: { createdAt: "asc" },
      select: { email: true }
    });
    if (defaultAdmin) {
      email = defaultAdmin.email;
    } else {
      console.error("No admin user found in database.");
      process.exit(1);
    }
  }

  const admin = await prisma.rfAdminUser.findUnique({ where: { email } });
  if (!admin) {
    console.error(`Admin with email ${email} not found.`);
    const allAdmins = await prisma.rfAdminUser.findMany({ select: { email: true } });
    console.log("Existing admins:", allAdmins.map(a => a.email).join(", "));
    process.exit(1);
  }

  const secret = generateTotpSecret();
  const uri = otpauthUri({ secret, account: email, issuer: "RF Intelligence" });

  await prisma.rfAdminUser.update({
    where: { email },
    data: {
      mfaSecretCiphertext: encryptSecret(secret),
      mfaEnabled: true,
      mfaEnrolledAt: new Date(),
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
      mfaLastUsedStep: null,
    },
  });

  console.log("=========================================");
  console.log("MFA forcefully enrolled for:", email);
  console.log("Secret to enter in Authenticator:", secret);
  console.log("Or use this URI:", uri);
  console.log("=========================================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
