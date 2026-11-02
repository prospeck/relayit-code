import {fs,ts,edit,tests,cleanImports,replace} from './.relayit-edit.mjs';
edit('server/index.ts',(n,c)=>{if(ts.isCallExpression(n)&&n.expression.getText()==='cloudRefusal'&&n.arguments.length>1){c(n,`cloudRefusal(${n.arguments[0].getText()})`);return false;}});
const p='server/composio.test.ts';edit(p,(n,c)=>{if(ts.isExpressionStatement(n)&&n.getText().startsWith('it(')&&n.getText().includes('rejects broker URL components and invalid tokens')){c(n,`it("ignores retired broker settings and requires a personal Composio key", () => {
    process.env.OMB_COMPOSIO_BROKER_URL = "https://broker.example.test";
    process.env.OMB_COMPOSIO_BROKER_TOKEN = "a".repeat(64);
    try {
      expect(connectionMode({})).toBe("unavailable");
      expect(connectionMode({ composio: { apiKey: "own-project-key" } })).toBe("self-hosted");
    } finally {
      delete process.env.OMB_COMPOSIO_BROKER_URL;
      delete process.env.OMB_COMPOSIO_BROKER_TOKEN;
    }
  });`);return false;}});
tests('shared/place-view.test.ts',title=>title==="reads today's English, before the Admin sends its own codes"||title==='maps the existing inactive-plan code, and the codes the Admin is adding');
let s=fs.readFileSync('shared/place-view.test.ts','utf8').replace('cloudRefusal reads the Admin\'s refusals','cloudRefusal reads direct provider failures').replace('expect(included("something new").state).toBe("cc-no-start");','expect(included("something new")).toEqual({ state: "cc-provider", params: { words: "something new." } });');fs.writeFileSync('shared/place-view.test.ts',s);
console.log('Own-provider assertions updated for removed plan protocol');
