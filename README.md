# Paperclip GitHub Sync Plugin

Bidirectional GitHub issue synchronization for [Paperclip](https://github.com/paperclipai/paperclip) — assign tasks to AI agents via GitHub labels, sync statuses in real-time, and let agents open PRs when work is done.

## Features

- **Bidirectional issue sync** — GitHub issues are imported into Paperclip; status changes sync back to GitHub
- **Agent assignment via labels** — Add `agent:django-specialist` to a GitHub issue and it gets assigned to the matching Paperclip agent
- **PR creation** — When an agent completes work, the plugin creates a branch and opens a PR
- **Hybrid webhook + polling** — Webhooks for real-time updates, polling every 5 minutes as fallback
- **Anti-loop protection** — Nonce-based mechanism prevents infinite sync loops
- **Dashboard widget** — See sync status, tracked repos, and unlinked repos at a glance
- **Issue detail tab** — View GitHub reference, linked PRs, and sync status on any issue

## Requirements

- [Paperclip](https://github.com/paperclipai/paperclip) v0.3.x or later
- A GitHub App installed on your organization
- Node.js 20+

## Quick Start

### 1. Create a GitHub App

Go to your GitHub org settings → Developer settings → GitHub Apps → New GitHub App.

| Setting | Value |
|---------|-------|
| **App name** | `Paperclip Sync` (or any name) |
| **Homepage URL** | Your Paperclip instance URL |
| **Webhook URL** | `https://<your-paperclip>/api/plugins/<plugin-id>/webhooks/github-events` |
| **Webhook secret** | Generate with `openssl rand -hex 32` |

**Repository permissions:**

| Permission | Access |
|-----------|--------|
| Issues | Read & Write |
| Pull requests | Read & Write |
| Contents | Read & Write |
| Metadata | Read-only |

**Subscribe to events:** Issues, Pull request

After creation:
1. Note the **App ID**
2. Generate a **Private Key** (downloads a `.pem` file)
3. **Install the App** on your org → note the **Installation ID** (from the URL)

### 2. Install the Plugin

```bash
# From your Paperclip directory
pnpm paperclipai plugin install ./packages/plugins/plugin-github-sync

# Or from npm (when published)
# pnpm paperclipai plugin install @paperclipai/plugin-github-sync
```

### 3. Create Secrets

Store your GitHub App credentials as Paperclip secrets:

```bash
COMPANY_ID="<your-company-id>"

# Private key
curl -X POST "http://localhost:3100/api/companies/$COMPANY_ID/secrets" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"github-app-private-key\",
    \"value\": \"$(cat /path/to/your-app.private-key.pem)\"
  }"
# Note the returned secret ID → PRIVATE_KEY_SECRET_ID

# Webhook secret
curl -X POST "http://localhost:3100/api/companies/$COMPANY_ID/secrets" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "github-webhook-secret",
    "value": "<your-webhook-secret>"
  }'
# Note the returned secret ID → WEBHOOK_SECRET_ID
```

### 4. Configure the Plugin

```bash
PLUGIN_ID="<from plugin install output>"

curl -X POST "http://localhost:3100/api/plugins/$PLUGIN_ID/config" \
  -H "Content-Type: application/json" \
  -d '{
    "configJson": {
      "githubAppId": "<app-id>",
      "githubInstallationId": "<installation-id>",
      "privateKeySecret": "<PRIVATE_KEY_SECRET_ID>",
      "orgName": "<your-github-org>",
      "companyId": "<your-paperclip-company-id>",
      "pollIntervalMinutes": 5,
      "syncLabelsPrefix": "agent:",
      "webhookSecretRef": "<WEBHOOK_SECRET_ID>"
    }
  }'
```

### 5. Create Matching Projects

The plugin maps GitHub repos to Paperclip projects **by name**. Create a project for each repo you want to sync:

```bash
curl -X POST "http://localhost:3100/api/companies/$COMPANY_ID/projects" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-repo", "status": "in_progress"}'
```

### 6. Test the Connection

```bash
curl -X POST "http://localhost:3100/api/plugins/$PLUGIN_ID/actions/test-connection" \
  -H "Content-Type: application/json" -d '{}'
# Expected: {"data":{"ok":true}}
```

### 7. Run Initial Sync

```bash
curl -X POST "http://localhost:3100/api/plugins/$PLUGIN_ID/actions/force-sync-now" \
  -H "Content-Type: application/json" -d '{}'
# Expected: {"data":{"success":true}}
```

## Usage

### Assign an Agent via GitHub

1. Create a GitHub label matching an agent's `urlKey`: `agent:django-specialist`
2. Add the label to any issue
3. The plugin syncs the issue to Paperclip and assigns it to the matching agent
4. The agent's heartbeat picks up the task automatically

### Status Flow

| GitHub Event | Paperclip Status |
|-------------|-----------------|
| Issue opened | `todo` |
| Agent checks out issue | `in_progress` |
| Agent completes work | `in_review` |
| PR merged | `done` |
| Issue closed manually | `cancelled` |

Status changes in Paperclip are reflected back on GitHub as labels (`status:in-progress`, `status:in-review`, `status:done`) and comments.

### Available Agent Labels

Use `agent:<urlKey>` where `urlKey` is the agent's URL key in Paperclip. Examples:

```
agent:django-specialist
agent:react-specialist
agent:devops-specialist
agent:code-reviewer
agent:product-manager
agent:ui-designer
```

## Configuration Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `githubAppId` | Yes | - | GitHub App ID |
| `githubInstallationId` | Yes | - | Installation ID on the org |
| `privateKeySecret` | Yes | - | Secret ID for the GitHub App private key (PEM) |
| `orgName` | Yes | - | GitHub organization name |
| `companyId` | Yes | - | Paperclip company ID to sync with |
| `pollIntervalMinutes` | No | `5` | Polling interval (1-30 minutes) |
| `syncLabelsPrefix` | No | `agent:` | Prefix for agent assignment labels |
| `webhookSecretRef` | Yes | - | Secret ID for webhook signature validation |

## Architecture

```
GitHub                          Paperclip
──────                          ─────────
Issue created ──webhook──→ Plugin ──→ Issue created (todo)
Label added   ──webhook──→ Plugin ──→ Agent assigned
                           Plugin ←── Agent checkout (in_progress)
                           Plugin ──→ Comment + label on GitHub
                           Plugin ←── Agent done (in_review)
                           Plugin ──→ Branch + PR + comment on GitHub
PR merged     ──webhook──→ Plugin ──→ Issue done
Issue closed  ──webhook──→ Plugin ──→ Issue cancelled
```

**Anti-loop:** Each outbound mutation embeds a nonce (`<!-- paperclip-sync:uuid -->`) in GitHub comments. Inbound webhooks check for the nonce and skip events triggered by the plugin itself.

## Development

```bash
# Install dependencies
pnpm install

# Build
cd packages/plugins/plugin-github-sync
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## Plugin Capabilities

The plugin declares the following Paperclip capabilities:

- `issues.read`, `issues.create`, `issues.update` — Issue CRUD
- `issue.comments.create` — Post sync comments
- `agents.read`, `projects.read`, `companies.read` — Read org data
- `plugin.state.read`, `plugin.state.write` — Store sync mappings
- `events.subscribe` — React to issue changes
- `jobs.schedule` — Periodic polling
- `webhooks.receive` — GitHub webhook endpoint
- `http.outbound` — Call GitHub API
- `secrets.read-ref` — Resolve stored credentials
- `activity.log.write`, `metrics.write` — Observability

## Known Limitations

- **Projects must be pre-created** — The Plugin SDK doesn't expose `projects.create`, so Paperclip projects must exist before sync (matched by repo name)
- **No automatic PR merge** — PRs are opened but not auto-merged
- **No bidirectional comment sync** — Only bot-posted comments, not full thread mirroring
- **Single-tenant** — One GitHub org per plugin instance

## License

MIT
