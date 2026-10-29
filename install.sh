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
echo 'db44ae010957828c6205283f52e4c0af5d8b4582fb9615d2b191c06e7943b0ad  '"$stage/payload.tar.gz" | sha256sum -c - >/dev/null || { echo 'Контрольная сумма не совпала.' >&2; exit 1; }
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
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
AA==
