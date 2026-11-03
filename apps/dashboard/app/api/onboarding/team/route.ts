import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { createInviteToken } from "@/app/lib/invite-token";
import { sendEmail } from "@/app/lib/email";
import { writeAuditLog } from "@/app/lib/audit";
import { getAppUrl } from "@/app/lib/url";
import { renderInvitationEmail } from "@/app/lib/email-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface TeamMemberInput {
  name: string;
  email: string;
  role?: string;
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { members?: TeamMemberInput[]; skip?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { members = [], skip = false } = body;

  // Retrieve organization plan and seat limits
  const org = await prisma.organization.findUnique({
    where: { id: session.organizationId },
    include: {
      subscriptions: {
        where: { status: "ACTIVE" },
        include: { plan: true },
        take: 1,
      },
    },
  });

  const activeSub = org?.subscriptions[0];
  const planSlug = activeSub?.plan?.slug ?? "rf-pro";
  // Maximum additional team members: RF Pro allows 4, RF Ultra allows 10
  const maxAdditionalSeats = planSlug === "rf-ultra" ? 10 : 4;

  if (skip || members.length === 0) {
    // Save empty invited members and advance to step 6 (Presentation)
    await prisma.organizationOnboarding.upsert({
      where: { organizationId: session.organizationId },
      create: {
        organizationId: session.organizationId,
        invitedMembers: JSON.stringify([]),
        currentStep: 6,
      },
      update: {
        invitedMembers: JSON.stringify([]),
        currentStep: 6,
      },
    });

    return Response.json({
      ok: true,
      nextStep: 6,
      invitedCount: 0,
      maxAdditionalSeats,
      invitedMembers: [],
    });
  }

  if (members.length > maxAdditionalSeats) {
    return Response.json(
      {
        error: `Your ${activeSub?.plan?.name ?? "selected"} plan allows up to ${maxAdditionalSeats} additional team members. You specified ${members.length}.`,
      },
      { status: 400 }
    );
  }

  // Validate and deduplicate emails
  const seenEmails = new Set<string>();
  const validMembers: TeamMemberInput[] = [];

  for (const m of members) {
    const email = m.email?.trim().toLowerCase();
    const name = m.name?.trim();
    if (!email || !email.includes("@")) {
      return Response.json({ error: `Invalid email address: ${m.email}` }, { status: 400 });
    }
    if (!name) {
      return Response.json({ error: `Name is required for ${email}` }, { status: 400 });
    }
    if (seenEmails.has(email)) {
      return Response.json({ error: `Duplicate email specified: ${email}` }, { status: 400 });
    }
    if (email === session.email.toLowerCase()) {
      return Response.json({ error: `You cannot invite your own account (${email})` }, { status: 400 });
    }
    seenEmails.add(email);
    validMembers.push({
      name,
      email,
      role: m.role?.trim() || "Operations",
    });
  }

  // Process official invitations in the database using the existing invitation system
  const appUrl = getAppUrl(request);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  for (const member of validMembers) {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: member.email },
      select: { id: true, organizationId: true },
    });

    if (existingUser) {
      continue; // Skip creating duplicate invitation if already in org
    }

    // Revoke any previous pending invite for this email in this org
    await prisma.invitation.updateMany({
      where: {
        organizationId: session.organizationId,
        email: member.email,
        status: "PENDING",
      },
      data: { status: "REVOKED" },
    });

    // Create invitation record
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: session.organizationId,
        invitedById: session.userId,
        email: member.email,
        role: "MEMBER",
        jobTitle: member.role,
        token: "pending",
        expiresAt,
      },
      select: { id: true },
    });

    // Generate signed HMAC token with invitation id embedded
    const token = createInviteToken(invitation.id);
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { token },
    });

    const acceptUrl = `${appUrl}/accept-invitation?token=${encodeURIComponent(token)}`;

    // Render HTML and plain text email
    const emailContent = renderInvitationEmail({
      recipientName: member.name,
      inviterName: session.name,
      organizationName: org?.name ?? "RF Intelligence",
      jobTitle: member.role,
      role: "MEMBER",
      acceptUrl,
      expiresDays: 7,
    });

    // Send invitation email
    sendEmail({
      to: member.email,
      subject: emailContent.subject,
      body: emailContent.text,
      html: emailContent.html,
    }).catch((err) => {
      console.warn(`[Onboarding] Email invite delivery skipped/failed for ${member.email}:`, err?.message || err);
    });

    await writeAuditLog({
      organizationId: session.organizationId,
      userId: session.userId,
      action: "INVITE_SENT",
      entityType: "INVITATION",
      entityId: invitation.id,
      metadata: { email: member.email, role: "MEMBER", onboarding: true },
    }).catch(() => {});
  }

  // Persist invited team list for team presentation
  await prisma.organizationOnboarding.upsert({
    where: { organizationId: session.organizationId },
    create: {
      organizationId: session.organizationId,
      invitedMembers: JSON.stringify(validMembers),
      currentStep: 6, // Next: Presentation
    },
    update: {
      invitedMembers: JSON.stringify(validMembers),
      currentStep: 6,
    },
  });

  return Response.json({
    ok: true,
    nextStep: 6,
    invitedCount: validMembers.length,
    maxAdditionalSeats,
    invitedMembers: validMembers,
  });
}
