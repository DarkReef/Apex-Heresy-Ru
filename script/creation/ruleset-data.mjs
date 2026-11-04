// ════════════════════════════════════════════════════════════════════════
//  О чём спрашивает Мастер создания — по книгам.
//
//  У самого Мастера ветвлений по книге нет: он идёт по этому списку, а `kind`
//  шага решает, какая панель рисуется. Добавить книгу — значит дописать сюда
//  запись, а не разложить условия по коду окна.
//
//  Порядок шагов книжный. Black Crusade единственная просит характеристики
//  посреди происхождения: архетип там выбирается уже зная их (стр. 47).
//
//  Тип актора книгу больше не решает: поля у обоих типов персонажа одни и те же,
//  а внешний вид листа выбирается по книге (см. Dh.sheetFor). Поэтому персонажа
//  любого типа можно вести по любой книге, ничего не пересоздавая.
//
//  `bioField` у шага — куда на листе попадает НАЗВАНИЕ выбранного. Заполняется
//  в момент выбора, а не в конце: игрок видит, как анкета собирается под его
//  руками. Поле остаётся редактируемым — переименовать «Мир-улей» в «Десолеум»
//  это обычная игра, а не поломка.
//
//  `characteristicModifiers` — чем является модификатор характеристики:
//    "generation" — правилом генерации, а не числом. Dark Heresy при «+» кидает
//                   3d10 и берёт две лучшие, при «–» две худшие, а при закупке
//                   начинает с 30 вместо 25 и с 20 вместо 25 (стр. 31). Модификатор
//                   уже сидит в полученном значении, и прибавлять его ВТОРОЙ раз
//                   нельзя.
//    "flat"       — обычной прибавкой к готовому значению.
//    null         — книга на этот счёт ещё не сверена; Мастер такую не ведёт.
// ════════════════════════════════════════════════════════════════════════

import {CHARACTERISTIC_KEYS} from "./origin-data.mjs";

/** Паки, где ищется выданное по имени. У книги свой пак идёт первым. */
const CONTENT_PACKS = ["apex-heresy-ru.dark-heresy", "apex-heresy-ru.black-crusade",
    "apex-heresy-ru.rogue-trader", "apex-heresy-ru.only-war", "apex-heresy-ru.deathwatch"];
const packsFirst = pack => [pack, ...CONTENT_PACKS.filter(entry => entry !== pack)];

