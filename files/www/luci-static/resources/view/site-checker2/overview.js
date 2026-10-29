'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var calls = {};
[
 ['get_config', []], ['save_config', ['config']], ['start_sites', []],
 ['start_diagnostics', []], ['start_route', ['target']], ['job', ['kind']], ['cancel', ['kind']]
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
 worker_lost:'Процесс проверки не найден. Повтори запуск.',
 cannot_verify_worker:'Не удалось безопасно подтвердить процесс проверки.',
 state_error:'Не удалось подготовить временные файлы.',
 save_failed:'Не удалось сохранить настройки.'
};
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
  return Promise.all([calls.get_config(),calls.job('sites'),calls.job('diagnostics'),calls.job('route')]);
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
  var tabs=E('div',{'class':'sc2-tabs',role:'tablist'}), panes={}, shortcuts=E('div',{'class':'sc2-shortcuts'});
  root.appendChild(tabs);
  var target=E('input',{type:'text',placeholder:'youtube.com или IP-адрес',maxlength:253,'aria-label':'Назначение'});
  function quickButtons() {
   shortcuts.replaceChildren();
   config.sites.filter(function(s){return s.enabled;}).forEach(function(s){
    shortcuts.appendChild(E('button',{'class':'sc2-button',click:function(){target.value=s.domain;target.focus();}},s.name));
   });
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
    out.appendChild(E('h3',{},text(r.application)));
    out.appendChild(E('p',{'class':'sc2-muted'},'Установлено: '+text(r.installed_version)+' · Последняя версия: '+text(r.latest_version)));
    if(r.diagnostic_status==='ok' && Array.isArray(r.issues) && !r.issues.length)
     out.appendChild(E('p',{'class':'sc2-success'},'✅ ВСЁ ОК'));
    else if(!Array.isArray(r.issues) || !r.issues.length) out.appendChild(E('p',{'class':'sc2-error'},'Не удалось подтвердить завершение обязательных проверок.'));
    else r.issues.forEach(function(i){
     out.appendChild(E('div',{'class':'sc2-issue'},[E('strong',{},(i.status==='error'?'🔴 ':'🟡 ')+i.message),E('p',{},i.recommendation)]));
    });
   } else {
    if(r.application)out.appendChild(E('h3',{},({podkop:'Podkop',forkop:'Forkop',forkozz:'Forkozz'})[r.application]||r.application));
    out.appendChild(E('p',{'class':'sc2-muted'},'Предполагаемый маршрут по правилам. Фактическое прохождение трафика не подтверждено.'));
    var exits={vpn:'Через настроенный VPN / туннель',direct:'Напрямую через основной маршрут',blocked:'Заблокировано правилом',unknown:'Не определено'};
    [['Назначение',r.target],['Предполагаемый выход',exits[r.presumed_exit]||'Не определено'],['Выход из правила',r.outbound],['Правило',r.matched_rule],['Секция',r.matched_section],['Причина',r.reason]].forEach(function(pair){
     out.appendChild(E('p',{},[E('strong',{},pair[0]+': '),text(pair[1])]));
    });
   }
  }
  function running(kind,on) { active[kind]=on;buttons[kind].disabled=on||!canWrite; }
  function start(kind) {
   if(active[kind])return;
   running(kind,true);
   var action=kind==='route'?calls.start_route(target.value.trim()):calls['start_'+kind]();
   return action.then(checked).then(function(r){showResult(kind,r);}).catch(function(e){running(kind,false);notice(e.message);});
  }
  [['sites','Сайты','Проверить сейчас'],['diagnostics','Диагностика','Запустить диагностику'],['route','Куда пойдёт запрос','Проверить']].forEach(function(def,index){
   var kind=def[0], pane=E('section',{'class':'sc2-panel',role:'tabpanel',id:'sc2-'+kind});
   panes[kind]=pane;pane.hidden=index!==0;
   var tab=E('button',{'class':'sc2-button',role:'tab','aria-controls':'sc2-'+kind,'aria-selected':String(index===0),click:function(){
    Object.keys(panes).forEach(function(k){panes[k].hidden=k!==kind;});
    Array.prototype.forEach.call(tabs.children,function(b){b.setAttribute('aria-selected',String(b===tab));});
   }},def[1]);tabs.appendChild(tab);
   var controls=E('div',{'class':'sc2-controls'});
   if(kind==='route') controls.appendChild(target);
   buttons[kind]=E('button',{'class':'sc2-button sc2-primary',disabled:!canWrite||null,click:function(){return start(kind);}},def[2]);
   controls.appendChild(buttons[kind]);
   controls.appendChild(E('button',{'class':'sc2-button',disabled:!canWrite||null,click:function(){
    return calls.cancel(kind).then(checked).then(function(r){showResult(kind,r);}).catch(function(e){notice(e.message);});
   }},'Отменить'));
   pane.appendChild(controls);
   if(kind==='route')pane.appendChild(shortcuts);
   outputs[kind]=E('div',{'class':'sc2-results','aria-live':'polite'});pane.appendChild(outputs[kind]);
   root.appendChild(pane);
   showResult(kind,data[index+1]);running(kind,data[index+1].state==='running');
  });
  var settings=E('div',{'class':'sc2-settings',hidden:true});
  var toggle=E('button',{'class':'sc2-button',click:function(){settings.hidden=!settings.hidden;}},'Настройки');
  panes.sites.insertBefore(toggle,outputs.sites);panes.sites.insertBefore(settings,outputs.sites);
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
     config=r.config;renderSettings();quickButtons();settings.hidden=true;notice('Настройки сохранены.');
    }).catch(function(e){notice(e.message);}).finally(function(){save.disabled=!canWrite;});
   }},'Сохранить');
   settings.appendChild(save);
  }
  renderSettings();quickButtons();
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
