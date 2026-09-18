import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// How tokens are written to SQLite.
//   with a key    → "enc:v1:<iv>:<tag>:<ciphertext>"  (AES-256-GCM, fresh IV per value)
//   without a key → "plain:v1:<token>"
// The key comes from GOOGLE_TOKEN_ENCRYPTION_KEY — never from the database or the OAuth client secret.
// Without a key the tokens are protected only by file access to data/ (git-ignored, outside public/), which
// is the same boundary that already protects .env.local and the chat data. The README says so plainly.

export function seal(token: string, key: Buffer | null): string {
  if (!key) return `plain:v1:${token}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["enc", "v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

/** null when the value cannot be read with the current key setup (missing/wrong key, tampered) → treat as "reconnect". */
export function open(sealed: string | null, key: Buffer | null): string | null {
  if (!sealed) return null;
  if (sealed.startsWith("plain:v1:")) return sealed.slice("plain:v1:".length);
  const [scheme, version, iv, tag, ciphertext] = sealed.split(":");
  if (scheme !== "enc" || version !== "v1" || !iv || !tag || !ciphertext || !key) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
