import {ruleName} from "../localization/rule-name.mjs";
/**
 * Armour granted by creature traits.
 *
 * Natural Armour (DH2 p. 136): "Gain additional Armour points to all locations."
 * The trait's own text adds: "Natural Armour stacks with worn armour, but not
 * with the Machine trait."
 *
 * Machine (X) (DH2 p. 137): "Machines have a certain number of Armour points
 * (indicated by the number in parentheses). This armour stacks with worn armour,
 * but not with the Natural Armour trait", and it does not protect against Fire
 * (p. 243). That fire exclusion belongs to the damage path, not here, and it is
 * the printed rule rather than a defect: a creature burning in its own plating
 * is exactly what the book describes.
 *
 * Both traits printed a value that nothing in the system ever read.
 *
 * The value lives in the item's name, as "Machine (5)", because that is how the
 * books write it and how a GM adds it to a sheet.
 */

const PATTERNS = [
    {source: 'machine', pattern: /^\s*machine\s*\((\d+)\)/i},
    {source: 'naturalArmour', pattern: /^\s*natural\s+armou?r\s*\((\d+)\)/i}
];

/**
 * The Armour Points a creature's traits grant to every location.
 *
 * Machine and Natural Armour do not stack with each other, so the higher of the
 * two wins. Either stacks with worn armour, which is the caller's job.
 *
 * @param {Array} items the actor's items
 * @returns {{value: number, source: 'machine'|'naturalArmour'|null}}
 */
export function traitArmour(items) {
    let best = {value: 0, source: null};
    for (const item of items ?? []) {
        if (item?.type !== 'trait') continue;
        for (const {source, pattern} of PATTERNS) {
            const found = pattern.exec(ruleName(item));
            if (!found) continue;
            const value = Number(found[1]) || 0;
            if (value > best.value) best = {value, source};
        }
    }
    return best;
}
