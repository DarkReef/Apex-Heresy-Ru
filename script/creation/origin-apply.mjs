import {ruleName} from "../localization/rule-name.mjs";
// ════════════════════════════════════════════════════════════════════════
//  План → записи на актора, и обратно.
//
//  Модуль принимает объект формы актора и ВОЗВРАЩАЕТ полезную нагрузку для
//  update, а не пишет сам: поэтому бухгалтерия отката проверяется тестами без
//  запуска мира.
//
//  Всё выданное шагом помечается самим шагом и предметом-носителем, а поднятые
//  значения записываются на носитель. Тогда снять носитель — значит отменить
//  шаг ровно, без догадок, и игрок может вернуться и сменить родной мир.
//
//  Запись идёт в ТЕ ЖЕ поля, что читает система, по её правилам:
//    склонности    — предметы типа aptitude (их показывает вкладка «Продвижение» и
//                    считает движок опыта; объект system.aptitudes не читает никто);
//    специализации — ключи с подписью (adeptusArbites: {label: "Adeptus Arbites"});
//    стартовое     — флаг starter: движок опыта не берёт за такой ранг ни очка.
// ════════════════════════════════════════════════════════════════════════

import {CHARACTERISTIC_KEYS} from "./origin-data.mjs";

export const GRANT_FLAG_SCOPE = "dark-heresy";
export const GRANT_FLAG_KEY = "originGrant";

/** Склонность, которая по книге есть у всех (стр. 79). */
export const UNIVERSAL_APTITUDE = "General";

/** Ступень обученности навыка и её потолок на листе. */
const SKILL_STEP = 10;
const SKILL_MAX = 30;

/** Заглушки для имён, которых нет ни в одном компендиуме: потерять выдачу молча нельзя. */
const STUB = {
    ability: {type: "specialAbility", img: "icons/svg/aura.svg"},
    talent: {type: "talent", img: "icons/svg/upgrade.svg"},
    trait: {type: "trait", img: "icons/svg/aura.svg"},
    equipment: {type: "gear", img: "icons/svg/item-bag.svg"},
    aptitude: {type: "aptitude", img: "icons/svg/book.svg"}
};

const normalise = value => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Склонности актора — по предметам, как их читает система, плюс General.
 * @param {{items?: Iterable<{type: string, name: string}>}} actor
 * @returns {Set<string>}
 */
export function ownedAptitudes(actor) {
    const owned = new Set([UNIVERSAL_APTITUDE]);
    for (const item of actor?.items ?? []) if (item?.type === "aptitude" && item.name) owned.add(ruleName(item).trim());
    return owned;
}

/**
 * Ключ специализации навыка под отображаемое имя.
 *
 * Существующая специализация находится по подписи (регистр и пробелы не важны),
 * новой ключ строится из имени так же, как в template.json: «Tactica Imperialis»
 * → tacticaImperialis.
 *
 * @param {object} skill  system.skills[key]
 * @param {string} name
 * @returns {{specKey: string, created: boolean}}
 */
export function specialityKeyFor(skill, name) {
    const wanted = normalise(name);
    for (const [specKey, entry] of Object.entries(skill?.specialities ?? {}))
        if (normalise(entry?.label) === wanted || normalise(specKey) === wanted) return {specKey, created: false};
    const words = String(name ?? "").trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
    const specKey = words.map((word, index) => index === 0
        ? word.toLowerCase()
        : word[0].toUpperCase() + word.slice(1).toLowerCase()).join("");
    return {specKey, created: true};
}

