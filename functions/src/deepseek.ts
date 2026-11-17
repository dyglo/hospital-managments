import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getStorage } from 'firebase-admin/storage';
import { getDeepSeekConfig } from './config';

export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMAGES_PER_REQUEST = 3;

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface DeepSeekCallOptions {
  messages: ChatMessage[];
  maxTokens: number;
  hasImages: boolean;
  stream?: boolean;
}

export interface DownloadedImagesResult {
  imageBlocks: ContentBlock[];
  imageFailed: boolean;
  tempFiles: string[];
}

function inferMimeFromPath(storagePath: string, metadataContentType?: string): string | null {
  if (metadataContentType && ALLOWED_IMAGE_MIME_TYPES.has(metadataContentType.toLowerCase())) {
    return metadataContentType.toLowerCase();
  }
  const ext = path.extname(storagePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return null;
}

/**
 * Downloads up to 3 private images from Firebase Storage into temp files,
 * validates MIME & size, converts to base64 image_url blocks, and returns
 * temp file paths for guaranteed cleanup after the API call.
 *
 * Never sends private Storage URLs to DeepSeek and never logs image/patient data.
 */
export async function prepareImageBlocks(
  storagePaths: string[],
  callerUid: string,
  allowAdminAccess = false,
  callerIdToken?: string
): Promise<DownloadedImagesResult> {
  if (!storagePaths || storagePaths.length === 0) {
    return { imageBlocks: [], imageFailed: false, tempFiles: [] };
  }

  const pathsToProcess = storagePaths.slice(0, MAX_IMAGES_PER_REQUEST);
  const bucketName =
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    'hospital-managmentsystem.firebasestorage.app';
  const bucket = getStorage().bucket(bucketName);
  const imageBlocks: ContentBlock[] = [];
  const tempFiles: string[] = [];
  let imageFailed = false;

  for (let i = 0; i < pathsToProcess.length; i++) {
    const storagePath = pathsToProcess[i];
    if (typeof storagePath !== 'string' || !storagePath.trim()) {
      imageFailed = true;
      continue;
    }

    // Security check: ensure patient only accesses their own path unless doctor/admin
    const expectedPrefix = `ai-intake/${callerUid}/`;
    if (!allowAdminAccess && !storagePath.startsWith(expectedPrefix)) {
      imageFailed = true;
      continue;
    }

    const tempPath = path.join(
      os.tmpdir(),
      `ds_img_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`
    );

    try {
      let mime: string | null = null;
      let fileBuffer: Buffer | null = null;

      try {
        const file = bucket.file(storagePath);
        const [metadata] = await file.getMetadata();
        const size = Number(metadata.size || 0);
        mime = inferMimeFromPath(storagePath, metadata.contentType);

        if (!mime || !ALLOWED_IMAGE_MIME_TYPES.has(mime) || size <= 0 || size > MAX_IMAGE_BYTES) {
          imageFailed = true;
          continue;
        }

        await file.download({ destination: tempPath });
        tempFiles.push(tempPath);
        fileBuffer = await fs.promises.readFile(tempPath);
      } catch {
        // Local Spark-plan fallback: download via Firebase Storage REST API using caller's ID token
        if (!callerIdToken) {
          imageFailed = true;
          continue;
        }
        const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
          storagePath
        )}?alt=media`;
        const resp = await fetchWithTimeout(
          url,
          { headers: { Authorization: `Firebase ${callerIdToken}` } },
          8000
        );
        if (!resp.ok) {
          imageFailed = true;
          continue;
        }
        mime = inferMimeFromPath(storagePath, resp.headers.get('content-type') || undefined);
        const arrBuf = await resp.arrayBuffer();
        if (
          !mime ||
          !ALLOWED_IMAGE_MIME_TYPES.has(mime) ||
          arrBuf.byteLength <= 0 ||
          arrBuf.byteLength > MAX_IMAGE_BYTES
        ) {
          imageFailed = true;
          continue;
        }
        fileBuffer = Buffer.from(arrBuf);
        await fs.promises.writeFile(tempPath, fileBuffer);
        tempFiles.push(tempPath);
      }

      if (!fileBuffer || !mime) {
        imageFailed = true;
        continue;
      }

      const base64 = fileBuffer.toString('base64');
      imageBlocks.push({
        type: 'image_url',
        image_url: {
          url: `data:${mime};base64,${base64}`,
        },
      });
    } catch {
      imageFailed = true;
    }
  }

  return { imageBlocks, imageFailed, tempFiles };
}

/**
 * Deletes temporary downloaded image files after the AI call completes.
 */
export async function cleanupTempFiles(tempFiles: string[]): Promise<void> {
  await Promise.all(
    tempFiles.map(async (filePath) => {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // Ignore cleanup errors
      }
    })
  );
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls DeepSeek OpenAI-compatible chat completions endpoint with:
 * - temperature: 0.2
 * - thinking disabled (with fallback token headroom)
 * - 12s timeout for images, 8s for text-only
 * - 1 automatic retry on network error or 5xx
 */
export async function callDeepSeekChat(options: DeepSeekCallOptions): Promise<Response> {
  const { apiKey, baseUrl, model } = getDeepSeekConfig();
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const endpoint = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/chat/completions`;

  const timeoutMs = options.hasImages ? 12000 : 8000;

  const payload = {
    model,
    messages: options.messages,
    temperature: 0.2,
    max_tokens: options.maxTokens,
    thinking: { type: 'disabled' },
    stream: Boolean(options.stream),
  };

  const requestInit: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchWithTimeout(endpoint, requestInit, timeoutMs);

      // If API rejects `thinking` param on a specific model, retry once without it & raise max_tokens
      if (response.status === 400 && attempt === 0) {
        const retryPayload = {
          ...payload,
          max_tokens: Math.max(options.maxTokens, 750),
        };
        delete (retryPayload as Record<string, unknown>).thinking;
        const retryInit: RequestInit = {
          ...requestInit,
          body: JSON.stringify(retryPayload),
        };
        const retryResp = await fetchWithTimeout(endpoint, retryInit, timeoutMs);
        if (retryResp.ok || !isRetryableStatus(retryResp.status)) {
          return retryResp;
        }
        lastError = new Error(`DeepSeek API returned ${retryResp.status}`);
        continue;
      }

      if (response.ok || !isRetryableStatus(response.status)) {
        return response;
      }

      lastError = new Error(`DeepSeek API returned ${response.status}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('DeepSeek request failed');
}
