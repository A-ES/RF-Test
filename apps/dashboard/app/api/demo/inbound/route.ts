import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { isDemoChannelEnabled } from "@/app/lib/demo-config";
import { ensureDemoInbox } from "@/app/lib/messaging/demo";
import {
  ingestInboundMessages,
  type MessagingStore,
  type IngestResult,
  type IngestSkip,
} from "@/app/lib/messaging/ingest";
import type { NormalizedInboundMessage } from "@/app/lib/messaging/types";
import { getTranscriber } from "@/app/lib/messaging/transcriber";
import { inngest } from "@/app/lib/inngest/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  // 1. Env flag check: when false every demo route returns 404
  if (!isDemoChannelEnabled()) {
    return json({ error: "Not Found" }, 404);
  }

  // 2. Auth: session-authenticated, CLIENT_ADMIN or ADMIN only
  const session = await getSession();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (session.role !== "CLIENT_ADMIN" && session.role !== "ADMIN") {
    return json({ error: "Forbidden: CLIENT_ADMIN or ADMIN role required" }, 403);
  }

  // 3. Parse payload
  let body: {
    customerId?: string;
    customer?: { name?: string; phone?: string };
    name?: string;
    phone?: string;
    text?: string;
    audioFileId?: string;
    messageId?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  // 4. Resolve contact and display name
  let contactIdentifier = "";
  let contactDisplayName = "";

  if (body.customerId) {
    // Org-scoped check: Customer MUST belong to session.organizationId
    const customer = await prisma.customer.findFirst({
      where: {
        id: body.customerId,
        organizationId: session.organizationId,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        whatsapp: true,
      },
    });

    if (!customer) {
      // Cross-org or nonexistent customer returns 404
      return json({ error: "Customer not found in organization" }, 404);
    }

    contactIdentifier =
      customer.phone || customer.whatsapp || `+1555${customer.id.slice(-7)}`;
    contactDisplayName = customer.name;
  } else {
    const rawName = body.customer?.name || body.name || "Demo Customer";
    const rawPhone = body.customer?.phone || body.phone;

    if (!rawPhone) {
      return json(
        { error: "Must provide either customerId or new customer with phone" },
        400,
      );
    }

    const digits = rawPhone.replace(/\D/g, "");
    contactIdentifier = rawPhone.startsWith("+")
      ? rawPhone
      : `+${digits.replace(/^00/, "") || "15550000000"}`;
    contactDisplayName = rawName;
  }

  // 5. Handle audio transcription if audioFileId supplied
  let transcript: string | undefined;
  let bodyText = body.text?.trim() || "";
  let attachmentsJson = "[]";

  if (body.audioFileId) {
    try {
      const transcriber = getTranscriber();
      transcript = await transcriber.transcribe({
        filename: `${body.audioFileId}.ogg`,
      });
    } catch {
      // If transcriber is not configured or in testing without active transcriber
      transcript = bodyText || "[Demo Voice Note]";
    }

    if (!bodyText && transcript) {
      bodyText = transcript;
    }

    attachmentsJson = JSON.stringify([
      {
        type: "audio",
        id: body.audioFileId,
        mimeType: "audio/ogg",
      },
    ]);
  }

  if (!bodyText) {
    return json({ error: "Either text or audioFileId is required" }, 400);
  }

  // 6. Ensure DEMO MessagingInbox exists for this organization
  const inbox = await ensureDemoInbox(session.organizationId);

  // 7. Construct NormalizedInboundMessage
  const providerMessageId =
    body.messageId?.trim() ||
    `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const normalized: NormalizedInboundMessage = {
    channel: "DEMO",
    inboxIdentifier: inbox.externalAddress,
    contactIdentifier,
    contactDisplayName: contactDisplayName || undefined,
    body: bodyText,
    attachmentsJson,
    transcript,
    providerMessageId,
    receivedAt: new Date(),
  };

  // 8. Ingest using the EXACT SAME function the WhatsApp webhook calls after parsing
  const [result] = await ingestInboundMessages(
    prisma as unknown as MessagingStore,
    [normalized],
  );

  if (!result || "skipped" in result) {
    return json(
      { error: "Failed to ingest message: inbox not resolved" },
      500,
    );
  }

  // 9. Emit customer.message.received to Inngest exactly as real webhook pipeline does
  try {
    await inngest.send({
      name: "customer.message.received",
      data: {
        organizationId: session.organizationId,
        customerId: result.customerId,
        conversationId: result.conversationId,
        messageId: result.messageId,
        channel: "DEMO",
        isNewCustomer: result.createdCustomer,
        duplicate: result.duplicate,
      },
    });
  } catch (err) {
    console.warn("demo/inbound: Inngest emit failed", err);
  }

  return json(
    {
      received: true,
      organizationId: result.organizationId,
      customerId: result.customerId,
      conversationId: result.conversationId,
      messageId: result.messageId,
      createdCustomer: result.createdCustomer,
      duplicate: result.duplicate,
    },
    200,
  );
}
