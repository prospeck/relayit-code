import {fs,tests} from './.relayit-edit.mjs';
const p='electron/cloud-connections.node-test.mjs';
tests(p,title=>title.startsWith("a trial's Cloud keeps")||title.startsWith("a server of the person's own with no connected-apps service"));
let s=fs.readFileSync(p,'utf8').replaceAll('mode: "managed"','mode: "own"').replaceAll('managed:','own:').replace('"PUT /api/cloud-connections/held-keys", ','').replace('      "mcp:dodo": { connection:', '      composio: { connection: { composio: { apiKey: "ck", userId: "u1" } } },\n      "mcp:dodo": { connection:');
s=s.replace('{ share: "c".repeat(64), apps: ["gmail"] }','{ apiKey: "ck", userId: "u1", apps: ["gmail"] }').replace('local.asked.find((what) => what.kind === "composio-share"), { kind: "composio-share", for: INSTALLATION }','local.asked.find((what) => what.id === "composio"), { kind: "connection", id: "composio" }');
fs.writeFileSync(p,s);
console.log('Own-key connection migration cases retained with direct credentials');
