import { usePluginAction } from "@paperclipai/plugin-sdk/ui";
import type { PluginSettingsPageProps } from "@paperclipai/plugin-sdk/ui";
import { useState } from "react";

export function SettingsPage({ context }: PluginSettingsPageProps) {
  const testConnection = usePluginAction("test-connection");
  const forceSyncNow = usePluginAction("force-sync-now");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const handleTestConnection = async () => {
    setTestResult("Testing...");
    try {
      const result = (await testConnection({})) as { ok: boolean; error?: string };
      setTestResult(result.ok ? "Connected!" : `Failed: ${result.error}`);
    } catch (err) {
      setTestResult(`Error: ${String(err)}`);
    }
  };

  const handleForceSync = async () => {
    setSyncing(true);
    try {
      await forceSyncNow({});
      setSyncing(false);
    } catch {
      setSyncing(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <h2 style={{ marginBottom: 16 }}>GitHub Sync Settings</h2>
      <p style={{ marginBottom: 16, color: "#6b7280", fontSize: 14 }}>
        Configuration is managed via the plugin instance config. Use the buttons below to test and trigger sync.
      </p>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <button onClick={handleTestConnection} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db", cursor: "pointer", backgroundColor: "#f9fafb" }}>
          Test Connection
        </button>
        <button onClick={handleForceSync} disabled={syncing} style={{ padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db", cursor: syncing ? "not-allowed" : "pointer", backgroundColor: syncing ? "#e5e7eb" : "#f9fafb" }}>
          {syncing ? "Syncing..." : "Force Sync Now"}
        </button>
      </div>
      {testResult && (
        <div style={{ padding: 12, borderRadius: 6, backgroundColor: testResult.startsWith("Connected") ? "#dcfce7" : "#fef2f2", fontSize: 14 }}>
          {testResult}
        </div>
      )}
    </div>
  );
}
