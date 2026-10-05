import {ruleName} from "../localization/rule-name.mjs";
// ════════════════════════════════════════════════════════════════════════
//  Психосилы Dark Heresy: деревья дисциплин, цены и рейтинг пси.
//
//  Силу покупают, если к ней есть путь по дереву её дисциплины (стр. 199):
//  от верхней силы вниз, не проходя через силу, которой у персонажа нет.
//  Деревья в книге — рисунки, а не текст, поэтому связи и цены (Value) сняты
//  с рисунков вручную: Biomancy стр. 201, Divination 205, Pyromancy 207,
//  Telekinesis 210, Telepathy 213.
//
//  Цена силы не зависит от склонностей: это число из её статьи.
//  Рейтинг пси покупается по 200 × новый рейтинг (стр. 90, 193). Первый
//  рейтинг даёт сама элитка Psyker, у санкционированного — сразу второй
//  (черта Sanctioned, стр. 138), и за него тоже не платят.
//
//  Модуль чистый: ни одной глобали Foundry.
// ════════════════════════════════════════════════════════════════════════

import {checkPrerequisites} from "./shop-data.mjs";

export const PSY_RATING_STEP_COST = 200;
export const PSY_RATING_MAX = 10;

const power = (name, value, ...parents) => ({name, value, parents});

/** Пять дисциплин основной книги. Minor, Malefic и Sanctic в неё не входят. */
export const DISCIPLINES = [
    {key: "biomancy", label: "Biomancy", page: 201, powers: [
        power("Invigourate", 100),
        power("Smite", 200, "Invigourate"),
        power("Shape Flesh", 200, "Smite"),
        power("Enfeeble", 100, "Smite"),
        power("Iron Arm", 400, "Shape Flesh"),
        power("Endurance", 300, "Shape Flesh"),
        power("Life Leech", 400, "Enfeeble"),
        power("Warp Speed", 500, "Iron Arm", "Endurance"),
        power("Haemorrhage", 400, "Life Leech")
    ]},
    {key: "divination", label: "Divination", page: 205, powers: [
        power("Warp Perception", 100),
        power("Prescience", 200, "Warp Perception"),
        power("Foreboding", 200, "Warp Perception"),
        power("Misfortune", 300, "Foreboding"),
        power("Scrier's Gaze", 200, "Prescience"),
        power("Forewarning", 400, "Foreboding"),
        power("Precognition", 400, "Scrier's Gaze"),
        power("Winding Fate", 500, "Scrier's Gaze"),
        power("Perfect Timing", 300, "Forewarning")
    ]},
    {key: "pyromancy", label: "Pyromancy", page: 207, powers: [
        power("Manipulate Flame", 100),
        power("Fire Shield", 300, "Manipulate Flame"),
        power("Spontaneous Combustion", 200, "Manipulate Flame"),
        power("Fiery Form", 400, "Fire Shield"),
        power("Cauterise", 300, "Fire Shield"),
        power("Flame Breath", 300, "Spontaneous Combustion"),
        power("Molten Beam", 400, "Spontaneous Combustion"),
        power("Sunburst", 400, "Flame Breath"),
        power("Inferno", 500, "Molten Beam", "Sunburst")
    ]},
    {key: "telekinesis", label: "Telekinesis", page: 210, powers: [
        power("Telekinetic Control", 100),
        power("Assail", 200, "Telekinetic Control"),
        power("Telekine Shield", 200, "Assail"),
        power("Crush", 300, "Assail"),
        power("Objuration Mechanicum", 300, "Crush"),
        power("Telekine Dome", 300, "Telekine Shield"),
        power("Shockwave", 300, "Crush"),
        power("Gate of Infinity", 400, "Telekine Dome"),
        power("Vortex of Doom", 400, "Telekine Dome", "Shockwave")
    ]},
    // Mental Fortitude висит сбоку, между Dominate и Terrify: сверху к ней линии нет.
    {key: "telepathy", label: "Telepathy", page: 213, powers: [
        power("Telepathic Link", 100),
        power("Erasure", 100, "Telepathic Link"),
        power("Hallucination", 200, "Telepathic Link"),
        power("Psychic Shriek", 300, "Hallucination"),
        power("Dominate", 200, "Erasure"),
        power("Terrify", 400, "Hallucination"),
        power("Mental Fortitude", 300, "Dominate", "Terrify"),
        power("Invisibility", 400, "Terrify"),
        power("Puppet Master", 400, "Dominate", "Mental Fortitude", "Terrify")
    ]}
];

const lower = name => String(name ?? "").toLowerCase().trim();

/** Сколько опыта стоят купленные ступени рейтинга сверх бесплатного. */
export function psyRatingCost(rating, base = 1) {
    let total = 0;
    for (let next = Math.max(1, base) + 1; next <= rating; next++) total += PSY_RATING_STEP_COST * next;
    return total;
}

/**
 * Бесплатный стартовый рейтинг.
 *
 * Dark Heresy: 1, а у санкционированного псайкера 2 (черта Sanctioned, стр. 138).
 * Only War: санкционированный псайкер там один и начинает с 2 (стр. 95).
 */
export function psyBase(traits, ruleset = "dh2") {
    if (ruleset === "ow") return 2;
    return (traits ?? []).some(entry => lower(ruleName(entry)) === "sanctioned") ? 2 : 1;
}

