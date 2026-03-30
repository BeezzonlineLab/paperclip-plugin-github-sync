import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";

interface GithubInfo {
  githubRef: string;
  repoFullName: string;
  issueNumber: number;
  issueUrl: string;
  prRef: string | null;
  prUrl: string | null;
  lastSyncedAt: string | null;
}

export function IssueDetailTab({ context }: PluginDetailTabProps) {
  const { data, loading, error } = usePluginData<GithubInfo | null>("issue-github-info", { issueId: context.entityId });

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;
  if (error) return <div style={{ padding: 16, color: "red" }}>Error: {error.message}</div>;
  if (!data) return <div style={{ padding: 16, color: "#9ca3af" }}>Not linked to GitHub</div>;

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ marginBottom: 12 }}>GitHub Issue</h3>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Reference</div>
        <a href={data.issueUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "none" }}>
          {data.githubRef}
        </a>
      </div>
      {data.prRef && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Pull Request</div>
          <a href={data.prUrl!} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "none" }}>
            {data.prRef}
          </a>
        </div>
      )}
      {data.lastSyncedAt && (
        <div style={{ fontSize: 12, color: "#9ca3af" }}>
          Last synced: {new Date(data.lastSyncedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
