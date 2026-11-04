import {OW_EQUIPMENT_CATALOG} from '../../script/data/ow-equipment-catalog.mjs';

/** Patch only known Only War documents, leaving names, descriptions and custom effects intact. */
export function addEquipmentPackEffects(source, packName) {
    const document = structuredClone(source);
    if (packName !== 'only-war') return document;
    const entry = OW_EQUIPMENT_CATALOG.find(entry => entry.sourceId === document._id && entry.type === document.type);
    if (!entry) return document;
    const effects = document.effects ?? [];
    const ids = new Set(effects.map(effect => typeof effect === 'string' ? effect : effect._id));
    document.effects = [...effects, ...entry.effects.filter(effect => !ids.has(effect._id)).map(effect => structuredClone(effect))];
    document.flags ??= {};
    document.flags['dark-heresy'] ??= {};
    document.flags['dark-heresy'].owEquipmentSource = entry.sourceId;
    return document;
}

/** Foundry LevelDB stores embedded effects in a sublevel, with IDs on the Item. */
export function splitItemEffects(source) {
    const document = structuredClone(source);
    if (!Array.isArray(document.effects)) throw new Error(`Item ${document._id}: effects must be an array`);
    const effects = [], ids = new Set();
    document.effects = document.effects.map(effect => {
        const id = typeof effect === 'string' ? effect : effect?._id;
        if (!/^[A-Za-z0-9]{16}$/.test(id ?? '') || ids.has(id)) throw new Error(`Invalid or duplicate embedded effect ID on ${document._id}`);
        ids.add(id);
        if (typeof effect !== 'string') effects.push({key:`!items.effects!${document._id}.${id}`, value:effect});
        return id;
    });
    return {document, effects};
}
