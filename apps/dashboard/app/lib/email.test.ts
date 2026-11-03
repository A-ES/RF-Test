import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => {
  const sendMail = vi.fn();
  const verify = vi.fn();
  const createTransport = vi.fn(() => ({
    sendMail: h.sendMail,
    verify: h.verify,
  }));

  return {
    sendMail,
    verify,
    createTransport,
  };
});

vi.mock("nodemailer", () => ({
  default: {
    createTransport: h.createTransport,
  },
}));

import {
  emailProviderName,
  getSmtpConfig,
  validateSmtpConfig,
  verifySmtpConnection,
  sendEmail,
} from "./email";

describe("Email & SMTP Delivery Subsystem", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Configuration & Validation", () => {
    it("reports missing SMTP credentials when environment variables are unset", () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const result = validateSmtpConfig();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("SMTP_HOST is required (e.g. smtp.gmail.com)");
      expect(result.errors).toContain("SMTP_USER is required (e.g. your-email@gmail.com)");
      expect(result.errors).toContain(
        "SMTP_PASS is required (for Gmail, generate an App Password with 2FA enabled)",
      );
    });

    it("reports invalid port number", () => {
      process.env.SMTP_HOST = "smtp.gmail.com";
      process.env.SMTP_USER = "admin@example.com";
      process.env.SMTP_PASS = "secret-pass";
      process.env.SMTP_PORT = "invalid_port";

      const result = validateSmtpConfig();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("SMTP_PORT must be a numeric port (e.g. 587 or 465)");
    });

    it("validates successfully with proper SMTP environment settings", () => {
      process.env.SMTP_HOST = "smtp.gmail.com";
      process.env.SMTP_USER = "admin@example.com";
      process.env.SMTP_PASS = "app-password";
      process.env.SMTP_PORT = "587";
      process.env.SMTP_SECURE = "false";

      const result = validateSmtpConfig();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("parses SMTP config properly including port 465 secure detection", () => {
      process.env.SMTP_HOST = "smtp.gmail.com";
      process.env.SMTP_USER = "admin@example.com";
      process.env.SMTP_PASS = "secret";
      process.env.SMTP_PORT = "465";
      delete process.env.SMTP_SECURE;

      const config = getSmtpConfig();
      expect(config).not.toBeNull();
      expect(config?.port).toBe(465);
      expect(config?.secure).toBe(true);
    });

    it("defaults provider to smtp when EMAIL_PROVIDER is not specified", () => {
      delete process.env.EMAIL_PROVIDER;
      expect(emailProviderName()).toBe("smtp");
    });
  });

  describe("SMTP Transporter & Connection Verification", () => {
    it("returns error from verifySmtpConnection when config is incomplete", async () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const result = await verifySmtpConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SMTP_HOST is required");
    });

    it("returns ok: true when transporter.verify() succeeds", async () => {
      process.env.SMTP_HOST = "smtp.gmail.com";
      process.env.SMTP_USER = "user@example.com";
      process.env.SMTP_PASS = "pass";
      h.verify.mockResolvedValueOnce(true);

      const result = await verifySmtpConnection();
      expect(result.ok).toBe(true);
      expect(h.verify).toHaveBeenCalled();
    });

    it("captures and returns error when authentication or connection fails", async () => {
      process.env.SMTP_HOST = "smtp.gmail.com";
      process.env.SMTP_USER = "user@example.com";
      process.env.SMTP_PASS = "wrong-pass";
      h.verify.mockRejectedValueOnce(
        new Error("535-5.7.8 Username and Password not accepted"),
      );

      const result = await verifySmtpConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("535-5.7.8 Username and Password not accepted");
    });
  });

  describe("sendEmail Dispatches", () => {
    it("returns delivered: false with descriptive message when SMTP credentials are unconfigured", async () => {
      process.env.EMAIL_PROVIDER = "smtp";
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const result = await sendEmail({
        to: "recipient@example.com",
        subject: "Invitation",
        body: "Hello",
      });

      expect(result.delivered).toBe(false);
      expect(result.provider).toBe("smtp");
      expect(result.error).toContain("SMTP not configured");
      expect(h.sendMail).not.toHaveBeenCalled();
    });

    it("sends email successfully through SMTP transporter and returns message ID", async () => {
      process.env.EMAIL_PROVIDER = "smtp";
      process.env.SMTP_HOST = "smtp.gmail.com";
      process.env.SMTP_USER = "admin@rfintelligence.com";
      process.env.SMTP_PASS = "app-password-123";
      process.env.EMAIL_FROM = "RF Intelligence <admin@rfintelligence.com>";

      h.sendMail.mockResolvedValueOnce({
        messageId: "<msg-id-12345@smtp.gmail.com>",
      });

      const result = await sendEmail({
        to: "newhire@example.com",
        subject: "Welcome to RF Intelligence",
        body: "Plain text invitation body",
        html: "<p>HTML invitation body</p>",
      });

      expect(result.delivered).toBe(true);
      expect(result.provider).toBe("smtp");
      expect(result.providerMessageId).toBe("<msg-id-12345@smtp.gmail.com>");
      expect(h.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "RF Intelligence <admin@rfintelligence.com>",
          to: "newhire@example.com",
          subject: "Welcome to RF Intelligence",
          text: "Plain text invitation body",
          html: "<p>HTML invitation body</p>",
        }),
      );
    });

    it("handles SMTP delivery rejections without throwing", async () => {
      process.env.EMAIL_PROVIDER = "smtp";
      process.env.SMTP_HOST = "smtp.gmail.com";
      process.env.SMTP_USER = "admin@rfintelligence.com";
      process.env.SMTP_PASS = "app-password-123";

      h.sendMail.mockRejectedValueOnce(
        new Error("550 5.1.1 The email account that you tried to reach does not exist"),
      );

      const result = await sendEmail({
        to: "nonexistent@example.com",
        subject: "Welcome",
        body: "Body",
      });

      expect(result.delivered).toBe(false);
      expect(result.provider).toBe("smtp");
      expect(result.error).toContain("550 5.1.1");
    });

    it("supports console provider and redacts sensitive URLs in output", async () => {
      process.env.EMAIL_PROVIDER = "console";
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      const result = await sendEmail({
        to: "test@example.com",
        subject: "Invite",
        body: "Visit http://localhost:3000/accept-invitation?token=secret123 to accept",
      });

      expect(result.delivered).toBe(true);
      expect(result.provider).toBe("console");
      expect(stdoutSpy).toHaveBeenCalled();
      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
      expect(output).toContain("[REDACTED]");
      expect(output).not.toContain("secret123");

      stdoutSpy.mockRestore();
    });
  });
});
