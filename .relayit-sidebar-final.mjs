import {fs,ts,edit,tests,members,cleanImports,fold,variables} from './.relayit-edit.mjs';
const p='src/components/SidebarProfileMenu.tsx';
edit(p,(n,c)=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='profileMenuItems'){
 let text=n.getText();const a=text.indexOf('  const accountItem:');text=text.slice(0,a)+`  const present = (...items: Array<SidebarMenuItem | null | false>) => items.filter((item): item is SidebarMenuItem => Boolean(item));
  if (!simple) return [...present(usageItem), ...phone, support, settings];
  const groups = [
    [...present(usageItem), ...phone, support, settings],
    simple.tools,
    simple.places,
  ].filter((group) => group.length > 0);
  return groups.flatMap((group, at) => group.map((item, index) => (at > 0 && index === 0 ? { ...item, separatorBefore: true } : item)));
}`;
 text=text.replace(/  update,\n|  updateTop = null,\n|  move = \[\],\n|  account,\n|  onAccount,\n/g,'').replace(/  update: SidebarMenuItem \| null;\n|  updateTop\?:[^\n]*\n|  move\?: SidebarMenuItem\[\];\n|  account: string \| null;\n|  onAccount: \(\) => void;\n|  onHelp\?: \(\) => void;\n|  onFeedback\?: \(\) => void;\n|  \/\*\* the move to My Cloud[^\n]*\n/g,'');c(n,text);return false;
}});
// Remove only the now-deleted arguments from the component's menu call, not its local profile props.
edit(p,(n,c)=>{if(ts.isCallExpression(n)&&n.expression.getText()==='profileMenuItems'){const body=n.arguments[0];const kept=body.properties.filter(m=>!['update','move','account','onAccount'].includes(m.name?.getText()));c(body,`{${kept.map(m=>m.getText()).join(',\n')}}`);return false;}});cleanImports(p);
const q='src/components/SidebarProfileMenu.test.ts';tests(q,title=>title==='keeps the update entry beside settings'||title.startsWith('raises an update that is ready'));
members(q,['update','updateTop','account','onAccount','onHelp','onFeedback']);
let s=fs.readFileSync(q,'utf8').replace('    items.find((item) => item.key === "account")!.onSelect();\n','').replace('    expect(onAccount).toHaveBeenCalledOnce();\n','').replace('const onUsage = vi.fn(), onAccount = vi.fn();','const onUsage = vi.fn();').replace('const items = build({ onUsage, onAccount });','const items = build({ onUsage });').replace('    expect(items.find((item) => item.key === "account")!.label).toBe("OpenMausBot Cloud");','    expect(items.some((item) => ["account", "update"].includes(item.key))).toBe(false);');
s=s.replaceAll(', "account"]',']').replace('["account"]','[]').replaceAll('["help", "feedback", "shortcuts", "about", "update"]','["shortcuts", "about"]').replaceAll('["help", "feedback", "shortcuts", "about"]','["shortcuts", "about"]').replaceAll(', "update"]',']');
// The simple fixture's phone row is now the direct pairing action.
s=s.replace('["usage", "phone-app", "support", "settings"],\n      ["automations"','["usage", "phone", "support", "settings"],\n      ["automations"').replace('["usage", "phone-app", "support", "settings", "update"]','["usage", "phone", "support", "settings"]');
fs.writeFileSync(q,s);cleanImports(q);
console.log('Removed updater, hosted-account and cloud-move menu construction');
