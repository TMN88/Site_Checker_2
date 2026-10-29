'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var calls = {};
[
 ['get_config', []], ['save_config', ['config']], ['start_sites', []],
 ['start_diagnostics', []], ['start_live_sites', []], ['start_connections', []], ['job', ['kind']], ['cancel', ['kind']]
].forEach(function(def) {
 calls[def[0]] = rpc.declare({object:'site-checker2',method:def[0],params:def[1],expect:{}});
});
var errors = {
 busy:'Проверка уже выполняется.', invalid_config:'Проверь домены и параметры: до 32 сайтов, таймаут до 15 секунд, до 4 запросов одновременно.',
 no_application:'Podkop, Forkop или Forkozz не обнаружен.',
 application_incomplete:'Пакет найден, но его исполняемые файлы или библиотеки отсутствуют. Установка обходчика неполна.',
 multiple_applications:'Найдено несколько обходчиков. Диагностика остановлена: нужен единственный источник.',
 unsupported_netshift:'Отдельный NetShift не поддерживается как Forkozz. Нужна совместимая версия Forkozz в Zapret Manager.',
 route_unsupported:'Установленный обходчик не предоставляет поддерживаемый механизм анализа правил. Маршрут не определён.',
 native_route_failed:'Нативный анализ маршрута не завершился или вернул некорректный результат.',
 route_service_stopped:'Forkozz не работает или его состояние не подтверждено. Маршрут не определён.',
 invalid_target:'Введи домен, IPv4 или IPv6 без порта и пути.',
 config_invalid:'Конфигурация Site Checker 2.0 повреждена или отсутствует.',
 cancelled_or_failed:'Проверка отменена или завершилась с ошибкой.',
 cancelled:'Проверка отменена.',
 worker_failed:'Не удалось обработать результат проверки. Подробности находятся в журнале задания Site Checker.',
 jq_incompatible:'Установленный jq не поддерживает регулярные выражения. Обнови Site Checker до версии local.6 или новее; заменять jq не требуется.',
 worker_lost:'Процесс проверки не найден. Повтори запуск.',
 cannot_verify_worker:'Не удалось безопасно подтвердить процесс проверки.',
 state_error:'Не удалось подготовить временные файлы.',
 save_failed:'Не удалось сохранить настройки.'
};
errors.connections_unavailable='Не удалось прочитать текущие соединения sing-box. Проверь, что обходчик работает и его API соединений доступен.';
errors.connections_unsupported='Установленная версия обходчика не предоставляет поддерживаемый список соединений.';
var reason = {none:'—', dns_error:'Ошибка DNS',connect_error:'Нет соединения',timeout:'Истёк таймаут',
 tls_error:'Ошибка TLS',http_error:'HTTP-ошибка: результат неопределён',redirect_limit:'Слишком много переходов',
 network_error:'Сетевая ошибка',invalid_response:'Некорректный ответ',curl_missing:'curl не установлен'};
function notice(msg) { ui.addNotification(null,E('p',{},msg)); }
function errorMessage(r) {
 var msg=errors[r && r.error] || 'Не удалось выполнить операцию.';
 var names={podkop:'Podkop',forkop:'Forkop',forkozz:'Forkozz'};
 if(r && Array.isArray(r.applications))msg+=' ('+r.applications.map(function(a){return names[a]||a;}).join(', ')+')';
 return msg;
}
function checked(r) { if(!r || r.ok===false) throw new Error(errorMessage(r)); return r; }
function text(v) { return v == null || v === '' ? 'Не определено' : String(v); }

