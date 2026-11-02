import {fs,ts,edit,tests,declarations,variables,members,cleanImports,replace} from './.relayit-edit.mjs';
const p='server/cli-phone-setup.test.ts';
tests(p,(title)=>/requires explicit public exposure|declining exposure|reuses an existing account|does not select managed|does not attempt sign-in|Ctrl-C during account/.test(title));
declarations(p,['dependencies']);
let s=fs.readFileSync(p,'utf8').replace(', type PhoneSetupDependencies','').replace('  tunnel: false, ','  ').replace(/    const deps = dependencies\(\);\n/g,'').replace(/    deps\.accountReady\.mockReturnValue\(true\);\n/g,'').replace(/, ui\.io, deps\)/g,', ui.io)').replace(/    expect\(deps\.(?:accountReady|login)\)[^\n]*\n/g,'').replace(' { tunnel: true },','').replace(/    expect\(options\.tunnel\)\.toBe\(false\);\n/g,'');
s=s.replace('choices: [2, 1]','choices: [2, 0]').replace('choices: [2, 2, 2]','choices: [2, 1, 1]').replace('choices: [1, 2, 3, 0]','choices: [1, 1, 2, 0]').replace('choices: [1, 4]','choices: [1, 3]');fs.writeFileSync(p,s);
tests('server/boat-errors.test.ts',title=>title.includes("Cloud Pro's included")||title.includes("Admin's own code"));
for(const p of ['server/cli-lifecycle.test.ts','server/cli-pair.test.ts','server/cli.test.ts','server/service-cli.test.ts']){
 tests(p,(title,body)=>!title.startsWith('describe') && (body.includes('tunnel: true')||body.includes('runLogin(')) && !/^parse|CLI|service|lifecycle/.test(title));
 let s=fs.readFileSync(p,'utf8').replace(/\btunnel: false,?\s*/g,'');fs.writeFileSync(p,s);cleanImports(p);
}
for(const p of ['server/bot-moves.test.ts','server/cloud-send-kinds.test.ts','server/move-freeze.test.ts','server/routes/cloud-send.test.ts','server/team-move-scope.test.ts'])members(p,['appEvents']);
// Only the removed included-key protocol, retaining direct-provider tests.
tests('server/decider/decider.test.ts',(title)=>title.includes('clearing an own key falls back to the included'));
for(const p of ['server/decider/decider.test.ts','server/routes/x-research.test.ts','server/x-research.test.ts']){
 tests(p,(title,body)=> !body.startsWith('describe(') && (body.includes('included: true')));
 members(p,['included']);cleanImports(p);
}
edit('server/composio.test.ts',(n,c)=>{if(ts.isCallExpression(n)&&n.expression.getText().endsWith('.connectorSetup')&&n.arguments.length>1){c(n,`${n.expression.getText()}(${n.arguments[0].getText()})`);return false;}});
variables('server/composio.test.ts',['list','initializeCalls']);
edit('server/routes/internal-chief-team.test.ts',(n,c,a,s)=>{if(ts.isShorthandPropertyAssignment(n)&&n.name.text==='library'){let end=n.end;if(s[end]===',')end++;c({getStart:()=>n.getStart(a),end});return false;}});
cleanImports('server/routes/internal-chief-team.test.ts');
console.log('Selected retired tests and fixtures updated');
