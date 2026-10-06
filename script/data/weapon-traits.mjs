const numbered = new Set(['rfFace','devastating','proven','primitive','felling','toxic','concussive',
    'snare','hallucinogenic','smoke','haywire','blast']);
const boolean = ['accurate','razorSharp','skipAttackRoll','tearing','storm','twinLinkedBonus','toxicUnrated',
    'twinLinked','force','inaccurate','unwieldy','reliable','unreliable','unbalanced','overheating',
    'shock','warpWeapon','scatter','maximal','lasSetting','recharge','melta','gyroStabilised','flame',
    'corrosive','balanced','defensive','flexible','powerField','tainted','sanctified'];

export const WEAPON_TRAIT_TYPES = Object.freeze(Object.fromEntries([
    ...boolean.map(key=>[key,'boolean']), ...[...numbered].map(key=>[key,'number']), ['crippling','string']
]));

/** An absent key inherits text; false explicitly disables a property, including numbered ones. */
export function validateTraitOverrides(overrides = {}) {
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Weapon traits must be an object');
    for (const [key,value] of Object.entries(overrides)) {
        const type = Object.hasOwn(WEAPON_TRAIT_TYPES,key) ? WEAPON_TRAIT_TYPES[key] : undefined;
        if (!type) throw new Error(`Unknown weapon trait: ${key}`);
        if (value === false) continue;
        const valid = type === 'number' ? Number.isInteger(value) && value >= 0
            : type === 'string' ? typeof value === 'string' && value.trim().length > 0
            : typeof value === 'boolean';
        if (!valid) throw new Error(`Invalid weapon trait value: ${key}`);
    }
    return overrides;
}

export function applyTraitOverrides(parsed, overrides = {}) {
    return {...parsed, ...validateTraitOverrides(overrides)};
}

export function traitOverridesFromRows(rows) {
    const result = {};
    for (const {key,mode,value} of rows) {
        if (!Object.hasOwn(WEAPON_TRAIT_TYPES,key)) throw new Error(`Unknown weapon trait: ${key}`);
        if (mode === 'inherit') continue;
        if (mode === 'off') { result[key] = false; continue; }
        if (mode !== 'value') throw new Error(`Invalid trait mode: ${key}`);
        const type = WEAPON_TRAIT_TYPES[key];
        if (type === 'number' && String(value ?? '').trim() === '') throw new Error(`Missing trait value: ${key}`);
        result[key] = type === 'boolean' ? true : type === 'number' ? Number(value) : String(value ?? '').trim();
    }
    return validateTraitOverrides(result);
}

/** Compare only edited keys; leave unrelated changes made since opening the editor intact. */
export function traitOverridePatch(before, after, current = before) {
    validateTraitOverrides(before); validateTraitOverrides(after); validateTraitOverrides(current);
    const patch = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (before[key] === after[key]) continue;
        if (current[key] !== before[key] && current[key] !== after[key]) throw new Error(`Trait edit conflict: ${key}`);
        if (Object.hasOwn(after,key)) patch[`system.traitOverrides.${key}`] = after[key];
        else patch[`system.traitOverrides.-=${key}`] = null;
    }
    return patch;
}

/** Later sources win only for the keys they actually affect. No stored source is mutated. */
export function editTraitOverrides(overrides, added, removed, parse) {
    const result = {...validateTraitOverrides(overrides)};
    const removalText = String(removed ?? '').split(/[,;\n]/).map(token=>token.includes('(') ? token : `${token} (0)`).join(', ');
    for (const [key,value] of Object.entries(parse(removalText))) if (value !== false && value !== undefined) result[key] = false;
    for (const [key,value] of Object.entries(parse(added))) if (value !== false && value !== undefined) result[key] = value;
    return result;
}
