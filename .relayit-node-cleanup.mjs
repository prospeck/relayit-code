import {fs,tests,declarations,cleanImports} from './.relayit-edit.mjs';
for(const p of ['electron/cloud-send.node-test.mjs','electron/cloud-send-move.node-test.mjs']){tests(p,(_title,body)=>body.includes('installCloudSend(')||body.includes('openOwnerSession(')||body.includes('installTeamMove('));cleanImports(p);}
const p='electron/app-permissions.node-test.mjs';tests(p,(title)=>title.includes("app's claim to Boat")||title.includes('one rule for My Cloud'));
let s=fs.readFileSync(p,'utf8');s=s.slice(0,s.indexOf('const ADMIN = "http://127.0.0.1:9";'));fs.writeFileSync(p,s);cleanImports(p);
for(const p of ['electron/cloud-first-open.node-test.mjs','electron/cloud-room.node-test.mjs','electron/companion-account-ipc.node-test.mjs','electron/companion-provisioning.node-test.mjs','electron/fixtures/home-window-world.mjs'])if(fs.existsSync(p))fs.rmSync(p);
p='electron/main.mjs';s=fs.readFileSync(p,'utf8').replace('    hostedUrl,\n','').replace('cloudPageAsking(event) ?? ','');fs.writeFileSync(p,s);
console.log('Retired native account tests removed, local permission and transport tests retained');
