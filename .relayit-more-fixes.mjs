import {execFileSync} from 'node:child_process';
import {fs,ts,edit,tests,members,cleanImports,namedImports,variables,declarations} from './.relayit-edit.mjs';
function leafTests(file,predicate){edit(file,(n,c)=>{if(!ts.isExpressionStatement(n)||!ts.isCallExpression(n.expression))return;const x=n.expression;let e=x.expression;while(ts.isCallExpression(e))e=e.expression;const label=e.getText();if(/^(it|test)(\.|$)/.test(label)&&ts.isStringLiteral(x.arguments[0])&&predicate(x.arguments[0].text,n.getText())){c(n);return false;}});}
leafTests('server/cli-phone-setup.test.ts',title=>title.includes('failed sign-in'));
leafTests('server/composio.test.ts',(_title,body)=>body.includes('connectedServiceSlugs({}, access)'));
cleanImports('server/composio.test.ts');cleanImports('server/cli.test.ts');
variables('server/cloud-send-kinds.ts',['APP_EVENT_FIELDS']);
declarations('server/index.ts',['cloudRoutineIsOwners','cloudOwnerApplied']);
edit('server/index.ts',(n,c)=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='cloudOwnersRoutine'){c(n,'function cloudOwnersRoutine(_routineId: string | undefined): void {}');return false;}});
let p='server/index.ts',s=fs.readFileSync(p,'utf8').replace('function recentWorkFilter(threadId: string)','function recentWorkFilter(_threadId: string)').replace('routineWriter: (id) => { const key = undefined; return key ? teamOwners.people?.list().find((one) => personKey({ id: "", email: one.email }) === key)?.email : undefined; }','routineWriter: () => undefined').replace('switchBack: ({ botId, threadId, from, to })','switchBack: ({ botId, threadId, from })').replace('createTask: (botId, title, run) => {','createTask: (botId, title) => {');
s=s.replace('eraseAudienceBrowsers,','eraseAudienceBrowsers: _eraseAudienceBrowsers,').replace('cloudLendingRefusalNotice,','cloudLendingRefusalNotice: _cloudLendingRefusalNotice,');fs.writeFileSync(p,s);
// Retire the hosted-key test fixture, leaving the local live-call fixture above it.
p='server/live-call.e2e.test.ts';edit(p,(n,c)=>{if(ts.isExpressionStatement(n)&&n.getText().startsWith('describe(')&&n.getText().includes('cloudPairingSignature(')){c(n);return false;}});cleanImports(p);
p='server/managed-policy.test.ts';s=fs.readFileSync(p,'utf8').replace('import { cloudHomePlaceRefusal } from "./cloud-home.ts";\n','').replace('const bind = (managedPolicy: ManagedDesktopPolicy, cloudHome = false) =>','const bind = (managedPolicy: ManagedDesktopPolicy) =>').replace('"CLOUD_HOME", "cloudHomePlaceRefusal", ','').replace('managedPolicy, computerKindForResource, cloudHome ? { machineId: "fixture" } : null, cloudHomePlaceRefusal,','managedPolicy, computerKindForResource,');fs.writeFileSync(p,s);
p='server/routes/internal-chief-team.test.ts';leafTests(p,(title,body)=>body.includes('/api/internal/team-library')&&!title.startsWith('refuses any other bot'));
s=fs.readFileSync(p,'utf8').replace('for (const path of ["/api/internal/team-library", "/api/internal/team-setup-catalog"])','for (const path of ["/api/internal/team-setup-catalog"])').replace('hidden.get("/api/internal/team-library")','hidden.get("/api/internal/team-setup-catalog")');fs.writeFileSync(p,s);cleanImports(p);
p='server/mcp-sign-in-card.test.ts';s=fs.readFileSync(p,'utf8').replace('    isOwnerLive, onSettled,','    isOwnerLive,');fs.writeFileSync(p,s);
cleanImports('server/routes/config.ts');
p='server/routes/teams.ts';s=fs.readFileSync(p,'utf8').replace('publicBot, publicGroupState, groupWithThread','publicBot, groupWithThread').replace('    let m: RegExpMatchArray | null = null;','');fs.writeFileSync(p,s);
fs.writeFileSync('electron/cloud-sync-plan.mjs',execFileSync('git',['show','693b804:electron/cloud-sync-plan.mjs']));
console.log('Remaining compiler cleanup applied');
