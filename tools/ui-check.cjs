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
  window.rpcCalls=[];window.testConfig=config;window.jobs={sites:{ok:true,state:'idle'},diagnostics:{ok:true,state:'idle'},live_sites:{ok:true,state:'idle'},connections:{ok:true,state:'idle'}};
  window.E=function(tag,attrs,children){
   let el=document.createElement(tag);attrs=attrs||{};
   Object.entries(attrs).forEach(([k,v])=>{
    // LuCI dom.attr skips null but serializes false as an attribute.
    if(v==null)return;
    if(typeof v==='function')el.addEventListener(k,v);
    else if(typeof v==='object')el.setAttribute(k,JSON.stringify(v));
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
    if(kind==='diagnostics')window.jobs[kind]={ok:true,state:'done',application:'forkozz',installed_version:'2.0.0',latest_version:'2.0.0',diagnostic_status:'ok',issues:[],checks:[
     {label:'Служба Forkozz',status:'ok',value:'Запущена и включена в автозапуск',source:'Forkozz · diag'},
     {label:'sing-box',status:'ok',value:'Работает · 1.14.4',source:'get_sing_box_status'},
     {label:'DNS роутера',status:'ok',value:'Запросы идут через Forkozz',source:'Forkozz · diag'},
     {label:'FakeIP',status:'ok',value:'Работает (198.18.0.5)',source:'check_fakeip'},
     {label:'Подключение к серверу',status:'ok',value:'Отвечает за 713 мс',source:'Forkozz · diag'}]};
    if(kind==='live_sites'||kind==='connections')window.jobs[kind]={ok:true,state:'done',application:'forkozz',captured_at:1793253600,total:4,truncated:false,conns:[
     {src:'192.168.7.162',dev:'Телефон',host:'chatgpt.com',dst:'1.2.3.4',dport:'443',proto:'tcp',out:'Основная'},
     {src:'192.168.7.162',dev:'Телефон',host:'chatgpt.com',dst:'1.2.3.4',dport:'443',proto:'tcp',out:'Основная'},
     {src:'192.168.7.163',dev:'Ноутбук',host:'chatgpt.com',dst:'1.2.3.4',dport:'443',proto:'udp',out:'Основная'},
     {src:'192.168.7.162',dev:'Телефон',host:'',dst:'2001:db8::1',dport:'443',proto:'tcp',out:''}]};
    return {ok:true,state:'running',kind};
   }
  }};
  window.viewInstance=new Function(source)();
  document.body.appendChild(window.viewInstance.render(await window.viewInstance.load()));
 },{source,config});
 await page.addStyleTag({content:'input[type=checkbox]{display:none!important}'+css});
 assert.deepEqual(await page.evaluate(()=>window.rpcCalls),['get_config','job','job']);
 await page.getByRole('tab',{name:'Диагностика',exact:true}).click();
 await page.getByRole('tab',{name:'Сайты сейчас',exact:true}).click();
 await page.getByRole('tab',{name:'Соединения',exact:true}).click();
 assert.equal(await page.getByRole('tab',{name:'Куда пойдёт запрос',exact:true}).count(),0);
 await page.getByRole('tab',{name:'Сайты',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.rpcCalls.filter(x=>x.startsWith('start')).length),0);
 const selected=await page.getByRole('tab',{name:'Сайты',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor);
 const unselected=await page.getByRole('tab',{name:'Диагностика',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor);
 assert.notEqual(selected,unselected,'active tab must have a filled background');
 async function checkControls(){
  const boxes=await page.locator('#sc2-sites>.sc2-controls button').evaluateAll(els=>els.map(e=>{const b=e.getBoundingClientRect();return {top:b.top,right:b.right,left:b.left};}));
  assert.equal(boxes.length,3);assert.ok(Math.abs(boxes[0].top-boxes[2].top)<2,'all three buttons share a row');
  const edge=await page.locator('#sc2-sites>.sc2-controls').evaluate(el=>el.getBoundingClientRect().right);
  assert.ok(Math.abs(edge-boxes[2].right)<2,'settings aligned right');
 }
 await checkControls();
 await page.getByRole('button',{name:'Проверить сейчас',exact:true}).click();
 await page.evaluate(()=>window.pollTick());
 assert.equal(await page.locator('tbody tr').count(),16);
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 assert.equal(await page.locator('.sc2-check input').first().getAttribute('disabled'),null);
 assert.equal(await page.locator('.sc2-check input').first().isVisible(),true);
 await page.locator('.sc2-check input').first().uncheck();
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 assert.equal(await page.locator('.sc2-check input').first().isChecked(),false);
 await page.screenshot({path:path.join(out,'ui-settings.png'),fullPage:true});
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 await page.getByRole('tab',{name:'Сайты сейчас',exact:true}).click();
 await page.locator('#sc2-live_sites').getByRole('button',{name:'Обновить',exact:true}).click();
 await page.evaluate(()=>window.pollTick());
 assert.equal(await page.locator('#sc2-live_sites tbody tr').count(),2);
 assert.ok((await page.locator('#sc2-live_sites .sc2-results').innerText()).includes('Ноутбук'));
 await page.screenshot({path:path.join(out,'ui-live-sites.png'),fullPage:true});
 await page.getByRole('tab',{name:'Соединения',exact:true}).click();
 await page.locator('#sc2-connections').getByRole('button',{name:'Обновить',exact:true}).click();
 await page.evaluate(()=>window.pollTick());
 assert.equal(await page.locator('#sc2-connections tbody tr').count(),3);
 assert.ok((await page.locator('#sc2-connections .sc2-results').innerText()).includes('[2001:db8::1]:443'));
 await page.screenshot({path:path.join(out,'ui-connections.png'),fullPage:true});
 await page.getByRole('tab',{name:'Диагностика',exact:true}).click();
 await page.getByRole('button',{name:'Запустить диагностику',exact:true}).click();
 await page.evaluate(()=>window.pollTick());
 assert.equal(await page.getByText('✅ ВСЁ ОК',{exact:true}).count(),1);
 assert.equal(await page.locator('.sc2-diagnostic-table tbody tr').count(),5);
 assert.ok((await page.locator('#sc2-diagnostics').innerText()).includes('713 мс'));
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
 await checkControls();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile horizontal overflow');
 await page.screenshot({path:path.join(out,'ui-mobile-light.png'),fullPage:true});
 for(const [tab,id] of [['Сайты сейчас','live_sites'],['Соединения','connections'],['Диагностика','diagnostics']]){
  await page.getByRole('tab',{name:tab,exact:true}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile overflow: '+tab);
  if(id==='diagnostics'){
   await page.getByRole('button',{name:'Запустить диагностику',exact:true}).click();await page.evaluate(()=>window.pollTick());
  }
  await page.screenshot({path:path.join(out,'ui-mobile-'+id+'.png'),fullPage:true});
 }
 await page.evaluate(async()=>{
  window.L.hasViewPermission=()=>false;
  document.querySelector('.sc2').replaceWith(window.viewInstance.render(await window.viewInstance.load()));
 });
 await page.getByRole('button',{name:'Настройки',exact:true}).click();
 assert.equal(await page.locator('.sc2-check input').first().isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'Сохранить',exact:true}).isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'Проверить сейчас',exact:true}).isDisabled(),true);
 assert.deepEqual(errors,[]);
 console.log('UI passed: filled active tabs, aligned controls, settings persistence, detailed diagnostics, live sites and connections, IPv6, mobile width, read-only mode. Screenshots saved.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
