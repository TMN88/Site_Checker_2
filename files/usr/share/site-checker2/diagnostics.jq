def issue($component;$state;$message;$recommendation):
 {component:$component,status:$state,message:$message,recommendation:$recommendation};
def flag: if . == true or . == 1 then true elif . == false or . == 0 then false else null end;
def health($v): if $v == true then "ok" elif $v == false then "error" else "unknown" end;
def display: if type=="string" or type=="number" then tostring | gsub("[\u0000-\u001f\u007f]";" ") | if test("://|(?i)bearer |private.?key|password|secret") then "[адрес или секрет скрыт]" else .[0:512] end else "не определено" end;
def yesno: flag | if .==true then "да" elif .==false then "нет" else "не определено" end;
def detail($label;$status;$value;$source): {label:$label,status:$status,value:$value,source:$source};
def array: if type=="array" then . else [] end;
def version_value:
 if type=="string" and length>0 and length<=80 and
  (explode | all(.==43 or .==45 or .==46 or .==95 or (.>=48 and .<=57) or (.>=65 and .<=90) or (.>=97 and .<=122))) then . else null end;
def version_parts:
  if type != "string" then null else
  ltrimstr("v") | split(".") |
  if length == 3 and all(length>0 and (explode | all(.>=48 and .<=57)))
  then map(tonumber) else null end end;
