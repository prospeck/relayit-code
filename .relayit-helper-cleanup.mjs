import {fs,ts,edit,declarations,cleanImports,members,variables} from './.relayit-edit.mjs';
declarations('server/extractor/remote.ts',['relayExtractEndpoint','extractWithRelay']);cleanImports('server/extractor/remote.ts');
let p='server/extractor/index.ts',s=fs.readFileSync(p,'utf8').replace('provider === "openrouter" ? extractWithOpenRouter : extractWithRelay','extractWithOpenRouter').replace('Boolean(account) && true','Boolean(account)').replace('...(({})), ','');fs.writeFileSync(p,s);cleanImports(p);
p='server/decider/jev.ts';s=fs.readFileSync(p,'utf8').replace('        ...(request.relaySeam ? { [RELAY_SEAM_HEADER]: request.relaySeam } : {}),\n','');fs.writeFileSync(p,s);declarations(p,['RELAY_SEAM_HEADER']);members('server/decider/types.ts',['relaySeam']);
p='server/index.ts';s=fs.readFileSync(p,'utf8').replace('xResearch: { included: false }, ','');fs.writeFileSync(p,s);members('src/state/config-status.ts',['xResearch']);
// Generic third-party Boat refusals remain, without upstream plan interpretation.
p='shared/place-view.ts';s=fs.readFileSync(p,'utf8');const a=s.indexOf('  const code = failure.code;',s.indexOf('export function cloudRefusal'));const b=s.indexOf('  // A start that failed',a);s=s.slice(0,a)+s.slice(b);s=s.replace(' }, included: boolean):',' }):').replace('if (!included && message)','if (message)');fs.writeFileSync(p,s);variables(p,['HOURS_USED','AT_ONCE']);
for(const p of ['src/components/ComputerPanel.tsx','shared/place-view.test.ts'])if(fs.existsSync(p))edit(p,(n,c)=>{if(ts.isCallExpression(n)&&n.expression.getText()==='cloudRefusal'&&n.arguments.length>1){c(n,`cloudRefusal(${n.arguments[0].getText()})`);return false;}});
console.log('Removed unreachable extraction relay and upstream plan refusals');
