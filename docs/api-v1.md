# Общий API Apex Heresy RU, версия 1

В 1.6.0 ID пакета изменён на `apex-heresy-ru`. API `game.darkHeresy` и события не переименованы. Устанавливаемый пакет и пространство сохранённых данных — разные понятия: старые флаги находятся в `document.flags["dark-heresy"]`, настройки зарегистрированы под `dark-heresy`. Не вызывайте `getFlag/setFlag/unsetFlag` для старого ID: Foundry отклоняет неактивный scope. Для чтения результата броска используйте `message.getRollData()`; для собственных флагов расширения используйте namespace этого расширения. При необходимости совместимой адресной записи системного флага используйте `document.update({"flags.dark-heresy.key": value})`.

Доступен после `game.ready` как `game.darkHeresy.api`. Методы с Actor UUID проверяют наличие документа и права владельца. Для независимого токена передавайте UUID его Actor, чтобы действие не попало в базового персонажа.

## Структурированные свойства оружия

Оружие (`weapon`), машинное оружие (`vehicleWeapon`) и психосилы (`psychicPower`) поддерживают `system.traitOverrides`. Это дополнительные значения поверх старого текста `special` (у психосил — `damage.special`). Старые строки сохраняются и продолжают читаться; массовая миграция не нужна.

```js
await game.darkHeresy.api.setItemTraits({
    actorUuid: actor.uuid,
    itemId: weapon.id,
    traits: {reliable: false, toxic: 3, balanced: true}
});
```

Метод **заменяет весь набор переопределений**. Передайте `{}` для возврата к текстовым свойствам. Отсутствующий ключ наследует текст; `false` отключает свойство, в том числе числовое. Числовые значения должны быть целыми и неотрицательными; строка `"false"` не является логическим значением. `crippling` хранит строковое значение, например `"1d10"`, без обещания автоматического исполнения этой формулы.

Допустимые ключи и типы доступны в `game.darkHeresy.api.weaponTraitTypes`. Унаследованные ключи движка сохраняются: `rfFace` соответствует Vengeful, `skipAttackRoll` — Spray. Неизвестные ключи и неверные типы отклоняются до записи.

Порядок для оружия: текст → структурированные значения → установленные модификации → заряженный боеприпас. Каждый последующий источник изменяет только затронутые свойства. Подготовка модификаций не переписывает сохранённый набор оружия. Итоговые значения находятся в `rollData.weapon.traits`.

Для чистого разбора без броска:

```js
game.darkHeresy.util.extractWeaponTraits("Reliable, Toxic (1)", {toxic: 3});
```

Пользовательские свойства, неизвестные парсеру, остаются в исходном тексте. Наличие числового свойства в наборе не означает, что все его игровые последствия автоматизированы.

## Редактор в листе

В заголовке листа оружия, машинного оружия или психосилы есть кнопка **Trait overrides**. Она доступна владельцу предмета и открывает DialogV2 с фильтром по 42 свойствам. Для каждого свойства можно выбрать наследование текста, отключение или явное значение. Под названием показано значение из сохранённого текста, без бонусов модификаций и боеприпасов.

Сохранение меняет только отредактированные ключи. Возврат к наследованию удаляет переопределение. При конфликте с более поздней правкой того же свойства окно сообщает об ошибке и остаётся открытым; его нужно закрыть и открыть снова для получения свежих значений. Потеря прав или ошибка записи также не закрывает окно. Этот контроль замечает уже полученные клиентом изменения и не заменяет серверную блокировку одновременных запросов.

Прежнее окно текстовых качеств сохранено отдельно. Изменение текста не отменяет явные переопределения: для возврата к нему выберите наследование.

## Боеприпасы с версии 1.6.1

`weapon.system.ammo` хранит ID предмета боеприпасов того же Actor. Контейнер не меняет владельца документа; запас находится в `actor.items`, а `system.inventory.containerId` задаёт только размещение. Исторические UUID того же владельца читаются совместимо. Не используйте поиск по имени или ссылки на чужой Actor для списания.

`weapon.system.loadedAmmo` — `null` для старой записи либо снимок `{itemId, uuid, name, effect}` заряженного профиля. `null` позволяет читать прежнюю связь; после штатной перезарядки профиль сохраняется независимо от запаса. При переносе оружия переназначайте только ссылки на реально переданные предметы; сами `name` и `effect` сохраняются. Поддержка такого переноса включена в ItemPileFFG 0.2.3.

