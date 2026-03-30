import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { GitHubSyncConfig } from "../github/types.js";
import type { GitHubClient } from "../github/client.js";
import { STATE_KEYS } from "../constants.js";
import { getRepoCursor, setRepoCursor } from "./mapping.js";
import { processGitHubIssue } from "./inbound.js";
import { getIssueForPR } from "./mapping.js";
import { cleanExpiredNonces } from "./dedup.js";

export async function discoverRepos(
  ctx: PluginContext,
  config: GitHubSyncConfig,
  ghClient: GitHubClient,
): Promise<void> {
  const ghRepos = await ghClient.listOrgRepos();
  const activeRepos = ghRepos.filter((r) => !r.archived);

  const projects = [];
  let offset = 0;
  while (true) {
    const batch = await ctx.projects.list({ companyId: config.companyId, limit: 100, offset });
    projects.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  const projectsByName = new Map(projects.map((p) => [p.name, p.id]));

  const trackedRepos: string[] = [];
  const unlinkedRepos: string[] = [];

  for (const repo of activeRepos) {
    const projectId = projectsByName.get(repo.name);
    if (projectId) {
      trackedRepos.push(repo.full_name);
      await ctx.state.set({ scopeKind: "instance", stateKey: `repo:${repo.full_name}:projectId` }, projectId);
    } else {
      unlinkedRepos.push(repo.full_name);
    }
  }

  await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEYS.repos }, trackedRepos);
  await ctx.state.set({ scopeKind: "instance", stateKey: STATE_KEYS.unlinkedRepos }, unlinkedRepos);
  ctx.logger.info("Repo discovery complete", { tracked: trackedRepos.length, unlinked: unlinkedRepos.length });
}

export async function pollAllRepos(
  ctx: PluginContext,
  config: GitHubSyncConfig,
  ghClient: GitHubClient,
): Promise<void> {
  const startTime = Date.now();

  if (!(await ghClient.isRateLimitSafe())) {
    ctx.logger.warn("Skipping poll cycle due to rate limit");
    return;
  }

  const repos = ((await ctx.state.get({ scopeKind: "instance", stateKey: STATE_KEYS.repos })) ?? []) as string[];

  if (repos.length === 0) {
    ctx.logger.info("No tracked repos, running discovery first");
    await discoverRepos(ctx, config, ghClient);
    return;
  }

  let totalIssuesProcessed = 0;
  let totalPRsProcessed = 0;

  for (const repoFullName of repos) {
    try {
      const cursor = await getRepoCursor(ctx, repoFullName);
      const since = cursor?.lastPollAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const issues = await ghClient.listIssuesSince(repoFullName, since);
      for (const issue of issues) {
        const ref = `${repoFullName}#${issue.number}`;
        await cleanExpiredNonces(ctx, ref);
        try {
          await processGitHubIssue(ctx, config, ghClient, repoFullName, issue);
          totalIssuesProcessed++;
        } catch (err) {
          ctx.logger.error("Error processing issue", { repo: repoFullName, issue: issue.number, error: String(err) });
          await ctx.metrics.write("github_sync.errors", 1, { type: "inbound_issue" });
        }
      }

      const closedPRs = await ghClient.listClosedPRsSince(repoFullName, since);
      for (const pr of closedPRs) {
        if (pr.merged) {
          const prRef = `${repoFullName}#${pr.number}`;
          const issueId = await getIssueForPR(ctx, prRef);
          if (issueId) {
            try {
              const issue = await ctx.issues.get(issueId, config.companyId);
              if (issue && issue.status === "in_review") {
                await ctx.issues.update(issueId, { status: "done" }, config.companyId);
                await ctx.activity.log({ companyId: config.companyId, message: `PR ${prRef} merged, issue marked done`, entityType: "issue", entityId: issueId });
                totalPRsProcessed++;
              }
            } catch (err) {
              ctx.logger.error("Error processing merged PR", { prRef, error: String(err) });
            }
          }
        }
      }

      await setRepoCursor(ctx, repoFullName, new Date().toISOString());
    } catch (err) {
      ctx.logger.error("Error polling repo", { repo: repoFullName, error: String(err) });
      await ctx.metrics.write("github_sync.errors", 1, { type: "poll_repo" });
    }
  }

  const durationMs = Date.now() - startTime;
  await ctx.metrics.write("github_sync.poll_duration_ms", durationMs);
  ctx.logger.info("Poll cycle complete", { repos: repos.length, issuesProcessed: totalIssuesProcessed, prsProcessed: totalPRsProcessed, durationMs });
}

export async function initialSync(
  ctx: PluginContext,
  config: GitHubSyncConfig,
  ghClient: GitHubClient,
): Promise<void> {
  ctx.logger.info("Starting initial sync");
  await discoverRepos(ctx, config, ghClient);

  const repos = ((await ctx.state.get({ scopeKind: "instance", stateKey: STATE_KEYS.repos })) ?? []) as string[];
  let totalImported = 0;

  for (const repoFullName of repos) {
    try {
      const issues = await ghClient.listOpenIssues(repoFullName);
      for (const issue of issues) {
        try {
          await processGitHubIssue(ctx, config, ghClient, repoFullName, issue);
          totalImported++;
        } catch (err) {
          ctx.logger.error("Error importing issue during initial sync", { repo: repoFullName, issue: issue.number, error: String(err) });
        }
      }
      await setRepoCursor(ctx, repoFullName, new Date().toISOString());
    } catch (err) {
      ctx.logger.error("Error during initial sync for repo", { repo: repoFullName, error: String(err) });
    }
  }

  const unlinkedRepos = ((await ctx.state.get({ scopeKind: "instance", stateKey: STATE_KEYS.unlinkedRepos })) ?? []) as string[];
  await ctx.activity.log({ companyId: config.companyId, message: `Initial sync: ${repos.length} repos linked, ${totalImported} issues imported, ${unlinkedRepos.length} repos unlinked` });
  ctx.logger.info("Initial sync complete", { reposLinked: repos.length, issuesImported: totalImported, reposUnlinked: unlinkedRepos.length });
}
