import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import {
  getIssueMapping,
  setIssueMapping,
  getGithubRefForIssue,
  setPRMapping,
  getIssueForPR,
  getProjectIdForRepo,
  setProjectIdForRepo,
  getRepoCursor,
  setRepoCursor,
  getIssueUpdatedAt,
  setIssueUpdatedAt,
} from "../src/sync/mapping.js";

function makeHarness() {
  return createTestHarness({ manifest, capabilities: [...manifest.capabilities] });
}

describe("mapping", () => {
  describe("issue mappings", () => {
    it("sets and gets bidirectional issue mapping", async () => {
      const { ctx } = makeHarness();
      await setIssueMapping(ctx, "org/repo#42", "paperclip-id-1");

      expect(await getIssueMapping(ctx, "org/repo#42")).toBe("paperclip-id-1");
      expect(await getGithubRefForIssue(ctx, "paperclip-id-1")).toBe("org/repo#42");
    });

    it("returns null for unmapped issues", async () => {
      const { ctx } = makeHarness();
      expect(await getIssueMapping(ctx, "org/repo#999")).toBeNull();
      expect(await getGithubRefForIssue(ctx, "nonexistent")).toBeNull();
    });
  });

  describe("PR mappings", () => {
    it("sets and gets bidirectional PR mapping", async () => {
      const { ctx } = makeHarness();
      await setPRMapping(ctx, "org/repo#10", "issue-id-1");

      expect(await getIssueForPR(ctx, "org/repo#10")).toBe("issue-id-1");
    });
  });

  describe("repo to project mappings", () => {
    it("sets and gets repo to project mapping", async () => {
      const { ctx } = makeHarness();
      await setProjectIdForRepo(ctx, "org/my-repo", "project-1");

      expect(await getProjectIdForRepo(ctx, "org/my-repo")).toBe("project-1");
    });

    it("returns null for unmapped repos", async () => {
      const { ctx } = makeHarness();
      expect(await getProjectIdForRepo(ctx, "org/unknown")).toBeNull();
    });
  });

  describe("repo cursors", () => {
    it("sets and gets repo cursor", async () => {
      const { ctx } = makeHarness();
      await setRepoCursor(ctx, "org/repo", "2026-01-01T00:00:00Z");

      const cursor = await getRepoCursor(ctx, "org/repo");
      expect(cursor).toEqual({ lastPollAt: "2026-01-01T00:00:00Z" });
    });

    it("returns null for repos without cursor", async () => {
      const { ctx } = makeHarness();
      expect(await getRepoCursor(ctx, "org/unknown")).toBeNull();
    });
  });

  describe("issue updatedAt tracking", () => {
    it("sets and gets issue updatedAt", async () => {
      const { ctx } = makeHarness();
      await setIssueUpdatedAt(ctx, "org/repo#42", "2026-01-01T00:00:00Z");

      expect(await getIssueUpdatedAt(ctx, "org/repo#42")).toBe("2026-01-01T00:00:00Z");
    });
  });
});
