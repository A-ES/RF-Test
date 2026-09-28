import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import {
  buildStorageKey,
  validateUploadInput,
} from "@/app/lib/uploads";
import { createUploadToken } from "@/app/lib/upload-token";
import {
  createPresignedUpload,
  isStorageConfigured,
  PRESIGN_EXPIRES_IN_SECONDS,
  StorageConfigError,
} from "@/app/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  if (!isStorageConfigured()) {
    return json({ error: "File storage is not configured." }, 503);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const validation = validateUploadInput({
    fileName: body.fileName,
    mimeType: body.mimeType,
    fileSize: body.fileSize,
  });
  if (!validation.ok) {
    return json({ error: validation.error }, 400);
  }

  const projectId =
    typeof body.projectId === "string" && body.projectId.length > 0
      ? body.projectId
      : null;

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: session.organizationId },
      select: { id: true },
    });
    if (!project) {
      return json({ error: "Unknown project for this organization" }, 400);
    }
  }

  const key = buildStorageKey(session.organizationId, validation.fileName);

  try {
    const uploadUrl = await createPresignedUpload({
      key,
      contentType: validation.mimeType,
      contentLength: validation.fileSize,
    });

    const uploadToken = createUploadToken({
      key,
      organizationId: session.organizationId,
      userId: session.userId,
      fileName: validation.fileName,
      mimeType: validation.mimeType,
      size: validation.fileSize,
    });

    const { trackEvent } = await import("@/app/lib/analytics");
    trackEvent("document_uploaded", { fileName: validation.fileName, size: validation.fileSize }, { organizationId: session.organizationId, userId: session.userId });

    return json({
      uploadUrl,
      storageKey: key,
      uploadToken,
      expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
      headers: { "Content-Type": validation.mimeType },
    });
  } catch (error) {
    if (error instanceof StorageConfigError) {
      return json({ error: "File storage is not configured." }, 503);
    }
    console.error("upload-url: failed to sign URL", error);
    return json({ error: "Could not create an upload URL." }, 500);
  }
}
