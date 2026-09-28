/**
 * Creates an RF admin account.
 *
 * The console has no signup path — an operator is provisioned from the CLI so
 * that adding a cross-tenant identity is always a deliberate, logged action.
 * MFA is enrolled separately with `pnpm admin:enrol-mfa` once the account exists.
 *
 *   pnpm admin:create --email someone@rf-intelligence.com --name "Someone"
 *
 * The password is read from the TTY without echo, or from RF_ADMIN_NEW_PASSWORD
 * for non-interactive use. It is never passed as an argument, so it does not
 * land in shell history.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@rf-intelligence/db";
import { hashPassword } from "../lib/password";
import { recordAuditEvent } from "../lib/audit";

function argValue(argv: string[], name: string): string {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return "";
  return (argv[index + 1] ?? "").trim();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const email = (argValue(argv, "email") || process.env.RF_ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();
  const name = argValue(argv, "name");

  if (!email || !email.includes("@")) {
    console.error("Usage: pnpm admin:create --email <email> [--name <display name>]");
    process.exit(1);
  }

  const existing = await prisma.rfAdminUser.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    console.error(`An RF admin with email ${email} already exists (${existing.id}).`);
    process.exit(1);
  }

  const password = process.env.RF_ADMIN_NEW_PASSWORD || (await promptPassword());
  if (!password) {
    console.error("A password is required.");
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Refusing to set a password shorter than 12 characters on the cross-tenant path.");
    process.exit(1);
  }

  const admin = await prisma.rfAdminUser.create({
    data: {
      id: `rfa_${randomBytes(8).toString("hex")}`,
      name: name || (email.split("@")[0] ?? email),
      email,
      passwordHash: await hashPassword(password),
      isActive: true,
    },
    select: { id: true, email: true },
  });

  console.log(`\n  ✓ Created RF admin ${admin.email} (${admin.id})`);

  // Provisioning a cross-tenant identity is exactly the kind of action the trail
  // exists for. There is no signed-in actor for a CLI, so adminId is null.
  await recordAuditEvent({
    adminId: null,
    action: "rf_admin.create",
    entityType: "rf_admin_user",
    entityId: admin.id,
    targetEmail: admin.email,
    succeeded: true,
  });

  console.log(`    Next: pnpm admin:enrol-mfa --email ${admin.email}`);
}

function promptPassword(): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      console.error(
        "No TTY available. Set RF_ADMIN_NEW_PASSWORD instead of passing it as an argument.",
      );
      resolve("");
      return;
    }
    // Suppress echo so the password is not left on screen.
    const stdin = process.stdin;
    const original = process.stdout.write.bind(process.stdout);
    (process.stdout as NodeJS.WriteStream).write = ((chunk: string, ...rest: unknown[]) => {
      if (typeof chunk === "string" && chunk.includes(":")) return true;
      return original(chunk, ...(rest as []));
    }) as typeof process.stdout.write;

    process.stdout.write("  Password (min 12 chars): ");
    stdin.setEncoding("utf8");
    stdin.once("data", (chunk: string) => {
      (process.stdout as NodeJS.WriteStream).write = original;
      process.stdout.write("\n");
      stdin.pause();
      resolve(chunk.split("\n")[0] ?? "");
    });
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
