import {ruleName} from "../localization/rule-name.mjs";
// ════════════════════════════════════════════════════════════════════════
//  Трата стартового опыта (Dark Heresy, стр. 78-81): что можно купить, почём,
//  и какая запись на лист у каждой покупки.
//
//  Покупка пишет в ТЕ ЖЕ поля, что читает движок опыта системы: прибавка к
//  характеристике — в advance (не в base: там стартовое значение), ранг навыка —
//  в advance навыка или специализации, талант — предметом со starter: false. Цена
//  пишется в поле cost, чтобы остаток на листе сходился и при выключенном
//  автоподсчёте.
//
//  Ступени проходят подряд (стр. 80), поэтому предлагается всегда только
//  СЛЕДУЮЩАЯ, а вернуть можно только верхнюю.
//
//  Модуль чистый: на вход — снимок актора, на выход — нагрузка для update.
// ════════════════════════════════════════════════════════════════════════

import {characteristicLadder, SKILL_LEVELS, CHARACTERISTIC_STEP, advanceCost, matchingAptitudes}
    from "./advancement-data.mjs";
import {patronRelation, BC_CHARACTERISTIC_PATRONS, BC_SKILL_PATRONS, infamyAdvanceCost}
    from "./patron-data.mjs";
import {patronOf} from "./bc-talents.mjs";

/** Влияние не покупается за опыт (стр. 79). */
export const UNPURCHASABLE_CHARACTERISTICS = ["influence"];

/**
 * Что нельзя купить в этой книге.
 *
 * У Black Crusade на месте Влияния стоит Тёмная слава, и она как раз покупается —
 * только по своей цене и до сорока (стр. 78). Поэтому список зависит от книги.
 */
export function unpurchasableIn(ruleset) {
    return ruleset === "bc" ? [] : UNPURCHASABLE_CHARACTERISTICS;
}

/**
 * Кем приходится бог покупки покровителю персонажа.
 *
 * Вне Black Crusade понятие бессмысленно, и отношение не считается вовсе: цену
 * там решают склонности.
 */
function relationIn(snapshot, god) {
    if (snapshot.ruleset !== "bc") return null;
    return patronRelation(snapshot.patron, god);
}

/** Сокращения, которыми книга пишет пороги в предпосылках: «Ag 30», «WP 40». */
export const CHARACTERISTIC_ABBREVIATIONS = {
    ws: "weaponSkill", bs: "ballisticSkill", s: "strength", t: "toughness", ag: "agility",
    int: "intelligence", per: "perception", wp: "willpower", fel: "fellowship", inf: "influence"
};

/** Ступень навыка по advance: -20 — не обучен, 0/10/20/30 — Known..Veteran. */
export function skillLevelIndex(advance) {
    const value = Number(advance ?? -20);
    return value < 0 ? -1 : Math.floor(value / 10);
}

const signed = value => `${value > 0 ? "+" : ""}${value}`;

/**
 * Характеристики, которые можно поднять, со следующей ступенью и её ценой.
 * @param {object} snapshot  {characteristics, aptitudes, ruleset}
 */
