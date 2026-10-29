#!/bin/sh
# Site Checker 2.0 local testing build. Payload is embedded, not fetched at runtime.
set -eu
umask 077
[ "$(id -u)" -eq 0 ] || { echo 'Нужны права root.' >&2; exit 1; }
[ -f /etc/openwrt_release ] || { echo 'Это не OpenWrt.' >&2; exit 1; }
. /etc/openwrt_release
case "$DISTRIB_RELEASE" in 24.10.*|25.12.*) ;; *) echo 'Поддерживаются OpenWrt 24.10.x и 25.12.x.' >&2; exit 1 ;; esac
for kind in sites diagnostics route; do
    [ ! -d "/tmp/site-checker2/$kind/lock" ] || { echo 'Сначала отмени активные проверки Site Checker 2.0.' >&2; exit 1; }
done
echo "OpenWrt $DISTRIB_RELEASE · $(uname -m)"
command -v sha256sum >/dev/null || { echo 'Нужна sha256sum.' >&2; exit 1; }
command -v base64 >/dev/null || { echo 'Нужна base64.' >&2; exit 1; }
stage=$(mktemp -d /tmp/site-checker2-install.XXXXXX)
# Keep installation and backup files on failure for inspection.
trap 'echo "Временные файлы установки: $stage"' EXIT
sed '1,/^__SITE_CHECKER2_PAYLOAD__$/d' "$0" | base64 -d > "$stage/payload.tar.gz"
echo '1dd625590c531824a875af855783600d0d8adede58edaf0524f1540f80afd924  '"$stage/payload.tar.gz" | sha256sum -c - >/dev/null || { echo 'Контрольная сумма не совпала.' >&2; exit 1; }
tar -xzf "$stage/payload.tar.gz" -C "$stage"
echo 'Проверяем зависимости.'
deps=""
command -v curl >/dev/null || deps="$deps curl"
command -v jq >/dev/null || deps="$deps jq"
command -v setsid >/dev/null || deps="$deps setsid"
command -v rpcd >/dev/null || [ -x /sbin/rpcd ] || deps="$deps rpcd"
[ -d /usr/share/luci ] || deps="$deps luci-base"
[ -f /etc/ssl/certs/ca-certificates.crt ] || deps="$deps ca-bundle"
# v2 needs these independently of a package-managed v1; keep them installed on apk del.
if command -v apk >/dev/null 2>&1 && apk info -e luci-app-sitecheck >/dev/null 2>&1; then
    deps="$deps luci-base curl"
fi
if [ -n "$deps" ]; then
    if command -v apk >/dev/null; then apk add $deps
    elif command -v opkg >/dev/null; then opkg update; opkg install $deps
    else echo 'Не найден apk/opkg.' >&2; exit 1; fi
fi
if [ -f /etc/site-checker2/config.json ]; then
    jq -e -f "$stage/files/usr/share/site-checker2/validate.jq" /etc/site-checker2/config.json >/dev/null || {
        echo 'Существующая конфигурация повреждена. Она сохранена без изменений.' >&2; exit 1;
    }
