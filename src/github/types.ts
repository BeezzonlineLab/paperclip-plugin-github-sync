export interface GitHubSyncConfig {
  githubAppId: string;
  githubInstallationId: string;
  privateKeySecret: string;
  orgName: string;
  companyId: string;
  pollIntervalMinutes: number;
  syncLabelsPrefix: string;
  webhookSecretRef: string;
}

export interface GitHubInstallationToken {
  token: string;
  expiresAt: Date;
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  updated_at: string;
  created_at: string;
  html_url: string;
  user: { login: string; id: number };
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  merged: boolean;
  merged_at: string | null;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  updated_at: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  archived: boolean;
  html_url: string;
}

export interface GitHubWebhookPayload {
  action: string;
  issue?: GitHubIssue;
  pull_request?: GitHubPullRequest;
  repository: GitHubRepo;
  sender: { id: number; login: string };
  installation?: { id: number };
}

export interface GitHubTreeEntry {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000" | "120000";
  type: "blob" | "tree" | "commit";
  sha?: string;
  content?: string;
}

export interface GitHubCreateTreeResponse {
  sha: string;
}

export interface GitHubCreateCommitResponse {
  sha: string;
}

export interface GitHubCreatePRResponse {
  number: number;
  html_url: string;
}

export interface GitHubRef {
  ref: string;
  object: { sha: string };
}
