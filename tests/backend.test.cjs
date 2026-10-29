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
 nativeFixture(f,'podkop');nativeFixture(f,'forkop');assert.equal(worker(f,'diagnostics',c).error,'multiple_applications');
});
function nativeFixture(f,app){
 put(f.root,'etc/init.d/'+app,'#!/bin/sh\nexit 0\n');
 if(app==='forkop'){
  put(f.root,'usr/lib/forkop/core/constants.uc','return {FORKOP_VERSION:"2.0.0"};\n');
  put(f.root,'usr/lib/forkop/service/cli.uc','// real installation footprint fixture\n');
 }else put(f.root,'usr/lib/'+app+'/constants.sh',app.toUpperCase()+'_VERSION="2.0.0"\n');
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
 assert.ok(r.checks.some(x=>x.label==='FakeIP'));
 assert.ok(r.checks.some(x=>x.label.includes('DNS')));
});
test('incomplete native fields never become ALL OK; secrets are not reflected',()=>{
 let f=fixture();nativeFixture(f,'forkop');put(f.root,'usr/bin/forkop','#!/bin/sh\necho \'{"secret":"VPN_PRIVATE_KEY","running":"false"}\'\n');
 let r=worker(f,'diagnostics',cfg(f));assert.equal(r.diagnostic_status,'issues');assert.ok(r.issues.length>0);assert.ok(!JSON.stringify(r).includes('VPN_PRIVATE_KEY'));
});
test('custom/latest unknown version is never declared outdated',()=>{
 let f=fixture();nativeFixture(f,'forkop');put(f.root,'bin/curl','#!/bin/sh\necho \'{"tag_name":"snapshot-3"}\'\n');
 let r=worker(f,'diagnostics',cfg(f));assert.equal(r.update_status,'unknown');assert.equal(r.diagnostic_status,'issues');
});
test('Forkozz exposes native diagnostic values including latency and extra checks',()=>{
 const f=fixture();nativeFixture(f,'netshift');put(f.root,'opt/zapret-manager-luci/netshift.uc','');
 const checks=['Служба Forkozz','sing-box','DNS роутера','FakeIP'].map(what=>({what,verdict:'ok',why:what==='FakeIP'?'работает (198.18.0.5)':'работает'}));
 checks.push({what:'Подключение к серверу',verdict:'ok',why:'отвечает за 713 мс'});
 put(f.root,'panel-reply',JSON.stringify({checks,extra:[{what:'Откуда берёт трафик',verdict:'ok',why:'br-lan'}],secret:'NEVER_RETURN_THIS'}));
 put(f.root,'bin/ucode','#!/bin/sh\ncat "$SC2_ROOT/panel-reply"\n');
 const r=worker(f,'diagnostics',cfg(f));
 assert.ok(r.checks.some(x=>x.value.includes('713 мс')));assert.ok(r.checks.some(x=>x.value==='br-lan'));
 assert.ok(r.checks.some(x=>x.value.includes('198.18.0.5')));assert.ok(!JSON.stringify(r).includes('NEVER_RETURN_THIS'));
});

test('Forkozz sites-now and connections call only native conns and project safe fields',()=>{
 const f=fixture();nativeFixture(f,'netshift');put(f.root,'opt/zapret-manager-luci/netshift.uc','');
 put(f.root,'connection-reply',JSON.stringify({conns:[{src:'192.168.7.162',dev:'Телефон',dst:'1.2.3.4',host:'chatgpt.com',dport:'443',proto:'tcp',out:'Основная',secret:'NEVER_RETURN_THIS'}],total:19}));
 put(f.root,'bin/ucode','#!/bin/sh\nprintf "%s\\n" "$2" >> "$CALLS"\n[ "$2" = conns ] || exit 2\ncat "$SC2_ROOT/connection-reply"\n');
 for(const kind of ['live_sites','connections']){
  const r=worker(f,kind,cfg(f));assert.equal(r.application,'forkozz');assert.equal(r.total,19);assert.equal(r.conns[0].host,'chatgpt.com');assert.equal(r.conns[0].out,'Основная');assert.ok(!JSON.stringify(r).includes('NEVER_RETURN_THIS'));
 }
 assert.deepEqual(fs.readFileSync(path.join(f.root,'calls'),'utf8').trim().split(/\r?\n/),['conns','conns']);
});

test('Forkop uses native GET connections transport and normalizes its body',()=>{
 const f=fixture();nativeFixture(f,'forkop');
 put(f.root,'connection-reply',JSON.stringify({status:200,body:JSON.stringify({connections:[{metadata:{sourceIP:'192.168.1.2',destinationIP:'2001:db8::1',destinationPort:443,network:'tcp'},chains:['node','main-out'],rule:'RuleSet',secret:'NEVER_RETURN_THIS'}]})}));
 put(f.root,'usr/bin/forkop','#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n[ "$1 $2 $3" = "clash_api GET /connections" ] || exit 2\ncat "$SC2_ROOT/connection-reply"\n');
 const r=worker(f,'connections',cfg(f));assert.equal(r.ok,true);assert.equal(r.conns[0].dst,'2001:db8::1');assert.equal(r.conns[0].out,'main-out');assert.equal(r.total,1);assert.ok(!JSON.stringify(r).includes('NEVER_RETURN_THIS'));
 assert.equal(fs.readFileSync(path.join(f.root,'calls'),'utf8').trim(),'clash_api GET /connections');
});

