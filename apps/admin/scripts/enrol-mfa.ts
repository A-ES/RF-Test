/**
 * MFA enrolment for RF admin accounts.
 *
 * The console has no self-service enrolment UI yet (that is feature-screen
 * work), and enrolment needs the AES key that only the admin app's environment
 * holds. So it is a CLI, run by whoever operates the console:
 *
 *   pnpm admin:enrol-mfa --email admin@rf-intelligence.com
 *
 * It prints the secret and an otpauth:// URI for the operator to scan, writes the
 * encrypted secret, and asks for a live code as confirmation. If no code is
 * supplied the account is left unenrolled, because enabling MFA without a
 * verified authenticator would lock the operator out of their own console.
 */
import { prisma } from "@rf-intelligence/db";
import { encryptSecret } from "../lib/crypto";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../lib/totp";

const ISSUER = "RF Intelligence";

function parseEmailArg(argv: string[]): string {
  const index = argv.indexOf("--email");
  if (index !== -1 && argv[index + 1]) return argv[index + 1].trim().toLowerCase();
  return process.env.RF_ADMIN_EMAIL?.trim().toLowerCase() ?? "";
}

async function main(): Promise<void> {
  const email = parseEmailArg(process.argv.slice(2));
  if (!email) {
    console.error("Usage: pnpm admin:enrol-mfa --email <rf-admin email>");
    process.exit(1);
  }

  if (!process.env.RF_ADMIN_MFA_ENCRYPTION_KEY) {
    console.error(
      "RF_ADMIN_MFA_ENCRYPTION_KEY is not set.\n" +
        "Generate one with `openssl rand -base64 32` and put it in the admin app's environment.",
    );
    process.exit(1);
  }

  const admin = await prisma.rfAdminUser.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, mfaEnabled: true, mfaEnrolledAt: true },
  });
  if (!admin) {
    console.error(`No RF admin with email ${email}.`);
    console.error("Create one with: pnpm --filter @rf-intelligence/admin admin:create");
    process.exit(1);
  }

  const secret = generateTotpSecret();
  const uri = otpauthUri({ secret, account: admin.email, issuer: ISSUER });

  console.log("");
  console.log(`  Account : ${admin.name} <${admin.email}>`);
  console.log(`  Status  : ${admin.mfaEnabled ? "MFA already enabled — re-enrolling" : "not enrolled"}`);
  console.log("");
  console.log("  Add this to your authenticator app (Google Authenticator, 1Password, …):");
  console.log("");
  console.log(`    Secret : ${secret}`);
  console.log(`    URI    : ${uri}`);
  console.log("");

  const code = (await prompt("  Enter the current 6-digit code to confirm, or press Enter to abort: "))
    .trim()
    .replace(/\s+/g, "");

  if (!code) {
    console.log("\n  Aborted. No changes were made.");
    return;
  }

  const result = verifyTotp(secret, code);
  if (!result.valid) {
    console.error("\n  That code is not valid for this secret. Nothing was saved — try again.");
    process.exit(1);
  }

  await prisma.rfAdminUser.update({
    where: { id: admin.id },
    data: {
      mfaSecretCiphertext: encryptSecret(secret),
      mfaEnabled: true,
      mfaEnrolledAt: new Date(),
      // Clear any lockout left over from the previous enrolment so the operator
      // can sign in immediately with the new authenticator.
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
      mfaLastUsedStep: null,
    },
  });

  console.log("\n  ✓ MFA enrolled. Sign-in now requires this authenticator.");
  console.log(`  Keep the secret safe: it is the only way to recover access without re-enrolling.`);
  console.log(
    `  Rotating RF_ADMIN_MFA_ENCRYPTION_KEY will invalidate this enrolment — ` +
      `re-run this command for every admin afterwards.`,
  );
}

/** Reads one line from stdin, resolving to "" on EOF (e.g. under `pnpm -y`). */
function prompt(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      process.stdin.setEncoding("utf8");
      process.stdin.once("data", (chunk: string) => {
        process.stdin.pause();
        resolve(chunk.split("\n")[0] ?? "");
      });
      return;
    }
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    process.stdin.once("end", () => resolve(buffer.trim()));
    process.stdin.once("error", () => resolve(""));
    process.stdin.resume();
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
