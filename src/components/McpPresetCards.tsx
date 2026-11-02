import { MCP_PRESETS } from "../../shared/mcp-presets";
import { t } from "@/lib/i18n";
import { isRemoteMcpListing, type McpServerListing } from "./mcp-draft";

export function McpPresetCards({ servers, disabled, connect }: {
  servers: readonly McpServerListing[];
  disabled: boolean;
  connect(preset: typeof MCP_PRESETS[number]): Promise<void>;
}) {
  return <section className="mb-5" aria-label={t("india.presets.title")}>
    <h4 className="mb-2 text-sm font-semibold text-ink">{t("india.presets.title")}</h4>
    <div className="grid gap-2 sm:grid-cols-2">
      {MCP_PRESETS.map((preset) => {
        const connected = servers.some((server) => isRemoteMcpListing(server) && server.url === preset.url && server.enabled && server.auth === "signed-in");
        return <div key={preset.id} className="rounded-xl border border-hairline p-3">
          <p className="text-sm font-medium text-ink">{preset.name}</p>
          <p className="my-1 text-xs text-ink-secondary">{t(preset.descriptionKey)}</p>
          <button type="button" disabled={disabled || connected} onClick={() => void connect(preset)}
            className="rounded-lg bg-control px-3 py-1.5 text-xs text-ink disabled:opacity-40"
            aria-label={t("india.presets.connect", { name: preset.name })}>
            {t(connected ? "apps.connected" : "connectors.action.connect")}
          </button>
        </div>;
      })}
    </div>
  </section>;
}
