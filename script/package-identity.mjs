export const SYSTEM_ID = "apex-heresy-ru";
export const LEGACY_DATA_SCOPE = "dark-heresy";
// Collection references omit the leading "Compendium." used by UUIDs.
const PACK_NAMES = new Set(["black-crusade", "dark-heresy", "rogue-trader", "only-war", "deathwatch", "origins", "bc-tables"]);
const PACK_REFERENCE_KEYS = new Set(["documentCollection", "pack", "collection"]);

/**
 * The installable package has its own ID; existing worlds deliberately retain
 * their settings and flags namespace. Foundry's flag helpers reject an inactive
 * package scope, but Document.update accepts these valid, existing flag keys.
 * Keep writes targeted so unrelated system and module flags survive unchanged.
 */
export function getLegacyFlag(document, key) {
    if (!document) return undefined;
    if (document.flags === undefined && useLegacyAPI(document, "getFlag")) {
        return document.getFlag(LEGACY_DATA_SCOPE, key);
    }
    const flags = document.flags?.[LEGACY_DATA_SCOPE];
    if (!key || !flags) return undefined;
    // Match getProperty: a literal key takes precedence over dotted traversal.
    if (key in flags) return flags[key];
    let value = flags;
    for (const part of key.split(".")) {
        if (!value || !["object", "function"].includes(typeof value) || !(part in value)) return undefined;
        value = value[part];
    }
    return value;
}

export async function setLegacyFlag(document, key, value) {
    validateFlagKey(key);
    if (typeof document?.update !== "function" && useLegacyAPI(document, "setFlag")) {
        return document.setFlag(LEGACY_DATA_SCOPE, key, value);
    }
    return document.update({[`flags.${LEGACY_DATA_SCOPE}.${key}`]: value});
}

export async function unsetLegacyFlag(document, key) {
    validateFlagKey(key);
    if (typeof document?.update !== "function" && useLegacyAPI(document, "unsetFlag")) {
        return document.unsetFlag(LEGACY_DATA_SCOPE, key);
    }
    const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
    if (ForcedDeletion) {
        return document.update({[`flags.${LEGACY_DATA_SCOPE}.${key}`]: new ForcedDeletion()});
    }
    // Foundry 13 uses a deletion marker on the final path segment.
    const parts = key.split(".");
    parts[parts.length - 1] = `-=${parts.at(-1)}`;
    return document.update({[`flags.${LEGACY_DATA_SCOPE}.${parts.join(".")}`]: null});
}

function useLegacyAPI(document, method) {
    // This also supports documents supplied by consumers of the previous API.
    // The independent package never calls the now-invalid legacy scope helpers.
    return globalThis.game?.system?.id !== SYSTEM_ID && typeof document?.[method] === "function";
}

function validateFlagKey(key) {
    const forbidden = new Set(["__proto__", "prototype", "constructor"]);
    if (typeof key !== "string" || !key || key.split(".").some(part => !part || forbidden.has(part))) {
        throw new TypeError("A flag key must be a non-empty, safe dotted property path.");
    }
}

/**
 * Copy serialized document data and update package resource references only.
 * Settings, flag scopes, sheet registrations and historical system IDs remain
 * intact. Macro command code is intentionally left for explicit human review.
 */
export function rewriteLegacyReferences(data) {
    return copyReferences(data, true);
}

function copyReferences(value, rewrite, key) {
    if (typeof value === "string") {
        if (rewrite && PACK_REFERENCE_KEYS.has(key) && value.startsWith(`${LEGACY_DATA_SCOPE}.`)
            && PACK_NAMES.has(value.slice(LEGACY_DATA_SCOPE.length + 1))) {
            return `${SYSTEM_ID}.${value.slice(LEGACY_DATA_SCOPE.length + 1)}`;
        }
        return rewrite ? value.replaceAll("systems/dark-heresy/", "systems/apex-heresy-ru/")
            .replaceAll("Compendium.dark-heresy.", "Compendium.apex-heresy-ru.") : value;
    }
    if (Array.isArray(value)) return value.map(entry => copyReferences(entry, rewrite));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
            [key, copyReferences(entry, rewrite && key !== "command", key)]));
    }
    return value;
}
