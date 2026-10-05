/** Original English identity used by name-based rules after Babele translation.
 * A subsequently specialised English name (e.g. Weapon Training (Las)) wins
 * over the base name left in Babele flags by the compendium import.
 */
export function ruleName(document) {
    if (typeof document === 'string') return document;
    const name = String(document?.name ?? '');
    if (!/[А-Яа-яЁё]/u.test(name)) return name;
    return String(document?.flags?.babele?.originalName ?? document?.originalName ?? name);
}
export function matchesRuleName(document, name) {
    const normalise = value => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    return normalise(document?.name) === normalise(name) || normalise(ruleName(document)) === normalise(name);
}
