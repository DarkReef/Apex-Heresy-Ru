# Отдельные модули Foundry

В ветке `codex/foundry-modules` встроенное расширение отключено и вынесено в два независимо устанавливаемых пакета версии 0.1.0:

* [Riftan Charbar](../modules/riftan-charbar/README.md): панель персонажей, состояния и запросы проверок.
* [ItemPileFFG](../modules/itempileffg/README.md): адаптер Item Piles, экономика и вложенные контейнеры.

Каждый пакет содержит собственный `module.json`, языки, CSS, исходники и GPL-3.0. Riftan Charbar не требует Item Piles; ItemPileFFG не требует Riftan Charbar. Включённые вместе, они интегрируются через API.

Манифесты установки:

```text
https://raw.githubusercontent.com/DarkReef/Apex-Heresy-Ru/codex/foundry-modules/modules/riftan-charbar/module.json
https://raw.githubusercontent.com/DarkReef/Apex-Heresy-Ru/codex/foundry-modules/modules/itempileffg/module.json
```

Исходная версия системы должна предоставлять API Apex Heresy v1, версия 1.4.2+. В этой ветке сохранены исправления атрибуции бросков и числовых полей, но автоматический запуск старой встроенной панели удалён. Модули сами предоставляют UI; ItemPileFFG регистрирует недостающие поля моделей при установке на прежнюю версию системы.

Для сборки: `npm run modules:build`. Архивы содержат `module.json` в корне, чтобы Foundry устанавливал их как Add-on Modules. Для проверок: `npm run modules:test` и `npm test`. Workflow `foundry-modules-release.yml` публикует два отдельных тестовых релиза с ZIP и манифестом для каждого пакета.

Проверены 896 автоматических тестов, два пропущены. DOM-проверки прошли в трёх режимах: только Riftan Charbar, только ItemPileFFG и оба вместе. Проверка в реальном многопользовательском Foundry VTT 14 ещё требуется.