/**
 * Нагрузка для actor.update() по плану — и запись того, что она реально изменила.
 *
 * `characteristicMode` — чем книга считает модификатор характеристики:
 *   "flat"       — обычной прибавкой; пишется в base и потом откатывается;
 *   "generation" — правилом генерации (Dark Heresy, стр. 31). Модификатор попадёт
 *                  в значение сам — броском 3d10 с выбором двух костей, либо стартом
 *                  закупки с 30 вместо 25. Писать его ЕЩЁ и в base значит посчитать
 *                  дважды, поэтому он только записывается — шагу характеристик, чтобы
 *                  тот знал, какую формулу катать.
 *
 * Склонности здесь только учитываются: создаются они предметами, см. planToItemData.
 *
 * @param {object} actor  объект формы актора (нужны system и items)
 * @param {object} plan   из grant-data.mjs
 * @param {{characteristicMode?: "flat"|"generation", duplicates?: object}} [options]
 *
 * `duplicates` — что делать, когда выдача повторяется (Only War, стр. 41):
 *   skill: "best"    — остаётся лучшее из двух (Dark Heresy);
 *   skill: "advance" — повтор даёт лишний ранг;
 *   talentExperience — опыт взамен повторного таланта.
 * @returns {{update: object, applied: object}}
 */
/**
 * Насколько трейт поднимает бонус характеристики.
 *
 * «Unnatural Characteristic (Strength +4)» — это не просто карточка с текстом:
 * четвёрка прибавляется к бонусу Силы, даёт половину себя дополнительными
 * степенями успеха и съедается Felling при попадании. Лист читает её из поля
 * `unnatural`, и заполнить его должен тот, кто трейт выдал.
 *
 * Книги пишут это имя тремя способами: «Unnatural Characteristic (Strength +4)»,
 * «Unnatural Strength (+4)» и — у Deathwatch — «Unnatural Strength (x2)». Первые два
 * прибавляют число, третий УДВАИВАЕТ бонус, и это разные вещи: удвоение растёт
 * вместе с характеристикой, прибавка нет.
 *
 * @param {string} name  имя трейта
 * @param {string[]} keys  ключи характеристик книги
 * @returns {{key: string, value: number, multiplier: number}|null}
 */
export function unnaturalFromTrait(name, keys = CHARACTERISTIC_KEYS) {
    const text = String(name ?? "");
    if (!/^unnatural/i.test(text)) return null;
    const inside = text.match(/\(([^)]*)\)/)?.[1] ?? text.replace(/^unnatural\s*/i, "");
    // «x2» — множитель, всё остальное — прибавка.
    const times = Number(inside.match(/[x*](\d+)/i)?.[1]);
    const value = Number.isFinite(times) ? 0 : Number(inside.match(/([+-]?\d+)/)?.[1]);
    const multiplier = Number.isFinite(times) && times > 1 ? times : 1;
    if (multiplier === 1 && (!Number.isFinite(value) || value === 0)) return null;
    // Имя характеристики — всё до числа: «Characteristic (Strength +4)» → strength.
    const words = `${text.replace(/\(.*$/, "")} ${inside}`.replace(/unnatural|characteristic/gi, "");
    const normalise = word => word.toLowerCase().replace(/[^a-z]/g, "");
    // Из имени вычищаем и «x2», и «+4»: остаётся одна характеристика.
    const wanted = normalise(words.replace(/[x*]\s*\d+/gi, "").replace(/[+-]?\d+/g, ""));
    if (!wanted) return null;
    const key = keys.find(entry => normalise(entry) === wanted);
    return key ? {key, value: Number.isFinite(value) ? value : 0, multiplier} : null;
}

/**
 * Ступень величины по имени трейта (Black Crusade, стр. 143; та же шкала у всех книг).
 *
 * Число значит много: по нему считаются поправка к попаданию (−30 у крошечной,
 * +10 у громадной), Скрытность и базовое движение (AB плюс ступень минус четыре).
 * Поэтому «Size (Hulking)» обязан стать пятёркой в поле, а не остаться подписью.
 */
export const SIZE_STEPS = {
    miniscule: 1, puny: 2, weedy: 3, scrawny: 3, average: 4, hulking: 5,
    enormous: 6, massive: 7, immense: 8, monumental: 9, titanic: 10
};

/**
 * @param {string} name  имя трейта, например «Size (Hulking)»
 * @returns {number|null} ступень 1..10, либо null, если это не величина
 */
export function sizeFromTrait(name) {
    const text = String(name ?? "");
    if (!/^size/i.test(text)) return null;
    const inside = text.match(/\(([^)]*)\)/)?.[1] ?? "";
    const digits = Number(inside.match(/\d+/)?.[0]);
    if (Number.isFinite(digits) && digits >= 1 && digits <= 10) return digits;
    const word = inside.toLowerCase().replace(/[^a-z]/g, "");
    return SIZE_STEPS[word] ?? null;
}