/** Открыта ли сила: верхняя — всегда, остальные — через имеющегося родителя. */
export function powerAccessible(entry, ownedLower) {
    return !entry.parents.length || entry.parents.some(parent => ownedLower.has(lower(parent)));
}

/**
 * Силы по дисциплинам — с доступом, предпосылками и ценой.
 *
 * @param {{name: string, uuid: string, prerequisite: string}[]} catalogue  силы из пака
 * @param {object} snapshot  снимок магазина плюс {psyRating, powers: string[]}
 * @param {Record<string, string>} characteristicNames
 */
export function psychicOffers(catalogue, snapshot, characteristicNames) {
    const byName = new Map((catalogue ?? []).map(entry => [lower(entry.name), entry]));
    const owned = new Set((snapshot.powers ?? []).map(lower));
    return DISCIPLINES.map(discipline => ({
        key: discipline.key, label: discipline.label, page: discipline.page,
        powers: discipline.powers.map(entry => {
            const source = byName.get(lower(entry.name));
            const prerequisites = checkPrerequisites(source?.prerequisite ?? "", snapshot, characteristicNames);
            const accessible = powerAccessible(entry, owned);
            return {
                name: entry.name, uuid: source?.uuid ?? null, cost: entry.value, parents: entry.parents,
                owned: owned.has(lower(entry.name)), accessible, prerequisites,
                blocked: !accessible || !source || prerequisites.some(check => check.status === "unmet")
            };
        })
    }));
}

/**
 * Силы книги без деревьев: цена и предпосылки берутся из самой записи пака.
 *
 * Only War (стр. 229) деревьев не знает: сила требует других сил или характеристик,
 * и это записано в её предпосылке.
 *
 * @param {{name, uuid, cost, prerequisite, discipline}[]} catalogue
 */
export function catalogueOffers(catalogue, snapshot, characteristicNames) {
    const owned = new Set((snapshot.powers ?? []).map(lower));
    const patron = snapshot.patron || "undivided";
    // Кровавый бог витчей не терпит: выровненный на Кхорна не пользуется силами вовсе
    // и даже не считается псайкером, пока держится его пути (Black Crusade, стр. 79).
    const khorne = patron === "khorne";
    const groups = new Map();
    for (const entry of catalogue ?? []) {
        const key = entry.discipline || "Psychic Powers";
        if (!groups.has(key)) groups.set(key, {key: lower(key).replace(/[^a-z0-9]/g, ""), label: key, page: null, powers: []});
        const prerequisites = checkPrerequisites(entry.prerequisite ?? "", snapshot, characteristicNames);
        // Сила своего бога доступна только его преданным (стр. 79).
        const god = entry.patron && entry.patron !== "undivided" ? entry.patron : null;
        const wrongGod = !!god && god !== patron;
        if (khorne) prerequisites.push({text: "Not Aligned to Khorne", status: "unmet"});
        else if (wrongGod) prerequisites.push({text: `Devoted to ${god[0].toUpperCase()}${god.slice(1)}`, status: "unmet"});
        groups.get(key).powers.push({
            name: entry.name, uuid: entry.uuid ?? null, cost: Number(entry.cost) || 0, parents: [],
            patron: god, owned: owned.has(lower(entry.name)), accessible: true, prerequisites,
            blocked: khorne || wrongGod || prerequisites.some(check => check.status === "unmet")
        });
    }
    return [...groups.values()];
}

/** Силы книги: Dark Heresy идёт по деревьям, остальные — по записям пака. */
export function psychicOffersFor(ruleset, catalogue, snapshot, characteristicNames) {
    return ruleset === "dh2"
        ? psychicOffers(catalogue, snapshot, characteristicNames)
        : catalogueOffers(catalogue, snapshot, characteristicNames);
}

/** Следующая ступень рейтинга пси. */
export function psyRatingOffer(snapshot) {
    const rating = Number(snapshot.psyRating) || 0;
    const base = psyBase(snapshot.traits, snapshot.ruleset);
    const maxed = rating >= PSY_RATING_MAX;
    return {rating, next: maxed ? null : rating + 1, cost: maxed ? null : PSY_RATING_STEP_COST * (rating + 1),
            maxed, base};
}

/**
 * Покупка ступени рейтинга. Поле psy.cost — накопительная цена купленных ступеней:
 * так его читает движок опыта листа.
 * @returns {{update: object, record: object}|null}
 */
export function purchasePsyRating(snapshot) {
    const offer = psyRatingOffer(snapshot);
    if (offer.maxed || offer.rating < 1) return null;
    return {
        update: {"system.psy.rating": offer.next, "system.psy.cost": psyRatingCost(offer.next, offer.base)},
        record: {kind: "psyRating", from: offer.rating, fromCost: Number(snapshot.psyCost) || 0,
                 cost: offer.cost, label: `Psy Rating ${offer.next}`}
    };
}

/**
 * Что игрок на самом деле платит за силу. Санкционированный псайкер Only War
 * получает сил на 400 опыта даром (стр. 95): сначала тратится подарок, остаток —
 * из общего опыта. Считается одинаково и для кнопки, и для самой покупки.
 * @returns {{free: number, due: number}}
 */
export function powerPrice(cost, freeExperience = 0) {
    const free = Math.min(Math.max(0, Number(cost) || 0), Math.max(0, Number(freeExperience) || 0));
    return {free, due: (Number(cost) || 0) - free};
}
