/**
 * Transcriber interface and private media storage for audio/voice notes.
 */

export interface TranscribeAudioInput {
  buffer?: Buffer;
  url?: string;
  mimeType?: string;
  filename?: string;
}

export interface Transcriber {
  transcribe(audio: TranscribeAudioInput): Promise<string>;
}

export class TranscriberNotConfiguredError extends Error {
  constructor(
    message = "Transcriber is not configured: missing TRANSCRIBER_API_KEY or OPENAI_API_KEY",
  ) {
    super(message);
    this.name = "TranscriberNotConfiguredError";
  }
}

let activeTranscriber: Transcriber | null = null;

/**
 * Test seam to inject a mock transcriber.
 */
export function setTranscriber(transcriber: Transcriber | null): void {
  activeTranscriber = transcriber;
}

/**
 * Returns the configured transcriber or throws TranscriberNotConfiguredError.
 */
export function getTranscriber(): Transcriber {
  if (activeTranscriber) {
    return activeTranscriber;
  }

  const apiKey =
    process.env.TRANSCRIBER_API_KEY || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new TranscriberNotConfiguredError();
  }

  return {
    async transcribe(audio: TranscribeAudioInput): Promise<string> {
      const endpoint =
        process.env.TRANSCRIBER_ENDPOINT ||
        "https://api.openai.com/v1/audio/transcriptions";

      const formData = new FormData();
      if (audio.buffer) {
        const blob = new Blob([new Uint8Array(audio.buffer)], {
          type: audio.mimeType || "audio/ogg",
        });
        formData.append("file", blob, audio.filename || "audio.ogg");
      }
      formData.append(
        "model",
        process.env.TRANSCRIBER_MODEL || "whisper-1",
      );

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Audio transcription failed (${response.status}): ${detail.slice(0, 300)}`,
        );
      }

      const data = (await response.json()) as { text?: string };
      return data.text?.trim() || "";
    },
  };
}

/**
 * Media bucket storage interface.
 */
export interface MediaStorageBucket {
  store(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ url: string; path: string }>;
}

class MemoryMediaBucket implements MediaStorageBucket {
  private readonly items = new Map<string, { buffer: Buffer; mimeType: string }>();

  async store(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ url: string; path: string }> {
    this.items.set(key, { buffer, mimeType });
    return {
      url: `https://private-bucket.internal/${key}`,
      path: key,
    };
  }
}

let activeBucket: MediaStorageBucket = new MemoryMediaBucket();

export function setMediaStorageBucket(bucket: MediaStorageBucket): void {
  activeBucket = bucket;
}

export function getMediaStorageBucket(): MediaStorageBucket {
  return activeBucket;
}