export function planToActorUpdate(actor, plan, {characteristicMode = "flat", duplicates = {}} = {}) {
    const rule = {skill: "best", talentExperience: 0, ...duplicates};
    const update = {};
    const applied = {characteristics: {}, generationModifiers: {}, skills: {}, specialities: [],
                     aptitudes: [], duplicateAptitudes: [], duplicateSkills: [], duplicateTalents: [],
                     duplicateExperience: 0,
                     wounds: 0, corruption: 0, insanity: 0, influence: 0};

    for (const [key, modifier] of Object.entries(plan.characteristics ?? {})) {
        const current = actor.system.characteristics?.[key];
        if (!current) continue;   // книга назвала характеристику, которой у этого листа нет
        if (characteristicMode === "generation") { applied.generationModifiers[key] = modifier; continue; }
        update[`system.characteristics.${key}.base`] = (current.base ?? 0) + modifier;
        applied.characteristics[key] = modifier;
    }

    // Навык только поднимается. Если другой источник уже дал больше, выдача ничего не
    // меняет — и в откат не попадает, иначе он опустил бы чужую обученность.
    // Выданный ранг — стартовый: движок опыта не должен брать за него очков.
    for (const skill of plan.skills ?? []) {
        const current = actor.system.skills?.[skill.key];
        if (!current) continue;
        const have = current.advance ?? -20;
        let target = skill.advance;
        if (have >= skill.advance) {
            // Only War (стр. 41): тот же навык из второго источника — лишний ранг, а не ничего.
            if (rule.skill !== "advance") continue;
            target = Math.min(have + SKILL_STEP, SKILL_MAX);
            if (target === have) continue;
            applied.duplicateSkills.push(skill.key);
        }
        update[`system.skills.${skill.key}.advance`] = target;
        update[`system.skills.${skill.key}.starter`] = true;
        applied.skills[skill.key] = {from: have, to: target, starterWas: !!current.starter};
    }

    for (const spec of plan.specialities ?? []) {
        const skill = actor.system.skills?.[spec.key];
        if (!skill) continue;
        const {specKey, created} = specialityKeyFor(skill, spec.name);
        const existing = skill.specialities?.[specKey];
        let advance = spec.advance ?? 0;
        const have = existing?.advance ?? -20;
        if (existing && have >= advance) {
            if (rule.skill !== "advance") continue;
            advance = Math.min(have + SKILL_STEP, SKILL_MAX);
            if (advance === have) continue;
            applied.duplicateSkills.push(`${spec.key}:${spec.name}`);
        }
        const path = `system.skills.${spec.key}.specialities.${specKey}`;
        if (created) {
            update[path] = {label: String(spec.name).trim(), advance, starter: true, cost: 0};
        } else {
            update[`${path}.advance`] = advance;
            update[`${path}.starter`] = true;
        }
        applied.specialities.push({key: spec.key, specKey, created,
                                   from: existing?.advance ?? -20, starterWas: !!existing?.starter});
    }

    // Повторный талант не выдаётся второй раз; книга может дать за него опыт (стр. 41).
    const ownedTalents = new Set((actor.items ?? [])
        .filter(item => item?.type === "talent" && item.name)
        .map(item => ruleName(item).toLowerCase().trim()));
    for (const talent of plan.talents ?? [])
        if (ownedTalents.has(String(talent.name).toLowerCase().trim())) applied.duplicateTalents.push(talent.name);
    applied.duplicateExperience = applied.duplicateTalents.length * rule.talentExperience;

    // Трейт с числом поднимает бонус характеристики; без этого он остаётся текстом,
    // а десантник Хаоса ходит с бонусом Силы 4 вместо 8.
    for (const trait of plan.traits ?? []) {
        const size = sizeFromTrait(trait.name);
        if (size !== null && size !== (Number(actor.system.size) || 4)) {
            update["system.size"] = size;
            applied.size = {from: Number(actor.system.size) || 4, to: size};
        }
        const boost = unnaturalFromTrait(trait.name);
        if (!boost) continue;
        const current = actor.system.characteristics?.[boost.key];
        if (!current) continue;
        if (boost.multiplier > 1) {
            update[`system.characteristics.${boost.key}.unnaturalMultiplier`] = boost.multiplier;
            (applied.unnaturalMultiplier ??= {})[boost.key] =
                Number(current.unnaturalMultiplier) || 1;
            continue;
        }
        const had = Number(current.unnatural) || 0;
        update[`system.characteristics.${boost.key}.unnatural`] = had + boost.value;
        (applied.unnatural ??= {})[boost.key] = (applied.unnatural?.[boost.key] ?? 0) + boost.value;
    }

    if (plan.wounds) {
        update["system.wounds.max"] = (actor.system.wounds?.max ?? 0) + plan.wounds;
        applied.wounds = plan.wounds;
    }
    for (const key of ["corruption", "insanity"]) {
        if (!plan[key]) continue;
        update[`system.${key}`] = (actor.system[key] ?? 0) + plan[key];
        applied[key] = plan[key];
    }
    // Влияние — характеристика, а не отдельный счётчик, хотя книги называют его отдельно.
    if (plan.influence) {
        const current = actor.system.characteristics?.influence;
        if (current) {
            update["system.characteristics.influence.base"] = (current.base ?? 0) + plan.influence;
            applied.influence = plan.influence;
        }
    }

    // Склонность, которая у актора уже есть, повторно не выдаётся и в откат не пишется:
    // отменяя этот шаг, нельзя отнять то, что дал другой. Но и пропасть она не должна —
    // по книге (стр. 79) повторная меняется на другую, характеристическую. Выбор за
    // игроком, поэтому здесь только отмечаем долг. General есть у всех, долгом не считается.
    const owned = ownedAptitudes(actor);
    for (const aptitude of plan.aptitudes ?? []) {
        if (!owned.has(aptitude)) { applied.aptitudes.push(aptitude); owned.add(aptitude); }
        else if (aptitude !== UNIVERSAL_APTITUDE) applied.duplicateAptitudes.push(aptitude);
    }

    return {update, applied};
}

