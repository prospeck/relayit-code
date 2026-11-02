import {fs,ts,edit,fold,variables,declarations,cleanImports,members,tests,files} from './.relayit-edit.mjs';
edit('server/live-call.e2e.test.ts',(n,c)=>{if(ts.isExpressionStatement(n)&&n.getText().startsWith('posixOnly(')&&n.getText().includes('cloudPairingSignature(')){c(n);return false;}});cleanImports('server/live-call.e2e.test.ts');
cleanImports('server/cli.test.ts');declarations('server/index.ts',['cloudOwnersRoutine']);
fold('server/postiz/service.ts',{'deps.team.team':null});members('server/postiz/service.ts',['team']);
// No trial credit provider remains, including its special Settings and chat UI.
fold('src/components/EnginesSettings.tsx',{'instance.trialCredit':null});fold('src/components/EngineAccounts.tsx',{'instance.trialCredit':null});members('src/state/store.tsx',['trialCredit']);
variables('src/components/ChatView.tsx',['TRIAL_CREDIT_LINE','credit']);declarations('src/components/ChatView.tsx',['TrialCreditFailedRow']);
edit('src/components/ChatView.tsx',(n,c)=>{if(ts.isIfStatement(n)&&n.expression.getText()==='credit'){c(n);return false;}});cleanImports('src/components/ChatView.tsx');
for(const p of ['src/components/TrialCreditNotice.tsx','src/components/FailedTurnRow.trial-credit.test.ts','server/cloud-health.ts','server/cloud-health.test.ts','server/cloud-team-admin.ts','server/cloud-team-admin.test.ts','server/hosted-contract.ts','server/hosted-contract.test.ts','server/testing/broker-fake.ts','server/testing/control-plane-stub.ts'])if(fs.existsSync(p))fs.rmSync(p);
// Old saved failures use the normal provider failure presentation.
fold('server/today.ts',{'credit':null});variables('server/today.ts',['credit']);cleanImports('server/today.ts');
let p='server/today.ts',s=fs.readFileSync(p,'utf8').replace('"out-of-credit": 1, ','');fs.writeFileSync(p,s);
p='shared/today.ts';s=fs.readFileSync(p,'utf8').split('\n').filter(l=>!l.includes('kind: "out-of-credit"')).join('\n');fs.writeFileSync(p,s);cleanImports(p);
for(const p of ['server/today.test.ts']){tests(p,(title,body)=>!body.startsWith('describe(')&&body.includes('out-of-credit'));cleanImports(p);}
console.log('Removed trial-specific UI and dormant control-plane clients');
