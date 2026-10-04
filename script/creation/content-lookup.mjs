import {matchesRuleName} from "../localization/rule-name.mjs";
// ════════════════════════════════════════════════════════════════════════
//  Поиск выданного предмета в компендиумах по имени.
//
//  Имя в выдаче — ссылка, а не текст: оно обязано находиться. Ровного
//  совпадения для этого мало по двум причинам.
//
//  Специалистский талант лежит в паке ОДНОЙ записью с «*» в имени, а
//  специализация дописывается уже на листе: «Weapon Training (Las)» — это
//  копия «Weapon Training*», переименованная при выдаче. Своего поля под
//  специализацию у таланта в системе нет (template.json, Item.talent).
//
//  И регистр с пробелами в паке гуляет: «Medi-kit» против «Medi-Kit»,
//  «Clues from  the Crowds» с двойным пробелом.
//
//  Модуль чистый: индекс — обычный массив, поэтому правило проверяется
//  тестами без запуска мира.
// ════════════════════════════════════════════════════════════════════════

/** Ключ сравнения: регистр и лишние пробелы значения не имеют. */
export function normaliseName(name) {
    return String(name ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Имя без уточнения в скобках: «Weapon Training (Las)» → «Weapon Training».
 * Скобки по книге всегда идут в конце и всегда означают специализацию.
 */
export function baseName(name) {
    return String(name ?? "").replace(/\s*\([^()]*\)\s*$/, "").trim();
}

/**
 * Имена, которыми стоит искать, в порядке убывания точности.
 *
 * @param {string} name
 * @returns {string[]}
 */
export function lookupCandidates(name) {
    const exact = String(name ?? "").trim();
    const base = baseName(exact);
    if (!base || base === exact) return [exact];
    // «*» — пометка специалистского таланта в паке dark-heresy; в других паках
    // та же запись лежит без неё.
    return [exact, `${base}*`, base];
}

/**
 * Найти запись компендиума под нужное имя.
 *
 * @param {{name: string, type: string}[]} index  записи компендиумов
 * @param {string[]} types                        подходящие типы предметов
 * @param {string} name                           имя из выдачи
 * @returns {object|null}
 */
export function findContent(index, types, name) {
    const allowed = new Set(types);
    for (const candidate of lookupCandidates(name)) {
        const key = normaliseName(candidate);
        const hit = index.find(entry => allowed.has(entry.type) && matchesRuleName(entry, key));
        if (hit) return hit;
    }
    return null;
}

/**
 * Какие типы предметов считаются тем или иным видом выдачи.
 *
 * Держится здесь, а не в окне Мастера: тот же список нужен тесту, который проверяет,
 * что каждое выданное имя находится в паках, а окно тест импортировать не может.
 */
export const GRANT_ITEM_TYPES = {
    talent: ["talent"],
    // Особая способность: Solo Mode ордена и способность специальности Deathwatch
    // лежат в паке предметами, а не строкой в описании.
    ability: ["specialAbility"],
    trait: ["trait"],
    equipment: ["weapon", "armour", "gear", "tool", "ammunition", "drug", "cybernetic", "forceField",
                "weaponModification"]
};
