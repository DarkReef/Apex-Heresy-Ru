import {extendSchemas} from './schema.mjs';
import {PHYSICAL_TYPES, descendants, contentsMass, itemMass, movePatch, validateMoney} from './inventory.mjs';
import {registerItemPiles, guardContainerTrade} from './item-piles.mjs';

const SCOPE = 'itempileffg';
const esc = value => foundry.utils.escapeHTML(String(value ?? ''));
const t = key => game.i18n.localize(`ITEMPILEFFG.${key}`);
const errorText = error => {
    const keys = {'Container cycle':'CYCLE','Container capacity exceeded':'CAPACITY_ERROR','Invalid money':'INVALID_MONEY',
        'Single container required':'SINGLE_CONTAINER','Physical item required':'UNKNOWN_ITEM'};
    return keys[error.message] ? t(keys[error.message]) : error.message;
};
const actorFrom = uuid => fromUuidSync(uuid);
const queues = new Map();
const inventoryWindows = new Set();
let InventoryApp;
function owned(actor) { if (!actor?.isOwner && !game.user.isGM) throw new Error(t('NO_PERMISSION')); }
function locked(uuid, operation) {
    const next = (queues.get(uuid) ?? Promise.resolve()).catch(() => {}).then(operation);
    queues.set(uuid, next); next.finally(() => { if (queues.get(uuid) === next) queues.delete(uuid); }).catch(() => {});
    return next;
}
export async function moveItem({actorUuid, itemId, containerId = ''}) {
    return locked(actorUuid, async () => {
        const actor = await fromUuid(actorUuid); owned(actor);
        const patch = movePatch([...actor.items], itemId, containerId);
        await actor.updateEmbeddedDocuments('Item', [patch]); return patch;
    });
}
export async function configureItem({actorUuid, itemId, price, quantity, isContainer, capacity}) {
    return locked(actorUuid, async () => {
        const actor = await fromUuid(actorUuid); owned(actor);
        const item = actor.items.get(itemId);
        if (!item || !PHYSICAL_TYPES.has(item.type)) throw new Error(t('UNKNOWN_ITEM'));
        const number = Number(quantity), limit = Number(capacity);
        if (!Number.isInteger(number) || number < 0 || !Number.isFinite(limit) || limit < 0 || isContainer && number !== 1) throw new Error(t('INVALID_QUANTITY'));
        const children = descendants([...actor.items], itemId);
        if (!isContainer && children.length || isContainer && limit > 0 && contentsMass([...actor.items],itemId) > limit) throw new Error(t('CAPACITY'));
        const patch = {'system.price':validateMoney(price),'system.quantity':number,
            'system.inventory.isContainer':!!isContainer,'system.inventory.capacity':limit,
            'system.inventory.containerKey':isContainer ? item.system.inventory?.containerKey || foundry.utils.randomID() : ''};
        if (isContainer || item.system.inventory?.containerId) patch['flags.item-piles.item.canStack'] = 'no';
        const parentId = item.system.inventory?.containerId;
        if (parentId) {
            const projected = [...actor.items].map(i => i.id === itemId ? {...i.toObject(), id:i.id, system:{...i.system, price:patch['system.price'], quantity:number}} : i);
            movePatch(projected, itemId, parentId);
        }
        await item.update(patch); return item;
    });
}
export function openInventory(actor) {
    owned(actor);
    const app = new InventoryApp(actor); inventoryWindows.add(app);
    return app.render(true);
}

