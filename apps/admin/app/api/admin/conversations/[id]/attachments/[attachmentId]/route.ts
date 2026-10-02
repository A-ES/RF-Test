import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import { createPresignedDownload } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/admin/conversations/[id]/attachments/[attachmentId]">,
): Promise<Response> {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  const { id, attachmentId } = await ctx.params;

  const attachment = await prisma.messageAttachment.findFirst({
    where: {
      id: attachmentId,
      message: {
        conversationId: id,
      },
    },
  });

  if (!attachment) {
    return json({ error: "Attachment not found" }, 404);
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
    console.error("[admin/attachments/download] failed to create download url", err);
    return json({ error: "Failed to create secure download link" }, 500);
  }
}
