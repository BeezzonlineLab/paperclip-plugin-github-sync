export const PLUGIN_ID = "paperclip.github-sync";
export const PLUGIN_VERSION = "0.1.0";

export const JOB_KEYS = {
  poll: "github-poll",
} as const;

export const WEBHOOK_KEYS = {
  githubEvents: "github-events",
} as const;

export const SLOT_IDS = {
  dashboardWidget: "github-sync-dashboard",
  settingsPage: "github-sync-settings",
  issueTab: "github-sync-issue-tab",
} as const;

export const EXPORT_NAMES = {
  dashboardWidget: "DashboardWidget",
  settingsPage: "SettingsPage",
  issueTab: "IssueDetailTab",
} as const;

export const DATA_KEYS = {
  syncStatus: "sync-status",
  issueGithubInfo: "issue-github-info",
} as const;

export const ACTION_KEYS = {
  forceSyncNow: "force-sync-now",
  testConnection: "test-connection",
} as const;

export const STATE_KEYS = {
  repos: "repos",
  unlinkedRepos: "unlinked-repos",
  agentsCache: "agents-cache",
  processedDeliveries: "processed-deliveries",
  rateLimit: "rate-limit",
} as const;

export const DEFAULT_CONFIG = {
  pollIntervalMinutes: 5,
  syncLabelsPrefix: "agent:",
};

export const SYNC_NONCE_PREFIX = "<!-- paperclip-sync:";
export const SYNC_NONCE_SUFFIX = " -->";
export const SYNC_NONCE_TTL_MS = 60 * 60 * 1000; // 1 hour
export const AGENTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const DELIVERY_RING_BUFFER_SIZE = 1000;
export const GITHUB_TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes before expiry
