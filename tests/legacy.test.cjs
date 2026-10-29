const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const sh=process.env.TEST_SH||(process.platform==='win32'?path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/usr/bin/sh.exe'):'/bin/sh');
const jqDir=process.env.TEST_JQ_DIR||(process.platform==='win32'?'D:/AI/GPT_Codex/ChatGPT/Zapret2/work/test-tools':'/usr/bin');
const posix=s=>s.replaceAll('\\','/');
const base=path.join(root,'work/legacy-tests');fs.mkdirSync(base,{recursive:true});
const files=['usr/lib/lua/luci/controller/sitecheck.lua','usr/lib/lua/luci/view/sitecheck/index.htm','usr/libexec/sitecheck-check','usr/libexec/sitecheck-check-zapret','usr/libexec/sitecheck-system-sites','usr/share/luci/menu.d/luci-app-site-checker.json','etc/config/sitecheck'];
const baseEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toLowerCase()!=='path'));
function put(dir,name,body){let p=path.join(dir,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,body);fs.chmodSync(p,0o755);}
function fixture(old=true){
 let dir=fs.mkdtempSync(path.join(base,'case-')),state=path.join(dir,'legacy-plan');
 fs.mkdirSync(path.join(dir,'bin'),{recursive:true});
 if(old)files.forEach((name,i)=>put(dir,name,'original-'+i+'\n'));
 put(dir,'etc/config/network','PRESERVE_NETWORK\n');put(dir,'usr/bin/podkop-vpn-failover','PRESERVE_SERVICE\n');put(dir,'usr/libexec/site-checker2','PRESERVE_V2\n');
 put(dir,'hash.cjs',String.raw`const fs=require('fs'),c=require('crypto');for(let p of process.argv.slice(2))console.log(c.createHash('sha256').update(fs.readFileSync(p)).digest('hex')+'  '+p);`);
 put(dir,'bin/sha256sum','#!/bin/sh\nexec "$SC2_NODE" "$SC2_HASH" "$@"\n');
 if(process.platform==='win32')put(dir,'bin/jq','#!/bin/sh\nexec "'+posix(path.join(jqDir,'jq.exe'))+'" -b "$@"\n');
 let env={...baseEnv,PATH:[path.join(dir,'bin'),jqDir,path.dirname(sh),process.env.PATH||process.env.Path].join(path.delimiter),
 SC2_ROOT:posix(dir),SC2_NODE:posix(process.execPath),SC2_HASH:posix(path.join(dir,'hash.cjs')),CALLS:posix(path.join(dir,'calls'))};
 function run(action,...extra){
  let r=spawnSync(sh,[posix(path.join(root,'files/usr/libexec/site-checker2-legacy')),action,posix(state),posix(dir),...extra.map(posix)],{env,encoding:'utf8',timeout:20000});
  assert.ifError(r.error);return r;
 }
 function intact(){for(let [i,n]of files.entries())assert.equal(fs.readFileSync(path.join(dir,n),'utf8'),'original-'+i+'\n');}
 function unrelated(){assert.equal(fs.readFileSync(path.join(dir,'etc/config/network'),'utf8'),'PRESERVE_NETWORK\n');assert.equal(fs.readFileSync(path.join(dir,'usr/bin/podkop-vpn-failover'),'utf8'),'PRESERVE_SERVICE\n');assert.equal(fs.readFileSync(path.join(dir,'usr/libexec/site-checker2'),'utf8'),'PRESERVE_V2\n');}
 return {dir,state,env,run,intact,unrelated};
}
test('v1 is removed without copying files or configuration',()=>{
 let f=fixture();assert.equal(f.run('plan').status,0);f.intact();
 assert.ok(!fs.existsSync(path.join(f.state,'files')));
 assert.ok(!fs.existsSync(path.join(f.state,'restore-helper.sh')));
 assert.equal(f.run('retire').status,0);
 files.forEach(n=>assert.ok(!fs.existsSync(path.join(f.dir,n))));f.unrelated();
});
test('replacement is safe when v1 is absent',()=>{
 let f=fixture(false);assert.equal(f.run('plan').status,0);assert.equal(f.run('retire').status,0);f.unrelated();
});
test('edited old settings are deleted rather than backed up or imported',()=>{
 let f=fixture();assert.equal(f.run('plan').status,0);
 put(f.dir,'etc/config/sitecheck','PRIVATE_V1_CONFIG_SENTINEL');
 assert.equal(f.run('retire').status,0);
 for(let name of fs.readdirSync(f.state))assert.ok(!fs.readFileSync(path.join(f.state,name),'utf8').includes('PRIVATE_V1_CONFIG_SENTINEL'));
 files.forEach(n=>assert.ok(!fs.existsSync(path.join(f.dir,n))));f.unrelated();
});
test('a directory in place of a v1 file fails before replacement',()=>{
 let f=fixture(false);fs.mkdirSync(path.join(f.dir,files[0]),{recursive:true});assert.notEqual(f.run('plan').status,0);f.unrelated();
});
test('symlink v1 assets are refused',{skip:process.platform==='win32'},()=>{
 let f=fixture(false);fs.mkdirSync(path.dirname(path.join(f.dir,files[0])),{recursive:true});fs.symlinkSync(path.join(f.dir,'etc/config/network'),path.join(f.dir,files[0]));
 assert.notEqual(f.run('plan').status,0);f.unrelated();
});
function pm(f,type,planExtra=false,foreign=false){
 let script;
 if(type==='apk')script=[
 '#!/bin/sh','printf "%s\\n" "$*" >> "$CALLS"','case "$*" in',
 '*"info -e"*) exit 0;;','*"info -L"*) echo "luci-app-sitecheck-1.3.0-r1 contains:"; echo "usr/libexec/sitecheck-check"'+(foreign?'; echo "etc/config/network"':'')+';;',
 '*"info -a"*) echo "package metadata";;','*"--simulate"*) echo "(1/1) Purging luci-app-sitecheck (1.3.0-r1)"'+(planExtra?'; echo "(2/2) Purging curl (8.0)"':'')+';;',
 '*"del"*) echo "REMOVED_PACKAGE" >> "$CALLS";;','*) exit 1;;','esac',''].join('\n');
 else script=[
 '#!/bin/sh','printf "%s\\n" "$*" >> "$CALLS"','case "$*" in',
 '*"status"*) echo "Status: install ok installed";;','*"files"*) echo "Package luci-app-sitecheck"; echo "/usr/libexec/sitecheck-check"'+(foreign?'; echo "/etc/config/network"':'')+';;',
 '*"--noaction"*) '+(planExtra?'exit 1':'exit 0')+';;','*"remove"*) echo "REMOVED_PACKAGE" >> "$CALLS";;','*) exit 1;;','esac',''].join('\n');
 put(f.dir,'bin/'+type,script);
}
for(let type of ['apk','opkg'])test(type+' removes only the registered first-version package',()=>{
 let f=fixture();pm(f,type);assert.equal(f.run('plan').status,0);assert.equal(f.run('retire').status,0);
 let calls=fs.readFileSync(path.join(f.dir,'calls'),'utf8');assert.ok(calls.includes('REMOVED_PACKAGE'));assert.ok(!calls.includes('--autoremove'));f.unrelated();
});
for(let type of ['apk','opkg'])test(type+' refuses extra package impact before deleting v1',()=>{
 let f=fixture();pm(f,type,true);assert.equal(f.run('plan').status,0);assert.notEqual(f.run('retire').status,0);f.intact();f.unrelated();
 assert.ok(!fs.readFileSync(path.join(f.dir,'calls'),'utf8').includes('REMOVED_PACKAGE'));
});
test('package-owned unrelated files block migration',()=>{
 let f=fixture();pm(f,'apk',false,true);assert.notEqual(f.run('plan').status,0);f.intact();f.unrelated();
});
test('obsolete restore and import operations are not supported',()=>{
 let f=fixture();assert.notEqual(f.run('restore').status,0);assert.notEqual(f.run('import').status,0);f.intact();
});
function installFixture(old=true,existingConfig=false,failRpc=false){
 let f=fixture(old);
 for(let name of ['root','tmp','usr/share/luci'])fs.mkdirSync(path.join(f.dir,name),{recursive:true});
 put(f.dir,'etc/openwrt_release',"DISTRIB_RELEASE='25.12.5'\n");
 put(f.dir,'etc/ssl/certs/ca-certificates.crt','fixture\n');
 for(let name of ['curl','setsid','rpcd','sleep'])put(f.dir,'bin/'+name,'#!/bin/sh\nexit 0\n');
 put(f.dir,'bin/id','#!/bin/sh\necho 0\n');
 put(f.dir,'bin/sha256sum','#!/bin/sh\nexec /usr/bin/sha256sum "$@"\n');
 put(f.dir,'etc/init.d/rpcd','#!/bin/sh\nexit 0\n');
 put(f.dir,'bin/ubus',failRpc?'#!/bin/sh\nexit 1\n':'#!/bin/sh\necho site-checker2\n');
 put(f.dir,'bin/uci','#!/bin/sh\nexit 0\n');
 if(existingConfig){let c=JSON.parse(fs.readFileSync(path.join(root,'files/etc/site-checker2/config.json')));c.sites[0].enabled=false;put(f.dir,'etc/site-checker2/config.json',JSON.stringify(c));}
 const script=fs.readFileSync(path.join(root,'install.sh'),'utf8');
 const marker='\n__SITE_CHECKER2_PAYLOAD__\n';
 let [header,payload]=script.split(marker);
 // Reroot only the installer header. The real archive bytes stay unchanged.
 header=header.replace(/(?<![A-Za-z0-9_$])\/(etc|usr|root|tmp|www|sbin)(?=[/\s])/g,(_,prefix)=>posix(f.dir)+'/'+prefix);
 header=header.replaceAll('"/$rel"','"$SC2_ROOT/$rel"').replaceAll('"/$(dirname','"$SC2_ROOT/$(dirname');
 const launcher=path.join(f.dir,'install-fixture.sh');fs.writeFileSync(launcher,header+marker+payload);
 let r=spawnSync(sh,[launcher],{env:f.env,encoding:'utf8',timeout:15000});
 assert.ifError(r.error);
 return {...f,result:r};
}
test('full installer replaces v1 without a persistent backup',{skip:process.platform==='win32'},()=>{
 let f=installFixture();assert.equal(f.result.status,0,f.result.stderr);
 files.forEach(n=>assert.ok(!fs.existsSync(path.join(f.dir,n)),n));
 assert.deepEqual(fs.readdirSync(path.join(f.dir,'root')),[]);
 function scan(dir){for(let e of fs.readdirSync(dir,{withFileTypes:true})){let p=path.join(dir,e.name);if(e.isDirectory())scan(p);else if(e.isFile())assert.ok(!fs.readFileSync(p).includes(Buffer.from('original-6')),'v1 config was copied: '+p);}}
 scan(f.dir);
 assert.equal(fs.readFileSync(path.join(f.dir,'usr/libexec/site-checker2'),'utf8'),fs.readFileSync(path.join(root,'files/usr/libexec/site-checker2'),'utf8'));
 assert.equal(fs.readFileSync(path.join(f.dir,'etc/config/network'),'utf8'),'PRESERVE_NETWORK\n');
});
test('failed v2 RPC validation leaves v1 intact and rolls back v2 files',{skip:process.platform==='win32'},()=>{
 let f=installFixture(true,false,true);assert.notEqual(f.result.status,0);f.intact();f.unrelated();
 assert.ok(!fs.existsSync(path.join(f.dir,'etc/site-checker2/config.json')));
});
test('existing v2 selections take precedence while replacing v1',{skip:process.platform==='win32'},()=>{
 let f=installFixture(true,true);assert.equal(f.result.status,0,f.result.stderr);
 let c=JSON.parse(fs.readFileSync(path.join(f.dir,'etc/site-checker2/config.json')));assert.equal(c.sites[0].enabled,false);
 files.forEach(n=>assert.ok(!fs.existsSync(path.join(f.dir,n))));
});
async function httpAssets(t,f){
 const {spawn}=require('node:child_process'),http=require('node:http');
 const sudo=spawnSync('sudo',['-n','true'],{encoding:'utf8'});
 if(sudo.status!==0){t.skip('Unprivileged HTTP check needs non-interactive sudo');return null;}
 // The server enters the private CI fixture as root, then drops uid/gid to nobody
 // before accepting requests; installed file permissions are not changed here.
 let proc=spawn('sudo',['-n','python3',path.join(root,'tools/unprivileged-http.py'),path.join(f.dir,'www')],{stdio:['ignore','pipe','pipe']});
 let stderr='';proc.stderr.on('data',b=>stderr+=b);
 try {
  let port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('HTTP server startup timeout: '+stderr)),5000);
   proc.stdout.once('data',b=>{clearTimeout(timer);resolve(Number(b.toString().trim()));});
   proc.once('error',e=>{clearTimeout(timer);reject(e);});
   proc.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(new Error('HTTP server failed: '+stderr));}});
  });
  async function get(name){return new Promise((resolve,reject)=>{
   const req=http.get('http://127.0.0.1:'+port+'/luci-static/resources/view/site-checker2/'+name+'?v=test',res=>{
    let chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}));
   });req.setTimeout(3000,()=>req.destroy(new Error('HTTP timeout')));req.on('error',reject);
  });}
  return [await get('overview.js'),await get('style.css')];
 } finally {proc.kill('SIGTERM');}
}
test('fresh install serves JS and CSS to an unprivileged HTTP client and keeps config private',{skip:process.platform==='win32'},async t=>{
 let f=installFixture();assert.equal(f.result.status,0,f.result.stderr);
 const resources='www/luci-static/resources/view/site-checker2';
 assert.equal(fs.statSync(path.join(f.dir,resources)).mode&0o777,0o755);
 for(let name of ['overview.js','style.css'])assert.equal(fs.statSync(path.join(f.dir,resources,name)).mode&0o777,0o644);
 assert.equal(fs.statSync(path.join(f.dir,'etc/site-checker2')).mode&0o777,0o700);
 assert.equal(fs.statSync(path.join(f.dir,'etc/site-checker2/config.json')).mode&0o777,0o600);
 let replies=await httpAssets(t,f);if(!replies)return;
 assert.deepEqual(replies.map(r=>r.status),[200,200]);
 assert.equal(replies[0].body.toString(),fs.readFileSync(path.join(root,'files',resources,'overview.js'),'utf8'));
 assert.equal(replies[1].body.toString(),fs.readFileSync(path.join(root,'files',resources,'style.css'),'utf8'));
});
test('upgrade repairs reproduced 403 from local.2 permissions without changing v2 settings',{skip:process.platform==='win32'},async t=>{
 let f=installFixture(true,true);assert.equal(f.result.status,0,f.result.stderr);
 const resources=path.join(f.dir,'www/luci-static/resources/view/site-checker2');
 const config=fs.readFileSync(path.join(f.dir,'etc/site-checker2/config.json'));
 fs.chmodSync(resources,0o700);
 for(let name of ['overview.js','style.css'])fs.chmodSync(path.join(resources,name),0o600);
 let before=await httpAssets(t,f);if(!before)return;
 assert.deepEqual(before.map(r=>r.status),[403,403]);
 let r=spawnSync(sh,[path.join(f.dir,'install-fixture.sh')],{env:f.env,encoding:'utf8',timeout:15000});
 assert.ifError(r.error);assert.equal(r.status,0,r.stderr);
 let after=await httpAssets(t,f);
 assert.deepEqual(after.map(r=>r.status),[200,200]);
 assert.deepEqual(fs.readFileSync(path.join(f.dir,'etc/site-checker2/config.json')),config);
 assert.equal(fs.statSync(path.join(f.dir,'etc/site-checker2/config.json')).mode&0o777,0o600);
});
