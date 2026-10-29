const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const project=path.resolve(__dirname,'..');
const sh=process.env.TEST_SH||(process.platform==='win32'?path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/usr/bin/sh.exe'):'/bin/sh');
const jqDir=process.env.TEST_JQ_DIR||(process.platform==='win32'?'D:/AI/GPT_Codex/ChatGPT/Zapret2/work/test-tools':'/usr/bin');
const posix=s=>s.replaceAll('\\','/');
const baseEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toLowerCase()!=='path'));
const base=path.join(project,'work/test-runs');fs.mkdirSync(base,{recursive:true});
function put(root,name,body){let f=path.join(root,name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,body);fs.chmodSync(f,0o755);}
function fixture(){
 let root=fs.mkdtempSync(path.join(base,'backend-'));
 fs.cpSync(path.join(project,'files'),root,{recursive:true});fs.mkdirSync(path.join(root,'tmp'),{recursive:true});
 if(process.platform==='win32') {
  // Windows jq defaults to CRLF; router jq emits LF. Keep fixtures equivalent.
  put(root,'bin/jq','#!/bin/sh\nexec "'+posix(path.join(jqDir,'jq.exe'))+'" -b "$@"\n');
  // Bundled Git omits chmod; permissions are enforced/tested on Linux/OpenWrt.
  put(root,'bin/chmod','#!/bin/sh\nexit 0\n');
 }
 let env={...baseEnv,PATH:[path.join(root,'bin'),jqDir,path.dirname(sh),process.env.PATH||process.env.Path].join(path.delimiter),
 SC2_ROOT:posix(root),SC2_SCRIPT:posix(path.join(root,'usr/libexec/site-checker2')),TMPDIR:posix(path.join(root,'tmp')),CALLS:posix(path.join(root,'calls'))};
 function run(method,arg='',input='{}'){
  let r=spawnSync(sh,['-c','exec sh "$SC2_SCRIPT" "$SC2_METHOD" "$SC2_ARG"'],{env:{...env,SC2_METHOD:method,SC2_ARG:arg},input,encoding:'utf8',timeout:20000});
  assert.ifError(r.error);return JSON.parse(r.stdout);
 }
 return {root,env,run};
}
function cfg(f){return JSON.parse(fs.readFileSync(path.join(f.root,'etc/site-checker2/config.json')));}
function worker(f,kind,c,request={}){
 let dir=path.join(f.root,'tmp/site-checker2',kind);fs.mkdirSync(path.join(dir,'lock'),{recursive:true});
 fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify(c));fs.writeFileSync(path.join(dir,'request.json'),JSON.stringify(request));
 let r=spawnSync(sh,['-c','exec sh "$SC2_SCRIPT" worker "$SC2_KIND"'],{env:{...f.env,SC2_KIND:kind},encoding:'utf8',timeout:20000});
 assert.ifError(r.error);assert.equal(r.stderr,'');
 return JSON.parse(fs.readFileSync(path.join(dir,'result.json'),'utf8'));
}
test('config rejects bad types, duplicates, unsafe domains; saves independent settings',()=>{
 let f=fixture(),c=cfg(f);assert.equal(f.run('get_config').config.sites.length,16);
 for(let mutate of [x=>x.sites[0].domain='x;reboot',x=>x.parallel=5,x=>x.total_timeout=0,x=>x.sites[0].enabled='true',x=>x.sites.push({...x.sites[0]}),x=>x.sites[0].domain='-x.test',x=>x.sites[0].domain='x..test']){
  let bad=structuredClone(c);mutate(bad);assert.equal(f.run('save_config','',JSON.stringify(bad)).ok,false);
 }
 c.sites[0].enabled=false;c.sites.push({name:"Свой ' сайт",domain:'Example.COM',enabled:true});
 assert.equal(f.run('save_config','',JSON.stringify(c)).ok,true);assert.equal(f.run('get_config').config.sites.at(-1).domain,'example.com');
});
test('pool skips disabled sites and keeps stable order despite completion order',()=>{
 let f=fixture(),c=cfg(f);c.sites=c.sites.slice(0,5);c.sites[1].enabled=false;c.parallel=2;
 put(f.root,'bin/curl','#!/bin/sh\nprintf "+%s\\n" "$$" >> "$CALLS"\nsleep 0.3\nprintf -- "-%s\\n" "$$" >> "$CALLS"\nprintf "200|0.125"\n');
 let r=worker(f,'sites',c);assert.equal(r.ok,true);assert.equal(r.results.length,4);
 assert.deepEqual(r.results.map(x=>x.domain),['youtube.com','telegram.org','instagram.com','tiktok.com']);
 assert.ok(r.results.every(x=>x.status==='available'&&x.http_code===200&&x.elapsed_ms===125));
 let running=0,max=0;for(let e of fs.readFileSync(path.join(f.root,'calls'),'utf8').trim().split(/\r?\n/)){running+=e.startsWith('+')?1:-1;max=Math.max(max,running);}assert.equal(running,0);assert.equal(max,2);
});
test('reject invalid job paths and duplicate start',()=>{
 let f=fixture();assert.equal(f.run('job','../../etc').error,'invalid_kind');assert.equal(f.run('cancel','x').ok,false);
 fs.mkdirSync(path.join(f.root,'tmp/site-checker2/sites/lock'),{recursive:true});assert.equal(f.run('start','sites').error,'busy');
});
test('diagnostics rejects absent and multiple applications',()=>{
 let f=fixture(),c=cfg(f);assert.equal(worker(f,'diagnostics',c).error,'no_application');
 put(f.root,'etc/config/podkop','');put(f.root,'etc/config/forkop','');assert.equal(worker(f,'diagnostics',c).error,'multiple_applications');
});
function nativeFixture(f,app){
 // Only this fixture bypasses native process isolation; production uses setsid.
 put(f.root,'usr/libexec/site-checker2-bounded','#!/bin/sh\nshift\nexec "$@"\n');
 let script=[
 '#!/bin/sh','printf "%s\\n" "$1" >> "$CALLS"','case "$1" in',
 'get_system_info) echo \'{"'+app+'_version":"2.0.0"}\';;',
 'check_service) echo \'{"running":true,"conflicts":[],"foreign_sing_box":[],"core":{"installed":true,"problem":""}}\';;',
 'get_sing_box_status) echo \'{"running":1}\';;',
 'check_dns) echo \'{"main":{"answered":true},"local":{"answered":true},"bootstrap":null}\';;',
 'check_dns_available) echo \'{"dns_status":1,"dns_on_router":1,"dhcp_config_status":1}\';;',
 'check_traffic) echo \'{"router":{"excluded":false,"answered":true,"dns_fakeip":true,"fakeip":true}}\';;',
 'check_servers) echo \'{"items":[]}\';;',
 'check_fakeip) echo \'{"fakeip":true}\';;','*) exit 2;;','esac',''
 ].join('\n');
 put(f.root,'usr/bin/'+app,script);put(f.root,'bin/curl','#!/bin/sh\necho \'{"tag_name":"2.0.0"}\'\n');
}
for(let app of ['forkop','podkop'])test(app+' uses only its own allowlisted native commands',()=>{
 let f=fixture();nativeFixture(f,app);let r=worker(f,'diagnostics',cfg(f));
 assert.equal(r.application,app);assert.equal(r.diagnostic_status,'ok');assert.deepEqual(r.issues,[]);
 assert.ok(!/restart|reload|start|show_config|report/.test(fs.readFileSync(path.join(f.root,'calls'),'utf8')));
});
test('incomplete native fields never become ALL OK; secrets are not reflected',()=>{
 let f=fixture();nativeFixture(f,'forkop');put(f.root,'usr/bin/forkop','#!/bin/sh\necho \'{"secret":"VPN_PRIVATE_KEY","running":"false"}\'\n');
 let r=worker(f,'diagnostics',cfg(f));assert.equal(r.diagnostic_status,'issues');assert.ok(r.issues.length>0);assert.ok(!JSON.stringify(r).includes('VPN_PRIVATE_KEY'));
});
test('custom/latest unknown version is never declared outdated',()=>{
 let f=fixture();nativeFixture(f,'forkop');put(f.root,'bin/curl','#!/bin/sh\necho \'{"tag_name":"snapshot-3"}\'\n');
 let r=worker(f,'diagnostics',cfg(f));assert.equal(r.update_status,'unknown');assert.equal(r.diagnostic_status,'issues');
});
test('routing explicitly reports unsupported instead of ip route get',()=>{
 let f=fixture();nativeFixture(f,'podkop');assert.equal(worker(f,'route',cfg(f),{target:'youtube.com'}).error,'route_unsupported');
});
test('route destinations validate IPv4, IPv6 and domains without accepting ports or commands',()=>{
 let f=fixture(),script=posix(path.join(f.root,'usr/libexec/site-checker2-target'));
 function check(target){
  return spawnSync(sh,['-c','exec sh "$VALIDATOR" "$TARGET"'],{env:{...f.env,VALIDATOR:script,TARGET:target},encoding:'utf8',timeout:5000});
 }
 for(let target of ['youtube.com','EXAMPLE.COM','192.168.1.1','::','::1','2001:db8::1','2001:db8:1:2:3:4:5:6','::ffff:192.0.2.1']){
  let r=check(target);assert.equal(r.status,0,target);assert.equal(r.stdout.trim(),target.toLowerCase());
 }
 for(let target of ['','300.1.2.3','1.2.3','2001:db8:1','1::2::3',':::1','https://x/','x;reboot','x\nreboot','youtube.com:443','-x.com']){
  assert.notEqual(check(target).status,0,target);
 }
});
test('Forkozz uses its actual panel diagnostics and route engine; standalone NetShift is rejected',()=>{
 let f=fixture();nativeFixture(f,'netshift');
 put(f.root,'opt/zapret-manager-luci/netshift.uc','// fixture: native engine is mocked by ucode below');
 put(f.root,'bin/ucode',[
 '#!/bin/sh','case "$2" in',
 'diag) echo \'{"checks":[{"verdict":"ok","what":"Служба Forkozz"},{"verdict":"ok","what":"sing-box"},{"verdict":"ok","what":"DNS роутера"},{"verdict":"ok","what":"FakeIP"}]}\';;',
 'route) echo \'{"action":"connection","rule":"YouTube","outbound":"youtube-out","section":"main"}\';;',
 '*) exit 2;;','esac',''
 ].join('\n'));
 let r=worker(f,'diagnostics',cfg(f));assert.equal(r.application,'forkozz');assert.equal(r.diagnostic_status,'ok');
 let route=worker(f,'route',cfg(f),{target:'::1'});assert.equal(route.outbound,'youtube-out');assert.equal(route.confidence,'rules_only');assert.equal(route.presumed_exit,'unknown');
 put(f.root,'usr/lib/opkg/info/netshift.control','Package: netshift');
 assert.equal(worker(f,'diagnostics',cfg(f)).error,'unsupported_netshift');
});
test('missing native route action never turns into a confident route result',()=>{
 let f=fixture();nativeFixture(f,'netshift');put(f.root,'opt/zapret-manager-luci/netshift.uc','');
 put(f.root,'bin/ucode','#!/bin/sh\necho "{}"\n');
 assert.equal(worker(f,'route',cfg(f),{target:'::1'}).error,'native_route_failed');
});
test('JSON streams and invalid native JSON are rejected',()=>{
 let f=fixture(),c=cfg(f);
 assert.equal(f.run('save_config','',JSON.stringify(c)+'\n'+JSON.stringify(c)).ok,false);
 nativeFixture(f,'forkop');put(f.root,'usr/bin/forkop','#!/bin/sh\necho "not JSON"\n');
 let r=worker(f,'diagnostics',c);assert.equal(r.diagnostic_status,'issues');assert.ok(r.issues.some(x=>x.component==='diagnostics'));
});
test('asynchronous start completes and exposes its result through job polling',async()=>{
 let f=fixture(),c=cfg(f);c.sites=c.sites.slice(0,1);
 assert.equal(f.run('save_config','',JSON.stringify(c)).ok,true);
 put(f.root,'bin/curl','#!/bin/sh\nsleep 1\nprintf "200|0.125"\n');
 assert.equal(f.run('start','sites').state,'running');
 assert.equal(f.run('start','sites').error,'busy');
 let r;
 for(let i=0;i<30;i++){
  r=f.run('job','sites');if(r.state==='done')break;
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 assert.equal(r.state,'done');assert.equal(r.results[0].status,'available');
});
test('process-group deadline cleans up native descendants',{skip:process.platform==='win32'},async()=>{
 let f=fixture();
 put(f.root,'bin/hanging-native','#!/bin/sh\nsh -c \'trap "" TERM; sleep 60\' &\necho "$!" > "$CHILD_PID_FILE"\nwait\n');
 let pidFile=path.join(f.root,'child.pid');
 let r=spawnSync(sh,[path.join(f.root,'usr/libexec/site-checker2-bounded'),'1',path.join(f.root,'bin/hanging-native')],{
  env:{...f.env,CHILD_PID_FILE:pidFile},encoding:'utf8',timeout:6000
 });
 assert.ifError(r.error);assert.notEqual(r.status,0);
 let pid=Number(fs.readFileSync(pidFile,'utf8').trim());
 let stat;
 // SIGKILL delivery and orphan reaping are asynchronous on the CI host.
 for(let i=0;i<50;i++){
  stat=undefined;
  try{stat=fs.readFileSync('/proc/'+pid+'/stat','utf8');}catch(e){}
  if(!stat || stat.split(' ')[2]==='Z')break;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 assert.ok(!stat || stat.split(' ')[2]==='Z','native descendant remains alive after deadline');
});
test('native server failures and excluded-router FakeIP are interpreted separately',()=>{
 let f=fixture();nativeFixture(f,'forkop');
 const binary=path.join(f.root,'usr/bin/forkop');
 let script=fs.readFileSync(binary,'utf8')
  .replace('{"items":[]}', '{"items":[{"runtime":true,"protocol":"socks","listening":false}]}')
  .replace('{"router":{"excluded":false,"answered":true,"dns_fakeip":true,"fakeip":true}}','{"router":{"excluded":true,"answered":false,"dns_fakeip":false,"fakeip":false}}');
 fs.writeFileSync(binary,script);
 let r=worker(f,'diagnostics',cfg(f));
 assert.equal(r.fakeip_status,'not_applicable');assert.ok(!r.issues.some(x=>x.component==='fakeip'));
 assert.ok(r.issues.some(x=>x.component==='server'&&x.status==='error'));assert.equal(r.diagnostic_status,'issues');
});
