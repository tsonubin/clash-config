const test = require('node:test');
const assert = require('node:assert/strict');
const { rewrite, GROUP } = require('../.test-build/api/rewrite.js');
function fixture() {
 return { proxies: [
  {name:'Reality',type:'vless',server:'s.tsonubin.com',port:24443,servername:'www.apple.com',uuid:'test-user'},
  {name:'Anytls',type:'anytls',server:'s.tsonubin.com',port:27443,sni:'s.tsonubin.com',password:'test-password'},
  {name:'Ss2022',type:'ss',server:'s.tsonubin.com',port:28388,password:'test-password'},
  {name:'Hysteria2',type:'hysteria2',server:'s.tsonubin.com',port:28443,sni:'s.tsonubin.com',password:'test-password','skip-cert-verify':false}
 ]};
}
const SERVICE_GROUPS=[GROUP.AI,GROUP.STEAM,GROUP.GOOGLE,GROUP.YOUTUBE,GROUP.SOCIAL,GROUP.TELEGRAM,GROUP.NETFLIX,GROUP.SLACK,GROUP.MICROSOFT,GROUP.DEVELOPER];
test('AUTO is a health-checked Hysteria2-first fallback that excludes AnyTLS', () => {
 const c=rewrite(fixture());const groups=c['proxy-groups'];const auto=groups.find(g=>g.name===GROUP.AUTO);
 assert.equal(auto.type,'fallback');assert.deepEqual(auto.proxies,['Hysteria2','Ss2022','Reality']);
 assert.equal(auto.url,'https://www.gstatic.com/generate_204');assert.equal(auto.interval,60);
});
test('MANUAL offers AUTO first, then every node including AnyTLS', () => {
 const groups=rewrite(fixture())['proxy-groups'];const manual=groups.find(g=>g.name===GROUP.MANUAL);
 assert.equal(manual.type,'select');
 assert.deepEqual(manual.proxies,[GROUP.AUTO,'Hysteria2','Ss2022','Reality','Anytls']);
});
test('proxy-needing selectors default to MANUAL and keep AUTO/GLOBAL/nodes/DIRECT selectable', () => {
 const groups=rewrite(fixture())['proxy-groups'];
 for(const name of [GROUP.GLOBAL,...SERVICE_GROUPS]){
  const g=groups.find(x=>x.name===name);assert.ok(g,`${name} group should exist`);
  assert.equal(g.proxies[0],GROUP.MANUAL,`${name} should default to MANUAL`);
  for(const member of [GROUP.AUTO,'Hysteria2','Anytls','DIRECT']) assert.ok(g.proxies.includes(member),`${name} should offer ${member}`);
  assert.equal(new Set(g.proxies).size,g.proxies.length,`${name} should not list duplicates`);
 }
 for(const name of SERVICE_GROUPS) assert.ok(groups.find(x=>x.name===name).proxies.includes(GROUP.GLOBAL),`${name} should offer GLOBAL`);
 assert.ok(!groups.find(g=>g.name===GROUP.GLOBAL).proxies.includes(GROUP.GLOBAL));
});
test('Apple stays DIRECT by default while DIRECT group remains DIRECT', () => {
 const groups=rewrite(fixture())['proxy-groups'];
 const apple=groups.find(g=>g.name===GROUP.APPLE);
 assert.equal(apple.proxies[0],'DIRECT');assert.equal(apple.proxies[1],GROUP.MANUAL);
 assert.equal(groups.find(g=>g.name===GROUP.DIRECT).proxies[0],'DIRECT');
});
test('FINAL catch-all prefers GLOBAL over DIRECT and domestic rules stay DIRECT', () => {
 const c=rewrite(fixture());const groups=c['proxy-groups'];const final=groups.find(g=>g.name===GROUP.FINAL);
 assert.deepEqual(final.proxies,[GROUP.GLOBAL,GROUP.MANUAL,GROUP.AUTO,'DIRECT']);
 const rules=c.rules;assert.equal(rules[rules.length-1],`MATCH,${GROUP.FINAL}`);
 for(const rule of ['RULE-SET,direct,DIRECT','RULE-SET,cncidr,DIRECT,no-resolve','GEOIP,CN,DIRECT']) assert.ok(rules.indexOf(rule)!==-1&&rules.indexOf(rule)<rules.length-1,`${rule} should precede MATCH`);
});
test('every group member resolves to a proxy, a group, or a built-in policy', () => {
 for(const withRelay of [false,true]){
  if(withRelay) Object.assign(process.env,{RELAY_HOST:'203.0.113.10',RELAY_USERNAME:'test-user',RELAY_PASSWORD:'test-password'});
  try {
   const c=rewrite(fixture());const groups=c['proxy-groups'];
   const known=new Set(['DIRECT','REJECT',...c.proxies.map(p=>p.name),...groups.map(g=>g.name)]);
   for(const g of groups) for(const member of g.proxies) assert.ok(known.has(member),`${g.name} references unknown member ${member}`);
  } finally {delete process.env.RELAY_HOST;delete process.env.RELAY_USERNAME;delete process.env.RELAY_PASSWORD;}
 }
});
test('server dialing bypasses broken DNS while retaining authentication and TLS names', () => {
 const input=fixture(), c=rewrite(structuredClone(input));
 for(const p of c.proxies){ const original=input.proxies.find(x=>x.name===p.name); assert.equal(p.server,'192.243.126.66');assert.deepEqual({...p,server:original.server},original); }
 assert.equal(c.hosts['s.tsonubin.com'],'192.243.126.66');
});
test('foreign DNS travels through the proxy without depending on proxy-host DNS', () => {
 const c=rewrite(fixture());assert.ok(c.dns.nameserver.every(x=>x.endsWith('#'+GROUP.AUTO)));
 assert.ok(c.dns['proxy-server-nameserver'].every(x=>!x.includes('#')));
});
test('AI relay remains outside its own dialer group and retains fallback', () => {
 Object.assign(process.env,{RELAY_HOST:'203.0.113.10',RELAY_USERNAME:'test-user',RELAY_PASSWORD:'test-password'});
 try { const c=rewrite(fixture()),g=c['proxy-groups'];assert.ok(!g.find(x=>x.name===GROUP.AUTO).proxies.includes('US-RELAY'));assert.equal(c.proxies.find(x=>x.name==='US-RELAY')['dialer-proxy'],GROUP.AUTO);assert.deepEqual(g.find(x=>x.name===GROUP.AI_ROUTE).proxies,['US-RELAY',GROUP.AI_FALLBACK]);assert.deepEqual(g.find(x=>x.name===GROUP.AI_FALLBACK).proxies,['Hysteria2','Ss2022','Reality']); }
 finally {delete process.env.RELAY_HOST;delete process.env.RELAY_USERNAME;delete process.env.RELAY_PASSWORD;}
});
test('AI group defaults to MANUAL but still offers the relay routes when configured', () => {
 Object.assign(process.env,{RELAY_HOST:'203.0.113.10',RELAY_USERNAME:'test-user',RELAY_PASSWORD:'test-password'});
 try {
  const g=rewrite(fixture())['proxy-groups'];const ai=g.find(x=>x.name===GROUP.AI);
  assert.equal(ai.proxies[0],GROUP.MANUAL);
  for(const member of [GROUP.AI_ROUTE,'US-RELAY',GROUP.AI_FALLBACK]) assert.ok(ai.proxies.includes(member),`AI should offer ${member}`);
  for(const name of [GROUP.GLOBAL,GROUP.GOOGLE,GROUP.STEAM]) assert.ok(!g.find(x=>x.name===name).proxies.includes(GROUP.AI_ROUTE),`${name} should not carry AI relay routes`);
 } finally {delete process.env.RELAY_HOST;delete process.env.RELAY_USERNAME;delete process.env.RELAY_PASSWORD;}
 const g=rewrite(fixture())['proxy-groups'];const ai=g.find(x=>x.name===GROUP.AI);
 assert.equal(ai.proxies[0],GROUP.MANUAL);
 for(const member of [GROUP.AI_ROUTE,'US-RELAY',GROUP.AI_FALLBACK]) assert.ok(!ai.proxies.includes(member),`AI should omit ${member} without relay env`);
 assert.ok(!g.some(x=>x.name===GROUP.AI_ROUTE||x.name===GROUP.AI_FALLBACK));
});
test('Steam routes community and client traffic to Steam group while downloads go direct', () => {
 const c = rewrite(fixture());
 const groups = c['proxy-groups'];
 const steamGroup = groups.find(g => g.name === GROUP.STEAM);
 assert.ok(steamGroup, 'Steam proxy group should exist');
 assert.equal(steamGroup.type, 'select');
 assert.equal(steamGroup.proxies[0], GROUP.MANUAL);

 const providers = c['rule-providers'];
 assert.ok(providers.steam, 'steam rule-provider should exist');
 assert.ok(providers.steamcn, 'steamcn rule-provider should exist');

 const rules = c.rules;
 const cmIndex = rules.indexOf(`DOMAIN-SUFFIX,cm.steampowered.com,${GROUP.STEAM}`);
 const communityIndex = rules.indexOf(`DOMAIN-SUFFIX,steamcommunity.com,${GROUP.STEAM}`);
 const chatIndex = rules.indexOf(`DOMAIN-SUFFIX,steam-chat.com,${GROUP.STEAM}`);
 const downloadContentIndex = rules.indexOf('DOMAIN-SUFFIX,steamcontent.com,DIRECT');
 const downloadServerIndex = rules.indexOf('DOMAIN-SUFFIX,steamserver.net,DIRECT');
 const downloadAkamaiIndex = rules.indexOf('DOMAIN-SUFFIX,steampipe.akamaized.net,DIRECT');
 const steamcnIndex = rules.indexOf('RULE-SET,steamcn,DIRECT');
 const steamRulesetIndex = rules.indexOf(`RULE-SET,steam,${GROUP.STEAM}`);

 assert.ok(cmIndex !== -1, 'cm.steampowered.com rule should exist');
 assert.ok(communityIndex !== -1, 'steamcommunity.com rule should exist');
 assert.ok(chatIndex !== -1, 'steam-chat.com rule should exist');
 assert.ok(downloadContentIndex !== -1, 'steamcontent.com direct rule should exist');
 assert.ok(downloadServerIndex !== -1, 'steamserver.net direct rule should exist');
 assert.ok(downloadAkamaiIndex !== -1, 'steampipe.akamaized.net direct rule should exist');
 assert.ok(steamcnIndex !== -1, 'steamcn rule-set should exist');
 assert.ok(steamRulesetIndex !== -1, 'steam rule-set should exist');

 // cm.steampowered.com must precede steamcn so client connection is proxied instead of direct
 assert.ok(cmIndex < steamcnIndex, 'client CM rule must precede steamcn direct ruleset');
 // Download direct rules must precede steam ruleset
 assert.ok(downloadAkamaiIndex < steamRulesetIndex, 'download direct rules must precede steam proxy ruleset');
 assert.ok(steamcnIndex < steamRulesetIndex, 'steamcn direct ruleset must precede steam proxy ruleset');
});
