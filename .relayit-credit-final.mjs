import {execFileSync} from 'node:child_process';
import {fs,ts,edit,cleanImports,declarations,members,namedImports} from './.relayit-edit.mjs';
namedImports('server/cli.test.ts',['resolve']);
edit('server/host/brief.ts',(n,c)=>{if(ts.isCaseClause(n)&&n.expression.getText()==='"out-of-credit"'){c(n);return false;}});
// Existing Postiz policy fixture is direct-only now; retain its local permission checks.
let p='server/postiz/service.test.ts',s=fs.readFileSync(p,'utf8').replace('team: { team: null,','team: {').replace('team: { team: null }','team: {}');fs.writeFileSync(p,s);
for(const p of ['server/turn-outcome.ts','server/routine-recovery.ts']){let s=fs.readFileSync(p,'utf8').replaceAll('"trialCredit" | ','').replaceAll('trialCredit, ','').replaceAll(' || trialCredit','').replaceAll('facts.trialCredit || ','').replaceAll('verdict.cause === "credits" && facts.trialCredit ? TRIAL_ACTION : ','');fs.writeFileSync(p,s);members(p,['trialCredit']);}
declarations('server/routine-recovery.ts',['TRIAL_ACTION']);
p='shared/runtime-events.ts';s=fs.readFileSync(p,'utf8').replace('    // `trialCredit`: the trial\'s Claude credit refused the call.\n','').replace(' trialCredit?: "used_up" | "ended" | "paused" | "too_low";','');fs.writeFileSync(p,s);
for(const p of ['server/routine-recovery.test.ts','server/host/chief-notices-retry.test.ts']){
 let s=fs.readFileSync(p,'utf8').split('\n').filter(l=>!l.includes('[TRIAL_CREDIT_REFUSED.used_up,')&&!l.includes('["a used-up trial credit",')).join('\n');
 if(p==='server/routine-recovery.test.ts'){const a=s.indexOf('    const trial = await h.start('),b=s.indexOf('\n  });',a);if(a>=0)s=s.slice(0,a)+s.slice(b);s=s.replace('fails an out-of-credit refusal at once with what to do, and the trial credit says to sign in','fails an out-of-credit refusal at once with what to do');}
 fs.writeFileSync(p,s);cleanImports(p);
}
// Preserve mixed local daily-summary cases, removing only the retired trial rows.
p='server/today.test.ts';s=execFileSync('git',['show',`693b804:${p}`],{encoding:'utf8'}).split('\n').filter(l=>!l.includes('TRIAL_CREDIT_REFUSED')&&!l.includes('["out-of-credit",')).join('\n');fs.writeFileSync(p,s);cleanImports(p);
fs.rmSync('shared/trial-credit.ts');
p='electron/cloud-rail.node-test.mjs';s=fs.readFileSync(p,'utf8').replace('assert.throws(() => call("workspaces:remove", true, "local"), /isn\'t here/);','await assert.rejects(call("workspaces:remove", true, "local"), /isn\'t here/);');fs.writeFileSync(p,s);
p='server/chat-pages.e2e.test.ts';s=fs.readFileSync(p,'utf8').replace(' and publishes it as static HTML','').replace('// points at part of it and asks for a change, the bot replaces it with update_html, and the person shares it from the\n// page\'s card. One loopback stub stands in for the Admin\'s token route and the pages Worker; no model is called and\n// no external service is reached.','// points at part of it and asks for a change, and the bot replaces it with update_html. No external service is reached.');fs.writeFileSync(p,s);
console.log('Trial-specific protocol removed; mixed local coverage retained');
