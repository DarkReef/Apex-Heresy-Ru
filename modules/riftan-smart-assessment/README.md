# Riftan Smart Assessment

Independent module for Foundry VTT 14 and **Apex Heresy Ru 1.5.1**. No dependency on DAE, Riftan Charbar or ItemPileFFG.

## Installation / Установка

1. Update the system first using this manifest: https://raw.githubusercontent.com/DarkReef/Apex-Heresy-Ru/codex/foundry-modules/system.json
2. Install this module using: https://raw.githubusercontent.com/DarkReef/Apex-Heresy-Ru/codex/foundry-modules/modules/riftan-smart-assessment/module.json
3. Enable the module in your world. A GM must be connected for Fate rerolls.

**Сначала обновите форк системы до 1.5.1**, затем установите и включите модуль. Старый Apex Heresy без расширения сохранённой сложности не поддерживает точные перебросы этим модулем.

## Active Effects

Open the native effect editor. Each attribute-key input gets a search box supporting Russian/English field names and technical paths. Select a result to populate the native key. Green means the field/value match; yellow means a derived phase or reference needs review; red means an unknown field or incompatible literal/operation. Warnings are advisory: the module does not block native editing or implement a new effect engine. Formula references use the native V14 engine and are not evaluated by this module.

Transferred item effects suggest Actor fields; non-transferred effects suggest Item fields. Actor-owned items use their actual Actor, standalone transferred items use the acolyte model. User-defined skill specialities are included when present. No effect-summary feature is included.

## Fate

Right-click a native system check → **Перебросить за Fate — 1 / Reroll with Fate — 1**. The module replaces the native menu entry while enabled.

The active GM validates ownership and original card visibility, queues requests per Actor, spends one **current** Fate point and repeats the saved test with its original final target and modifiers. It uses the native check/attack engine; rerolls do not consume ammunition or recharge a weapon again. Only failed tests may be rerolled; damage cards, regeneration checks with automatic healing, and already-rerolled checks are rejected. Existing Black Crusade Infamy eligibility restrictions are retained.

Successful rerolls have a gold frame; failures a blood-scarlet frame. Each has one of ten outcome-specific authored phrases (not quotations from published books), selected once and stored on the card. The footer records `original → new result` and `Fate before → after`. Original cards remain in chat, are marked as replaced and link to the new result. Hidden and whispered rolls retain the original recipients/blindness; history is rendered only to users who can see the relevant card.

Requests require a connected GM. An error before a new card exists refunds the point. Once a card exists, failure recording history never refunds it. The result card itself prevents reuse even if the history update fails. Checks with system-specific side effects retain the native engine's behavior; this is not a full combat automation engine. As with other Foundry modules, request document flags are not a security boundary against a user deliberately running privileged JavaScript.

## API

```js
await game.modules.get('riftan-smart-assessment').api.requestReroll(messageId);
```

## Validation

Automated tests cover field selection/types/phases, ownership, visibility, saved modifiers, failure/refunds and simultaneous requests. DOM integration is tested using a mocked Foundry host. Live Foundry multiplayer QA remains required before treating this prerelease as production-ready.

GPL-3.0; system integration derives from Apex Heresy. See LICENSE.
