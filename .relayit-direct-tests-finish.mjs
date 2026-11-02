import {fs,tests,cleanImports,replace,variables} from './.relayit-edit.mjs';
tests('server/composio.test.ts',title=>title==='a connector tools/list that fails'||title==='connector tool inventory');
tests('server/extractor/extractor.test.ts',title=>title.startsWith('with no own key, Cloud')||title==='a request the relay would refuse never goes through the included token');cleanImports('server/extractor/extractor.test.ts');
tests('src/components/DecisionModelSettings.test.ts',title=>title.startsWith("shows Cloud Pro's included")||title.startsWith('Test checks the included decisions'));
let p='src/components/DecisionModelSettings.test.ts',s=fs.readFileSync(p,'utf8').replaceAll('included: true, ','').replace('    click(render().save);\n    await flush();\n    expect(fixture.api).toHaveBeenCalledTimes(1);','    expect(fixture.api).toHaveBeenCalledTimes(1);');fs.writeFileSync(p,s);
console.log('Retired included-model test cases removed');
