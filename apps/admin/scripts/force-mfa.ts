import { prisma } from "@rf-intelligence/db";
import { encryptSecret } from "../lib/crypto";
import { generateTotpSecret, otpauthUri } from "../lib/totp";

async function main() {
  const email = "admin@rf-intelligence.com";
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
