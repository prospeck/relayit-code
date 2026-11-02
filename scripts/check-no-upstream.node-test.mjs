import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { checkNoUpstream, upstreamReferences } from "./check-no-upstream.mjs";

test("detects upstream hosts and releases, including escaped literals", () => {
  for (const text of [
    'https://ACCOUNTS.OPENMAUSBOT.COM/sign-in',
    'https://cloud.openmausbot.com',
    'https://app.mausbot.si',
    'https://a.mausbot.page',
    'https://www.mausbot.com',
    'https://openmausbot-composio.milindsoni201.workers.dev',
    'https://us.i.posthog.com',
    'https://omb-u-fixture.fly.dev',
    'https://omb-t-acme.fly.dev',
    'https://api.github.com/repos/milind-soni/OpenMausBot/releases/latest',
    'https://raw.githubusercontent.com/milind-soni/openmausbot-teams/main/catalog.json',
    String.raw`/^c-[a-z]+\.openmausbot\.com$/`,
    String.raw`https:\/\/accounts.openmausbot.com`,
  ]) assert.ok(upstreamReferences(text).length, text);
  assert.equal(upstreamReferences("local\nhttps://cloud.openmausbot.com")[0].line, 2);
});

test("leaves brand identifiers and independent direct-key services alone", () => {
  for (const text of [
    'openmausbot.sidebarDensity', '.openmausbot', 'OMB_COMPOSIO_API_KEY',
    'https://boat.dev/api/v1', 'https://api.elevenlabs.io/v1',
    'https://api.fish.audio', 'https://openrouter.ai/api/v1',
    'https://backend.composio.dev', 'http://computer.tailnet.ts.net:8810',
    'https://github.com/vercel-labs/agent-browser',
  ]) assert.deepEqual(upstreamReferences(text), [], text);
});

test("scans shipped roots and permits only explicit legal paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'relayit-guard-fixture-'));
  try {
    for (const dir of ['server', 'public', 'src/third_party', 'docs']) await mkdir(path.join(root, dir), { recursive: true });
    const upstream = 'https://accounts.openmausbot.com';
    await writeFile(path.join(root, 'server/client.ts'), upstream);
    await writeFile(path.join(root, 'public/client.js'), upstream);
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ homepage: upstream }));
    await writeFile(path.join(root, 'server/LICENSE'), upstream);
    await writeFile(path.join(root, 'src/third_party/license.txt'), upstream);
    await writeFile(path.join(root, 'docs/history.md'), upstream);
    const result = await checkNoUpstream(root);
    assert.deepEqual(result.hits.map(hit => hit.file).sort(), ['package.json', 'public/client.js', 'server/client.ts']);
    assert.equal(result.scanned, 3);
    await writeFile(path.join(root, 'server/client.ts'), 'export const app = "OpenMausBot";');
    await writeFile(path.join(root, 'public/client.js'), '');
    await writeFile(path.join(root, 'package.json'), '{}');
    assert.deepEqual((await checkNoUpstream(root)).hits, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
