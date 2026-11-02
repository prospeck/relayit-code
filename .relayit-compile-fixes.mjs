import {execFileSync} from 'node:child_process';
import {fs,ts,edit,tests,members,cleanImports,namedImports,replace,variables} from './.relayit-edit.mjs';
function restoreFunction(file,name){const original=execFileSync('git',['show',`693b804:${file}`],{encoding:'utf8'}),a=ts.createSourceFile(file,original,ts.ScriptTarget.Latest,true);const fn=a.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!fn)throw Error(name);edit(file,(n,c)=>{if(ts.isFunctionDeclaration(n)&&n.name?.text===name){c(n,fn.getText(a));return false;}});}
restoreFunction('server/cli.ts','runAccess');
let s=fs.readFileSync('server/cli.ts','utf8').replace(/\s*undefined\.dispose\(\);/g,'');fs.writeFileSync('server/cli.ts',s);
for(const f of ['server/host/quota-switch.ts','server/routes/bot-patch.ts','server/routes/bot-settings.ts','server/routes/bots-create.ts','server/routes/tasks.ts']){let s=fs.readFileSync(f,'utf8').replace('type { hostedModelPolicy }','type { HostedModelPolicy }').replaceAll('ReturnType<typeof hostedModelPolicy>','HostedModelPolicy | null');fs.writeFileSync(f,s);}
members('server/routes/config.ts',['included']);
tests('server/decider/decider.test.ts',title=>title==="Cloud Pro's included decisions");cleanImports('server/decider/decider.test.ts');
fs.rmSync('server/hosted-models.test.ts');
tests('server/drivers/acp/opencode-go.test.ts',(title,body)=>!body.startsWith('describe(')&&body.includes('cloudHomeConfigured('));cleanImports('server/drivers/acp/opencode-go.test.ts');
tests('server/managed-policy.test.ts',(title,body)=>!body.startsWith('describe(')&&body.includes('cloudHomePlaceRefusal('));cleanImports('server/managed-policy.test.ts');
cleanImports('server/live-call.e2e.test.ts');variables('server/research.test.ts',['PLAN']);cleanImports('server/research.test.ts');
replace('server/cloud-connections.test.ts','composio: { mode: "managed", account: "managed:abc", installationId: "11111111-2222-4333-8444-555555555555", shared: false }','composio: { mode: "own", account: "own:abc", installationId: "11111111-2222-4333-8444-555555555555", shared: false }');
s=fs.readFileSync('server/cloud-connections.test.ts','utf8').replaceAll('mode: "managed", account: "managed:abc"','mode: "own", account: "own:abc"');fs.writeFileSync('server/cloud-connections.test.ts',s);
tests('server/mcp-sign-in-card.test.ts',title=>title.startsWith('on a Team Cloud'));
members('server/mcp-sign-in-card.test.ts',['team','adminOrigin','audienceOf','requester','roster','onSettled','brokerUrl']);
// The direct MCP fixture shares one local OAuth manager; per-member cloud OAuth is retired.
s=fs.readFileSync('server/mcp-sign-in-card.test.ts','utf8').replace('team.turnPerson(threadId)','null').replace('(threadId) => null','() => null').replace('team.nameOf(person)','person').replace('team.actsForAdmin(threadId)','true');fs.writeFileSync('server/mcp-sign-in-card.test.ts',s);
variables('server/mcp-sign-in-card.test.ts',['ROSTER','AUDIENCES','REQUESTER','OLIVE','ADA','CLEO']);cleanImports('server/mcp-sign-in-card.test.ts');
console.log('Source and direct-only test fixes completed');
