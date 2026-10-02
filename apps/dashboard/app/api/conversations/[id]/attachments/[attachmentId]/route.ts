import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { createPresignedDownload } from "@/app/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string; attachmentId: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  const { id, attachmentId } = await ctx.params;

  // Strict tenant check: verify attachment belongs to this organization and conversation
  const attachment = await prisma.messageAttachment.findFirst({
    where: {
      id: attachmentId,
      organizationId: session.organizationId,
      message: {
        conversationId: id,
        organizationId: session.organizationId,
      },
    },
  });

  if (!attachment) {
    return json({ error: "Attachment not found or access denied" }, 404);
  }

  try {
    const downloadUrl = await createPresignedDownload({
      key: attachment.storageKey,
      filename: attachment.fileName,
      expiresIn: 300,
    });

    return json({
      downloadUrl,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
    });
  } catch (err) {
    console.error("[attachments/download] failed to create download url", err);
    return json({ error: "Failed to create secure download link" }, 500);
  }
}
