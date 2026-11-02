import {fs,fold,variables} from './.relayit-edit.mjs';
let p='src/state/store.tsx',s=fs.readFileSync(p,'utf8').replace('"xResearch" | ','').replace(' xResearch: frame.xResearch,','');fs.writeFileSync(p,s);
p='src/components/bot-settings/AccessSection.tsx';fold(p,{'state.config?.xResearch?.included':false,'included':false});variables(p,['included']);s=fs.readFileSync(p,'utf8').replace('t(ownKey ? "research.ownOn" : "research.planOn")','t("research.ownOn")');fs.writeFileSync(p,s);
variables('shared/place-view.ts',['MONTH']);
console.log('Final config shape now reports only the own research key');
