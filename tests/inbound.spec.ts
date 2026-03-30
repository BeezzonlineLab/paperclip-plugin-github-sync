import { describe, expect, it, vi, beforeEach } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import { processGitHubIssue } from "../src/sync/inbound.js";
import { getIssueMapping, setIssueMapping, setProjectIdForRepo } from "../src/sync/mapping.js";
import type { GitHubIssue, GitHubSyncConfig } from "../src/github/types.js";

const TEST_CONFIG: GitHubSyncConfig = {
  githubAppId: "123",
  githubInstallationId: "456",
  privateKeySecret: "pk-ref",
  orgName: "test-org",
  companyId: "company-1",
  pollIntervalMinutes: 5,
  syncLabelsPrefix: "agent:",
  webhookSecretRef: "wh-ref",
};

function makeGitHubIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    id: 1,
    number: 42,
    title: "Test issue",
    body: "Issue description",
    state: "open",
    labels: [],
    updated_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    html_url: "https://github.com/test-org/repo/issues/42",
    user: { login: "testuser", id: 1 },
    ...overrides,
  };
}

function makeMockClient() {
  return {
    addComment: vi.fn(),
    addLabel: vi.fn(),
    removeLabel: vi.fn(),
    listOrgRepos: vi.fn(),
    listIssuesSince: vi.fn(),
    listOpenIssues: vi.fn(),
    listClosedPRsSince: vi.fn(),
    createPR: vi.fn(),
    getRef: vi.fn(),
    createRef: vi.fn(),
    createTree: vi.fn(),
    createCommit: vi.fn(),
    updateRef: vi.fn(),
    verifyConnection: vi.fn(),
    isRateLimitSafe: vi.fn().mockResolvedValue(true),
  } as any;
}

describe("inbound sync", () => {
  it("creates a new Paperclip issue from a GitHub issue", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities],
    });
    const ctx = harness.ctx;
    const ghClient = makeMockClient();

    // Seed project and set mapping
    harness.seed({
      companies: [{ id: "company-1", name: "Test Co" } as any],
      projects: [{ id: "project-1", name: "repo", companyId: "company-1" } as any],
    });
    await setProjectIdForRepo(ctx, "test-org/repo", "project-1");

    // Seed agents for label resolution
    harness.seed({
      agents: [{ id: "agent-1", name: "Odoo Expert", urlKey: "odoo-expert", companyId: "company-1" } as any],
    });

    const issue = makeGitHubIssue({
      labels: [{ name: "agent:odoo-expert" }],
    });

    await processGitHubIssue(ctx, TEST_CONFIG, ghClient, "test-org/repo", issue);

    // Should have created the issue mapping
    const paperclipId = await getIssueMapping(ctx, "test-org/repo#42");
    expect(paperclipId).not.toBeNull();

    // Should have logged activity
    expect(harness.activity.length).toBeGreaterThan(0);
    expect(harness.activity[0].message).toContain("imported");
  });

  it("updates an existing Paperclip issue", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities],
    });
    const ctx = harness.ctx;
    const ghClient = makeMockClient();

    harness.seed({
      companies: [{ id: "company-1", name: "Test Co" } as any],
      projects: [{ id: "project-1", name: "repo", companyId: "company-1" } as any],
      issues: [{ id: "existing-issue", title: "Old title", companyId: "company-1", status: "todo" } as any],
    });
    await setProjectIdForRepo(ctx, "test-org/repo", "project-1");
    await setIssueMapping(ctx, "test-org/repo#42", "existing-issue");

    const issue = makeGitHubIssue({ title: "Updated title" });
    await processGitHubIssue(ctx, TEST_CONFIG, ghClient, "test-org/repo", issue);

    expect(harness.activity.some((a) => a.message.includes("updated"))).toBe(true);
  });

  it("skips already-closed issues on first import", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities],
    });
    const ctx = harness.ctx;
    const ghClient = makeMockClient();

    await setProjectIdForRepo(ctx, "test-org/repo", "project-1");

    const issue = makeGitHubIssue({ state: "closed" });
    await processGitHubIssue(ctx, TEST_CONFIG, ghClient, "test-org/repo", issue);

    expect(await getIssueMapping(ctx, "test-org/repo#42")).toBeNull();
  });

  it("skips issues when no project mapping exists", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities],
    });
    const ctx = harness.ctx;
    const ghClient = makeMockClient();

    const issue = makeGitHubIssue();
    await processGitHubIssue(ctx, TEST_CONFIG, ghClient, "test-org/repo", issue);

    expect(await getIssueMapping(ctx, "test-org/repo#42")).toBeNull();
  });

  it("skips issues already processed with same updated_at", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities],
    });
    const ctx = harness.ctx;
    const ghClient = makeMockClient();

    harness.seed({
      companies: [{ id: "company-1", name: "Test Co" } as any],
      projects: [{ id: "project-1", name: "repo", companyId: "company-1" } as any],
    });
    await setProjectIdForRepo(ctx, "test-org/repo", "project-1");

    const issue = makeGitHubIssue();

    // Process once
    await processGitHubIssue(ctx, TEST_CONFIG, ghClient, "test-org/repo", issue);
    const activityCount = harness.activity.length;

    // Process again with same updated_at — should skip
    await processGitHubIssue(ctx, TEST_CONFIG, ghClient, "test-org/repo", issue);
    expect(harness.activity.length).toBe(activityCount);
  });

  it("posts comment when agent label not found", async () => {
    const harness = createTestHarness({
      manifest,
      capabilities: [...manifest.capabilities],
    });
    const ctx = harness.ctx;
    const ghClient = makeMockClient();

    harness.seed({
      companies: [{ id: "company-1", name: "Test Co" } as any],
      projects: [{ id: "project-1", name: "repo", companyId: "company-1" } as any],
      agents: [], // No agents
    });
    await setProjectIdForRepo(ctx, "test-org/repo", "project-1");

    const issue = makeGitHubIssue({
      labels: [{ name: "agent:nonexistent" }],
    });

    await processGitHubIssue(ctx, TEST_CONFIG, ghClient, "test-org/repo", issue);

    expect(ghClient.addComment).toHaveBeenCalledWith(
      "test-org/repo",
      42,
      expect.stringContaining("nonexistent"),
    );
  });
});