//  Поля правил, которыми книги расходятся (значение Dark Heresy — по умолчанию):
//    ready                 — Мастер по книге доведён до конца и предлагается игрокам;
//    characteristicRerolls — сколько результатов характеристик можно перебросить;
//    startingExperience    — стартовый опыт, если его не задаёт происхождение;
//    fate                  — {formula, table}: Судьба броском по таблице, а не от мира;
//    duplicates            — skill: "best" (лучшее из двух) | "advance" (лишний ранг),
//                            talentExperience: опыт взамен повторного таланта;
//    contentPacks          — порядок паков при поиске выданного по имени;
//    characteristicKeys    — характеристики книги;
//    characteristicBase    — прибавка к броску 2d10 (20 у Dark Heresy, 25/30 у Black Crusade);
//    infamy                — {key, formula}: характеристика, которая бросается своей формулой;
//    aptitudes             — false, если книга склонностей не знает вовсе.
export const RULESET_DEFS = {
    dh2: {
        label: "RULESET.DH2",
        ready: true,
        characteristicModifiers: "generation",
        characteristicMethods: ["roll", "pointBuy"],
        characteristicRerolls: 0,
        startingExperience: 1000,
        duplicates: {skill: "best", talentExperience: 0},
        // Элитные продвижения — понятие Dark Heresy (стр. 86); в Only War их нет:
        // санкционированный псайкер там не продвижение, а специальность.
        eliteAdvances: true,
        // Раны и Судьба Dark Heresy идут от родного мира и бросаются вместе с характеристиками.
        vitalsStage: "characteristics",
        contentPacks: packsFirst("apex-heresy-ru.dark-heresy"),
        steps: [
            {id: "homeWorld",       label: "ORIGIN.STAGE.HOME_WORLD",  kind: "origin", stage: "homeWorld", bioField: "system.bio.homeWorld"},
            {id: "background",      label: "ORIGIN.STAGE.BACKGROUND",  kind: "origin", stage: "background", bioField: "system.bio.background"},
            {id: "role",            label: "ORIGIN.STAGE.ROLE",        kind: "origin", stage: "role", bioField: "system.bio.role"},
            {id: "characteristics", label: "WIZARD.CHARACTERISTICS",   kind: "characteristics"},
            {id: "experience",      label: "WIZARD.EXPERIENCE",        kind: "experience"},
            // Стадия 4 книги — «Spend Experience Points, Equip Acolyte» (стр. 78-82).
            {id: "equipment",       label: "WIZARD.EQUIPMENT",         kind: "equipment"},
            {id: "divination",      label: "ORIGIN.STAGE.DIVINATION",  kind: "divination"}
        ]
    },
    rt: {
        label: "RULESET.RT",
        characteristicModifiers: null,
        characteristicMethods: ["roll", "pointBuy"],
        steps: [
            // Путь Происхождения — шесть строк одной таблицы с правилом соседства,
            // поэтому один шаг с собственным виджетом, а не шесть выпадающих списков.
            {id: "originPath",      label: "WIZARD.ORIGIN_PATH",       kind: "origin", stage: "homeWorld", widget: "grid"},
            {id: "career",          label: "ORIGIN.STAGE.CAREER",      kind: "origin", stage: "career"},
            {id: "characteristics", label: "WIZARD.CHARACTERISTICS",   kind: "characteristics"},
            {id: "experience",      label: "WIZARD.EXPERIENCE",        kind: "experience"}
        ]
    },
    ow: {
        label: "RULESET.OW",
        ready: true,
        // Модификаторы полка и специальности прибавляются к готовому броску (стр. 41).
        characteristicModifiers: "flat",
        characteristicMethods: ["roll", "pointBuy"],
        characteristicRerolls: 1,
        // 600 у гвардейца; специальность поддержки задаёт 300 сама (стр. 100).
        startingExperience: 600,
        fate: {formula: "1d10", table: [{min: 1, max: 7, value: 1}, {min: 8, max: 9, value: 2}, {min: 10, max: 10, value: 3}]},
        duplicates: {skill: "advance", talentExperience: 100},
        // Раны задаёт специальность, а она выбирается после характеристик (стр. 100).
        vitalsStage: "speciality",
        contentPacks: packsFirst("apex-heresy-ru.only-war"),
        characteristicKeys: CHARACTERISTIC_KEYS.filter(key => key !== "influence"),
        steps: [
            // Книжный порядок (стр. 73): полк группы, затем характеристики, специальность,
            // раны-судьба-опыт и Comrade. Полк — один на весь отряд и собирается за бюджет.
            {id: "regiment",        label: "ORIGIN.STAGE.REGIMENT",    kind: "regiment", stage: "regiment", bioField: "system.bio.background"},
            {id: "characteristics", label: "WIZARD.CHARACTERISTICS",   kind: "characteristics"},
            {id: "speciality",      label: "ORIGIN.STAGE.SPECIALITY",  kind: "origin", stage: "speciality", bioField: "system.bio.role"},
            {id: "experience",      label: "WIZARD.EXPERIENCE",        kind: "experience"},
            {id: "comrade",         label: "WIZARD.COMRADE",           kind: "comrade"}
        ]
    },
    bc: {
        label: "RULESET.BC",
        ready: true,
        // Модификаторы Гордыни, Позора и архетипа прибавляются к готовому броску (стр. 72-74).
        characteristicModifiers: "flat",
        characteristicMethods: ["roll", "pointBuy"],
        // «Благословлённые Тёмными богами» перебрасывают один результат, оставляя новый (стр. 53).
        characteristicRerolls: 1,
        // 1000 у человека, 500 у десантника Хаоса — цифру задаёт раса (стр. 75). Здесь
        // человеческая: раса её переопределяет, как специальность Only War.
        startingExperience: 1000,
        // База броска и распределения очков тоже от расы: 25 у человека, 30 у десантника.
        characteristicBase: 25,
        // Тёмная слава живёт на месте Влияния и бросается отдельной формулой даже при
        // распределении очков (стр. 53).
        infamy: {key: "influence", formula: "1d5+19"},
        // Порча стартует с нуля, а набирается Позором и Стремлением (стр. 84).
        vitalsStage: "archetype",
        // Склонностей в книге нет: цену задаёт бог улучшения и покровитель персонажа.
        aptitudes: false,
        // Отсюда и строка «Покровитель» в лавке: она объясняет цену. У Deathwatch
        // склонностей тоже нет, но покровителя нет и подавно — цена там напечатана.
        patronPricing: true,
        contentPacks: packsFirst("apex-heresy-ru.black-crusade"),
        steps: [
            // Книжный порядок (стр. 48): раса, характеристики, архетип, страсти,
            // траты опыта, снаряжение с Порчей и, наконец, выбор Тёмного бога.
            {id: "race",            label: "ORIGIN.STAGE.RACE",        kind: "origin", stage: "race", bioField: "system.race"},
            {id: "characteristics", label: "WIZARD.CHARACTERISTICS",   kind: "characteristics"},
            {id: "archetype",       label: "ORIGIN.STAGE.ARCHETYPE",   kind: "origin", stage: "archetype", bioField: "system.archetype"},
            // Три таблицы одной панелью: у каждой свой носитель, свой список и своя кость.
            {id: "passions",        label: "WIZARD.PASSIONS",          kind: "passions", stages: [
                {id: "pride",      label: "ORIGIN.STAGE.PRIDE",      stage: "pride",      bioField: "system.pride"},
                {id: "disgrace",   label: "ORIGIN.STAGE.DISGRACE",   stage: "disgrace",   bioField: "system.vice"},
                {id: "motivation", label: "ORIGIN.STAGE.MOTIVATION", stage: "motivation", bioField: "system.aspiration"}
            ]},
            {id: "experience",      label: "WIZARD.EXPERIENCE",        kind: "experience"},
            {id: "equipment",       label: "WIZARD.EQUIPMENT",         kind: "equipment"},
            {id: "darkGods",        label: "WIZARD.DARK_GODS",         kind: "darkGods"}
        ]
    },
    dw: {
        label: "RULESET.DW",
        ready: true,
        // Модификаторы ордена прибавляются к готовому броску (стр. 24).
        characteristicModifiers: "flat",
        characteristicMethods: ["roll", "pointBuy"],
        // «Один из сильнейших защитников Империума» перебрасывает один результат (стр. 26).
        characteristicRerolls: 1,
        // 2d10+30 — десантник начинает там, где смертный заканчивает.
        characteristicBase: 30,
        // Тысяча на продвижения; ещё 12 000 — это то, чем он УЖЕ стал, их не тратят (стр. 28).
        startingExperience: 1000,
        backgroundExperience: 12000,
        // Раны и Судьба бросаются вместе с характеристиками, но раны у всех одинаковы,
        // а Судьба идёт по таблице 1-2 (стр. 28).
        vitalsStage: "spaceMarine",
        wounds: {formula: "18+1d5"},
        fate: {formula: "1d10", table: [{min: 1, max: 7, value: 3}, {min: 8, max: 9, value: 4},
                                        {min: 10, max: 10, value: 5}]},
        // Склонностей книга не знает: у каждого продвижения своя цена в своём списке.
        aptitudes: false,
        // Цена — не лестница, а строка списка: Chapter, General Space Marine и Speciality.
        advanceLists: true,
        contentPacks: packsFirst("apex-heresy-ru.deathwatch"),
        // Влияния у десантника нет: снаряжение он получает Реквизицией (стр. 29).
        characteristicKeys: CHARACTERISTIC_KEYS.filter(key => key !== "influence"),
        steps: [
            // Книжный порядок (стр. 24): сначала характеристики, потом орден и специальность.
            {id: "spaceMarine",     label: "ORIGIN.STAGE.SPACE_MARINE", kind: "origin", stage: "spaceMarine"},
            {id: "characteristics", label: "WIZARD.CHARACTERISTICS",   kind: "characteristics"},
            {id: "chapter",         label: "ORIGIN.STAGE.CHAPTER",     kind: "origin", stage: "chapter", bioField: "system.bio.homeWorld"},
            {id: "speciality",      label: "ORIGIN.STAGE.SPECIALITY",  kind: "origin", stage: "speciality", bioField: "system.bio.role"},
            {id: "experience",      label: "WIZARD.EXPERIENCE",        kind: "experience"},
            {id: "life",            label: "WIZARD.LIFE",              kind: "life"}
        ]
    }
};

