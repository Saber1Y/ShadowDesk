import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Stateless session storage for serverless hosts.
 *
 * Vercel functions have no shared filesystem: a session written to /tmp on one
 * instance is invisible to the instance that serves the OIDC callback or the
 * next /api/state call. The session therefore travels in the browser as an
 * encrypted, compressed cookie instead of a server-side file.
 *
 * Payloads are gzipped (a session JSON is ~3.7KB and lands near ~2.1KB), then
 * sealed with AES-256-GCM, then base64url encoded. When the result still does
 * not fit one cookie it is split across numbered chunks. The purpose string is
 * bound as GCM additional data, so a sealed authorization request can never be
 * replayed as a session or vice versa.
 */

const VERSION = "v1";
const MAX_CHUNK_CHARS = 3000;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** Hard ceiling for a sealed payload across all of its chunks. */
const MAX_SEALED_BYTES = 12 * 1024;

/** How many cookie names one sealed payload may occupy. */
export const MAX_COOKIE_CHUNKS = Math.ceil(MAX_SEALED_BYTES / MAX_CHUNK_CHARS);

export class SessionCookieError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionCookieError";
  }
}

const secretKey = (): Buffer => {
  const secret = process.env.SHADOWDESK_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new SessionCookieError(
      "SHADOWDESK_SESSION_SECRET is missing or too short; it must be set to at least 16 characters.",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
};

const seal = (purpose: string, plaintext: Buffer): string => {
  const key = secretKey();
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${VERSION}:${purpose}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
};

const open = (purpose: string, sealed: string): Buffer | undefined => {
  if (!sealed.startsWith(`${VERSION}.`)) return undefined;
  const key = secretKey();
  const raw = Buffer.from(sealed.slice(VERSION.length + 1), "base64url");
  if (raw.length <= GCM_IV_BYTES + GCM_TAG_BYTES) return undefined;
  const iv = raw.subarray(0, GCM_IV_BYTES);
  const tag = raw.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_TAG_BYTES);
  const ciphertext = raw.subarray(GCM_IV_BYTES + GCM_TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(`${VERSION}:${purpose}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Wrong purpose, tampered value, rotated secret, or a legacy plain id.
    return undefined;
  }
};

/** Seal a JSON-serializable payload into one or more cookie values. */
export const sealPayload = (purpose: string, payload: unknown): string[] => {
  const sealed = seal(purpose, gzipSync(Buffer.from(JSON.stringify(payload), "utf8")));
  if (Buffer.byteLength(sealed, "utf8") > MAX_SEALED_BYTES) {
    throw new SessionCookieError(
      `Session payload sealed to ${sealed.length} bytes, over the ${MAX_SEALED_BYTES} byte limit.`,
    );
  }
  if (sealed.length <= MAX_CHUNK_CHARS) return [sealed];
  const chunks: string[] = [];
  for (let offset = 0; offset < sealed.length; offset += MAX_CHUNK_CHARS) {
    chunks.push(sealed.slice(offset, offset + MAX_CHUNK_CHARS));
  }
  return chunks;
};

/**
 * Open a payload that was sealed into chunks.
 *
 * `read` is called with the chunk index and returns undefined when that chunk
 * is absent, which terminates the read. A truncated chain fails GCM
 * verification rather than silently decoding, so a dropped chunk surfaces as an
 * invalid payload, not a partial one.
 */
export const openPayload = <T>(purpose: string, read: (index: number) => string | undefined): T | undefined => {
  const first = read(0);
  if (!first) return undefined;
  const parts = [first];
  for (let index = 1; index < MAX_COOKIE_CHUNKS; index += 1) {
    const chunk = read(index);
    if (!chunk) break;
    parts.push(chunk);
  }
  const plaintext = open(purpose, parts.join(""));
  if (!plaintext) return undefined;
  try {
    return JSON.parse(gunzipSync(plaintext).toString("utf8")) as T;
  } catch {
    return undefined;
  }
};

/** The cookie name for one chunk: base name at index 0, then numbered continuations. */
export const chunkCookieName = (baseName: string, index: number): string =>
  index === 0 ? baseName : `${baseName}_${index}`;
