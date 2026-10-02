import { prisma } from "@rf-intelligence/db";
import { requireRfAdminSession } from "@/lib/session";
import { createPresignedUpload } from "@/lib/storage";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/csv",
]);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireRfAdminSession();
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "";
  const fileSize = typeof body.fileSize === "number" ? body.fileSize : 0;

  if (!organizationId) return json({ error: "organizationId is required" }, 400);
  if (!fileName) return json({ error: "fileName is required" }, 400);
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return json({ error: "File type is not permitted." }, 400);
  }
  if (fileSize <= 0 || fileSize > MAX_FILE_SIZE) {
    return json({ error: `File size must be between 1 byte and 25MB` }, 400);
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  });
  if (!org) return json({ error: "Organization not found" }, 404);

  const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  const storageKey = `org_${organizationId}/conversations/${Date.now()}-${randomSuffix}-${cleanName}`;

  try {
    const uploadUrl = await createPresignedUpload({
      key: storageKey,
      contentType: mimeType,
      contentLength: fileSize,
      expiresIn: 300,
    });

    return json({
      uploadUrl,
      storageKey,
      fileName,
      fileSize,
      mimeType,
    });
  } catch (err) {
    console.error("[admin/upload-url] failed to create upload URL", err);
    return json({ error: "Failed to generate upload URL. S3 storage may not be configured." }, 500);
  }
}
