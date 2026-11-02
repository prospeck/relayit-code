import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const paths=[...new Set([...execFileSync('git',['diff','--name-only','-z','HEAD'],{encoding:'utf8'}).split('\0'),...execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0')])].filter(p=>p&&!p.startsWith('.relayit-'));
const groups=[
 {name:'Remove managed brokers and included provider credentials',paths:[]},
 {name:'Delete upstream cloud control-plane and connector deployments',paths:[]},
 {name:'Remove upstream developer reporting and hosted publishing catalogs',paths:[]},
 {name:'Remove hosted desktop accounts and retain direct local connections',paths:[]},
 {name:'Detach server startup and headless CLI from hosted control planes',paths:[]},
 {name:'Guard upstream URLs and use independent browser release assets',paths:[]},
];
for(const p of paths){let i;
 if(/^(cloudflare|connector)\//.test(p))i=1;
 else if(/^server\/(?:included-services|provider-credentials|composio|research|x-research|highlevel\/|decider\/|extractor\/|boat(?:\.|-)|tts(?:\.|-)|voice(?:\.|-)|routes\/(?:x-|highlevel)|host\/highlevel)/.test(p)||/^src\/(?:components\/(?:HighLevel|XCard|DecisionModelSettings|WorkersAi|keys\/)|lib\/highlevel)/.test(p)||/^shared\/x-connector/.test(p))i=0;
 else if(/^server\/(?:devs-|pages\/|published-|team-library|skill-fetch|recent-log|app-event|agents-devs|host\/(?:devs|app-event)|drivers\/agents-|tool-schema-profile)/.test(p)||/^shared\/(?:devs-|published-page)/.test(p)||/^src\/(?:components\/TeamLibraryPanel|lib\/team-catalog)/.test(p))i=2;
 else if(/^(electron|src)\//.test(p))i=3;
 else if(/^(server|shared|companion)\//.test(p))i=4;
 else i=5;
 groups[i].paths.push(p);
}
fs.writeFileSync('.relayit-commit-groups.json',JSON.stringify(groups,null,2));
for(const g of groups)console.log(`${g.paths.length} files: ${g.name}`);