function bind(app, handler) {
    app.element.querySelector('.dh-party-content').addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        event.preventDefault(); button.disabled = true;
        Promise.resolve(handler(button.dataset.action, button)).catch(error => ui.notifications.error(errorText(error)))
            .finally(() => { button.disabled = false; });
    });
}
async function editItem(actor, item) {
    const inventory = item.system.inventory ?? {};
    return foundry.applications.api.DialogV2.prompt({window:{title:item.name}, content:`<div class="dh-party-form">
        <label>${esc(t('PRICE'))}<input name="price" type="number" min="0" step="0.01" value="${Number(item.system.price) || 0}"></label>
        <label>${esc(t('QUANTITY'))}<input name="quantity" type="number" min="0" step="1" value="${Number(item.system.quantity ?? 1)}"></label>
        <label><input name="container" type="checkbox" ${inventory.isContainer ? 'checked' : ''}>${esc(t('CONTAINER'))}</label>
        <label>${esc(t('CAPACITY'))}<input name="capacity" type="number" min="0" step="0.1" value="${Number(inventory.capacity) || 0}"></label></div>`,
        ok:{label:t('SAVE'), callback:(_event, button) => {
            const form = button.form;
            return configureItem({actorUuid:actor.uuid,itemId:item.id,price:form.elements.price.value,quantity:form.elements.quantity.value,
                isContainer:form.elements.container.checked,capacity:form.elements.capacity.value});
        }}});
}
function createApplications() {
    const {ApplicationV2} = foundry.applications.api;
    class BasePanel extends ApplicationV2 {
        static DEFAULT_OPTIONS = {classes:['dark-heresy','dh-party-app'], position:{width:760,height:520}, window:{resizable:true}};
        _replaceHTML(result, content) { content.innerHTML = result; }
    }
    InventoryApp = class extends BasePanel {
        constructor(actor) { super({window:{title:`${t('INVENTORY')}: ${actor.name}`}}); this.actor = actor; }
        async close(options) { inventoryWindows.delete(this); return super.close(options); }
        async _renderHTML() {
            const actor = this.actor; owned(actor);
            const items = [...actor.items].filter(i => PHYSICAL_TYPES.has(i.type)), containers = items.filter(i => i.system.inventory?.isContainer);
            const rows = []; const seen = new Set();
            const walk = (parentId, depth) => {
                for (const item of items.filter(i => (i.system.inventory?.containerId || '') === parentId)) {
                    if (seen.has(item.id)) continue;
                    seen.add(item.id); rows.push({item, depth}); walk(item.id, depth+1);
                }
            };
            walk('',0); for (const item of items) if (!seen.has(item.id)) {rows.push({item,depth:0}); seen.add(item.id); walk(item.id,1);}
            return `<div class="dh-party-content"><div class="dh-party-toolbar"><strong>${esc(t('CREDITS'))}: ${Number(actor.system.economy?.credits) || 0}</strong>
                ${game.user.isGM ? `<button data-action="wallet">${esc(t('EDIT_WALLET'))}</button>` : ''}<button data-action="bag">${esc(t('NEW_BAG'))}</button></div>
                <p>${esc(t('TOTAL_WEIGHT'))}: ${items.reduce((sum,item) => sum + itemMass(item),0).toFixed(2)} kg</p>
                ${rows.map(({item,depth}) => `<div class="dh-inventory-row" draggable="true" data-item="${esc(item.id)}" style="padding-left:${Math.min(depth,10)*16}px">
                    <img src="${esc(item.img)}" alt=""><span>${esc(item.name)} ×${Number(item.system.quantity ?? 1)}<br><small>${Number(item.system.price)||0} cr · ${itemMass(item).toFixed(2)} kg${item.system.inventory?.isContainer ? ` · ${esc(t('CONTENTS'))}: ${contentsMass(items,item.id).toFixed(2)} / ${Number(item.system.inventory.capacity)||'∞'} kg` : ''}</small></span>
                    <select aria-label="${esc(t('MOVE'))}" data-container="${esc(item.id)}"><option value="">${esc(t('ROOT'))}</option>${containers.filter(c => c.id !== item.id && !descendants(items,item.id).some(child => child.id===c.id)).map(c => `<option value="${esc(c.id)}" ${item.system.inventory?.containerId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
                    <button data-action="edit">${esc(t('EDIT'))}</button><button data-action="item-sheet">${esc(t('SHEET'))}</button></div>`).join('')}</div>`;
        }
        _onRender(context, options) {
            super._onRender(context,options);
            bind(this, async (action,button) => {
                const item = this.actor.items.get(button.closest('[data-item]')?.dataset.item);
                if (action === 'edit') await editItem(this.actor,item);
                if (action === 'item-sheet') return item.sheet.render(true);
                if (action === 'wallet') {
                    if (!game.user.isGM) throw new Error(t('GM_ONLY'));
                    await foundry.applications.api.DialogV2.prompt({window:{title:t('EDIT_WALLET')},content:`<input name="credits" type="number" min="0" step="0.01" value="${Number(this.actor.system.economy?.credits)||0}">`,
                        ok:{callback:(_event, button) => this.actor.update({'system.economy.credits':validateMoney(button.form.elements.credits.value)})}});
                }
                if (action === 'bag') {
                    owned(this.actor);
                    await this.actor.createEmbeddedDocuments('Item',[{name:t('NEW_BAG'),type:'gear',img:'icons/containers/bags/pack-leather-brown.webp',
                        system:{quantity:1,inventory:{isContainer:true,containerKey:foundry.utils.randomID(),capacity:20}}}]);
                }
                return this.render(true);
            });
            this.element.querySelector('.dh-party-content').addEventListener('change', event => {
                if (!event.target.matches('[data-container]')) return;
                moveItem({actorUuid:this.actor.uuid,itemId:event.target.dataset.container,containerId:event.target.value})
                    .catch(error => ui.notifications.error(errorText(error))).finally(() => this.render(true));
            });
            this.element.querySelector('.dh-party-content').addEventListener('dragstart', event => {
                const row = event.target.closest('[data-item]');
                const item = row && this.actor.items.get(row.dataset.item);
                if (item?.uuid) event.dataTransfer.setData('text/plain',JSON.stringify({type:'Item',uuid:item.uuid}));
            });
        }
    };
}
export async function makeMerchant() {
    if (!game.user.isGM) throw new Error(t('GM_ONLY'));
    const tokens = canvas.tokens?.controlled ?? [];
    if (!tokens.length) throw new Error(t('SELECT_TOKEN'));
    if (!game.modules.get('item-piles')?.active || !game.itempiles?.API) throw new Error(t('INSTALL_ITEM_PILES'));
    await game.itempiles.API.turnTokensIntoItemPiles(tokens.map(token => token.document), {pileSettings:{enabled:true,type:'merchant'}});
}

Hooks.once('setup', () => {
    extendSchemas(); registerItemPiles();
    if (typeof CONFIG.Actor.documentClass?.prototype?._computeEncumbrance === 'function') {
        libWrapper.register(SCOPE, 'CONFIG.Actor.documentClass.prototype._computeEncumbrance', function(wrapped, _oldWeight, ...args) {
            return wrapped([...this.items].reduce((sum,item) => sum + itemMass(item),0), ...args);
        }, 'WRAPPER');
    }
});
Hooks.on('item-piles-preTradeItems', guardContainerTrade);
Hooks.once('ready', () => {
    createApplications();
    const api = {version:1, openInventory, moveItem, configureItem, createMerchantFromSelected:makeMerchant};
    game.itempileffg = api; game.modules.get(SCOPE).api = api;
    for (const hook of ['updateActor','createItem','updateItem','deleteItem']) Hooks.on(hook, () => {
        for (const app of inventoryWindows) if (app.rendered) app.render(true);
    });
});
Hooks.on('getActorSheetHeaderButtons', (sheet, buttons) => {
    if (!sheet.actor?.isOwner && !game.user.isGM) return;
    buttons.unshift({label:t('INVENTORY'),class:'itempileffg-inventory',icon:'fa-solid fa-box-open',onclick:() => openInventory(sheet.actor)});
});
Hooks.on('getSceneControlButtons', controls => {
    if (!controls.tokens?.tools) return;
    controls.tokens.tools.itempileffg = {name:'itempileffg',title:'ITEMPILEFFG.INVENTORY',icon:'fa-solid fa-box-open',order:96,button:true,onChange:() => {
        const actor = canvas.tokens.controlled[0]?.actor ?? game.user.character;
        if (actor) openInventory(actor); else ui.notifications.warn(t('SELECT_TOKEN'));
    }};
});
