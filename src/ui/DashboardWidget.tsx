import { usePluginData } from "@paperclipai/plugin-sdk/ui";
import type { PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";

interface SyncStatus {
  connected: boolean;
  orgName: string;
  trackedRepos: number;
  unlinkedRepos: string[];
  rateLimit: { remaining: number; resetAt: number } | null;
}

export function DashboardWidget({ context }: PluginWidgetProps) {
  const { data, loading, error } = usePluginData<SyncStatus>("sync-status", {
    companyId: context.companyId,
  });

  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;
  if (error) return <div style={{ padding: 16, color: "red" }}>Error: {error.message}</div>;
  if (!data) return <div style={{ padding: 16 }}>Not configured</div>;

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: data.connected ? "#22c55e" : "#ef4444",
            display: "inline-block",
          }}
        />
        <strong>GitHub: {data.orgName}</strong>
      </div>
      <div style={{ fontSize: 14, marginBottom: 8 }}>
        {data.trackedRepos} repos tracked
      </div>
      {data.unlinkedRepos.length > 0 && (
        <div style={{ fontSize: 12, color: "#f59e0b", marginBottom: 8 }}>
          {data.unlinkedRepos.length} repos unlinked (create matching Paperclip projects)
        </div>
      )}
      {data.rateLimit && (
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          API: {data.rateLimit.remaining} calls remaining
        </div>
      )}
    </div>
  );
}
