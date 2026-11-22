import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CmsError } from "./cms-client";
import { dataDir } from "./store";
import { isVercel, workspaceNamespace } from "./runtime";

async function key() {
  let secret = process.env.CMS_SESSION_SECRET || process.env.APP_PASSWORD;
  if (!secret && !isVercel()) {
    await mkdir(dataDir(), { recursive: true });
    const file = join(dataDir(), ".cms-session-key");
    try {
      await writeFile(file, randomBytes(32).toString("hex"), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    secret = await readFile(file, "utf8");
  }
  if (!secret || secret.length < 16)
    throw new CmsError(
      "CMS session encryption requires APP_PASSWORD or CMS_SESSION_SECRET of at least 16 characters.",
      503,
      "CMS_NOT_CONFIGURED",
    );
  return createHash("sha256")
    .update(`benchmark-cms-v1\0${workspaceNamespace()}\0${secret}`)
    .digest();
}
export async function seal(value: unknown, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await key(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}
export async function unseal(value: string, context: string): Promise<unknown> {
  try {
    const data = Buffer.from(value, "base64url");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await key(),
      data.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        decipher.update(data.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new CmsError(
      "This CMS session is no longer usable. Sign in again.",
      401,
      "CMS_AUTH_REQUIRED",
    );
  }
}