$system[0] as $s | $service[0] as $r | $dns[0] as $d | $fakeip[0] as $f |
(if $app=="forkop" then $s.forkop_version elif $app=="podkop" then $s.podkop_version else $s.netshift_version end | version_value) as $installed |
($latest[0].tag_name // $s.podkop_latest_version // $s.netshift_latest_version // null | version_value) as $new |
($installed | version_parts) as $iv | ($new | version_parts) as $nv |
(if $iv==null or $nv==null then "unknown" elif $iv < $nv then "available" elif $iv == $nv then "current" else "newer_or_custom" end) as $update |
($r.running | flag) as $running |
(if $app=="forkop" then
  if ($d.main.answered|type)=="boolean" and ($d.local.answered|type)=="boolean"
  then ($d.main.answered and $d.local.answered and ($d.bootstrap==null or $d.bootstrap.answered==true)) else null end
else
  if ($d.dns_status|flag)==null or ($d.dns_on_router|flag)==null or ($d.dhcp_config_status|flag)==null
  then null else (($d.dns_status|flag) and ($d.dns_on_router|flag) and ($d.dhcp_config_status|flag)) end
end) as $dns_ok |
(if $app=="forkop" then
   if $f.router.excluded==true then "not_applicable"
   elif $f.router.answered!=true then "unknown"
   elif ($f.router.dns_fakeip|type)=="boolean" then health($f.router.dns_fakeip and $f.router.fakeip==true)
   else "unknown" end
 else
   # A failed external FakeIP endpoint alone cannot establish a mode mismatch.
   if $f.fakeip==true then "ok" else "unknown" end
 end) as $fake |
[
 if $running==false then issue("service";"error";"Служба не работает";"Открой диагностику установленного обходчика и проверь его журнал.")
 elif $running==null then issue("service";"unknown";"Не удалось определить состояние службы";"Проверь версию и доступность нативной команды диагностики.") else empty end,
 if $dns_ok==false then issue("dns";"error";"Родная диагностика обнаружила проблему DNS";"Проверь раздел DNS в установленном обходчике.")
 elif $dns_ok==null then issue("dns";"unknown";"Проверка DNS не завершена";"Повтори проверку и проверь родную диагностику.") else empty end,
 if $fake=="error" then issue("fakeip";"error";"Родная диагностика обнаружила проблему FakeIP";"Проверь режим DNS и исключения обходчика.")
 elif $fake=="unknown" then issue("fakeip";"unknown";"Работу FakeIP подтвердить не удалось";"Проверь режим приложения; выключенный необязательный FakeIP не считается ошибкой.") else empty end,
 if $update=="available" then issue("version";"warning";"Доступно обновление приложения";"Обнови приложение самостоятельно после проверки совместимости.")
 elif $update=="unknown" then issue("version";"unknown";"Актуальность версии не подтверждена";"Проверь доступ к источнику обновлений или особенности установленной сборки.") else empty end,
 if ($missing|length)>0 then issue("diagnostics";"unknown";"Часть нативных команд не завершилась или вернула неверный JSON";"Проверь установленную версию обходчика и повтори диагностику.") else empty end,
 if $app=="forkop" and (($r.conflicts // [] | length)>0 or ($r.foreign_sing_box // [] | length)>0 or $r.core.installed==false or ($r.core.problem // "")!="")
 then issue("native";"error";"Родная диагностика обнаружила конфликт или проблему ядра";"Открой вкладку диагностики Forkop для подробностей.") else empty end,
 if $app=="forkop" and (($r.core.installed|type)!="boolean" or ($r.conflicts|type)!="array" or ($r.foreign_sing_box|type)!="array" or ($servers[0].items|type)!="array")
 then issue("native";"unknown";"Ответ диагностики Forkop неполон";"Проверь поддержку установленной версии.") else empty end,
 if $app=="forkop" and ($r.memory.total_kb // 0)>0 and ($r.memory.available_kb // 0)<($r.memory.total_kb*0.1)
 then issue("memory";"warning";"Родная диагностика сообщает о нехватке памяти";"Проверь нагрузку и объём списков в Forkop.") else empty end,
 if $app=="forkop" then
  ($servers[0].items | if type=="array" then . else [] end | to_entries[] | .key as $n | .value |
   if .runtime==false or (.protocol=="tailscale" and (.state!="Running" or .connected!=true or .key_expired==true)) or
     (.protocol!="tailscale" and (.listening==false or ((.owners // "")!="") or (.exposed==true and .open_firewall==true and .firewall_open==false)))
   then issue("server";"error";("Сервер №"+(($n+1)|tostring)+": нативная диагностика сообщает о проблеме");"Открой диагностику серверов Forkop и проверь соответствующую строку.")
   elif (.runtime|type)!="boolean" or (.protocol!="tailscale" and (.listening|type)!="boolean")
   then issue("server";"unknown";("Сервер №"+(($n+1)|tostring)+": проверка неполна");"Проверь поддержку версии в нативной диагностике.")
   else empty end)
 else empty end,
 if $app=="forkozz" and (($panel[0].checks|type)!="array" or (["Служба Forkozz","sing-box","DNS роутера","FakeIP"] - [$panel[0].checks[]?.what] | length)>0)
 then issue("native";"unknown";"Диагностика панели Forkozz недоступна";"Проверь версию Zapret Manager.")
 else empty end,
 if $app=="forkozz" then
  (($panel[0].checks|array) + ($panel[0].extra|array) | .[] | select(.verdict!="ok") |
   (if .what=="Служба Forkozz" or .what=="sing-box" or .what=="DNS роутера" or .what=="FakeIP" or .what=="Защита от утечек" then .what else "Секция Forkozz" end) as $title |
   issue("native";(if .verdict=="fail" then "error" elif .verdict=="warn" then "warning" else "unknown" end);($title+": обнаружен недочёт");"Открой этот пункт в диагностике Forkozz и выполни его родную рекомендацию."))
 else empty end
] as $issues |
{ok:true,state:"done",application:$app,installed_version:$installed,latest_version:$new,
 update_status:$update,service_status:health($running),dns_status:health($dns_ok),fakeip_status:$fake,
 diagnostic_status:(if ($issues|length)==0 then "ok" else "issues" end),
 issues:$issues,
 checks:[
   detail("Установленная версия";"info";($installed // "не определено");"get_system_info"),
   detail("Последняя версия"; (if $update=="available" then "warning" elif $update=="unknown" then "unknown" else "ok" end);($new // "не определено");"GitHub Releases"),
   if $app=="forkozz" then
     (($panel[0].checks|array) + ($panel[0].extra|array) | .[0:40][] | select(type=="object") |
      detail((.what|display);(if .verdict=="ok" then "ok" elif .verdict=="fail" then "error" elif .verdict=="warn" then "warning" else "unknown" end);(.why|display);"Forkozz · diag"))
   else
     detail("Служба / sing-box";health($running);("Работает: "+($running|yesno));(if $app=="forkop" then "check_service" else "get_sing_box_status" end)),
     if $app=="forkop" then
       detail("Ядро sing-box"; (if $r.core.installed==true then "info" else "unknown" end);("Установлено: "+($r.core.installed|yesno)+" · версия: "+($r.core.version|display)+" · требуется: "+($r.core.required|display));"check_service"),
       detail("DNS обходчика";health($d.main.answered|flag);("Серверы: "+($d.main.servers|display)+" · ответ: "+($d.main.status|display)+" · время: "+($d.main.ms|display)+" мс");"check_dns"),
       detail("DNS роутера";health($d.local.answered|flag);("Ответ: "+($d.local.status|display)+" · время: "+($d.local.ms|display)+" мс");"check_dns"),
       if $d.bootstrap!=null then detail("Bootstrap DNS";health($d.bootstrap.answered|flag);("Серверы: "+($d.bootstrap.servers|display)+" · ответ получен: "+($d.bootstrap.answered|yesno)+" · время: "+($d.bootstrap.ms|display)+" мс");"check_dns") else empty end,
       detail("FakeIP";$fake;("Роутер исключён: "+($f.router.excluded|yesno)+" · DNS FakeIP: "+($f.router.dns_fakeip|yesno)+" · тестовый ответ: "+($f.router.fakeip|yesno)+" · IP: "+($f.router.ip|display));"check_traffic"),
       if ($r.memory.available_kb|type)=="number" then detail("Память";"info";("Доступно: "+($r.memory.available_kb|tostring)+" КБ из "+($r.memory.total_kb|display));"check_service") else empty end,
       ($servers[0].items // [] | .[0:24][] | detail("Сервер / входящее подключение";(if .runtime==true then "info" else "unknown" end);("Протокол: "+(.protocol|display)+" · runtime: "+(.runtime|yesno)+" · порт слушает: "+(.listening|yesno));"check_servers"))
     else
       detail("DNS-сервер";health($d.dns_status|flag);(($d.dns_server|display)+" · тип: "+($d.dns_type|display)+" · отвечает: "+($d.dns_status|yesno));"check_dns_available"),
       detail("DNS роутера / DHCP";health($dns_ok);("DNS через обходчик: "+($d.dns_on_router|yesno)+" · DHCP настроен: "+($d.dhcp_config_status|yesno));"check_dns_available"),
       detail("Bootstrap DNS";health($d.bootstrap_dns_status|flag);(($d.bootstrap_dns_server|display)+" · отвечает: "+($d.bootstrap_dns_status|yesno));"check_dns_available"),
       detail("FakeIP";$fake;("Подтверждён: "+($f.fakeip|yesno)+" · IP: "+($f.IP|display));"check_fakeip")
     end
   end
 ],source:"native",version_source:"native_or_github_release",
 note:"Сетевые настройки не изменялись. Успех показывается только при завершённых применимых проверках."}
