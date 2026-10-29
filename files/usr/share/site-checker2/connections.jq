# Explicit projection: never return controller credentials, URLs or raw configuration.
def clean($n): if type=="string" or type=="number" then tostring | explode | map(select(.>=32 and .!=127)) | implode | (ascii_downcase) as $low | if ($low | contains("://") or contains("bearer ") or contains("private") or contains("password") or contains("secret")) then "[скрыто]" else .[0:$n] end else "" end;
(if $app=="forkop" then
   if (.status|type)=="number" and .status>=200 and .status<300 then
     if (.body|type)=="string" then (try (.body|fromjson) catch null) else .value end
   else null end
 else . end) as $payload |
(if ($payload|type)!="object" then null elif $app=="forkozz" then $payload.conns else $payload.connections end) as $items |
if ($items|type)!="array" then {ok:false,error:"connections_unavailable",applications:[$app]}
else
($items | length) as $size |
{ok:true,state:"done",application:$app,source:"native_connections",captured_at:(now|floor),
 total:(if $app=="forkozz" and ($payload.total|type)=="number" then ([$size,$payload.total]|max) else $size end),
 truncated:($size>150 or $payload.truncated==true or (($payload.total|type)=="number" and $payload.total>$size)),
 conns:[$items[0:150][] | select(type=="object") |
   if $app=="forkozz" then
     {src:(.src|clean(64)),dev:(.dev|clean(64)),dst:(.dst|clean(64)),host:(.host|clean(253)),dport:(.dport|clean(8)),proto:(.proto|clean(16)),out:(.out|clean(96)),rule:(.rule|clean(96))}
   else
     (.metadata | if type=="object" then . else {} end) as $m | (.chains // [] | if type=="array" then . else [] end) as $chain |
     ($chain[-1] // "" | clean(96)) as $out |
     {src:($m.sourceIP|clean(64)),dev:"",dst:($m.destinationIP|clean(64)),host:($m.host|clean(253)),dport:($m.destinationPort|clean(8)),proto:($m.network|clean(16)),
      out:(if $out=="direct" or $out=="direct-out" then "" elif $out=="" then "Не определено" else $out end),rule:(.rule|clean(96))}
   end]}
end