test('Podkop reads configured controller with protected auth header and no config changes',()=>{
 const f=fixture();nativeFixture(f,'podkop');
 const config=JSON.stringify({experimental:{clash_api:{external_controller:'0.0.0.0:9090',secret:'fixture-auth-token'}}});
 put(f.root,'etc/sing-box/custom.json',config);put(f.root,'bin/uci','#!/bin/sh\necho /etc/sing-box/custom.json\n');
 put(f.root,'bin/curl','#!/bin/sh\nprintf "%s\\n" "$@" > "$SC2_ROOT/curl-args"\nwhile [ "$#" -gt 0 ]; do if [ "$1" = --header ]; then shift; cat "${1#@}" > "$SC2_ROOT/seen-header"; fi; shift; done\necho \'{"connections":[{"metadata":{"sourceIP":"192.168.1.3","host":"example.com"},"chains":["direct"]}]}\'\n');
 const r=worker(f,'live_sites',cfg(f));assert.equal(r.ok,true);assert.equal(r.conns[0].host,'example.com');assert.equal(r.conns[0].out,'');
 assert.ok(!JSON.stringify(r).includes('fixture-auth-token'));assert.ok(!fs.readFileSync(path.join(f.root,'curl-args'),'utf8').includes('fixture-auth-token'));
 assert.ok(fs.readFileSync(path.join(f.root,'curl-args'),'utf8').includes('http://127.0.0.1:9090/connections'));
 assert.equal(fs.readFileSync(path.join(f.root,'seen-header'),'utf8').trim(),'Authorization: Bearer fixture-auth-token');
 assert.equal(fs.existsSync(path.join(f.root,'tmp/site-checker2/live_sites/controller-header')),false);
 assert.equal(fs.readFileSync(path.join(f.root,'etc/sing-box/custom.json'),'utf8'),config);
});

test('connections rejects native API errors and malformed data instead of showing empty success',()=>{
 const f=fixture();nativeFixture(f,'forkop');
 put(f.root,'usr/bin/forkop','#!/bin/sh\ncat "$SC2_ROOT/connection-reply"\n');
 for(const response of [{status:401,body:'{"connections":[]}'},{status:200,body:'invalid JSON'},{status:200,body:'[]'},{status:200,body:'{}'}]){
  put(f.root,'connection-reply',JSON.stringify(response));assert.equal(worker(f,'connections',cfg(f)).error,'connections_unavailable');
 }
 put(f.root,'connection-reply',JSON.stringify({status:200,body:'{"connections":[]}'}));assert.equal(worker(f,'connections',cfg(f)).total,0);
});

test('Podkop does not enable a disabled API or follow unsafe controller addresses',()=>{
 const f=fixture();nativeFixture(f,'podkop');put(f.root,'bin/uci','#!/bin/sh\necho /etc/sing-box/config.json\n');
 put(f.root,'bin/curl','#!/bin/sh\necho called >> "$CALLS"\nexit 1\n');
 for(const endpoint of ['', 'http://evil.example:9090/path', '127.0.0.1:0', '127.0.0.1:9090\nInjected: header']){
  const config=JSON.stringify({experimental:{clash_api:{external_controller:endpoint,secret:'fixture-token'}}});
  put(f.root,'etc/sing-box/config.json',config);
  assert.equal(worker(f,'connections',cfg(f)).error,'connections_unavailable');
  assert.equal(fs.readFileSync(path.join(f.root,'etc/sing-box/config.json'),'utf8'),config);
 }
 assert.equal(fs.existsSync(path.join(f.root,'calls')),false);
});

