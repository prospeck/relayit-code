import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { score, toolSequence } from "./score.ts";
import { scenarios } from "./scenarios.ts";
import type { Result } from "./run.ts";

// Regrade recorded evidence after correcting a check, without making model calls.
// Raw transcripts, timing, tokens and tool evidence are preserved.
const path = resolve(process.argv[2] ?? "");
const resultsDir = fileURLToPath(new URL("./results", import.meta.url));
assert.equal(dirname(path), resultsDir, "Pass a JSON result inside evals/results/");
type Report = {
  version: number;
  complete: boolean;
  startedAt: string;
  configuration: { model: string; provider: string; repeat: number; only: string | null };
  results: Result[];
  summary: unknown;
  gradedAt?: string;
  gradingNote?: string;
};
const report = JSON.parse(await readFile(path, "utf8")) as Report;
assert.equal(report.complete, true, "The model run must finish before regrading");
const selected = scenarios.filter(
  (s) => !report.configuration.only || report.configuration.only === s.id,
);
assert.equal(report.results.length, selected.length * report.configuration.repeat);
for (const s of selected) {
  const attempts = report.results.filter((r) => r.id === s.id);
  assert.equal(
    attempts.length,
    report.configuration.repeat,
    `${s.id}: missing or duplicate attempts`,
  );
  assert.equal(new Set(attempts.map((r) => r.iteration)).size, attempts.length);
}
for (const result of report.results) {
  const scenario = scenarios.find((s) => s.id === result.id);
  assert.ok(scenario, `Unknown scenario ${result.id}`);
  assert.equal(result.prompt, scenario.prompt);
  assert.ok(result.wallTimeMs >= 0);
  assert.ok(result.tokens.input >= 0 && result.tokens.output >= 0);
  assert.deepEqual(result.tools, toolSequence(result));
  assert.ok(
    result.cards.every((c) => c.status === "refused"),
    `${result.id}: an approval was not refused`,
  );
  result.checks = score(scenario, result);
  result.passed = result.checks.every((c) => c.pass);
  result.expected = scenario.expectations;
}
const passed = report.results.filter((r) => r.passed).length;
report.summary = {
  passed,
  total: report.results.length,
  planned: selected.length * report.configuration.repeat,
  passRate: passed / report.results.length,
  scenarios: selected.map((s) => {
    const attempts = report.results.filter((r) => r.id === s.id);
    const n = attempts.filter((r) => r.passed).length;
    return {
      id: s.id,
      passed: n,
      total: attempts.length,
      passRate: n / attempts.length,
      flaky: n > 0 && n < attempts.length,
    };
  }),
};
report.version = 2;
report.gradedAt = new Date().toISOString();
report.gradingNote =
  "Regraded from unchanged model/audit evidence with the current scenarios and scorer. Includes named restaurant/dish, quote amount, rejected model-call feedback and refusal retry checks; permits a composed manager email without an unrelated thread reply. No inference rerun.";
await writeFile(path, JSON.stringify(report, null, 2) + "\n");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const rows = report.results.map(
  (r) =>
    `| ${r.id} #${r.iteration} | ${r.passed ? "PASS" : "FAIL"} | ${r.checks.map((c) => `${c.pass ? "✓" : "✗"} ${cell(c.name)}`).join("<br>")} | ${r.tools.join(" → ") || "—"} | ${(r.wallTimeMs / 1000).toFixed(1)}s | ${r.tokens.input}/${r.tokens.output} |`,
);
await writeFile(
  resolve(resultsDir, "latest.md"),
  `# Intent understanding eval\n\n${report.configuration.model} via ${report.configuration.provider}; ${report.startedAt}. Complete.\n\n${passed}/${report.results.length} passed (${((passed / report.results.length) * 100).toFixed(1)}%). ${report.configuration.repeat} attempt(s) per scenario.\n\n[Full evidence](${basename(path)})\n\n| Scenario | Result | Checks | Tools (executions + approval requests) | Wall time | Tokens in/out |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n\nAll approval cards were refused. Model steps exclude refusal-only continuations; wall time and tokens include them. Interrupted requests may not report tokens. Runtime/tool errors fail even if recovered. Success-claim scoring is lexical; inspect transcripts. A single attempt cannot establish flakiness.\n\n${report.gradingNote}\n`,
);
console.log(
  `Validated and graded ${report.results.length} results: ${passed} passed, ${report.results.length - passed} failed.`,
);
