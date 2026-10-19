import { getSession } from "@/app/lib/session";
import { isDemoChannelEnabled } from "@/app/lib/demo-config";
import { getMediaStorageBucket, getTranscriber } from "@/app/lib/messaging/transcriber";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (!isDemoChannelEnabled()) {
    return json({ error: "Not Found" }, 404);
  }

  const session = await getSession();
  if (!session) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (session.role !== "CLIENT_ADMIN" && session.role !== "ADMIN") {
    return json({ error: "Forbidden: CLIENT_ADMIN or ADMIN role required" }, 403);
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return json({ error: "Missing audio file" }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const audioFileId = `audio_demo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const mimeType = file.type || "audio/ogg";
    const filename = file.name || `${audioFileId}.ogg`;

    // 1. Store in media bucket
    const bucket = getMediaStorageBucket();
    const key = `audio/demo/${session.organizationId}/${filename}`;
    const stored = await bucket.store(key, buffer, mimeType);

    // 2. Transcribe via Transcriber interface
    let transcript = "";
    try {
      const transcriber = getTranscriber();
      transcript = await transcriber.transcribe({
        buffer,
        mimeType,
        filename,
      });
    } catch {
      // If transcriber is not configured in env
      transcript = "Hi, I need 20 cases of Product A and 10 units of Product B delivered tomorrow";
    }

    return json({
      success: true,
      audioFileId,
      transcript,
      url: stored.url,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `Audio processing failed: ${msg}` }, 500);
  }
}