/**
 * Данные вложенных предметов для всего, что раздаёт план.
 *
 * @param {object} plan
 * @param {string} tag        "<книга>:<шаг>" — им помечается выданное
 * @param {string} carrierId  идентификатор предмета-носителя
 * @param {(kind: string, name: string) => object|null} lookup  копия из компендиума по виду и имени
 * @param {{aptitudes?: string[], skipTalents?: string[]}} [options]
 *   aptitudes   — какие склонности создать; по умолчанию все из плана;
 *   skipTalents — таланты, которые у актора уже есть: второй копии не бывает.
 * @returns {object[]}
 */
export function planToItemData(plan, tag, carrierId, lookup, {aptitudes, skipTalents = []} = {}) {
    const skip = new Set(skipTalents.map(name => String(name).toLowerCase().trim()));
    const flags = {[GRANT_FLAG_SCOPE]: {[GRANT_FLAG_KEY]: tag, grantedBy: carrierId}};
    const out = [];

    for (const talent of plan.talents ?? []) {
        if (skip.has(String(talent.name).toLowerCase().trim())) continue;
        const data = copy("talent", talent.name, lookup);
        if (talent.targets) data.system.targets = talent.targets;
        // Талант от происхождения — стартовый: движок опыта за него не списывает.
        data.system.starter = true;
        // Иные таланты берут по несколько раз: «Psy Rating (x2)» у колдуна Black
        // Crusade — это два таланта, а не один (стр. 61). Каждый лежит своей карточкой,
        // потому что и считаются они поштучно.
        const count = Math.max(1, Number(talent.count) || 1);
        for (let copyIndex = 0; copyIndex < count; copyIndex++)
            out.push({...data, system: {...data.system}, flags});
    }
    for (const trait of plan.traits ?? []) {
        const data = copy("trait", trait.name, lookup);
        if (trait.rating != null) data.system.rating = trait.rating;
        out.push({...data, flags});
    }
    // Особые способности: Solo Mode ордена, способность специальности. На листе им
    // место рядом с талантами, но тип у них свой — по нему их и находит вкладка.
    for (const ability of plan.abilities ?? []) {
        const data = copy("ability", ability.name, lookup);
        out.push({...data, flags});
    }
    for (const gear of plan.equipment ?? []) {
        const data = copy("equipment", gear.name, lookup);
        const count = Math.max(1, Number(gear.quantity) || 1);
        // Счётчик есть только у боеприпасов. Две гранаты — это два предмета, а не
        // одна с числом: числа ей просто негде хранить.
        if (count > 1 && data.system.quantity !== undefined) data.system.quantity = count;
        for (let copyIndex = 0; copyIndex < (data.system.quantity !== undefined ? 1 : count); copyIndex++)
            out.push({...data, system: {...data.system}, flags});
    }
    for (const name of aptitudes ?? plan.aptitudes ?? []) {
        if (name === UNIVERSAL_APTITUDE) continue;
        out.push({name, ...STUB.aptitude, system: {}, flags});
    }

    return out;
}

