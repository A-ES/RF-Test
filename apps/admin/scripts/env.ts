import { existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv(): void {
  const envLocal = resolve(__dirname, "../.env.local");
  const env = resolve(__dirname, "../.env");

  if (existsSync(envLocal)) {
    process.loadEnvFile(envLocal);
  } else if (existsSync(env)) {
    process.loadEnvFile(env);
  }

  process.env.RF_APP = "admin";
  if (!process.env.DATABASE_URL && process.env.ADMIN_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.ADMIN_DATABASE_URL;
  }
}

loadEnv();
