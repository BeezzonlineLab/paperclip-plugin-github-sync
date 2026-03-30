import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import type { GitHubSyncConfig } from "../github/types.js";
import type { GitHubClient } from "../github/client.js";
import { getGithubRefForIssue, setPRMapping } from "./mapping.js";
import { createSyncNonce, embedNonce } from "./dedup.js";

function parseGithubRef(ref: string): { repoFullName: string; number: number } {
  const [repo, num] = ref.split("#");
  return { repoFullName: repo, number: parseInt(num, 10) };
}

const STATUS_LABELS: Record<string, string> = {
  in_progress: "status:in-progress",
  in_review: "status:in-review",
  done: "status:done",
  cancelled: "status:cancelled",
};

async function removeAllStatusLabels(ghClient: GitHubClient, repoFullName: string, issueNumber: number): Promise<void> {
  for (const label of Object.values(STATUS_LABELS)) {
    await ghClient.removeLabel(repoFullName, issueNumber, label);
  }
}

export async function handleIssueUpdated(
  ctx: PluginContext,
  config: GitHubSyncConfig,
  ghClient: GitHubClient,
  event: PluginEvent,
): Promise<void> {
  const issueId = event.entityId;
  if (!issueId) return;

  const githubRef = await getGithubRefForIssue(ctx, issueId);
  if (!githubRef) return;

  const { repoFullName, number: issueNumber } = parseGithubRef(githubRef);
  const issue = await ctx.issues.get(issueId, config.companyId);
  if (!issue) return;

  const status = issue.status;
  const nonce = await createSyncNonce(ctx, githubRef);

  if (STATUS_LABELS[status]) {
    await removeAllStatusLabels(ghClient, repoFullName, issueNumber);
    await ghClient.addLabel(repoFullName, issueNumber, STATUS_LABELS[status]);
  }

  if (status === "in_progress") {
    const agent = issue.assigneeAgentId ? await ctx.agents.get(issue.assigneeAgentId, config.companyId) : null;
    const agentName = agent?.name ?? "an agent";
    await ghClient.addComment(repoFullName, issueNumber, embedNonce(`Taken by agent **${agentName}**`, nonce));
  }

  if (status === "in_review") {
    await createPRForIssue(ctx, config, ghClient, issueId, githubRef);
    await ghClient.addComment(repoFullName, issueNumber, embedNonce(`Agent work completed. Awaiting review.`, nonce));
  }

  if (status === "done") {
    await ghClient.addComment(repoFullName, issueNumber, embedNonce(`Issue resolved.`, nonce));
  }

  await ctx.metrics.write("github_sync.events_processed", 1, { type: "issue", direction: "outbound" });
}

export async function createPRForIssue(
  ctx: PluginContext,
  config: GitHubSyncConfig,
  ghClient: GitHubClient,
  issueId: string,
  githubRef: string,
): Promise<void> {
  const { repoFullName, number: issueNumber } = parseGithubRef(githubRef);
  const issue = await ctx.issues.get(issueId, config.companyId);
  if (!issue) return;

  const agent = issue.assigneeAgentId ? await ctx.agents.get(issue.assigneeAgentId, config.companyId) : null;
  if (!agent) {
    ctx.logger.warn("No agent assigned, skipping PR creation", { issueId });
    return;
  }

  const agentUrlKey = agent.urlKey ?? "agent";

  let baseSha: string;
  try {
    const ref = await ghClient.getRef(repoFullName, "heads/main");
    baseSha = ref.object.sha;
  } catch {
    try {
      const ref = await ghClient.getRef(repoFullName, "heads/master");
      baseSha = ref.object.sha;
    } catch (e) {
      ctx.logger.error("Could not find main or master branch", { repoFullName, error: String(e) });
      return;
    }
  }

  let branchName = `agent/${agentUrlKey}/issue-${issueNumber}`;
  try {
    await ghClient.createRef(repoFullName, `heads/${branchName}`, baseSha);
  } catch {
    branchName = `${branchName}-${Date.now()}`;
    await ghClient.createRef(repoFullName, `heads/${branchName}`, baseSha);
  }

  const defaultBranch = "main";
  const pr = await ghClient.createPR(
    repoFullName,
    branchName,
    defaultBranch,
    `[Agent: ${agent.name}] ${issue.title}`,
    `${issue.description ?? ""}\n\n---\n*Created by Paperclip GitHub Sync*`,
  );

  const prRef = `${repoFullName}#${pr.number}`;
  await setPRMapping(ctx, prRef, issueId);

  const nonce = await createSyncNonce(ctx, githubRef);
  await ghClient.addComment(repoFullName, issueNumber, embedNonce(`PR opened: ${pr.html_url}`, nonce));

  await ctx.activity.log({
    companyId: config.companyId,
    message: `PR #${pr.number} created for issue ${githubRef}`,
    entityType: "issue",
    entityId: issueId,
    metadata: { prUrl: pr.html_url, prNumber: pr.number },
  });

  await ctx.metrics.write("github_sync.events_processed", 1, { type: "pr", direction: "outbound" });
}