У боеприпаса `system.quantityUnit` принимает `magazines` (по умолчанию, прежний смысл количества) или `rounds`. `system.effect.penetration` остаётся полной заменой ББ; `system.effect.penetrationModifier` — отдельное числовое слагаемое. `rollData.weapon.ammunitionFingerprint` защищает ранее открытый бросок от изменения заряженного профиля. Не удаляйте его при передаче данных штатному броску. Переброс использует сохранённые данные и не повторяет расход.

Подсказки `modifierTooltip` и `modifierTooltipHtml` добавляются только в копию данных листа. Это представление, а не поля модели Actor.

## Единая карточка с версии 1.7.0

Обычный `useItem` использует новую карточку для поддержанных атак OW при включённой настройке `combatWorkflow` и наличии активного GM. Флаг `flags["dark-heresy"].combatWorkflow` хранит версию, поколение атаки и отдельные строки точных Token UUID. Исходные данные атаки остаются в `rollData`; результаты защиты и урона хранятся в соответствующей строке.

`game.darkHeresy.api.combat` — мост нативной карточки. Запросы подтверждаются по автору сохранённого ChatMessage; сокет передаёт только ID запроса. Собственные расширения не должны редактировать состояние карточки или квитанции применения напрямую и не должны вызывать старый `applyDamage` на корневой карточке, содержащей только атаку. На этом этапе публичный стабильный контракт для внешнего подтверждения многоцелевого урона не объявлен: используйте кнопки общей карточки.

`effectClock` задаёт только специальную границу завершения эффекта, не дополнительный расчёт штрафов или периодического урона. Числовые модификаторы продолжают быть нативными `system.changes`. [Режимы и ограничения](combat-workflow.md).

## Атака и события

```js
await game.darkHeresy.api.useItem({actorUuid: actor.uuid, itemId: weapon.id, dialog: false});
```

Общий путь проверяет боезапас, режим атаки и подзарядку. Результат — объект со `status`, `context` и, при отказе проверки, `reason`. `darkHeresy.preRoll` может отменить бросок возвратом `false`; `darkHeresy.roll` вызывается после завершённого броска. Очередь атак действует внутри одного клиента и не является распределённой блокировкой нескольких владельцев.

## Состояние проверки

Структурированные свойства проверены автоматическими тестами парсера, API, моделей, подготовки модификаций и редактора. На Foundry 14.365 проверены кнопка в листе, рендер DialogV2, фильтр, точечный патч сохранения и сохранение окна при потере прав. Персистентность редактора была подменена записью патча в память; реальные игровые предметы этим тестом не обновлялись. На временном Actor проверены значения в данных атаки и после reset; валидатор поля отвергает неправильный тип.

При возобновлении браузерной проверки вкладка перешла в GMTEST, мир сообщает worldSchemaVersion=14. Время обновления этой версии данной проверкой не установлено; испытания миграции с исходной старой схемы на изолированной копии всё ещё требуются.

## Only War 1.5.1 — extension contract

The system contains no optional modules or module economy fields. Charbar,
ItemPileFFG and Smart Assessment are installed independently. Historical
`codex/party-bar-item-piles` and `codex/foundry-modules` branches are prototypes,
not system release sources.

`game.darkHeresy.localization.ruleTerm(value, book = "ow", field = "")`
translates an exact display term. `ruleText` has the same arguments and translates
plain text, including numbered qualities. Both use the current UI language;
unknown terms, English and other books pass through. Never persist their output
in mechanical fields.

`game.darkHeresy.tests.fateSnapshotVersion === 1` advertises the synchronous
`darkHeresy.preComputeRollTarget` hook. A listener may restore a validated saved
roll target and return false to skip target recomputation. Common and combat
checks call the hook. Ownership, spending and snapshot validation belong to the
module. Chat creation is awaited and persistence errors propagate to callers.

Russian UI source: `localization/ru/glossary.json`; ambiguous English labels use
`localization/ru/interface-overrides.json`. Rebuild with `npm run localization:build`.
Do not edit generated `lang/ru.json`. Only War content completeness is covered by
source/translation tests; other books are not claimed complete.

Release remains a candidate until Foundry 14.365 + Russian + Babele is checked
with no modules, each optional module, and all three together, including GM and
player clients, private rolls, failed persistence and Fate rerolls after modifiers
change. Automated tests do not replace this live multiplayer validation.