export function characteristicOffers(snapshot) {
    const offers = [];
    const ladder = characteristicLadder(snapshot.ruleset);
    const infamyKey = snapshot.ruleset === "bc" ? "influence" : null;
    for (const [key, entry] of Object.entries(snapshot.characteristics ?? {})) {
        if (unpurchasableIn(snapshot.ruleset).includes(key)) continue;
        const steps = Math.floor((Number(entry.advance) || 0) / CHARACTERISTIC_STEP);
        const matched = matchingAptitudes(snapshot.aptitudes, entry.aptitudes);
        // Тёмная слава вне лестницы: ровно 500 за каждые +5, пока она ниже сорока.
        if (key === infamyKey) {
            const value = Number(entry.total ?? entry.base ?? 0) || 0;
            const cost = infamyAdvanceCost(value);
            offers.push({key, steps, matched: 0, relation: "own", nextLevel: cost ? "infamy" : null,
                         cost, maxed: !cost, infamy: true});
            continue;
        }
        // Deathwatch цену не выводит: она напечатана в самой специальности, четырьмя
        // числами на характеристику (стр. 58). Склонностей и покровителя там нет.
        const printed = snapshot.characteristicCosts?.[key];
        if (printed) {
            const cost = printed[steps] ?? null;
            offers.push({key, steps, matched: 0, relation: null, nextLevel: cost ? "listed" : null,
                         cost, maxed: !cost, printedSteps: printed.length});
            continue;
        }
        const relation = relationIn(snapshot, BC_CHARACTERISTIC_PATRONS[key]);
        const nextLevel = ladder.levels[steps] ?? null;
        offers.push({
            key, steps, matched, nextLevel, relation,
            cost: nextLevel ? advanceCost("characteristic", nextLevel, matched, snapshot.ruleset, relation) : null,
            maxed: !nextLevel
        });
    }
    return offers;
}

/**
 * Навыки и специализации, которые можно поднять.
 *
 * У специалистского навыка предлагаются только специализации, которые уже есть на
 * листе хотя бы на Known: их двадцать с лишним на навык, и список «купить Known в
 * каждой» был бы стеной. Новая специализация покупается отдельно, по имени.
 *
 * @param {object} snapshot  {skills, aptitudes}
 */
export function skillOffers(snapshot) {
    const offers = [];
    const offer = (key, specKey, label, entry, skill) => {
        const index = skillLevelIndex(entry.advance);
        const nextLevel = SKILL_LEVELS[index + 1] ?? null;
        const matched = matchingAptitudes(snapshot.aptitudes, skill.aptitudes);
        const relation = relationIn(snapshot, BC_SKILL_PATRONS[key]);
        offers.push({
            key, specKey, label, matched, relation,
            level: SKILL_LEVELS[index] ?? null,
            nextLevel,
            cost: nextLevel ? advanceCost("skill", nextLevel, matched, snapshot.ruleset, relation) : null,
            maxed: !nextLevel
        });
    };
    for (const [key, skill] of Object.entries(snapshot.skills ?? {})) {
        if (!skill.isSpecialist) { offer(key, null, skill.label ?? key, skill, skill); continue; }
        for (const [specKey, speciality] of Object.entries(skill.specialities ?? {}))
            if (skillLevelIndex(speciality.advance) >= 0)
                offer(key, specKey, speciality.label ?? specKey, speciality, skill);
    }
    return offers;
}

/** Имя навыка без регистра, пробелов и дефисов: книга пишет и «Tech-Use», и «Tech Use». */
const skillName = text => String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Лучший ранг (advance) навыка по имени из текста книги, или null, если такого навыка нет.
 * «Common Lore (War)» — конкретная специализация; «Common Lore» или «any Common Lore» —
 * лучшая из имеющихся.
 */
function skillAdvance(skills, text) {
    const bracket = /^(.+?)\s*\((.+)\)$/.exec(String(text).trim());
    const wanted = skillName(bracket ? bracket[1] : text);
    for (const [key, skill] of Object.entries(skills ?? {})) {
        if (skillName(skill.label ?? key) !== wanted && skillName(key) !== wanted) continue;
        if (!skill.isSpecialist) return Number(skill.advance ?? -20);
        const specialities = Object.entries(skill.specialities ?? {});
        // «(Xenos–Any)» — любая специализация, начинающаяся с «Xenos»; «(Any)» — любая.
        const anyOf = bracket && /\bany\b/i.test(bracket[2]) ? skillName(bracket[2].replace(/\bany\b/i, "")) : null;
        if (bracket && anyOf === null) {
            const spec = specialities.find(([specKey, entry]) =>
                [entry.label, specKey].some(name => skillName(name) === skillName(bracket[2])));
            return spec ? Number(spec[1].advance ?? -20) : -20;
        }
        if (anyOf) return Math.max(-20, ...specialities
            .filter(([specKey, entry]) => [entry.label, specKey].some(name => skillName(name).startsWith(anyOf)))
            .map(([, entry]) => Number(entry.advance ?? -20)));
        return Math.max(-20, ...specialities.map(([, entry]) => Number(entry.advance ?? -20)));
    }
    return null;
}

