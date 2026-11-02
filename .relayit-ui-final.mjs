import {fs,ts,edit,fold,variables,declarations,cleanImports,tests} from './.relayit-edit.mjs';
let p='src/components/DecisionModelSettings.tsx';fold(p,{'decider.included':false,'extraction.included':false,'included':false,'testingIncluded':false});variables(p,['included','testingIncluded']);declarations(p,['INCLUDED_FAILURES']);
let s=fs.readFileSync(p,'utf8').replace('included = false, ','');fs.writeFileSync(p,s);
for(const p of ['src/components/DecisionModelSettings.tsx','src/components/DecisionModelSettings.test.ts']){edit(p,(n,c)=>{if(ts.isCallExpression(n)&&n.expression.getText()==='deciderFailureText'&&n.arguments.length>1){c(n,`deciderFailureText(${[n.arguments[0],...n.arguments.slice(2)].map(a=>a.getText()).join(', ')})`);return false;}});cleanImports(p);}
p='src/components/SettingsModal.tsx';s=fs.readFileSync(p,'utf8').replace('sections: ["usage", "cloudAccount"]','sections: ["usage"]').replace('["billing", "included", "allowance", "cloud hours", "voice"]','["billing", "usage", "voice"]');fs.writeFileSync(p,s);
p='server/postiz/service.test.ts';s=fs.readFileSync(p,'utf8').replace('scopes: { scope: () => scope }, ','').replace('let scope: "team" | "person" = "team";\n','').replace('  scope = "team";\n','');fs.writeFileSync(p,s);
variables('server/today.test.ts',['kai']);
tests('server/default-model-selection.test.ts',title=>title.includes("trial's Claude credit"));cleanImports('server/default-model-selection.test.ts');
p='server/turn-outcome.test.ts';s=fs.readFileSync(p,'utf8').replace('message: "The trial Claude credit is used up.", setup: true, trialCredit: "used_up"','message: "The provider is not configured.", setup: true').replace('{ setup: true, trialCredit: "used_up" }','{ setup: true }');fs.writeFileSync(p,s);
console.log('Removed included-service settings branches');
