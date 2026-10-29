// path: src/lib/assets/uploadthing-server.ts

import "server-only";
import { UTApi } from "uploadthing/server";
import { env } from "@/lib/env";
import { UpstreamServiceError } from "@/lib/errors";
import { isTrustedUploadUrl } from "./upload-policy";

/**
 * The ONE place the UploadThing server SDK is instantiated. Uses the
 * installed v7 API (`UTApi`, token-based auth). The token never leaves the
 * server; it is read from validated env, not `process.env`, so a missing
 * value fails at boot with a clear message.
 */
export const utapi = new UTApi({ token: env.UPLOADTHING_TOKEN });

const FETCH_TIMEOUT_MS = 20_000;

/**
 * Downloads an UploadThing-hosted object with a HARD byte cap (streamed, so a
 * lying `Content-Length` or an endless body can't exhaust memory) and a
 * timeout. Only trusted CDN hosts are fetched, and redirects are refused so a
 * trusted host can't bounce us to an internal address.
 */
export async function fetchStoredBytes(
  url: string,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!isTrustedUploadUrl(url)) {
    throw new UpstreamServiceError("Refusing to fetch an untrusted URL.");
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new UpstreamServiceError(`Stored file could not be read (${response.status}).`);
  }

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UpstreamServiceError("Stored file exceeds the size limit.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new UpstreamServiceError("Stored file exceeds the size limit.");
    }
    chunks.push(value);
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Deletes one stored object. THROWS unless UploadThing confirms `success`
 * — callers must never treat a swallowed failure as a deletion.
 * `deletedCount: 0` with `success: true` means the key was already gone,
 * which is the desired end state, so retries are safe. (Assumption about the
 * live API's behaviour for unknown keys; see the plan's unverified list.)
 */
export async function deleteStoredObject(key: string): Promise<void> {
  const result = await utapi.deleteFiles(key);
  if (!result.success) {
    throw new UpstreamServiceError("Storage provider did not confirm deletion.", undefined, {
      key,
    });
  }
}

/** Uploads replacement bytes (used when an SVG had to be sanitized). */
export async function uploadReplacementObject(args: {
  name: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<{ key: string; ufsUrl: string }> {
  const file = new File([args.bytes as unknown as BlobPart], args.name, {
    type: args.mime,
  });
  const result = await utapi.uploadFiles(file);
  if (result.error || !result.data) {
    throw new UpstreamServiceError("Could not store the cleaned file.", result.error);
  }
  return { key: result.data.key, ufsUrl: result.data.ufsUrl };
}