/**
 * Проверка предпосылок таланта по тексту книги.
 *
 * Читаются: порог характеристики полным именем или сокращением («Willpower 50», «Ag 30»),
 * навык («Awareness», «Awareness +10», «Rank 2 (Trained) in any Operate skill»), имеющийся
 * талант или черта, талант книги, которого у персонажа нет (snapshot.talentNames), и
 * альтернативы через «or». Остальное («Psy rating», импланты) помечается «проверить
 * вручную» и покупку не блокирует: запретить по тому, что не удалось прочитать, хуже,
 * чем разрешить.
 *
 * @param {string} text
 * @param {object} snapshot  {characteristicValues, skills, talents, traits, talentNames?}
 * @param {Record<string, string>} characteristicNames  «willpower» → willpower, «wp» → willpower
 * @returns {{text: string, status: "met"|"unmet"|"unknown"}[]}
 */
export function checkPrerequisites(text, snapshot, characteristicNames) {
    const raw = String(text ?? "").trim();
    if (!raw || /^none$/i.test(raw) || raw === "—" || raw === "-") return [];

    // Предпосылкой бывает и другая сила («Endurance» у Iron Arm, Only War стр. 230).
    const owned = new Set([...(snapshot.talents ?? []), ...(snapshot.traits ?? []), ...(snapshot.powers ?? [])]
        .map(entry => ruleName(entry).toLowerCase().replace(/\*$/, "").trim()));
    const talentNames = snapshot.talentNames ?? new Set();
    const meets = (advance, required) => advance === null ? "unknown" : advance >= required ? "met" : "unmet";

    const single = part => {
        const threshold = /^(.+?)\s+(\d+)\+?$/.exec(part);
        const key = threshold && characteristicNames[threshold[1].trim().toLowerCase()];
        if (key) return Number(snapshot.characteristicValues?.[key] ?? 0) >= Number(threshold[2]) ? "met" : "unmet";

        // Рейтинг пси — не характеристика, но пишется так же: «Psy rating 3».
        const psy = /^psy\s*rating\s+(\d+)$/i.exec(part);
        if (psy) return (Number(snapshot.psyRating) || 0) >= Number(psy[1]) ? "met" : "unmet";

        // Ранг N — это advance (N-1)·10: Known 0, Trained 10, Experienced 20, Veteran 30.
        const rank = /^rank\s+(\d)\s*(?:\([^)]*\))?\s+in\s+(?:the\s+)?(?:any\s+)?(.+?)(?:\s+skills?)?$/i.exec(part);
        if (rank) return meets(skillAdvance(snapshot.skills, rank[2]), (Number(rank[1]) - 1) * 10);
        const bonus = /^(.+?)\s*\+(\d+)$/.exec(part);
        if (bonus) return meets(skillAdvance(snapshot.skills, bonus[1]), Number(bonus[2]));

        const name = part.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "").trim();
        if (owned.has(part.toLowerCase()) || (owned.has(name) && !/\(/.test(part))) return "met";
        const skill = skillAdvance(snapshot.skills, part);
        if (skill !== null) return meets(skill, 0);
        if (owned.has(name) && !talentNames.has(name)) return "met";
        if (talentNames.has(name)) return "unmet";
        return "unknown";
    };

    return raw.split(/,(?![^(]*\))/).map(part => part.trim()).filter(Boolean).map(part => {
        const statuses = part.split(/\s+or\s+(?![^(]*\))/i).map(option => single(option.trim()));
        const status = statuses.includes("met") ? "met"
            : statuses.every(entry => entry === "unmet") ? "unmet" : "unknown";
        return {text: part, status};
    });
}

