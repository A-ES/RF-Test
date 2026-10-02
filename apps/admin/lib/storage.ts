import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export const PRESIGN_EXPIRES_IN_SECONDS = 300;

export function getStorageConfig(): StorageConfig {
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3-compatible storage is not configured");
  }

  return {
    bucket,
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  };
}

let cached: { key: string; client: S3Client } | null = null;

function getClient(config: StorageConfig): S3Client {
  const cacheKey = [
    config.region,
    config.endpoint ?? "",
    config.accessKeyId,
    config.forcePathStyle ? "1" : "0",
  ].join("|");

  if (cached && cached.key === cacheKey) return cached.client;

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  cached = { key: cacheKey, client };
  return client;
}

export async function createPresignedUpload(params: {
  key: string;
  contentType: string;
  contentLength: number;
  expiresIn?: number;
}): Promise<string> {
  const config = getStorageConfig();
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
    ContentType: params.contentType,
    ContentLength: params.contentLength,
  });

  return getSignedUrl(getClient(config), command, {
    expiresIn: params.expiresIn ?? PRESIGN_EXPIRES_IN_SECONDS,
  });
}

export async function createPresignedDownload(params: {
  key: string;
  expiresIn?: number;
  filename?: string;
}): Promise<string> {
  const config = getStorageConfig();
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: params.key,
    ResponseContentDisposition: params.filename
      ? `inline; filename="${encodeURIComponent(params.filename)}"`
      : undefined,
  });

  return getSignedUrl(getClient(config), command, {
    expiresIn: params.expiresIn ?? PRESIGN_EXPIRES_IN_SECONDS,
  });
}
