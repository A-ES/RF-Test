import { getSession } from "@/app/lib/session";
import { createPresignedUpload } from "@/app/lib/storage";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
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
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const body = (payload ?? {}) as Record<string, unknown>;
  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "";
  const fileSize = typeof body.fileSize === "number" ? body.fileSize : 0;

  if (!fileName) return json({ error: "fileName is required" }, 400);
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return json({ error: "File type is not permitted. Allowed: PDF, Images, Word, Excel, CSV, TXT." }, 400);
  }
  if (fileSize <= 0 || fileSize > MAX_FILE_SIZE) {
    return json({ error: `File size must be between 1 byte and ${MAX_FILE_SIZE / (1024 * 1024)}MB` }, 400);
  }

  // Derive tenant-scoped storage key: org_<organizationId>/conversations/<randomId>-<cleanFilename>
  const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  const storageKey = `org_${session.organizationId}/conversations/${Date.now()}-${randomSuffix}-${cleanName}`;

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
    console.error("[conversations/upload-url] failed to create upload URL", err);
    return json({ error: "Failed to generate upload URL. S3 storage may not be configured." }, 500);
  }
}