/**
 * Таланты, которые можно взять, с ценой и состоянием предпосылок.
 *
 * @param {{name: string, tier: number, aptitudes: string, prerequisites: string, uuid?: string}[]} catalogue
 * @param {object} snapshot
 * @param {Record<string, string>} characteristicNames
 */
export function talentOffers(catalogue, snapshot, characteristicNames) {
    const owned = new Set((snapshot.talents ?? []).map(entry => ruleName(entry).toLowerCase()));
    // Имена талантов из самого каталога: предпосылка «Frenzy» — талант, которого может не быть.
    const withNames = {...snapshot, talentNames: new Set((catalogue ?? [])
        .map(entry => ruleName(entry).toLowerCase().replace(/\*$/, "").trim()))};
    const offers = [];
    for (const entry of catalogue ?? []) {
        const tier = Number(entry.tier);
        if (!(tier >= 1 && tier <= 3)) continue;
        // Специалистский талант («Weapon Training*») берут много раз с разными
        // специализациями, поэтому уже имеющаяся копия его не прячет.
        const specialist = ruleName(entry).endsWith("*");
        if (!specialist && owned.has(ruleName(entry).toLowerCase())) continue;
        const aptitudes = String(entry.aptitudes ?? "").split(",").map(part => part.trim()).filter(Boolean);
        const matched = matchingAptitudes(snapshot.aptitudes, aptitudes);
        const prerequisites = checkPrerequisites(entry.prerequisites, withNames, characteristicNames);
        const relation = relationIn(snapshot, patronOf({name: ruleName(entry), system: {patron: entry.patron}}));
        offers.push({
            name: entry.name, originalName: ruleName(entry), uuid: entry.uuid, tier, aptitudes, matched, specialist, relation,
            cost: advanceCost("talent", tier, matched, snapshot.ruleset, relation),
            prerequisites,
            blocked: prerequisites.some(check => check.status === "unmet")
        });
    }
    return offers.sort((a, b) => a.tier - b.tier || a.cost - b.cost || a.name.localeCompare(b.name));
}

/** Сумма цен набора покупок. */
export function spentOn(purchases) {
    return (purchases ?? []).reduce((total, purchase) => total + (Number(purchase.cost) || 0), 0);
}

/**
 * Покупка ступени характеристики.
 * @returns {{update: object, record: object}|null} null — покупать нечего
 */
export function purchaseCharacteristic(snapshot, key) {
    const offer = characteristicOffers(snapshot).find(entry => entry.key === key);
    if (!offer || offer.maxed) return null;
    const entry = snapshot.characteristics[key];
    const advance = (Number(entry.advance) || 0) + CHARACTERISTIC_STEP;
    // Поле cost — накопительная цена всех купленных ступеней: так его читает движок.
    // У Тёмной славы лестницы нет, каждая ступень стоит одинаково (стр. 78).
    let total = 0;
    const printed = snapshot.characteristicCosts?.[key];
    if (offer.infamy) total = (offer.steps + 1) * offer.cost;
    // Напечатанные цены накопительны так же, как лестница: пропустить ступень нельзя.
    else if (printed) for (let index = 0; index <= offer.steps; index++) total += printed[index] ?? 0;
    else for (let index = 0; index <= offer.steps; index++)
        total += advanceCost("characteristic", characteristicLadder(snapshot.ruleset).levels[index],
                             offer.matched, snapshot.ruleset, offer.relation);
    return {
        update: {
            [`system.characteristics.${key}.advance`]: advance,
            [`system.characteristics.${key}.cost`]: total
        },
        record: {kind: "characteristic", key, level: offer.nextLevel, cost: offer.cost,
                 fromAdvance: Number(entry.advance) || 0, fromCost: Number(entry.cost) || 0,
                 label: `${key} ${signed(CHARACTERISTIC_STEP)}`}
    };
}

