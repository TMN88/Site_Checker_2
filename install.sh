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
echo '35122ae1da7cdc77fa59bb0f964eac106f005123b6f33bb4269b007bef97a8ee  '"$stage/payload.tar.gz" | sha256sum -c - >/dev/null || { echo 'Контрольная сумма не совпала.' >&2; exit 1; }
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
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
PqfPv43n/wEAHHm/ABgBAA==
