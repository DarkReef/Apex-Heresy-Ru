export const PHYSICAL_TYPES = new Set(['ammunition','armour','cybernetic','drug','forceField','gear','tool','weapon','weaponModification','vehicleWeapon']);
const id = item => item.id ?? item._id;
export function descendants(items, parentId) {
    const result = [], seen = new Set([parentId]);
    function visit(parent) {
        for (const item of items) if (item.system?.inventory?.containerId === parent) {
            if (seen.has(id(item))) throw new Error('Container cycle');
            seen.add(id(item)); result.push(item); visit(id(item));
        }
    }
    visit(parentId); return result;
}
export function itemMass(item) {
    const quantity = Number(item.system?.quantity ?? 1), weight = Number(item.system?.weight ?? 0);
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(weight) || weight < 0) throw new Error('Invalid inventory weight');
    return quantity * weight;
}
export function contentsMass(items, parentId) { return descendants(items, parentId).reduce((sum, item) => sum + itemMass(item), 0); }
export function movePatch(items, itemId, containerId = '') {
    const item = items.find(i => id(i) === itemId), target = items.find(i => id(i) === containerId);
    if (!item || !PHYSICAL_TYPES.has(item.type)) throw new Error('Physical item required');
    if (containerId && (!target?.system?.inventory?.isContainer || Number(target.system.quantity ?? 1) !== 1)) throw new Error('Single container required');
    if (itemId === containerId || descendants(items, itemId).some(i => id(i) === containerId)) throw new Error('Container cycle');
    const moved = items.map(i => id(i) === itemId ? {...i, system:{...i.system, inventory:{...i.system.inventory, containerId}}} : i);
    let parent = target; const seen = new Set();
    while (parent) {
        if (seen.has(id(parent))) throw new Error('Container cycle');
        seen.add(id(parent));
        const limit = Number(parent.system.inventory.capacity ?? 0);
        if (limit > 0 && contentsMass(moved, id(parent)) > limit + 1e-8) throw new Error('Container capacity exceeded');
        parent = moved.find(i => id(i) === parent.system.inventory.containerId);
    }
    return {_id:itemId, 'system.inventory.containerId':containerId,
        'system.inventory.parentKey':target?.system.inventory.containerKey ?? ''};
}
/** Recover all nesting levels after Item Piles assigns destination Item IDs. */
export function remapContainers({map}) {
    const items = [...new Set(Object.values(map).flatMap(entry => [entry.item, ...(entry.items ?? [])]))];
    const containers = new Map(items.filter(i => i.system?.inventory?.isContainer).map(i => [i.system.inventory.containerKey, i]));
    for (const item of items) {
        const inventory = item.system?.inventory;
        if (!inventory) continue;
        const parent = inventory.parentKey && containers.get(inventory.parentKey);
        inventory.containerId = parent ? id(parent) : '';
        inventory.parentKey = parent ? id(parent) : '';
    }
    for (const item of items) if (item.system?.inventory?.isContainer) item.system.inventory.containerKey = id(item);
}
export function validateMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(Math.round(number * 100))) throw new Error('Invalid money');
    return Math.round(number * 100) / 100;
}