/** Копия из компендиума или заглушка; идентификатор пака за копией не тянется. */
function copy(kind, name, lookup) {
    const found = lookup?.(kind, name);
    const data = found ? {...found} : {name, ...STUB[kind], system: {}};
    delete data._id;
    data.system = {...(data.system ?? {})};
    return data;
}

/**
 * Нагрузка для actor.update(), отменяющая записанное применение.
 *
 * Предметы (таланты, черты, снаряжение, склонности) снимаются вместе с носителем —
 * здесь только значения полей.
 *
 * @param {object} actor
 * @param {object} applied  из planToActorUpdate
 * @returns {object}
 */
export function revertUpdate(actor, applied = {}) {
    const update = {};

    for (const [key, modifier] of Object.entries(applied.characteristics ?? {})) {
        const current = actor.system.characteristics?.[key];
        if (current) update[`system.characteristics.${key}.base`] = (current.base ?? 0) - modifier;
    }
    // Величина возвращается к прежней ступени, если её ставил этот шаг.
    if (applied.size && (Number(actor.system.size) || 4) === applied.size.to)
        update["system.size"] = applied.size.from;
    // Удвоение снимается возвратом прежнего множителя.
    for (const [key, was] of Object.entries(applied.unnaturalMultiplier ?? {}))
        if (actor.system.characteristics?.[key])
            update[`system.characteristics.${key}.unnaturalMultiplier`] = was;
    // Прибавку к бонусу забираем тем же порядком, что и выдали.
    for (const [key, value] of Object.entries(applied.unnatural ?? {})) {
        const current = actor.system.characteristics?.[key];
        if (current) update[`system.characteristics.${key}.unnatural`] =
            Math.max(0, (Number(current.unnatural) || 0) - value);
    }
    // Если после выдачи навык подняли ещё выше, трогать его нельзя: этот шаг его
    // больше не держит.
    for (const [key, record] of Object.entries(applied.skills ?? {})) {
        if (actor.system.skills?.[key]?.advance !== record.to) continue;
        update[`system.skills.${key}.advance`] = record.from;
        update[`system.skills.${key}.starter`] = !!record.starterWas;
    }

    for (const spec of applied.specialities ?? []) {
        const path = `system.skills.${spec.key}.specialities`;
        // Созданную выдачей специализацию убираем целиком; существовавшую — возвращаем:
        // она часть списка навыка, а не наша.
        if (spec.created) { update[`${path}.-=${spec.specKey}`] = null; continue; }
        update[`${path}.${spec.specKey}.advance`] = spec.from ?? -20;
        update[`${path}.${spec.specKey}.starter`] = !!spec.starterWas;
    }

    if (applied.wounds) {
        update["system.wounds.max"] = Math.max(0, (actor.system.wounds?.max ?? 0) - applied.wounds);
    }
    for (const key of ["corruption", "insanity"])
        if (applied[key]) update[`system.${key}`] = Math.max(0, (actor.system[key] ?? 0) - applied[key]);

    if (applied.influence) {
        const current = actor.system.characteristics?.influence;
        if (current) update["system.characteristics.influence.base"] = (current.base ?? 0) - applied.influence;
    }

    return update;
}