return view.extend({
 load:function() {
  return Promise.all([calls.get_config(),calls.job('sites'),calls.job('diagnostics')]);
 },
 render:function(data) {
  var self=this, config=checked(data[0]).config, active={}, outputs={}, buttons={}, checks=[];
  var canWrite=L.hasViewPermission();
  var root=E('div',{'class':'sc2'});
  root.appendChild(E('link',{rel:'stylesheet',href:L.resource('view/site-checker2/style.css')}));
  var title=E('div',{'class':'sc2-head'},[
   E('div',{},[E('h2',{},'Site Checker 2.0'),E('p',{},'Проверка сайтов и диагностика OpenWrt')]),
   E('button',{'class':'sc2-button',click:function(){
    var dark=root.getAttribute('data-theme')==='dark';
    root.setAttribute('data-theme',dark?'light':'dark');
    try {localStorage.setItem('site-checker2-theme',dark?'light':'dark');} catch(e){}
   }},'Сменить тему')
  ]);
  try { var theme=localStorage.getItem('site-checker2-theme'); if(theme)root.setAttribute('data-theme',theme); } catch(e){}
  root.appendChild(title);
  var tabs=E('div',{'class':'sc2-tabs',role:'tablist'}), panes={};
  root.appendChild(tabs);
  var appNames={podkop:'Podkop',forkop:'Forkop',forkozz:'Forkozz'};
  function trafficResult(kind,r,out) {
   out.appendChild(E('h3',{},appNames[r.application]||text(r.application)));
   out.appendChild(E('p',{'class':'sc2-muted'},'Снимок текущих соединений sing-box по нажатию кнопки. Это не история посещений и не проверка доступности.'));
   if(r.captured_at)out.appendChild(E('p',{'class':'sc2-muted'},'Получено: '+new Date(r.captured_at*1000).toLocaleString()+' · Соединений: '+text(r.total)));
   var groups=new Map();
   (r.conns||[]).forEach(function(c){
    var host=c.host||c.dst;if(!host)return;
    var key=JSON.stringify(kind==='live_sites'?[host,c.out]:[c.src,host,c.dport,c.proto,c.out]);
    if(!groups.has(key))groups.set(key,{c:c,n:0,devices:new Set()});
    var row=groups.get(key);row.n++;row.devices.add(c.dev?c.dev+' ('+c.src+')':c.src||'Не определено');
   });
   if(!groups.size){out.appendChild(E('p',{'class':'sc2-muted'},'Сейчас соединений нет. Открой сайт на устройстве и нажми «Обновить».'));return;}
   var table=E('table',{'class':'sc2-table sc2-traffic-table'}),body=E('tbody');
   var labels=kind==='live_sites'?['Сайт / IP','Устройства','Секция / выход','Соединений']:['Устройство','Назначение','Протокол','Секция / выход','Соединений'];
   table.appendChild(E('thead',{},E('tr',{},labels.map(function(l){return E('th',{},l);}))));
   groups.forEach(function(g){
    var c=g.c,dst=c.host||c.dst;
    if(kind==='connections'&&c.dport)dst=(!c.host&&dst.indexOf(':')>=0?'['+dst+']':dst)+':'+c.dport;
    var values=kind==='live_sites'?[c.host||c.dst,Array.from(g.devices).join(', '),c.out||'Напрямую',g.n]:[Array.from(g.devices).join(', '),dst,c.proto||'Не определено',c.out||'Напрямую',g.n];
    body.appendChild(E('tr',{},values.map(function(v,i){return E('td',{'data-label':labels[i]},String(v));})));
   });
   table.appendChild(body);out.appendChild(table);
   if(r.truncated)out.appendChild(E('p',{'class':'sc2-muted'},'Показана часть соединений: '+(r.conns||[]).length+' из '+text(r.total)+'.'));
  }
  function showResult(kind,r) {
   var out=outputs[kind]; out.replaceChildren();
   if(!r || r.state==='idle') {out.appendChild(E('p',{'class':'sc2-muted'},'Проверка ещё не запускалась.'));return;}
   if(r.ok===false) {out.appendChild(E('p',{'class':'sc2-error'},errorMessage(r)));return;}
   if(r.state==='running'||r.state==='cancelling') {
    out.appendChild(E('p',{'class':'sc2-muted'},r.state==='running'?'Проверка выполняется…':'Отмена проверки…'));return;
   }
   if(kind==='sites') {
    var table=E('table',{'class':'sc2-table'},[E('thead',{},E('tr',{},['Сайт','Статус','HTTP','Время','Причина'].map(function(t){return E('th',{},t);})))]);
    var tbody=E('tbody');
    (r.results||[]).forEach(function(row){
     var labels={available:'🟢 Доступен',unavailable:'🔴 Недоступен',error:'🟡 Неопределённо'};
     tbody.appendChild(E('tr',{},[
      E('td',{'data-label':'Сайт'},[E('strong',{},row.name),E('small',{},row.domain)]),
      E('td',{'data-label':'Статус'},labels[row.status]||'⚪ Не проверялся'),
      E('td',{'data-label':'HTTP'},row.http_code?String(row.http_code):'—'),
      E('td',{'data-label':'Время'},String(row.elapsed_ms||0)+' мс'),
      E('td',{'data-label':'Причина'},reason[row.reason]||'Ошибка проверки')
     ]));
    }); table.appendChild(tbody);out.appendChild(table);
    out.appendChild(E('p',{'class':'sc2-muted'},'Проверка идёт с роутера. Доступность главной страницы не гарантирует воспроизведение видео и работу всех функций сайта.'));
   } else if(kind==='diagnostics') {
    out.appendChild(E('h3',{},appNames[r.application]||text(r.application)));
    out.appendChild(E('p',{'class':'sc2-muted'},'Установлено: '+text(r.installed_version)+' · Последняя версия: '+text(r.latest_version)));
    if(r.diagnostic_status==='ok' && Array.isArray(r.issues) && !r.issues.length)
     out.appendChild(E('p',{'class':'sc2-success'},'✅ ВСЁ ОК'));
    else if(!Array.isArray(r.issues) || !r.issues.length) out.appendChild(E('p',{'class':'sc2-error'},'Не удалось подтвердить завершение обязательных проверок.'));
    else r.issues.forEach(function(i){
     out.appendChild(E('div',{'class':'sc2-issue'},[E('strong',{},(i.status==='error'?'🔴 ':'🟡 ')+i.message),E('p',{},i.recommendation)]));
    });
    if(Array.isArray(r.checks)&&r.checks.length){
     var details=E('table',{'class':'sc2-table sc2-diagnostic-table'}),rows=E('tbody');
     var heads=['Что проверялось','Результат','Полученные значения'];
     var states={ok:'🟢 В порядке',error:'🔴 Ошибка',warning:'🟡 Внимание',unknown:'⚪ Не подтверждено',info:'ℹ Сведения',not_applicable:'— Не применяется'};
     details.appendChild(E('thead',{},E('tr',{},heads.map(function(h){return E('th',{},h);}))));
     r.checks.forEach(function(c){rows.appendChild(E('tr',{},[
      E('td',{'data-label':heads[0]},[text(c.label),E('small',{},'Источник: '+text(c.source))]),
      E('td',{'data-label':heads[1]},states[c.status]||states.unknown),
      E('td',{'data-label':heads[2]},text(c.value))
     ]));});
     details.appendChild(rows);out.appendChild(details);
    }
   } else {
    trafficResult(kind,r,out);
   }
  }
  function running(kind,on) { active[kind]=on;buttons[kind].disabled=on||!canWrite; }
  function start(kind) {
   if(active[kind])return;
   running(kind,true);
   var action=calls['start_'+kind]();
   return action.then(checked).then(function(r){showResult(kind,r);}).catch(function(e){running(kind,false);notice(e.message);});
  }
  [['sites','Сайты','Проверить сейчас'],['diagnostics','Диагностика','Запустить диагностику'],['live_sites','Сайты сейчас','Обновить'],['connections','Соединения','Обновить']].forEach(function(def,index){
   var kind=def[0], pane=E('section',{'class':'sc2-panel',role:'tabpanel',id:'sc2-'+kind});
   panes[kind]=pane;pane.hidden=index!==0;
   var tab=E('button',{'class':'sc2-button',role:'tab','aria-controls':'sc2-'+kind,'aria-selected':String(index===0),click:function(){
    Object.keys(panes).forEach(function(k){panes[k].hidden=k!==kind;});
    Array.prototype.forEach.call(tabs.children,function(b){b.setAttribute('aria-selected',String(b===tab));});
   }},def[1]);tabs.appendChild(tab);
   var controls=E('div',{'class':'sc2-controls'});
   buttons[kind]=E('button',{'class':'sc2-button sc2-primary',disabled:!canWrite||null,click:function(){return start(kind);}},def[2]);
   controls.appendChild(buttons[kind]);
   controls.appendChild(E('button',{'class':'sc2-button',disabled:!canWrite||null,click:function(){
    return calls.cancel(kind).then(checked).then(function(r){showResult(kind,r);}).catch(function(e){notice(e.message);});
   }},'Отменить'));
   pane.appendChild(controls);
   outputs[kind]=E('div',{'class':'sc2-results','aria-live':'polite'});pane.appendChild(outputs[kind]);
   root.appendChild(pane);
   var initial=index<2?data[index+1]:{ok:true,state:'idle'};
   showResult(kind,initial);running(kind,initial.state==='running');
  });
  var settings=E('div',{'class':'sc2-settings',hidden:true});
  var toggle=E('button',{'class':'sc2-button',click:function(){settings.hidden=!settings.hidden;}},'Настройки');
  toggle.classList.add('sc2-settings-toggle');panes.sites.querySelector('.sc2-controls').appendChild(toggle);panes.sites.insertBefore(settings,outputs.sites);
  function renderSettings() {
   checks=[];settings.replaceChildren();
   config.sites.forEach(function(s){
    var box=E('input',{type:'checkbox',checked:s.enabled?true:null,disabled:!canWrite||null});
    checks.push(box);settings.appendChild(E('label',{'class':'sc2-check'},[box,' '+s.name+' · '+s.domain]));
   });
   var custom=E('textarea',{rows:3,placeholder:'Пользовательские домены — по одному в строке','aria-label':'Новые домены',disabled:!canWrite||null});
   settings.appendChild(custom);
   var inputs={};
   [['connect_timeout','Соединение, сек',1,10],['total_timeout','Вся проверка сайта, сек',1,15],['parallel','Одновременно',1,4]].forEach(function(d){
    inputs[d[0]]=E('input',{type:'number',min:d[2],max:d[3],value:config[d[0]],disabled:!canWrite||null});
    settings.appendChild(E('label',{'class':'sc2-field'},[d[1],inputs[d[0]]]));
   });
   var save=E('button',{'class':'sc2-button sc2-primary',disabled:!canWrite||null,click:function(){
    var next={sites:config.sites.map(function(s,i){return {name:s.name,domain:s.domain,enabled:checks[i].checked};})};
    custom.value.split(/\s+/).filter(Boolean).forEach(function(d){next.sites.push({name:d,domain:d.toLowerCase(),enabled:true});});
    Object.keys(inputs).forEach(function(k){next[k]=Number(inputs[k].value);});
    save.disabled=true;
    return calls.save_config(next).then(checked).then(function(r){
     config=r.config;renderSettings();settings.hidden=true;notice('Настройки сохранены.');
    }).catch(function(e){notice(e.message);}).finally(function(){save.disabled=!canWrite;});
   }},'Сохранить');
   settings.appendChild(save);
  }
  renderSettings();
  poll.add(function(){
   var kinds=Object.keys(active).filter(function(k){return active[k];});
   return Promise.all(kinds.map(function(kind){
    return calls.job(kind).then(function(r){
     showResult(kind,r);
     if(r.state!=='running'&&r.state!=='cancelling')running(kind,false);
    }).catch(function(e){running(kind,false);notice('Не удалось получить результат: '+e.message);});
   }));
  },2);
  return root;
 },
 handleSaveApply:null,
 handleSave:null,
 handleReset:null
});
