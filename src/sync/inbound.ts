import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { GitHubIssue, GitHubSyncConfig } from "../github/types.js";
import { AGENTS_CACHE_TTL_MS, STATE_KEYS } from "../constants.js";
import { getIssueMapping, getIssueUpdatedAt, getProjectIdForRepo, setIssueMapping, setIssueUpdatedAt } from "./mapping.js";
import type { GitHubClient } from "../github/client.js";

interface CachedAgents {
  agents: Array<{ id: string; urlKey: string; name: string }>;
  cachedAt: number;
}

async function resolveAgent(ctx: PluginContext, config: GitHubSyncConfig, urlKey: string): Promise<{ id: string; name: string } | null> {
  const cached = (await ctx.state.get({ scopeKind: "instance", stateKey: STATE_KEYS.agentsCache })) as CachedAgents | null;
  let agents: CachedAgents["agents"];

  if (cached && Date.now() - cached.cachedAt < AGENTS_CACHE_TTL_MS) {
    agents = cached.agents;
  } else {
    const agentList = await ctx.agents.list({ companyId: config.companyId });
    agents = agentList.map((a) => ({ id: a.id, urlKey: a.urlKey, name: a.name }));
    await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEYS.agentsCache }, { agents, cachedAt: Date.now() });
  }

  const match = agents.find((a) => a.urlKey === urlKey);
  return match ? { id: match.id, name: match.name } : null;
}

function extractAgentLabel(labels: Array<{ name: string }>, prefix: string): string | null {
  const label = labels.find((l) => l.name.startsWith(prefix));
  if (!label) return null;
  return label.name.slice(prefix.length);
}

export async function processGitHubIssue(
  ctx: PluginContext,
  config: GitHubSyncConfig,
  ghClient: GitHubClient,
  repoFullName: string,
  issue: GitHubIssue,
): Promise<void> {
  const githubRef = `${repoFullName}#${issue.number}`;

  const lastUpdatedAt = await getIssueUpdatedAt(ctx, githubRef);
  if (lastUpdatedAt && lastUpdatedAt === issue.updated_at) return;

  const projectId = await getProjectIdForRepo(ctx, repoFullName);
  if (!projectId) {
    ctx.logger.warn("No project mapping for repo, skipping", { repoFullName });
    return;
  }

  const agentUrlKey = extractAgentLabel(issue.labels, config.syncLabelsPrefix);
  let assigneeAgentId: string | null | undefined = undefined;

  if (agentUrlKey) {
    const agent = await resolveAgent(ctx, config, agentUrlKey);
    if (agent) {
      assigneeAgentId = agent.id;
    } else {
      ctx.logger.warn("Agent not found for label", { agentUrlKey, githubRef });
      await ghClient.addComment(repoFullName, issue.number, `Agent \`${agentUrlKey}\` not found in Paperclip. Issue imported without assignment.`);
    }
  } else {
    assigneeAgentId = null;
  }

  const existingId = await getIssueMapping(ctx, githubRef);

  if (existingId) {
    const patch: Record<string, unknown> = {
      title: issue.title,
      description: issue.body ?? undefined,
    };
    if (issue.state === "closed") patch.status = "cancelled";
    if (assigneeAgentId !== undefined) patch.assigneeAgentId = assigneeAgentId;

    await ctx.issues.update(existingId, patch as Parameters<typeof ctx.issues.update>[1], config.companyId);
    await ctx.activity.log({ companyId: config.companyId, message: `GitHub issue ${githubRef} synced (updated)`, entityType: "issue", entityId: existingId });
  } else {
    if (issue.state === "closed") return;

    const created = await ctx.issues.create({
      companyId: config.companyId,
      projectId,
      title: issue.title,
      description: issue.body ?? undefined,
      assigneeAgentId: assigneeAgentId ?? undefined,
    });

    await setIssueMapping(ctx, githubRef, created.id);

    if (created.status !== "todo") {
      try {
        await ctx.issues.update(created.id, { status: "todo" }, config.companyId);
      } catch {
        ctx.logger.warn("Could not set initial status to todo", { issueId: created.id });
      }
    }

    await ctx.activity.log({ companyId: config.companyId, message: `GitHub issue ${githubRef} imported`, entityType: "issue", entityId: created.id });
  }

  await setIssueUpdatedAt(ctx, githubRef, issue.updated_at);
  await ctx.metrics.write("github_sync.events_processed", 1, { type: "issue", direction: "inbound" });
}
