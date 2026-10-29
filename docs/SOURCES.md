# Исходные проекты и решения

## Дополнение после реализации 2.0.0-local.1

Предыдущие разделы ниже сохраняют первоначальный анализ. Текущая реализация теперь включает пул проверок, LuCI/RPC, нативные адаптеры и установщик. Состояние описано в README.md и VALIDATION.md.

Анализатор Forkozz не скопирован: вызываются только diag/route установленного netshift.uc. Изучены cmd_diag (30744), srs_hit (30937), where_scan и cmd_route (31019) исходного ZapretManager_LuCI.sh. Анализ читает конфигурацию, DNS и rule-set; может обновлять собственный временный кеш наборов в /tmp, но не сетевые настройки.

cidr_hit (28520) в изученной версии реализован через ip4n и не поддерживает IPv6 CIDR. В нашем результате для IPv6 выход поэтому остаётся unknown. Проверена также схема shell-плагинов rpcd по upstream https://github.com/openwrt/rpcd/blob/master/plugin.c и exec.c: сигнатура параметра config как JSON object поддерживается, stdin закрывается после передачи JSON, что позволяет ограниченное чтение через head.

Выбор сайтов теперь хранится в /etc/site-checker2/config.json. Первоначальный files/etc/config/site_checker2 оставлен как сохранённый ранний эскиз и не включается в установщик. Для GitHub Content используется реальный URL raw.githubusercontent.com из upstream.

Исходники проверки и интерфейса написаны отдельно; условия собственных файлов указаны в LICENSE, внешние источники — в THIRD_PARTY.md. Полный перенос стороннего анализатора не заявляется.

Дата анализа: 2026-10-29. Команды сторонних проектов изучались как данные и не запускались.

| Проект | Зафиксированный commit | Изученный участок |
|---|---|---|
| TMN88/Site_Checker | ed1e31ac4e5e8fa662532b58bf7fb6dbf89375b7 | files/controller/sitecheck.lua, sitecheck-check-zapret, sitecheck.conf, README |
| StressOzz/Zapret-Manager | 302b0e46710bd8096f4c299c37cb0162e76c4445 | ZapretManager_LuCI.sh: _test_prepare_urls (7298), _si_sites (26508), forkop_status (23045), fk_route_check (25847) |
| itdoginfo/podkop | c654bf5da75309754e3fb63b9441981db65fff68 | podkop/files/usr/bin/podkop: check_dns_available, check_fakeip, CLI dispatcher |
| ushan0v/forkop | 9544f3de09c62c935e1147147136234594d04f02 | forkop/files/usr/lib/service/cli.uc, diagnostics/runtime.uc, docs/troubleshooting/diagnostics.md |
| yandexru45/netshift | 23d14fbae049dbf40a1f125e33e1957f07261d65 | netshift/files/usr/bin/netshift: команды check_dns_available, check_fakeip, support_report, global_check |
| TMN88/youtube-watchdog | 84b1a043a87e793e4aacdc78828fa130617f4e9b | files/overview.js: цвета и компоновка, LICENSE |

## Проверка сайтов

Исходная версия имеет два разных механизма и Lua-контроллер. Автоопрос первой версии переносить нельзя: новое ТЗ требует исключительно ручного запуска. Настройки старой второй таблицы сохранялись в браузере: полноценная автоматическая миграция потребует работы интерфейса, а не только чтения UCI.

_si_sites использует curl и пакетный параллелизм по 10 запросов. Новая реализация пока содержит только одиночный probe, сохраняющий профиль запроса. Дополнительно возвращаются HTTP-код, время и причина ошибки. Исходный код стороннего скрипта в проект не копировался.

_test_prepare_urls указывает для GitHub Content рабочий URL raw.githubusercontent.com со скриптом проекта. В начальной конфигурации пока сохранён домен из ТЗ githubusercontent.com; окончательный URL проверки нужно согласовать с моделью domain/url, поскольку корневой домен может не предоставлять успешную страницу.

## Диагностика

Forkop 2.0 использует собственное ядро sing-box-forkop и ucode. Реальные JSON-команды: check_service, check_dns, check_traffic, check_servers, get_status, get_system_info. Нельзя считать его старой копией shell-интерфейса Podkop. Название Forcop из ТЗ трактуется как Forkop; имя пакета/службы — forkop.

Podkop предоставляет check_dns_available, check_fakeip, get_status, get_system_info. check_fakeip делает внешний HTTPS-запрос и требует проверки полноты ответа. Неудача запроса должна означать неизвестный результат, а не успешную диагностику.

Forkozz в Zapret Manager построен на yandexru45/netshift. Признаки _fk_installed: /usr/bin/netshift и /usr/lib/netshift/constants.sh. Отдельно установленный NetShift необходимо отличать от управляемого панелью Forkozz через _fk_foreign/_fk_ours; одного имени бинарника недостаточно.

Нельзя запускать или source всего backend.sh либо установщика: рядом с диагностикой есть функции установки, удаления, исправлений и перезапуска. Будущие адаптеры должны вызывать только проверенные команды из фиксированного разрешённого списка с таймаутом. Полный отчёт с конфигурациями не должен попадать в интерфейс без фильтрации секретов.

## Анализ маршрута

fk_route_check использует DNS, FakeIP, nft-наборы netshift_subnets и ucode-модуль /opt/zapret-manager-luci/netshift.uc. Он учитывает source, rule, section, outbound, action и where. Простая проверка ip route get не эквивалентна этому механизму. Возвращаемый маршрут — предположение по правилам.

Перед переносом нужен полный аудит netshift.uc и его зависимостей. Совместимость с Podkop/Forkop ещё не установлена; рабочий адаптер не заявляется.

## Лицензии и публикация

У Site_Checker и Zapret-Manager в просмотренных деревьях не найден отдельный LICENSE. Это не является разрешением на копирование их кода. До публикации перенесённых компонентов необходимо проверить лицензии/разрешения авторов. Собственный probe написан самостоятельно по изученному поведению и не содержит скопированных функций.

У Podkop, Forkop, NetShift и YouTube Watchdog имеются файлы LICENSE. Перед включением любого их кода проверить конкретные условия и атрибуцию. Ссылки: https://github.com/TMN88/Site_Checker, https://github.com/StressOzz/Zapret-Manager, https://github.com/itdoginfo/podkop, https://github.com/ushan0v/forkop, https://github.com/yandexru45/netshift, https://github.com/TMN88/youtube-watchdog.

Репозитории загружены локально в work/. Checkout NetShift на Windows не выполнен из-за имени файла с двоеточием; исходный файл прочитан непосредственно из Git через git show. Точки интеграции нужно повторно проверить на версиях конкретных роутеров.
