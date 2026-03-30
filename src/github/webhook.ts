import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { GitHubSyncConfig } from "./types.js";

export async function validateWebhookSignature(
  ctx: PluginContext,
  config: GitHubSyncConfig,
  rawBody: string,
  signatureHeader: string | string[] | undefined,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!signature?.startsWith("sha256=")) return false;

  const secret = await ctx.secrets.resolve(config.webhookSecretRef);
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)),
  );

  const expected = `sha256=${Array.from(mac)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}
