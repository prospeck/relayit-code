import { WELCOME_VERSION } from "../electron/onboarding-record.mjs";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { fixtureApi, mountPreview, parkUntilSignal, type MountedPreview } from "./testing/preview-fixture.ts";

if (!process.env.OMB_DATA_DIR) throw new Error("Set OMB_DATA_DIR to a fresh temporary folder before starting this fixture.");
const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_REPLIES: JSON.stringify([
  "The launch checklist is ready. I grouped the work into design review, connector checks, and the first release handoff.\n\nThe next step is to review the RelayIt artwork in light and dark themes.",
]) });
const stopBackend = () => { fixture.child.kill("SIGTERM"); };
process.once("SIGINT", stopBackend);
process.once("SIGTERM", stopBackend);
let preview: MountedPreview | undefined;
try {
  const api = fixtureApi(fixture.info.url);
  await api("PATCH", "/api/config", { language: "en", onboarding: { completedAt: new Date().toISOString(), version: WELCOME_VERSION } });
  for (const name of ["Atlas", "Iris", "Cove"]) await runControlOmb(["new-bot", "--name", name, "--url", fixture.info.url]);
  const { bots } = await api("GET", "/api/bots") as { bots: Array<{ id: string; name: string; defaultBot?: object }> };
  for (const bot of bots) {
    const look = bot.name === "Atlas" ? { color: "orange", mascotBody: "cursor", title: "Launch coordinator" }
      : bot.name === "Iris" ? { color: "purple", mascotBody: "hexagon", title: "Design review", mascotExpression: "listening" }
      : bot.name === "Cove" ? { color: "teal", mascotBody: "capsule", title: "Connector checks" }
      : { name: "Relay", color: "chrome", mascotBody: "cursor", title: "Your assistant" };
    await api("PATCH", `/api/bots/${bot.id}`, { ...look, ...(bot.defaultBot ? { welcomed: true } : {}), description: "Synthetic bot for isolated RelayIt brand review." });
  }
  const atlas = bots.find((bot) => bot.name === "Atlas")!;
  await runControlOmb(["send", "--bot", atlas.id, "--text", "Prepare a short checklist for the RelayIt launch.", "--url", fixture.info.url]);
  await runControlOmb(["wait", "--bot", atlas.id, "--timeout", "30", "--url", fixture.info.url]);
  preview = await mountPreview(fixture, { entry: "/src/testing/relay-brand.tsx", route: "/__relay-brand.html", title: "RelayIt brand review" });
  console.log(JSON.stringify({ pid: process.pid, previewUrl: preview.previewUrl, apiUrl: fixture.info.url }));
  await parkUntilSignal();
} finally {
  await fixture.close();
  await preview?.close();
  process.off("SIGINT", stopBackend);
  process.off("SIGTERM", stopBackend);
}