/** Шаги Мастера для книги; незнакомая книга просто не имеет шагов. */
export function stepsFor(ruleset) { return RULESET_DEFS[ruleset]?.steps ?? []; }

/** Только те шаги, на которых выбирается предмет происхождения. */
export function originStepsFor(ruleset) { return stepsFor(ruleset).filter(s => s.kind === "origin"); }

/** Книги, по которым Мастер реально умеет вести: сверенные и доведённые до конца. */
export function auditedRulesets() {
    return Object.keys(RULESET_DEFS).filter(key => RULESET_DEFS[key].ready && RULESET_DEFS[key].characteristicModifiers);
}

/** Характеристики книги. */
export function characteristicKeysFor(ruleset) {
    return RULESET_DEFS[ruleset]?.characteristicKeys ?? CHARACTERISTIC_KEYS;
}

/**
 * Опыт, которым персонаж УЖЕ обладает к началу игры и который не тратится.
 * Он есть только у Deathwatch: 12 000 — это то, кем брат стал за век службы
 * до Караула Смерти, и ранг считается вместе с ними (стр. 28, таблица 2-2).
 */
export function backgroundExperienceFor(ruleset) {
    return Number(RULESET_DEFS[ruleset]?.backgroundExperience) || 0;
}

/** Порядок паков для поиска выданного по имени. */
export function contentPacksFor(ruleset) {
    return RULESET_DEFS[ruleset]?.contentPacks ?? CONTENT_PACKS;
}

/** Судьба по таблице: строка, в которую попал бросок. */
export function fateFromTable(total, table) {
    return (table ?? []).find(row => total >= row.min && total <= row.max)?.value ?? 0;
}
