/**
 * Updates an RF admin account's email and password.
 *
 * Usage:
 *   pnpm admin:update --new-email <new-email> [--password <password>] [--old-email <old-email>] [--name <name>] [--reset-mfa]
 *
 * Or non-interactive with env:
 *   RF_ADMIN_NEW_PASSWORD="strongpassword123" pnpm admin:update --new-email admin@mydomain.com
 */
import "./env";
import { prisma } from "@rf-intelligence/db";
import { hashPassword } from "../lib/password";
import { encryptSecret } from "../lib/crypto";
import { generateTotpSecret, otpauthUri } from "../lib/totp";
import { recordAuditEvent } from "../lib/audit";

function argValue(argv: string[], name: string): string {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return "";
  return (argv[index + 1] ?? "").trim();
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function promptPassword(): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      console.error(
        "No TTY available. Set RF_ADMIN_NEW_PASSWORD or pass --password <password>.",
      );
      resolve("");
      return;
    }
    const stdin = process.stdin;
    const original = process.stdout.write.bind(process.stdout);
    (process.stdout as NodeJS.WriteStream).write = ((chunk: string, ...rest: unknown[]) => {
      if (typeof chunk === "string" && chunk.includes(":")) return true;
      return original(chunk, ...(rest as []));
    }) as typeof process.stdout.write;

    process.stdout.write("  New Password (min 12 chars): ");
    stdin.setEncoding("utf8");
    stdin.once("data", (chunk: string) => {
      (process.stdout as NodeJS.WriteStream).write = original;
      process.stdout.write("\n");
      stdin.pause();
      resolve(chunk.split("\n")[0] ?? "");
    });
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (hasFlag(argv, "help") || hasFlag(argv, "h") || argv.length === 0) {
    console.log(`
Usage:
  pnpm admin:update --new-email <new-email> [--password <password>] [options]

Options:
  --new-email, --email   New email address for the admin
  --password             New password (minimum 12 characters). If omitted, prompts securely.
  --old-email            Email of the existing admin to update (defaults to the existing admin)
  --name                 Optional new display name
  --reset-mfa            Reset MFA secret and generate a new QR / authenticator URI
  --help, -h             Show this help message

Environment variables:
  RF_ADMIN_NEW_PASSWORD  Can be used instead of --password for non-interactive execution
`);
    process.exit(0);
  }

  const newEmail = (argValue(argv, "new-email") || argValue(argv, "email") || "").trim().toLowerCase();
  let oldEmail = argValue(argv, "old-email").trim().toLowerCase();
  const newName = argValue(argv, "name").trim();
  const resetMfa = hasFlag(argv, "reset-mfa");

  // Determine which admin to update
  if (!oldEmail) {
    const admins = await prisma.rfAdminUser.findMany({
      select: { id: true, email: true, name: true },
      orderBy: { createdAt: "asc" },
    });

    if (admins.length === 0) {
      console.error("No admin accounts found. Create one first with `pnpm admin:create`.");
      process.exit(1);
    }

    if (admins.length === 1) {
      oldEmail = admins[0].email;
    } else {
      console.error("Multiple admin accounts exist. Please specify --old-email <email>.");
      console.log("Existing admins:", admins.map((a) => a.email).join(", "));
      process.exit(1);
    }
  }

  const existingAdmin = await prisma.rfAdminUser.findUnique({
    where: { email: oldEmail },
  });

  if (!existingAdmin) {
    console.error(`Admin with email "${oldEmail}" not found.`);
    const admins = await prisma.rfAdminUser.findMany({ select: { email: true } });
    console.log("Existing admins:", admins.map((a) => a.email).join(", "));
    process.exit(1);
  }

  // Check if new email is different and if it's already taken by another admin
  const targetEmail = newEmail || oldEmail;
  if (newEmail && newEmail !== oldEmail) {
    const conflict = await prisma.rfAdminUser.findUnique({
      where: { email: newEmail },
    });
    if (conflict) {
      console.error(`An admin with email "${newEmail}" already exists.`);
      process.exit(1);
    }
  }

  // Read or prompt password
  let password = argValue(argv, "password") || process.env.RF_ADMIN_NEW_PASSWORD || "";
  if (!password) {
    password = await promptPassword();
  }

  if (!password) {
    console.error("A new password is required.");
    process.exit(1);
  }

  if (password.length < 12) {
    console.error("Refusing to set a password shorter than 12 characters on the admin console.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  const updateData: Parameters<typeof prisma.rfAdminUser.update>[0]["data"] = {
    email: targetEmail,
    passwordHash,
    name: newName || (newEmail && existingAdmin.name === "RF Console Admin" ? (newEmail.split("@")[0] ?? existingAdmin.name) : existingAdmin.name),
    mfaFailedAttempts: 0,
    mfaLockedUntil: null,
  };

  let newTotpSecret: string | null = null;
  let newTotpUri: string | null = null;

  if (resetMfa) {
    newTotpSecret = generateTotpSecret();
    newTotpUri = otpauthUri({ secret: newTotpSecret, account: targetEmail, issuer: "RF Intelligence" });
    updateData.mfaSecretCiphertext = encryptSecret(newTotpSecret);
    updateData.mfaEnabled = true;
    updateData.mfaEnrolledAt = new Date();
    updateData.mfaLastUsedStep = null;
  }

  const updated = await prisma.rfAdminUser.update({
    where: { id: existingAdmin.id },
    data: updateData,
    select: { id: true, email: true, name: true, mfaEnabled: true },
  });

  console.log("\n  ✓ Admin account credentials successfully updated!");
  console.log(`    ID    : ${updated.id}`);
  console.log(`    Name  : ${updated.name}`);
  console.log(`    Email : ${updated.email}`);
  console.log(`    Password : [Updated successfully (min 12 characters, scrypt hashed)]`);

  await recordAuditEvent({
    adminId: updated.id,
    action: "rf_admin.credentials_updated",
    entityType: "rf_admin_user",
    entityId: updated.id,
    targetEmail: updated.email,
    succeeded: true,
  });

  if (resetMfa && newTotpSecret && newTotpUri) {
    console.log("\n  ── MFA Authenticator Setup ────────────────────────────────");
    console.log("  A new TOTP MFA secret has been generated for your authenticator app:");
    console.log(`  Secret : ${newTotpSecret}`);
    console.log(`  URI    : ${newTotpUri}`);
    console.log("  Scan the QR code or enter this secret into Google Authenticator or 1Password.");
    console.log("  ───────────────────────────────────────────────────────────\n");
  } else {
    console.log("\n  Note on MFA:");
    if (updated.mfaEnabled) {
      console.log("  • MFA remains enabled. Your existing authenticator code will continue to work.");
      console.log("  • If you want a fresh QR code / label in your authenticator app for the new email, run:");
      console.log(`      pnpm --filter @rf-intelligence/admin admin:force-mfa "${updated.email}"`);
      console.log("    or");
      console.log(`      pnpm --filter @rf-intelligence/admin admin:enrol-mfa --email "${updated.email}"\n`);
    } else {
      console.log("  • MFA is currently disabled. Login requires MFA!");
      console.log(`  • Run: pnpm --filter @rf-intelligence/admin admin:force-mfa "${updated.email}"\n`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
