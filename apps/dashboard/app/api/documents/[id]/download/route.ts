import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { createPresignedDownload, isStorageConfigured } from "@/app/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return Response.json({ error: "Document ID is required" }, { status: 400 });
  }

  // Tenant scoping: strictly verify the document belongs to the caller's organization
  const document = await prisma.document.findFirst({
    where: {
      id,
      organizationId: session.organizationId,
    },
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      fileUrl: true,
      storageKey: true,
      mimeType: true,
    },
  });

  if (!document) {
    return Response.json({ error: "Document not found or access denied" }, { status: 404 });
  }

  let downloadUrl = document.fileUrl;

  if (document.storageKey && isStorageConfigured()) {
    try {
      downloadUrl = await createPresignedDownload({
        key: document.storageKey,
        filename: document.fileName,
        expiresIn: 300,
      });
    } catch (err) {
      console.error("[documents/download] failed to create presigned download url", err);
    }
  }

  const url = new URL(request.url);
  const wantsJson =
    url.searchParams.get("format") === "json" ||
    request.headers.get("accept")?.includes("application/json");

  if (wantsJson) {
    return Response.json({
      downloadUrl,
      fileName: document.fileName,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
    });
  }

  // Direct download redirect
  return Response.redirect(downloadUrl, 302);
}
