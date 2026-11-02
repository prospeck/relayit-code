import {execFileSync} from 'node:child_process';
import {fs,ts,edit,fold,variables,declarations,namedImports,cleanImports,emptyJsx,tests} from './.relayit-edit.mjs';
const p='src/components/CompanionSection.tsx';fs.writeFileSync(p,execFileSync('git',['show',`693b804:${p}`]));
edit(p,(n,c)=>{if(ts.isJsxElement(n)&&n.openingElement.getText().includes('className="border-t border-hairline/30 pt-4"')&&n.getText().includes('remote.account.title')){c(n);return false;}});
variables(p,['accountActionError','hosted']);fold(p,{'hosted':null,'c.hostedReady':false,'c.accountBusy':false});emptyJsx(p);declarations(p,['endpointHost']);
edit(p,(n,c)=>{if(ts.isExportDeclaration(n)&&n.exportClause&&ts.isNamedExports(n.exportClause)){const kept=n.exportClause.elements.filter(e=>!['companionAccountActionError','companionPairingMode','shouldHydrateCompanionEmail'].includes(e.name.text));c(n,`export { ${kept.map(e=>e.getText()).join(', ')} };`);return false;}});cleanImports(p);
// Tailscale remains the native companion route. Retired managed addresses never become trusted endpoints.
let f='electron/desktop-companion-client.test.mjs',s=fs.readFileSync(f,'utf8');let a=s.indexOf('    expect(normalizeDesktopCompanionEndpoint(`https://${LABEL}.agent.example.test`))'),b=s.indexOf('    for (const endpoint of [',a);s=s.slice(0,a)+s.slice(b);s=s.replace('accepts managed HTTPS and cleartext only for Tailscale MagicDNS','accepts cleartext only for Tailscale MagicDNS');
a=s.indexOf('    const hostedAccess = { ...access, endpoint:');b=s.indexOf('    expect(\n      desktopCompanionAccess',a);s=s.slice(0,a)+`    expect(desktopCompanionAccess({ [DESKTOP_COMPANION_FIELD]: { ...access, endpoint: \`https://\${LABEL}.agent.example.test\` } })).toBeNull();\n`+s.slice(b);fs.writeFileSync(f,s);tests(f,title=>title==='pairs through a managed HTTPS companion address');
console.log('Restored all local paired-device permissions, revocation and advanced connection controls');
