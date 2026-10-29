// Render the actual LuCI view with an explicit mock RPC transport in an isolated browser.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),os=require('node:os');
const runtime=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(root,'outputs');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try {
 const page=await browser.newPage({viewport:{width:1200,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Site Checker 2.0 — локальная проверка интерфейса</title><body style="margin:0;background:#e5eaf0"><p style="font:13px system-ui;margin:12px">Локальная проверка интерфейса · тестовые ответы, не данные роутера</p></body></html>');
 const source=fs.readFileSync(path.join(root,'files/www/luci-static/resources/view/site-checker2/overview.js'),'utf8');
 const css=fs.readFileSync(path.join(root,'files/www/luci-static/resources/view/site-checker2/style.css'),'utf8');
 const config=JSON.parse(fs.readFileSync(path.join(root,'files/etc/site-checker2/config.json')));
 await page.evaluate(async({source,config})=>{
  window.rpcCalls=[];window.testConfig=config;window.jobs={sites:{ok:true,state:'idle'},diagnostics:{ok:true,state:'idle'},route:{ok:true,state:'idle'}};
  window.E=function(tag,attrs,children){
   let el=document.createElement(tag);attrs=attrs||{};
   Object.entries(attrs).forEach(([k,v])=>{
    if(typeof v==='function')el.addEventListener(k,v);
    else if(['checked','disabled','hidden','value'].includes(k))el[k]=v;
    else el.setAttribute(k,String(v));
   });
   function append(x){if(x==null)return;if(Array.isArray(x))x.forEach(append);else el.appendChild(x instanceof Node?x:document.createTextNode(String(x)));}
   append(children);return el;
  };
  window.view={extend:x=>x};window.ui={addNotification:(_,n)=>{window.lastNotice=n.textContent;}};
  window.L={hasViewPermission:()=>true,resource:x=>'data:text/css,'};
  window.poll={add:f=>window.pollTick=f};
  window.rpc={declare:({method})=>async(...args)=>{
   window.rpcCalls.push(method);
   if(method==='get_config')return {ok:true,config:window.testConfig};
   if(method==='save_config'){window.testConfig=args[0];return {ok:true,config:args[0]};}
   if(method==='job')return window.jobs[args[0]];
   if(method==='cancel'){window.jobs[args[0]]={ok:false,state:'failed',error:'cancelled_or_failed'};return {ok:true,state:'cancelling'};}
   if(method.startsWith('start_')){
    let kind=method.slice(6);
    if(kind==='sites')window.jobs[kind]={ok:true,state:'done',results:window.testConfig.sites.filter(x=>x.enabled).map((x,i)=>({...x,status:i===2?'error':'available',http_code:i===2?403:200,elapsed_ms:125+i*15,reason:i===2?'http_error':'none'}))};
    if(kind==='diagnostics')window.jobs[kind]={ok:true,state:'done',application:'Forkop',installed_version:'2.0.0',latest_version:'2.0.0',diagnostic_status:'ok',issues:[]};
    if(kind==='route')window.jobs[kind]={ok:true,state:'done',target:args[0],action:'connection',presumed_exit:'vpn',reason:'Совпадение с тестовым правилом секции',outbound:'youtube-out',matched_section:'YouTube',matched_rule:'Домены секции'};
    return {ok:true,state:'running',kind};
   }
  }};
  window.viewInstance=new Function(source)();
  document.body.appendChild(window.viewInstance.render(await window.viewInstance.load()));
 },{source,config});
 await page.addStyleTag({content:css});
 assert.deepEqual(await page.evaluate(()=>window.rpcCalls),['get_config','job','job','job']);
 await page.getByRole('tab',{name:'Диагностика',exact:true}).click();
 await page.getByRole('tab',{name:'Куда пойдёт запрос',exact:true}).click();
 await page.getByRole('tab',{name:'Сайты',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.rpcCalls.filter(x=>x.startsWith('start')).length),0);
 await page.getByRole('button',{name:'Проверить сейчас',exact:true}).click();
 await page.evaluate(()=>window.pollTick());
 assert.equal(await page.locator('tbody tr').count(),16);
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.locator('.sc2-check input').first().uncheck();
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.getByRole('tab',{name:'Куда пойдёт запрос',exact:true}).click();
 assert.equal(await page.locator('.sc2-shortcuts button').count(),15);
 assert.equal(await page.locator('.sc2-shortcuts button').filter({hasText:'YouTube'}).count(),0);
 await page.getByRole('button',{name:'Instagram',exact:true}).click();
 assert.equal(await page.locator('.sc2-controls input[type=text]').inputValue(),'instagram.com');
 await page.getByRole('button',{name:'Проверить',exact:true}).click();
 await page.evaluate(()=>window.pollTick());
 assert.ok((await page.locator('#sc2-route .sc2-results').innerText()).includes('Через настроенный VPN / туннель'));
 await page.screenshot({path:path.join(out,'ui-route.png'),fullPage:true});
 await page.getByRole('tab',{name:'Диагностика',exact:true}).click();
 await page.getByRole('button',{name:'Запустить диагностику',exact:true}).click();
 await page.evaluate(()=>window.pollTick());
 assert.equal(await page.getByText('✅ ВСЁ ОК',{exact:true}).count(),1);
 await page.screenshot({path:path.join(out,'ui-diagnostics.png'),fullPage:true});
 await page.getByRole('button',{name:'Запустить диагностику',exact:true}).click();
 await page.locator('#sc2-diagnostics').getByRole('button',{name:'Отменить',exact:true}).click();
 await page.evaluate(()=>window.pollTick());
 assert.equal(await page.getByText('Проверка отменена или завершилась с ошибкой.',{exact:true}).count(),1);
 await page.getByRole('tab',{name:'Сайты',exact:true}).click();
 await page.locator('.sc2').evaluate(el=>el.setAttribute('data-theme','dark'));
 await page.screenshot({path:path.join(out,'ui-desktop-dark.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.locator('.sc2').evaluate(el=>el.setAttribute('data-theme','light'));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile horizontal overflow');
 await page.screenshot({path:path.join(out,'ui-mobile-light.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('UI passed: no automatic checks, tab switching, sites, settings persistence, quick domains, diagnostics, mobile width. Screenshots saved.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
