import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { redactUrl } from "./url";

/**
 * Robust SMTP email delivery abstraction for RF Intelligence using Nodemailer.
 *
 * Supports:
 *   - "smtp" (default production provider): delivers emails via any standard SMTP host
 *     (Gmail, Outlook, Amazon SES, SendGrid SMTP, Postmark SMTP, custom corporate SMTP)
 *   - "console" (offline development fallback): logs redacted emails to stdout
 *
 * Never exposes SMTP passwords, API secrets, or invitation tokens in logs or responses.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  body: string; // Plain text content
  html?: string; // Rich semantic HTML template
  from?: string; // Optional custom sender address
}

export interface EmailResult {
  delivered: boolean;
  provider: string; // "smtp" | "console"
  providerMessageId?: string;
  error?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface SmtpVerificationResult {
  ok: boolean;
  error?: string;
}

/**
 * Returns the currently active email provider name.
 * Defaults to "smtp" unless explicitly overridden with EMAIL_PROVIDER="console".
 */
export function emailProviderName(): string {
  const envProvider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (envProvider) return envProvider;
  return "smtp";
}

/**
 * Reads and normalizes SMTP configuration from environment variables.
 * Returns null if required credentials (host, user, pass) are absent.
 */
export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const portStr = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const secureStr = process.env.SMTP_SECURE?.trim().toLowerCase();

  if (!host || !user || !pass) {
    return null;
  }

  const port = portStr ? parseInt(portStr, 10) : 587;
  const isPort465 = port === 465;
  const secure = secureStr === "true" || secureStr === "1" || (isPort465 && secureStr !== "false" && secureStr !== "0");

  const from =
    process.env.EMAIL_FROM?.trim() ||
    (user ? `RF Intelligence <${user}>` : "RF Intelligence <no-reply@rfintelligence.com>");

  return {
    host,
    port: isNaN(port) ? 587 : port,
    secure,
    user,
    pass,
    from,
  };
}

/**
 * Validates the SMTP environment configuration.
 * Returns a list of human-readable issues if any variables are missing or invalid.
 */
export function validateSmtpConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!process.env.SMTP_HOST?.trim()) {
    errors.push("SMTP_HOST is required (e.g. smtp.gmail.com)");
  }
  if (!process.env.SMTP_USER?.trim()) {
    errors.push("SMTP_USER is required (e.g. your-email@gmail.com)");
  }
  if (!process.env.SMTP_PASS?.trim()) {
    errors.push(
      "SMTP_PASS is required (for Gmail, generate an App Password with 2FA enabled)",
    );
  }
  const port = process.env.SMTP_PORT?.trim();
  if (port && isNaN(parseInt(port, 10))) {
    errors.push("SMTP_PORT must be a numeric port (e.g. 587 or 465)");
  }
  return { valid: errors.length === 0, errors };
}

let cachedTransporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;
let cachedConfigKey = "";

/**
 * Resolves or constructs a singleton Nodemailer SMTP transporter.
 */
export function getSmtpTransporter(
  forceNew = false,
): Transporter<SMTPTransport.SentMessageInfo> | null {
  const config = getSmtpConfig();
  if (!config) return null;

  const configKey = `${config.host}:${config.port}:${config.secure}:${config.user}`;
  if (!forceNew && cachedTransporter && cachedConfigKey === configKey) {
    return cachedTransporter;
  }

  const transportOptions: SMTPTransport.Options = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    // Standard network timeouts to prevent hanging on unresponsive SMTP hosts
    connectionTimeout: 10_000, // 10s connection establishment timeout
    greetingTimeout: 5_000,    // 5s banner greeting timeout
    socketTimeout: 15_000,      // 15s inactivity socket timeout
  };

  const transporter = nodemailer.createTransport(transportOptions);
  cachedTransporter = transporter;
  cachedConfigKey = configKey;
  return transporter;
}

/**
 * Verifies the SMTP connection and authentication credentials.
 * Used for administrative diagnostics and automated health-checks.
 */
export async function verifySmtpConnection(): Promise<SmtpVerificationResult> {
  const validation = validateSmtpConfig();
  if (!validation.valid) {
    return { ok: false, error: validation.errors.join("; ") };
  }

  const transporter = getSmtpTransporter(true);
  if (!transporter) {
    return { ok: false, error: "Unable to initialize SMTP transporter from configuration" };
  }

  try {
    await transporter.verify();
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "SMTP connection or authentication failed";
    console.error("[email:smtp] Transporter verification failed:", message);
    return { ok: false, error: message };
  }
}

/**
 * Main email dispatch function.
 * Safely handles SMTP credentials, TLS connections, provider errors, and token redaction.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const provider = emailProviderName();

  if (provider === "smtp") {
    const config = getSmtpConfig();

    if (!config) {
      const validation = validateSmtpConfig();
      const err =
        validation.errors.length > 0
          ? `SMTP not configured: ${validation.errors.join(", ")}`
          : "SMTP credentials not configured in environment variables";
      console.warn(`[email:smtp] Cannot deliver email to ${message.to}: ${err}`);
      return {
        delivered: false,
        provider: "smtp",
        error: err,
      };
    }

    try {
      const transporter = getSmtpTransporter();
      if (!transporter) {
        throw new Error("Unable to create SMTP transporter");
      }

      const fromAddress = message.from?.trim() || config.from;

      const mailOptions = {
        from: fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.body,
        html: message.html,
      };

      const info = await transporter.sendMail(mailOptions);
      const messageId = info.messageId || `smtp_${Date.now()}`;

      console.info(
        `[email:smtp] Email accepted by SMTP server for ${message.to} (Message ID: ${messageId})`,
      );

      return {
        delivered: true,
        provider: "smtp",
        providerMessageId: messageId,
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Unexpected exception during SMTP email send";
      console.error(
        `[email:smtp] Delivery error for ${message.to}: ${errorMessage}`,
      );
      return {
        delivered: false,
        provider: "smtp",
        error: errorMessage,
      };
    }
  }

  if (provider === "console") {
    // Redact tokens and secret links before printing to console
    const safeBody = redactUrl(message.body);
    const divider = "─".repeat(60);
    process.stdout.write(
      [
        "",
        divider,
        `[email:console] Simulated Email Dispatch`,
        `  To:      ${message.to}`,
        `  Subject: ${message.subject}`,
        `  Body:`,
        ...safeBody.split("\n").map((line) => `    ${line}`),
        divider,
        "",
      ].join("\n"),
    );
    return {
      delivered: true,
      provider: "console",
      providerMessageId: `console_${Date.now()}`,
    };
  }

  // Unknown/unconfigured provider
  console.warn(`[email] Provider "${provider}" is not recognized; message dropped.`);
  return {
    delivered: false,
    provider,
    error: `Unsupported provider: ${provider}`,
  };
}