/**
 * Покупка ранга навыка или специализации.
 * @returns {{update: object, record: object}|null}
 */
export function purchaseSkill(snapshot, key, specKey = null) {
    const offer = skillOffers(snapshot).find(entry => entry.key === key && (entry.specKey ?? null) === specKey);
    if (!offer || offer.maxed) return null;
    const skill = snapshot.skills[key];
    const entry = specKey ? skill.specialities[specKey] : skill;
    const path = specKey ? `system.skills.${key}.specialities.${specKey}` : `system.skills.${key}`;
    const nextIndex = skillLevelIndex(entry.advance) + 1;
    // Стартовый ранг бесплатен, и в cost он не входит — ровно так считает движок.
    let total = 0;
    for (let index = entry.starter ? 1 : 0; index <= nextIndex; index++)
        total += advanceCost("skill", SKILL_LEVELS[index], offer.matched, snapshot.ruleset, offer.relation);
    return {
        update: {[`${path}.advance`]: nextIndex * 10, [`${path}.cost`]: total},
        record: {kind: "skill", key, specKey, level: offer.nextLevel, cost: offer.cost,
                 fromAdvance: Number(entry.advance ?? -20), fromCost: Number(entry.cost) || 0,
                 label: specKey ? `${key} (${offer.label}) ${offer.nextLevel}` : `${key} ${offer.nextLevel}`}
    };
}

/**
 * Покупка новой специализации на Known — по имени, которого в списке навыка нет.
 * @returns {{update: object, record: object}|null}
 */
export function purchaseNewSpeciality(snapshot, key, name, specKey) {
    const skill = snapshot.skills?.[key];
    if (!skill?.isSpecialist || !String(name ?? "").trim() || skill.specialities?.[specKey]) return null;
    const matched = matchingAptitudes(snapshot.aptitudes, skill.aptitudes);
    const cost = advanceCost("skill", SKILL_LEVELS[0], matched);
    return {
        update: {[`system.skills.${key}.specialities.${specKey}`]:
                     {label: String(name).trim(), advance: 0, starter: false, cost}},
        record: {kind: "skill", key, specKey, level: SKILL_LEVELS[0], cost, created: true,
                 label: `${key} (${String(name).trim()}) ${SKILL_LEVELS[0]}`}
    };
}

/**
 * Возврат покупки. Можно вернуть только верхнюю ступень — иначе посередине лестницы
 * осталась бы дыра, которой не бывает по книге.
 *
 * @param {object} snapshot
 * @param {object} record  из purchase*
 * @returns {object|null}  null — эта покупка уже не верхняя
 */
export function refundUpdate(snapshot, record) {
    if (record.kind === "characteristic") {
        const entry = snapshot.characteristics?.[record.key];
        if (!entry) return null;
        const expected = record.fromAdvance + CHARACTERISTIC_STEP;
        if ((Number(entry.advance) || 0) !== expected) return null;
        return {[`system.characteristics.${record.key}.advance`]: record.fromAdvance,
                [`system.characteristics.${record.key}.cost`]: record.fromCost};
    }
    if (record.kind === "skill") {
        const skill = snapshot.skills?.[record.key];
        const path = record.specKey
            ? `system.skills.${record.key}.specialities.${record.specKey}` : `system.skills.${record.key}`;
        if (record.created) return {[`system.skills.${record.key}.specialities.-=${record.specKey}`]: null};
        const entry = record.specKey ? skill?.specialities?.[record.specKey] : skill;
        if (!entry) return null;
        const expected = (skillLevelIndex(record.fromAdvance) + 1) * 10;
        if (Number(entry.advance) !== expected) return null;
        return {[`${path}.advance`]: record.fromAdvance, [`${path}.cost`]: record.fromCost};
    }
    if (record.kind === "psyRating") {
        if ((Number(snapshot.psyRating) || 0) !== record.from + 1) return null;
        return {"system.psy.rating": record.from, "system.psy.cost": record.fromCost};
    }
    return null;
}
