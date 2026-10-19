import QRCode from "qrcode";
import { hashPassword } from "@/lib/password";
import { generateTotpSecret, otpauthUri } from "@/lib/totp";
import {
  createSetupChallengeToken,
  isSetupAvailable,
  setSetupChallengeCookie,
} from "@/lib/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const setupState = await isSetupAvailable();
  if (!setupState.available) {
    return Response.json(
      { error: "Initial setup has already been completed. Please sign in instead." },
      { status: 403 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = (payload ?? {}) as { name?: unknown; email?: unknown; password?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !email.includes("@")) {
    return Response.json({ error: "A valid email address is required" }, { status: 400 });
  }

  if (!password || password.length < 12) {
    return Response.json(
      { error: "Password must be at least 12 characters long" },
      { status: 400 },
    );
  }

  const displayName = name || email.split("@")[0] || "Admin";

  // Generate TOTP secret and QR code
  const secret = generateTotpSecret();
  const uri = otpauthUri({
    secret,
    account: email,
    issuer: "RF Intelligence",
  });

  const qrCodeDataUrl = await QRCode.toDataURL(uri, {
    errorCorrectionLevel: "M",
    width: 260,
    margin: 2,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });

  const passwordHash = await hashPassword(password);

  const token = createSetupChallengeToken({
    name: displayName,
    email,
    passwordHash,
    secret,
  });

  await setSetupChallengeCookie(token);

  return Response.json({
    ok: true,
    qrCode: qrCodeDataUrl,
    secret,
    uri,
    account: email,
  });
}
