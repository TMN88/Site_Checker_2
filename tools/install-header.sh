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
echo '@PAYLOAD_SHA@  '"$stage/payload.tar.gz" | sha256sum -c - >/dev/null || { echo 'Контрольная сумма не совпала.' >&2; exit 1; }
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
backup="$stage/rollback-v2"
mkdir -p "$backup/files"
: > "$backup/previous"
: > "$backup/created"
legacy="$stage/files/usr/libexec/site-checker2-legacy"
sh "$legacy" plan "$stage/legacy-plan"
v2_ready=0
rollback() {
    set +e
    echo "Ошибка установки. Возвращаем прежние файлы; резервная копия: $backup" >&2
    while IFS= read -r rel; do cp -p "$backup/files/$rel" "/$rel"; done < "$backup/previous"
    while IFS= read -r rel; do rm -f "/$rel"; done < "$backup/created"
    /etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
finish() {
    rc=$?
    if [ "$rc" -ne 0 ]; then
        if [ "$v2_ready" -eq 0 ]; then rollback
        else echo 'Версия 2 установлена. Удаление первой версии не завершилось; проверь ошибку выше.' >&2; fi
    fi
    echo "Временные файлы: $stage"
}
trap finish EXIT
trap 'exit 1' HUP INT TERM
while IFS= read -r rel; do
    case "$rel" in
        usr/libexec/site-checker2|usr/libexec/site-checker2-probe|usr/libexec/site-checker2-bounded|usr/libexec/site-checker2-target|usr/libexec/site-checker2-detect|usr/libexec/site-checker2-legacy|usr/libexec/site-checker2-uninstall|usr/libexec/rpcd/site-checker2|usr/share/site-checker2/*|usr/share/luci/menu.d/luci-app-site-checker2.json|usr/share/rpcd/acl.d/luci-app-site-checker2.json|www/luci-static/resources/view/site-checker2/*|etc/site-checker2/config.json) ;;
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
chmod 755 /usr/libexec/site-checker2 /usr/libexec/site-checker2-probe /usr/libexec/site-checker2-bounded /usr/libexec/site-checker2-target /usr/libexec/site-checker2-detect /usr/libexec/site-checker2-legacy /usr/libexec/site-checker2-uninstall /usr/libexec/rpcd/site-checker2
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
v2_ready=1
sh "$legacy" retire "$stage/legacy-plan"
# LuCI's generated menu cache is safe to regenerate.
rm -f /tmp/luci-indexcache /tmp/luci-indexcache.*
for cache in /tmp/luci-modulecache/*sitecheck*; do [ ! -f "$cache" ] || rm -f "$cache"; done
echo 'Установлено: LuCI → Службы → Site Checker 2.0'
echo "Резервная копия собственных файлов: $backup"
echo 'Роутер не перезагружался. VPN, DNS, firewall и обходчики не изменялись.'
exit 0
__SITE_CHECKER2_PAYLOAD__
