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
test('normal traffic defaults to a health-checked Hysteria2-first fallback', () => {
 const c=rewrite(fixture());const groups=c['proxy-groups'];const auto=groups.find(g=>g.name===GROUP.AUTO);
 assert.equal(auto.type,'fallback');assert.deepEqual(auto.proxies,['Hysteria2','Ss2022','Reality']);
 assert.equal(auto.url,'https://www.gstatic.com/generate_204');assert.equal(auto.interval,60);
 for(const name of [GROUP.GLOBAL,GROUP.GOOGLE,GROUP.YOUTUBE,GROUP.DEVELOPER]) assert.equal(groups.find(g=>g.name===name).proxies[0],GROUP.AUTO);
 assert.ok(groups.find(g=>g.name==='🚀 MANUAL').proxies.includes('Anytls'));
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
