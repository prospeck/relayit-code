import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "../App";
import { BotAvatar } from "../components/Avatar";
import { AgentCursor } from "../components/browser/AgentCursor";
import { MAUS_COLOR_NAMES } from "../lib/mascot";
import { applySkin, type SkinId } from "../lib/skins";
import { setLocale } from "../lib/i18n";
import "../styles.css";

const query = new URLSearchParams(location.search);
setLocale("en");
applySkin((query.get("theme") === "light" ? "daylight" : "midnight") satisfies SkinId);

function CursorReview() {
  const [sequence, setSequence] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSequence((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, []);
  return <main className="min-h-screen bg-panel p-10 text-ink">
    <header className="mb-8 flex items-center gap-3"><img src="/app-icon.svg" alt="RelayIt" width={44} height={44} /><div><h1 className="text-xl font-semibold">RelayIt · computer pointer and token states</h1><p className="text-sm text-ink-secondary">Real components on a synthetic surface. No computer is connected.</p></div></header>
    <div className="grid grid-cols-[260px_1fr] gap-8">
      <aside className="space-y-6 rounded-2xl border border-hairline bg-card p-6">
        <h2 className="text-sm font-medium">Activity stays readable without motion</h2>
        {([['idle', 'Idle'], ['working', 'Working'], ['listening', 'Waiting'], ['alerting', 'Needs attention'], ['happy', 'Complete']] as const).map(([state, label]) => <div key={state} className="flex items-center gap-3"><BotAvatar bot={{ name: "Atlas", color: "orange" }} state={state} size={36} /><span className="text-sm">{label}</span></div>)}
      </aside>
      <section className="overflow-hidden rounded-2xl border border-hairline bg-card">
        <div className="flex items-center gap-3 border-b border-hairline p-4"><BotAvatar bot={{ name: "Atlas", color: "orange" }} state="working" size={32} /><span className="text-sm">Atlas’s computer · pointer preview</span></div>
        <div className="relative m-6 h-[290px] rounded-xl border border-hairline bg-panel p-7">
          <div className="text-xs uppercase tracking-wider text-ink-secondary">Synthetic release board</div><h2 className="mt-3 text-2xl font-semibold">Ready for the handoff.</h2>
          <div className="mt-6 space-y-3 text-sm"><p>✓ RelayIt artwork</p><p>✓ Light and dark themes</p><p>✓ Reduced motion</p></div>
          <button className="mt-5 rounded-lg bg-accent px-4 py-2 text-sm text-accent-ink">Review the release</button>
          <AgentCursor phase="move" sequence={sequence} left={190} top={236} controller="agent" color="orange" />
        </div>
      </section>
    </div>
    <section className="mt-8 rounded-2xl border border-hairline bg-card p-6"><h2 className="mb-4 text-sm font-medium">Each bot keeps its colour · sidebar and chat sizes</h2><div className="flex flex-wrap items-center gap-5">{MAUS_COLOR_NAMES.map((color) => <div key={color} className="flex flex-col items-center gap-2"><BotAvatar bot={{ name: color, color }} size={36} state="idle" animated={false} /><BotAvatar bot={{ name: color, color }} size={20} state="working" animated={false} /><span className="text-xs text-ink-secondary">{color}</span></div>)}</div></section>
  </main>;
}

const root = createRoot(document.getElementById("root")!);
root.render(query.has("cursor") ? <CursorReview /> : <App />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
