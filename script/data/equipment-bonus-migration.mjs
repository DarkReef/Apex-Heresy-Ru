import {OW_EQUIPMENT_CATALOG} from './ow-equipment-catalog.mjs';

const SOURCE = /^Compendium\.(?:dark-heresy|apex-heresy-ru)\.only-war\.(?:Item\.)?([A-Za-z0-9]{16})$/;
const values = collection => collection?.contents ?? (collection?.values ? [...collection.values()] : collection ?? []);
const metadata = effect => effect?.flags?.['dark-heresy']?.equipmentBonus;
const changes = effect => effect?.system?.changes ?? effect?.changes ?? [];

/** Only a verified package origin or the shipped content marker identifies a rule. */
export function equipmentEntryFor(item) {
    const flags = item?.flags ?? item?._source?.flags ?? {};
    const marker = flags['dark-heresy']?.owEquipmentSource;
    const origins = [item?._stats?.compendiumSource, item?._source?._stats?.compendiumSource, flags.core?.sourceId];
    const sourceIds = origins.map(origin => typeof origin === 'string' ? SOURCE.exec(origin)?.[1] : null).filter(Boolean);
    if (typeof marker === 'string') sourceIds.unshift(marker);
    return OW_EQUIPMENT_CATALOG.find(entry => entry.type === item?.type && sourceIds.includes(entry.sourceId)) ?? null;
}

/** Add missing supplied effects; never overwrite a user's effect or numeric item data. */
export function planEquipmentBonusMigration(item) {
    const entry = equipmentEntryFor(item);
    if (!entry) return {effects:[], skipped:[], sourceId:null};
    const existing = values(item.effects ?? item._source?.effects);
    const actor = item.actor ?? (item.parent?.documentName === 'Actor' ? item.parent : null);
    const relatedActorEffects = values(actor?.effects).filter(effect => item.uuid &&
        (effect.origin === item.uuid || effect.origin?.startsWith(`${item.uuid}.`)));
    const managed = new Set([...existing, ...relatedActorEffects].map(effect => metadata(effect)?.id).filter(Boolean));
    const ids = new Set(existing.map(effect => effect.id ?? effect._id));
    const custom = [...existing, ...relatedActorEffects].filter(effect => !metadata(effect));
    const customKeys = new Set(custom.flatMap(effect => changes(effect).map(change => change.key)));
    const effects = [], skipped = [];
    for (const supplied of entry.effects) {
        const ruleId = metadata(supplied)?.id;
        if (!ruleId || managed.has(ruleId)) continue;
        if (ids.has(supplied._id) || changes(supplied).some(change => customKeys.has(change.key))) {
            skipped.push(ruleId);
            continue;
        }
        effects.push(structuredClone(supplied));
        managed.add(ruleId);
    }
    return {effects, skipped, sourceId:entry.sourceId};
}

/** Runs within the existing active-GM world migration; no name matching or retries. */
export async function syncEquipmentBonuses(item, {localize = key => globalThis.game?.i18n?.localize(key) ?? key} = {}) {
    const plan = planEquipmentBonusMigration(item);
    if (!plan.effects.length) return {added:0, skipped:plan.skipped};
    for (const effect of plan.effects) {
        if (effect.name?.startsWith('EQUIPMENT_BONUS.')) effect.name = localize(effect.name);
    }
    const written = await item.createEmbeddedDocuments('ActiveEffect', plan.effects, {keepId:true});
    if (!Array.isArray(written) || written.length !== plan.effects.length) {
        throw new Error('Incomplete equipment effect migration; inspect the item before retrying');
    }
    return {added:written.length, skipped:plan.skipped};
}
