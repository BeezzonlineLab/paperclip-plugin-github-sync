import type { PluginContext } from "@paperclipai/plugin-sdk";
import { DELIVERY_RING_BUFFER_SIZE, STATE_KEYS, SYNC_NONCE_PREFIX, SYNC_NONCE_SUFFIX, SYNC_NONCE_TTL_MS } from "../constants.js";

export async function isDeliveryProcessed(ctx: PluginContext, deliveryId: string): Promise<boolean> {
  const deliveries = ((await ctx.state.get({ scopeKind: "instance", stateKey: STATE_KEYS.processedDeliveries })) ?? []) as string[];
  return deliveries.includes(deliveryId);
}

export async function markDeliveryProcessed(ctx: PluginContext, deliveryId: string): Promise<void> {
  const deliveries = ((await ctx.state.get({ scopeKind: "instance", stateKey: STATE_KEYS.processedDeliveries })) ?? []) as string[];
  deliveries.push(deliveryId);
  if (deliveries.length > DELIVERY_RING_BUFFER_SIZE) {
    deliveries.splice(0, deliveries.length - DELIVERY_RING_BUFFER_SIZE);
  }
  await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEYS.processedDeliveries }, deliveries);
}

export function embedNonce(body: string, nonce: string): string {
  return `${body}\n${SYNC_NONCE_PREFIX}${nonce}${SYNC_NONCE_SUFFIX}`;
}

export function extractNonce(body: string): string | null {
  const start = body.indexOf(SYNC_NONCE_PREFIX);
  if (start === -1) return null;
  const nonceStart = start + SYNC_NONCE_PREFIX.length;
  const end = body.indexOf(SYNC_NONCE_SUFFIX, nonceStart);
  if (end === -1) return null;
  return body.substring(nonceStart, end);
}

export async function createSyncNonce(ctx: PluginContext, githubRef: string): Promise<string> {
  const nonce = crypto.randomUUID();
  await ctx.state.set({ scopeKind: "instance", stateKey: `sync:${githubRef}:nonce` }, { nonce, createdAt: Date.now() });
  return nonce;
}

export async function isOwnSyncEvent(ctx: PluginContext, githubRef: string, body: string): Promise<boolean> {
  const nonce = extractNonce(body);
  if (!nonce) return false;
  const stored = (await ctx.state.get({ scopeKind: "instance", stateKey: `sync:${githubRef}:nonce` })) as { nonce: string; createdAt: number } | null;
  if (!stored) return false;
  return stored.nonce === nonce;
}

export async function cleanExpiredNonces(ctx: PluginContext, githubRef: string): Promise<void> {
  const stored = (await ctx.state.get({ scopeKind: "instance", stateKey: `sync:${githubRef}:nonce` })) as { nonce: string; createdAt: number } | null;
  if (stored && Date.now() - stored.createdAt > SYNC_NONCE_TTL_MS) {
    await ctx.state.delete({ scopeKind: "instance", stateKey: `sync:${githubRef}:nonce` });
  }
}
