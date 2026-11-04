/**
 * Email templates for RF Intelligence.
 * Produces both semantic, cross-client HTML and plain-text fallback.
 */

export interface InvitationEmailProps {
  recipientName?: string;
  inviterName: string;
  organizationName: string;
  jobTitle?: string;
  role?: string;
  acceptUrl: string;
  expiresDays?: number;
}

export function renderInvitationEmail(props: InvitationEmailProps): {
  subject: string;
  text: string;
  html: string;
} {
  const {
    recipientName,
    inviterName,
    organizationName,
    jobTitle,
    role,
    acceptUrl,
    expiresDays = 7,
  } = props;

  const greeting = recipientName ? `Hi ${recipientName},` : "Hello,";
  const roleDisplay = jobTitle ? `${jobTitle}${role ? ` (${role})` : ""}` : (role || "Team Member");
  const subject = `You've been invited to join ${organizationName} on RF Intelligence`;

  const text = [
    greeting,
    "",
    `${inviterName} has invited you to join ${organizationName} on RF Intelligence as a ${roleDisplay}.`,
    "",
    "Accept your invitation and set up your account here:",
    acceptUrl,
    "",
    `This invitation link is valid for ${expiresDays} days. If you did not expect this invitation, you can safely ignore this email.`,
    "",
    "— The RF Intelligence Team",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #0b0f17;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
    }
    .wrapper {
      width: 100%;
      background-color: #0b0f17;
      padding: 40px 16px;
      box-sizing: border-box;
    }
    .card {
      max-width: 560px;
      margin: 0 auto;
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    }
    .header {
      background: linear-gradient(135deg, #182234 0%, #111827 100%);
      padding: 32px 32px 24px;
      border-bottom: 1px solid #1f2937;
    }
    .brand-badge {
      display: inline-block;
      padding: 4px 10px;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 6px;
      color: #f87171;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 12px;
    }
    .title {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.02em;
    }
    .content {
      padding: 32px;
    }
    .greeting {
      font-size: 16px;
      color: #f1f5f9;
      margin-top: 0;
      margin-bottom: 16px;
    }
    .lead {
      font-size: 15px;
      color: #cbd5e1;
      margin-bottom: 24px;
    }
    .info-box {
      background: #1a2234;
      border: 1px solid #283548;
      border-radius: 8px;
      padding: 18px 20px;
      margin-bottom: 28px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 14px;
      border-bottom: 1px solid #232f42;
    }
    .info-row:last-child {
      border-bottom: none;
    }
    .info-label {
      color: #94a3b8;
    }
    .info-value {
      color: #f8fafc;
      font-weight: 600;
      text-align: right;
    }
    .cta-container {
      text-align: center;
      margin: 32px 0;
    }
    .btn {
      display: inline-block;
      background-color: #ef4444;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      padding: 14px 32px;
      border-radius: 8px;
      box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4);
      transition: background-color 0.2s ease;
    }
    .btn:hover {
      background-color: #dc2626;
    }
    .fallback-link {
      background: #0d131f;
      border: 1px dashed #334155;
      border-radius: 6px;
      padding: 12px;
      font-size: 12px;
      color: #94a3b8;
      word-break: break-all;
      margin-top: 20px;
    }
    .fallback-link a {
      color: #60a5fa;
      text-decoration: none;
    }
    .footer {
      padding: 24px 32px;
      background: #0d131f;
      border-top: 1px solid #1f2937;
      font-size: 12px;
      color: #64748b;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div class="brand-badge">RF Intelligence Team</div>
        <h1 class="title">Workspace Invitation</h1>
      </div>
      <div class="content">
        <p class="greeting">${greeting}</p>
        <p class="lead">
          <strong style="color: #ffffff;">${inviterName}</strong> has invited you to join <strong style="color: #ffffff;">${organizationName}</strong> on the RF Intelligence SaaS platform.
        </p>

        <div class="info-box">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #94a3b8; font-size: 14px;">Organization:</td>
              <td style="padding: 6px 0; color: #f8fafc; font-weight: 600; font-size: 14px; text-align: right;">${organizationName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #94a3b8; font-size: 14px; border-top: 1px solid #232f42;">Invited By:</td>
              <td style="padding: 6px 0; color: #f8fafc; font-weight: 600; font-size: 14px; text-align: right; border-top: 1px solid #232f42;">${inviterName}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #94a3b8; font-size: 14px; border-top: 1px solid #232f42;">Professional Role:</td>
              <td style="padding: 6px 0; color: #f8fafc; font-weight: 600; font-size: 14px; text-align: right; border-top: 1px solid #232f42;">${roleDisplay}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #94a3b8; font-size: 14px; border-top: 1px solid #232f42;">Expires:</td>
              <td style="padding: 6px 0; color: #f8fafc; font-weight: 600; font-size: 14px; text-align: right; border-top: 1px solid #232f42;">${expiresDays} days</td>
            </tr>
          </table>
        </div>

        <div class="cta-container">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${acceptUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="17%" stroke="f" fillcolor="#ef4444">
            <w:anchorlock/>
            <center>
          <![endif]-->
          <a href="${acceptUrl}" class="btn" target="_blank">Accept Invitation</a>
          <!--[if mso]>
            </center>
          </v:roundrect>
          <![endif]-->
        </div>

        <p style="font-size: 13px; color: #94a3b8; margin-top: 24px; text-align: center;">
          Click the button above to accept the invitation and set up your password.
        </p>

        <div class="fallback-link">
          If the button does not work, copy and paste this link into your browser:<br>
          <a href="${acceptUrl}" target="_blank">${acceptUrl}</a>
        </div>
      </div>
      <div class="footer">
        This link is single-use and will expire in ${expiresDays} days.<br>
        If you did not expect an invitation to join ${organizationName}, you can safely disregard this email.
      </div>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
