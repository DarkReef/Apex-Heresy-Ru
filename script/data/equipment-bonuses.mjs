/** Equipment automation is opt-in metadata, independent of translated names. */
import {getLegacyFlag} from '../package-identity.mjs';
const entries = collection => collection?.contents ?? (typeof collection?.values === 'function' ? [...collection.values()] : collection ?? []);
const metadata = effect => effect?.flags?.['dark-heresy']?.equipmentBonus;
export const equipmentBonusMetadata = metadata;

/** Localize only newly supplied catalog names; never rename a custom effect. */
export function localizeEquipmentEffectNames(source, localize = key => key) {
    const effects = structuredClone(source ?? []);
    let changed = false;
    for (const effect of effects) {
        if (!metadata(effect)?.id || !effect.name?.startsWith('EQUIPMENT_BONUS.')) continue;
        const name = localize(effect.name);
        if (typeof name !== 'string' || !name.trim() || name === effect.name) continue;
        effect.name = name;
        changed = true;
    }
    return {effects, changed};
}

function sourceItem(effect, actor) {
    if (effect?.parent?.documentName === 'Item') return effect.parent;
    if (!actor || typeof effect?.origin !== 'string') return null;
    return entries(actor.items).find(item => item.uuid &&
        (effect.origin === item.uuid || effect.origin.startsWith(`${item.uuid}.`))) ?? null;
}

/** Never use effect.active here: isSuppressed delegates to this function. */
function eligible(effect, actor, ruleset, conditional) {
    const rule = metadata(effect);
    if (!rule?.id || ruleset !== 'ow' || !!rule.conditional !== conditional) return false;
    if (effect.disabled || effect.duration?.expired || effect.system?.isSuppressed) return false;
    const item = sourceItem(effect, actor);
    if (!item || item.parent !== actor) return false;
    if (item.system?.inventory?.containerId || !(Number(item.system?.quantity ?? 1) > 0)) return false;
    if (item.type === 'forceField' && getLegacyFlag(item, 'overloaded')) return false;
    const activation = effect.flags?.['dark-heresy']?.activation ?? 'equipped';
    if (activation === 'installed') {
        if (item.type !== 'cybernetic' || item.system?.installed !== true) return false;
    } else if (activation !== 'always' && item.system?.equipped !== true) return false;
    if (Array.isArray(rule.quality) && !rule.quality.includes(item.system?.craftsmanship ?? 'common')) return false;
    const itemEffect = effect.parent?.documentName === 'Item';
    return conditional ? itemEffect && effect.transfer === false : !itemEffect || effect.transfer !== false;
}

function candidates(actor) {
    return [...entries(actor?.effects), ...entries(actor?.items).flatMap(item => entries(item.effects))];
}

function stableKey(effect, actor) {
    const item = sourceItem(effect, actor);
    // Native item effects win over old actor copies of the same managed rule.
    return `${effect.parent?.documentName === 'Item' ? '0' : '1'}:${item?.id ?? item?._id ?? ''}:${effect.id ?? effect._id ?? ''}`;
}

/** Exactly one eligible copy of a catalog rule may contribute to an actor. */
export function equipmentEffectApplies(effect, actor, {ruleset = actor?.system?.ruleset} = {}) {
    const conditional = !!metadata(effect)?.conditional;
    if (!eligible(effect, actor, ruleset, conditional)) return false;
    const id = metadata(effect).id;
    const eligibleCopies = candidates(actor).filter(candidate => metadata(candidate)?.id === id
        && eligible(candidate, actor, ruleset, conditional));
    eligibleCopies.sort((a, b) => stableKey(a, actor).localeCompare(stableKey(b, actor)));
    return !eligibleCopies.length || eligibleCopies[0] === effect;
}

export function equipmentItemEquippable(item) {
    return entries(item?.effects).some(effect => metadata(effect)?.id
        && effect.flags?.['dark-heresy']?.activation === 'equipped');
}

function selectorMatches(selector, roll) {
    if (typeof selector !== 'string') return false;
    if (selector.startsWith('characteristic:')) return !roll.skillKey && !!roll.characteristicKey
        && (selector.slice(15) === '*' || selector.slice(15) === roll.characteristicKey);
    if (selector.startsWith('basedOn:')) return !!roll.characteristicKey
        && (selector.slice(8) === '*' || selector.slice(8) === roll.characteristicKey);
    if (!selector.startsWith('skill:') || !roll.skillKey) return false;
    const requested = selector.slice(6);
    const current = `${roll.skillKey}${roll.specialityKey ? `.${roll.specialityKey}` : ''}`;
    return requested === '*' || requested === roll.skillKey || requested === current
        || requested.endsWith('.*') && current.startsWith(requested.slice(0, -1));
}

function bonusValue(effect) {
    const changes = effect.system?.changes ?? effect.changes ?? [];
    // Catalog choices represent one situational bonus. Unknown formulas and
    // operations must remain manual rather than execute arbitrary rule code.
    if (changes.length !== 1 || changes.some(change => (change.type ?? (change.mode === 2 ? 'add' : '')) !== 'add'
        || !Number.isFinite(Number(change.value)) || String(change.value).trim() === '')) return null;
    return changes.reduce((sum, change) => sum + Number(change.value), 0);
}

/** UI candidates contain no document references, so chat snapshots serialize. */
export function conditionalEquipmentBonuses(actor, roll, {ruleset = actor?.system?.ruleset, allCharacteristics = false, localize = key => key} = {}) {
    if (!actor || ruleset !== 'ow' || roll.flags?.isEvasion || roll.flags?.isAttack) return [];
    const possibleRolls = allCharacteristics && roll.characteristics?.length
        ? roll.characteristics.map(characteristic => ({...roll, characteristicKey: characteristic.key})) : [roll];
    return candidates(actor).filter(effect => metadata(effect)?.conditional
        && equipmentEffectApplies(effect, actor, {ruleset}))
        .flatMap(effect => {
            const rule = metadata(effect), selectors = Array.isArray(rule.selectors) ? rule.selectors : [];
            if (!possibleRolls.some(candidate => selectors.some(selector => typeof selector === 'string' && selectorMatches(selector, candidate)))) return [];
            const value = bonusValue(effect);
            if (value === null || !value) return [];
            const item = sourceItem(effect, actor);
            return [{id: `${item.id ?? item._id}:${effect.id ?? effect._id}`, ruleId: rule.id,
                name: item.name, condition: localize(effect.name), value, signed: `${value > 0 ? '+' : ''}${value}`,
                selectors: [...selectors], matches: selectors.some(selector => selectorMatches(selector, roll))}];
        });
}

/** Revalidate checked choices at roll time; a Fate reroll uses its saved state. */
export function snapshotEquipmentBonuses(actor, roll, options = {}) {
    if (!roll.flags?.isReRoll) {
        const selected = new Set(Array.isArray(roll.equipmentBonusSelection) ? roll.equipmentBonusSelection : []);
        roll.equipmentBonusSnapshot = conditionalEquipmentBonuses(actor, roll, options)
            .filter(choice => selected.has(choice.id)).map(({id, ruleId, name, condition, value}) => ({id, ruleId, name, condition, value}));
    }
    const rows = roll.equipmentBonusSnapshot ?? [];
    roll.equipmentBonusModifier = rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
    roll.equipmentBonusSources = rows.map(row => `${row.name}: ${row.condition} (${row.value > 0 ? '+' : ''}${row.value})`).join(', ');
    return roll.equipmentBonusModifier;
}
