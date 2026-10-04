import {PHYSICAL_TYPES, descendants, remapContainers, contentsMass, validateMoney} from './inventory.mjs';

export function integrationConfig() {
    const handlers = {
        GLOBAL: {isContained:({item}) => item.system?.inventory?.containerId || '',
            isContainedPath:'system.inventory.containerId', containerTransformer:remapContainers}
    };
    for (const type of PHYSICAL_TYPES) handlers[type] = {
        contents:({item}) => item.parent?.items ? descendants([...item.parent.items], item.id) : [],
        transfer:({item, items}) => {
            if (!item.parent?.items) return;
            for (const child of descendants([...item.parent.items], item.id)) {
                if (!items.some(i => (i._id ?? i.id) === child.id)) items.push(child.toObject());
            }
        }
    };
    return {
        VERSION:'2.0.0', ACTOR_CLASS_TYPE:'acolyte', ITEM_CLASS_LOOT_TYPE:'gear',
        ITEM_CLASS_WEAPON_TYPE:'weapon', ITEM_CLASS_EQUIPMENT_TYPE:'gear',
        ITEM_QUANTITY_ATTRIBUTE:'system.quantity', ITEM_PRICE_ATTRIBUTE:'system.price',
        ITEM_FILTERS:[{path:'type', filters:'aptitude,criticalInjury,malignancy,mentalDisorder,mutation,psychicPower,specialAbility,talent,trait,race,origin,vehicleTrait,shipComponent,shipWeapon'},
            {path:'system.installed', filters:'installed'}],
        ITEM_SIMILARITIES:['name','type','system.craftsmanship','system.price','system.special','system.traitOverrides','system.inventory.containerId','system.inventory.containerKey'],
        CURRENCIES:[{type:'attribute', name:'ITEMPILEFFG.CREDITS', img:'icons/svg/coins.svg', abbreviation:'{#} cr',
            data:{path:'system.economy.credits'}, primary:true, exchangeRate:1}],
        CURRENCY_DECIMAL_DIGITS:0.01, ITEM_TYPE_HANDLERS:handlers,
        ITEM_COST_TRANSFORMER:item => validateMoney(item.system?.price ?? 0),
        ITEM_TRANSFORMER: data => {
            const copy = structuredClone(data);
            if (!PHYSICAL_TYPES.has(copy.type)) return copy;
            copy.system ??= {}; copy.system.equipped = false;
            if (copy.system.inventory?.isContainer) {
                copy.flags ??= {}; copy.flags['dark-heresy'] ??= {};
                copy.flags['dark-heresy'].containerOrigin = copy.system.inventory.containerKey;
            }
            if (copy.system.inventory?.isContainer || copy.system.inventory?.containerId) {
                copy.flags ??= {}; copy.flags['item-piles'] ??= {};
                copy.flags['item-piles'].item ??= {};
                copy.flags['item-piles'].item.canStack = 'no';
            }
            return copy;
        }
    };
}

export function registerItemPiles() {
    const api = game.itempiles?.API;
    if (!game.modules.get('item-piles')?.active || !api?.addSystemIntegration) return false;
    api.addSystemIntegration(integrationConfig());
    return true;
}

/** Expand the documented preTradeItems update arrays before either commit.
 * A filled container is one priced bundle. Its contents are not charged twice. */
export function prepareContainerTrade(seller, sellerUpdates, buyer, buyerUpdates, randomID) {
    const plans = [], claimed = new Set();
    for (const root of buyerUpdates.itemsToCreate) {
        const origin = root.flags?.['dark-heresy']?.containerOrigin;
        if (!origin || !root.system?.inventory?.isContainer) continue;
        const source = [...seller.items].find(i => i.system?.inventory?.containerKey === origin);
        if (!source) continue;
        const children = descendants([...seller.items], source.id);
        if (!children.length) continue;
        if (Number(source.system.quantity) !== 1 || Number(root.system.quantity) !== 1) throw new Error('A filled container must be sold as one bundle');
        for (const container of [source,...children].filter(i => i.system.inventory?.isContainer)) {
            const limit = Number(container.system.inventory.capacity);
            if (limit > 0 && contentsMass([...seller.items],container.id) > limit) throw new Error('Container capacity exceeded');
        }
        if (children.some(child => claimed.has(child.id))) throw new Error('Overlapping container bundles');
        if (children.some(child => sellerUpdates.itemDeltas.some(delta => delta.quantity < 0 && delta.item._id === child.id))) throw new Error('Do not sell bundle contents separately');
        children.forEach(child => claimed.add(child.id));
        plans.push({root,source,children,remove:sellerUpdates.itemDeltas.some(delta => delta.quantity < 0 && delta.item._id === source.id)});
    }
    const used = new Set([...buyer.items].map(item => item.id).concat(buyerUpdates.itemsToCreate.map(item => item._id)));
    const uniqueID = () => { for (let i=0;i<100;i++) {const candidate=randomID();if (!used.has(candidate)) {used.add(candidate);return candidate;}} throw new Error('Cannot allocate item ID'); };
    const expanded = plans.map(({root,source,children,remove}) => {
        const map = new Map([[source.id, root._id]]);
        const copies = children.map(child => {
            const data = child.toObject(); data._id = uniqueID(); map.set(child.id,data._id);
            data.system.equipped = false;
            data.flags ??= {}; data.flags['item-piles'] ??= {}; data.flags['item-piles'].item ??= {};
            data.flags['item-piles'].item.canStack = 'no';
            return data;
        });
        for (const copy of copies) {
            const parent = map.get(copy.system.inventory.containerId);
            copy.system.inventory.containerId = parent; copy.system.inventory.parentKey = parent;
            if (copy.system.inventory.isContainer) copy.system.inventory.containerKey = copy._id;
        }
        return {root,source,children,remove,copies};
    });
    for (const {root,children,remove,copies} of expanded) {
        root.system.inventory.containerId = ''; root.system.inventory.parentKey = ''; root.system.inventory.containerKey = root._id;
        buyerUpdates.itemsToCreate.push(...copies);
        if (remove) for (const child of children) {
            if (!sellerUpdates.itemsToDelete.includes(child.id)) sellerUpdates.itemsToDelete.push(child.id);
            const delta = child.toObject();
            sellerUpdates.itemDeltas.push({item:delta,quantity:-Number(child.system.quantity ?? 1),type:'item'});
        }
    }
    return true;
}
export function guardContainerTrade(seller, updates, buyer, buyerUpdates) {
    try {return prepareContainerTrade(seller, updates, buyer, buyerUpdates, () => foundry.utils.randomID());}
    catch (error) {ui.notifications.warn(error.message); return false;}
}