fi
# Save only this application's owned files. Never touch router/VPN configuration.
backup="/root/site-checker2-backup-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$backup/files"
: > "$backup/previous"
: > "$backup/created"
legacy="$stage/files/usr/libexec/site-checker2-legacy"
sh "$legacy" snapshot "$backup/legacy-v1"
new_config=1
[ ! -f /etc/site-checker2/config.json ] || new_config=0
rollback() {
    set +e
    echo "Ошибка установки. Возвращаем прежние файлы; резервная копия: $backup" >&2
    while IFS= read -r rel; do cp -p "$backup/files/$rel" "/$rel"; done < "$backup/previous"
    while IFS= read -r rel; do rm -f "/$rel"; done < "$backup/created"
    if [ -f "$backup/legacy-v1/retiring" ]; then sh "$legacy" restore "$backup/legacy-v1"; fi
    /etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
trap 'rc=$?; if [ "$rc" -ne 0 ]; then rollback; fi; echo "Временные файлы: $stage"' EXIT
trap 'exit 1' HUP INT TERM
while IFS= read -r rel; do
    case "$rel" in
        usr/libexec/site-checker2|usr/libexec/site-checker2-probe|usr/libexec/site-checker2-bounded|usr/libexec/site-checker2-target|usr/libexec/site-checker2-legacy|usr/libexec/site-checker2-uninstall|usr/libexec/rpcd/site-checker2|usr/share/site-checker2/*|usr/share/luci/menu.d/luci-app-site-checker2.json|usr/share/rpcd/acl.d/luci-app-site-checker2.json|www/luci-static/resources/view/site-checker2/*|etc/site-checker2/config.json) ;;
        *) echo "Небезопасный путь: $rel" >&2; exit 1 ;;
    esac
    if [ "$rel" = etc/site-checker2/config.json ] && [ -f "/$rel" ]; then continue; fi
    if [ -f "/$rel" ]; then
        mkdir -p "$backup/files/$(dirname "$rel")"
        cp -p "/$rel" "$backup/files/$rel"
        printf '%s\n' "$rel" >> "$backup/previous"
    else printf '%s\n' "$rel" >> "$backup/created"; fi
    case "$rel" in
        etc/site-checker2/config.json) mkdir -p "/$(dirname "$rel")" ;;
        *) (umask 022; mkdir -p "/$(dirname "$rel")") ;;
    esac
    cp "$stage/files/$rel" "/$rel"
    case "$rel" in
        etc/site-checker2/config.json) chmod 600 "/$rel" ;;
        usr/libexec/*) chmod 755 "/$rel" ;;
        *) chmod 644 "/$rel" ;;
    esac
    expected=$(sha256sum "$stage/files/$rel"); actual=$(sha256sum "/$rel")
    [ "${expected%% *}" = "${actual%% *}" ] || { echo "Не прошла проверка файла $rel" >&2; exit 1; }
done < "$stage/manifest"
# Repair app directories left at 0700 by versions local.1/local.2.
# Never change permissions recursively or expose /etc/site-checker2.
chmod 755 /www/luci-static/resources/view/site-checker2 /usr/share/site-checker2
chmod 755 /usr/libexec/site-checker2 /usr/libexec/site-checker2-probe /usr/libexec/site-checker2-bounded /usr/libexec/site-checker2-target /usr/libexec/site-checker2-legacy /usr/libexec/site-checker2-uninstall /usr/libexec/rpcd/site-checker2
if [ "$new_config" -eq 1 ]; then
    sh "$legacy" import "$backup/legacy-v1" "" /etc/site-checker2/config.json "$stage/files/usr/share/site-checker2/validate.jq"
fi
chmod 700 /etc/site-checker2
chmod 600 /etc/site-checker2/config.json
/usr/libexec/site-checker2 get_config | jq -e '.ok == true' >/dev/null
/etc/init.d/rpcd reload
ready=0
for attempt in 1 2 3; do
    if ubus -S list site-checker2 2>/dev/null | grep -qx site-checker2; then ready=1; break; fi
    sleep 1
done
[ "$ready" -eq 1 ] || { echo 'RPC Site Checker 2.0 не зарегистрирован.' >&2; exit 1; }
# Retire v1 only after v2's files, configuration and RPC have passed validation.
sh "$legacy" retire "$backup/legacy-v1"
# LuCI's generated menu cache is safe to regenerate.
rm -f /tmp/luci-indexcache /tmp/luci-indexcache.*
for cache in /tmp/luci-modulecache/*sitecheck*; do [ ! -f "$cache" ] || rm -f "$cache"; done
echo 'Установлено: LuCI → Службы → Site Checker 2.0'
echo "Резервная копия собственных файлов: $backup"
echo 'Роутер не перезагружался. VPN, DNS, firewall и обходчики не изменялись.'
exit 0
__SITE_CHECKER2_PAYLOAD__
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
