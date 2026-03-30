import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  DEFAULT_CONFIG,
  EXPORT_NAMES,
  JOB_KEYS,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
  WEBHOOK_KEYS,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "GitHub Sync",
  description:
    "Bidirectional GitHub issue sync with agent assignment via labels and PR creation by agents.",
  author: "Paperclip",
  categories: ["connector", "automation"],
  capabilities: [
    "issues.read",
    "issues.create",
    "issues.update",
    "issue.comments.create",
    "agents.read",
    "companies.read",
    "projects.read",
    "activity.log.write",
    "metrics.write",
    "plugin.state.read",
    "plugin.state.write",
    "events.subscribe",
    "jobs.schedule",
    "webhooks.receive",
    "http.outbound",
    "secrets.read-ref",
    "instance.settings.register",
    "ui.dashboardWidget.register",
    "ui.detailTab.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      githubAppId: {
        type: "string",
        title: "GitHub App ID",
      },
      githubInstallationId: {
        type: "string",
        title: "Installation ID",
      },
      privateKeySecret: {
        type: "string",
        title: "Private Key Secret Reference",
        description: "Secret reference to the GitHub App private key (PEM)",
      },
      orgName: {
        type: "string",
        title: "GitHub Organization",
      },
      companyId: {
        type: "string",
        title: "Paperclip Company ID",
      },
      pollIntervalMinutes: {
        type: "number",
        title: "Poll Interval (minutes)",
        default: DEFAULT_CONFIG.pollIntervalMinutes,
        minimum: 1,
        maximum: 30,
      },
      syncLabelsPrefix: {
        type: "string",
        title: "Agent Label Prefix",
        default: DEFAULT_CONFIG.syncLabelsPrefix,
      },
      webhookSecretRef: {
        type: "string",
        title: "Webhook Secret Reference",
        description: "Secret reference for webhook signature validation",
      },
    },
    required: [
      "githubAppId",
      "githubInstallationId",
      "privateKeySecret",
      "orgName",
      "companyId",
      "webhookSecretRef",
    ],
  },
  jobs: [
    {
      jobKey: JOB_KEYS.poll,
      displayName: "GitHub Poll",
      description: "Polls GitHub for issue and PR changes missed by webhooks.",
      schedule: "*/5 * * * *",
    },
  ],
  webhooks: [
    {
      endpointKey: WEBHOOK_KEYS.githubEvents,
      displayName: "GitHub Events",
      description: "Receives GitHub webhook payloads for issues and pull requests.",
    },
  ],
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboardWidget,
        displayName: "GitHub Sync",
        exportName: EXPORT_NAMES.dashboardWidget,
      },
      {
        type: "settingsPage",
        id: SLOT_IDS.settingsPage,
        displayName: "GitHub Sync Settings",
        exportName: EXPORT_NAMES.settingsPage,
      },
      {
        type: "detailTab",
        id: SLOT_IDS.issueTab,
        displayName: "GitHub",
        exportName: EXPORT_NAMES.issueTab,
        entityTypes: ["issue"],
      },
    ],
  },
};

export default manifest;