test('connection snapshots bound large lists, preserve totals and redact credential strings',()=>{
 const f=fixture();nativeFixture(f,'netshift');put(f.root,'opt/zapret-manager-luci/netshift.uc','');
 put(f.root,'connection-reply',JSON.stringify({total:500,conns:Array.from({length:400},()=>({src:'192.168.1.2',host:'vless://sensitive-credential',out:'main',dport:'443'}))}));
 put(f.root,'bin/ucode','#!/bin/sh\ncat "$SC2_ROOT/connection-reply"\n');
 const r=worker(f,'connections',cfg(f));assert.equal(r.total,500);assert.equal(r.truncated,true);assert.equal(r.conns.length,150);assert.ok(!JSON.stringify(r).includes('sensitive-credential'));
 const long=n=>'🙂'.repeat(n);
 put(f.root,'connection-reply',JSON.stringify({total:400,conns:Array.from({length:400},()=>({src:long(64),dev:long(64),dst:long(64),host:long(253),out:long(96),rule:long(96),proto:long(16),dport:'443'}))}));
 const utf=worker(f,'connections',cfg(f));assert.equal(utf.ok,true);assert.equal(utf.truncated,true);assert.ok(utf.conns.length<150);assert.ok(Buffer.byteLength(JSON.stringify(utf))<196608);
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
 assert.equal(worker(f,'diagnostics',cfg(f)).application,'forkozz');
 const standalone=fixture();nativeFixture(standalone,'netshift');
 assert.equal(worker(standalone,'diagnostics',cfg(standalone)).error,'unsupported_netshift');
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

test('worker processing failures are not reported as user cancellation',async()=>{
 for(const [message,expected] of [['processing failed','worker_failed'],['jq was compiled without ONIGURUMA regex library','jq_incompatible']]){
  const f=fixture();nativeFixture(f,'forkop');
  put(f.root,'usr/bin/forkop','#!/bin/sh\necho \'{"status":200,"body":"{\\"connections\\":[]}"}\'\n');
  put(f.root,'usr/share/site-checker2/connections.jq','error('+JSON.stringify(message)+')\n');
  assert.equal(f.run('start','connections').state,'running');
  let result;
  for(let i=0;i<40;i++){
   result=f.run('job','connections');if(result.state==='failed')break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(result.error,expected);assert.equal(result.ok,false);
  assert.ok(fs.readFileSync(path.join(f.root,'tmp/site-checker2/connections/log'),'utf8').includes(message));
 }
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
function detectApp(f){
 const r=spawnSync(sh,['-c','exec sh "$DETECTOR"'],{env:{...f.env,DETECTOR:posix(path.join(f.root,'usr/libexec/site-checker2-detect'))},encoding:'utf8',timeout:5000});
 assert.ifError(r.error);assert.equal(r.stderr,'');return JSON.parse(r.stdout);
}
test('orphan configs and old package control files are not installed applications',()=>{
 const f=fixture();
 for(const app of ['podkop','forkop','netshift']){put(f.root,'etc/config/'+app,'old settings');put(f.root,'usr/lib/opkg/info/'+app+'.control','stale metadata');}
 assert.equal(detectApp(f).error,'no_application');
});
for(const app of ['podkop','forkop'])test(app+' ignores orphan configs of the other applications',()=>{
 const f=fixture();nativeFixture(f,app);
 for(const old of ['podkop','forkop','netshift'])put(f.root,'etc/config/'+old,'old settings');
 assert.equal(detectApp(f).application,app);
 assert.equal(worker(f,'diagnostics',cfg(f)).application,app);
});
test('managed Forkozz selects one engine for diagnostics and routing despite old configs',()=>{
 const f=fixture();nativeFixture(f,'netshift');
 for(const old of ['podkop','forkop','netshift'])put(f.root,'etc/config/'+old,'old settings');
 put(f.root,'usr/lib/netshift/zm-managed','');
 put(f.root,'opt/zapret-manager-luci/netshift.uc','// panel module fixture');
 put(f.root,'bin/ucode',[
 '#!/bin/sh','case "$2" in',
 'diag) echo \'{"checks":[{"what":"Служба Forkozz","verdict":"ok"},{"what":"sing-box","verdict":"ok"},{"what":"DNS роутера","verdict":"ok"},{"what":"FakeIP","verdict":"ok"}]}\';;',
 'route) echo \'{"action":"direct","outbound":"direct-out","rule":"default"}\';;',
 '*) exit 1;;','esac',''
 ].join('\n'));
 assert.equal(detectApp(f).application,'forkozz');
 assert.equal(worker(f,'diagnostics',cfg(f)).application,'forkozz');
 assert.equal(worker(f,'route',cfg(f),{target:'1.1.1.1'}).action,'direct');
});
function packages(f,names){
 put(f.root,'bin/opkg','#!/bin/sh\ncase "$*" in\n'+names.map(name=>'*"status '+name+'") echo "Status: install ok installed";;').join('\n')+'\n*) exit 1;;\nesac\n');
}
test('registered application takes precedence over an unregistered legacy runtime',()=>{
 const f=fixture();nativeFixture(f,'podkop');nativeFixture(f,'forkop');packages(f,['forkop']);
 assert.equal(detectApp(f).application,'forkop');assert.equal(detectApp(f).detection_source,'installed');
});
test('two genuinely installed runtimes remain an explicit conflict with their names',()=>{
 const f=fixture();nativeFixture(f,'podkop');nativeFixture(f,'forkop');packages(f,['podkop','forkop']);
 assert.deepEqual(detectApp(f).applications,['podkop','forkop']);
 assert.equal(detectApp(f).error,'multiple_applications');
});
test('registered package with missing runtime is reported as incomplete, not selected',()=>{
 const f=fixture();packages(f,['forkop']);
 assert.equal(detectApp(f).error,'application_incomplete');assert.deepEqual(detectApp(f).applications,['forkop']);
});
