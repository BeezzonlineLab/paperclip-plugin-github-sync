import { describe, expect, it, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import {
  embedNonce,
  extractNonce,
  isDeliveryProcessed,
  markDeliveryProcessed,
  createSyncNonce,
  isOwnSyncEvent,
  cleanExpiredNonces,
} from "../src/sync/dedup.js";

function makeHarness() {
  return createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
}

describe("dedup", () => {
  describe("embedNonce / extractNonce", () => {
    it("embeds and extracts a nonce from text", () => {
      const nonce = "test-nonce-123";
      const body = embedNonce("Hello world", nonce);
      expect(body).toContain("Hello world");
      expect(body).toContain("paperclip-sync:");
      expect(extractNonce(body)).toBe(nonce);
    });

    it("returns null when no nonce is present", () => {
      expect(extractNonce("plain text without nonce")).toBeNull();
    });
  });

  describe("delivery deduplication", () => {
    it("marks a delivery as processed and detects duplicates", async () => {
      const harness = makeHarness();
      const ctx = harness.ctx;

      expect(await isDeliveryProcessed(ctx, "delivery-1")).toBe(false);
      await markDeliveryProcessed(ctx, "delivery-1");
      expect(await isDeliveryProcessed(ctx, "delivery-1")).toBe(true);
    });

    it("does not falsely detect unprocessed deliveries", async () => {
      const harness = makeHarness();
      const ctx = harness.ctx;

      await markDeliveryProcessed(ctx, "delivery-1");
      expect(await isDeliveryProcessed(ctx, "delivery-2")).toBe(false);
    });
  });

  describe("sync nonces", () => {
    it("creates a nonce and detects own sync events", async () => {
      const harness = makeHarness();
      const ctx = harness.ctx;
      const ref = "org/repo#42";

      const nonce = await createSyncNonce(ctx, ref);
      const body = embedNonce("some comment", nonce);

      expect(await isOwnSyncEvent(ctx, ref, body)).toBe(true);
    });

    it("does not match different nonces", async () => {
      const harness = makeHarness();
      const ctx = harness.ctx;
      const ref = "org/repo#42";

      await createSyncNonce(ctx, ref);
      const body = embedNonce("some comment", "different-nonce");

      expect(await isOwnSyncEvent(ctx, ref, body)).toBe(false);
    });

    it("cleans expired nonces", async () => {
      const harness = makeHarness();
      const ctx = harness.ctx;
      const ref = "org/repo#42";

      // Create nonce with expired timestamp
      await ctx.state.set(
        { scopeKind: "instance", stateKey: `sync:${ref}:nonce` },
        { nonce: "old", createdAt: Date.now() - 2 * 60 * 60 * 1000 },
      );

      await cleanExpiredNonces(ctx, ref);

      const stored = await ctx.state.get({ scopeKind: "instance", stateKey: `sync:${ref}:nonce` });
      expect(stored).toBeNull();
    });

    it("does not clean non-expired nonces", async () => {
      const harness = makeHarness();
      const ctx = harness.ctx;
      const ref = "org/repo#42";

      await createSyncNonce(ctx, ref);
      await cleanExpiredNonces(ctx, ref);

      const stored = await ctx.state.get({ scopeKind: "instance", stateKey: `sync:${ref}:nonce` });
      expect(stored).not.toBeNull();
    });
  });
});
