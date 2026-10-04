import {PHYSICAL_TYPES, descendants, contentsMass, itemMass, movePatch, validateMoney} from './inventory.mjs';
import {validateRequest, canRespond, acceptedResponses} from './requests.mjs';
import {registerItemPiles, guardContainerTrade} from './item-piles.mjs';

const SCOPE = 'dark-heresy';
const esc = value => foundry.utils.escapeHTML(String(value ?? ''));
const t = key => game.i18n.localize(`PARTY.${key}`);
const errorText = error => {
    const keys = {'Container cycle':'CYCLE','Container capacity exceeded':'CAPACITY_ERROR','Invalid money':'INVALID_MONEY',
        'Single container required':'SINGLE_CONTAINER','Physical item required':'UNKNOWN_ITEM'};
    return keys[error.message] ? t(keys[error.message]) : error.message;
};
const actorFrom = uuid => fromUuidSync(uuid);
const queues = new Map(), responding = new Set();
const inventoryWindows = new Set();
let panel, InventoryApp;
function owned(actor) { if (!actor?.isOwner && !game.user.isGM) throw new Error(t('NO_PERMISSION')); }
function locked(uuid, operation) {
    const next = (queues.get(uuid) ?? Promise.resolve()).catch(() => {}).then(operation);
    queues.set(uuid, next); next.finally(() => { if (queues.get(uuid) === next) queues.delete(uuid); }).catch(() => {});
    return next;
}
function actors() {
    const result = new Map();
    for (const token of canvas.tokens?.placeables ?? []) {
        const actor = token.actor;
        if (actor && (game.user.isGM ? !token.document.hidden && actor.hasPlayerOwner : actor.isOwner)) result.set(actor.uuid, actor);
    }
    for (const user of game.users) if (user.character && (game.user.isGM || user.character.isOwner)) result.set(user.character.uuid, user.character);
    for (const token of canvas.tokens?.controlled ?? []) if (token.actor && (game.user.isGM || token.actor.isOwner)) result.set(token.actor.uuid, token.actor);
    return [...result.values()];
}
function responses(message, request) {
    return acceptedResponses(game.messages.contents, message.id, request, actorFrom, id => game.users.get(id));
}
function requestHTML(message, request) {
    const result = responses(message, request);
    return `<section class="dh-party-request"><h3>${esc(t('REQUEST'))}: ${esc(request.label)}</h3><p>${esc(request.reason)} (${request.modifier >= 0 ? '+' : ''}${request.modifier})</p>
        ${request.actorUuids.map(uuid => {
            const actor = actorFrom(uuid), response = result.get(uuid);
            return `<div>${esc(actor?.name ?? t('MISSING_ACTOR'))}: ${response ? `${response.roll} / ${response.target} — ${esc(t(response.success ? 'SUCCESS' : 'FAILURE'))} (${response.degrees})`
                : `<button type="button" data-party-roll="${esc(uuid)}" ${canRespond(request, actor, game.user) ? '' : 'disabled'}>${esc(t(request.closed ? 'CLOSED' : 'ROLL'))}</button>`}</div>`;
        }).join('')}${game.user.isGM && !request.closed ? `<button type="button" data-party-close>${esc(t('CLOSE_REQUEST'))}</button>` : ''}</section>`;
}
export async function requestChecks(input) {
    if (!game.user.isGM) throw new Error(t('GM_ONLY'));
    const request = {...validateRequest(input), reason:String(input.reason ?? '').slice(0,500), closed:false};
    for (const uuid of request.actorUuids) {
        const actor = await fromUuid(uuid);
        if (!actor || !(request.characteristic ? actor.characteristics?.[request.characteristic] : actor.skills?.[request.skill])) throw new Error(t('UNKNOWN_TEST'));
    }
    const first = await fromUuid(request.actorUuids[0]);
    request.label = game.i18n.localize((request.characteristic ? first.characteristics[request.characteristic] : first.skills[request.skill]).label || request.characteristic || request.skill);
    return ChatMessage.create({content:`<p>${esc(t('REQUEST'))}: ${esc(request.label)}</p>`, flags:{[SCOPE]:{partyRequest:request}}});
}
export async function respondCheck(messageId, actorUuid) {
    const key = `${messageId}:${actorUuid}`;
    if (responding.has(key)) return;
    responding.add(key);
    try {
        const message = game.messages.get(messageId), request = message?.getFlag(SCOPE, 'partyRequest');
        const actor = await fromUuid(actorUuid);
        if (!message?.author?.isGM || !canRespond(request, actor, game.user)) throw new Error(t('NO_PERMISSION'));
        if (responses(message, request).has(actorUuid)) return;
        const roll = await game.darkHeresy.api.rollTest({actorUuid, characteristic:request.characteristic, skill:request.skill, modifier:request.modifier, dialog:false});
        if (roll.status !== 'resolved') return;
        const data = roll.context;
        const response = {requestId:messageId, actorUuid, roll:Number(data.result), target:Number(data.target.final),
            success:!!data.flags.isSuccess, degrees:Number(data.flags.isSuccess ? data.dos : data.dof)};
        const chat = {content:`<p>${esc(actor.name)}: ${esc(request.label)} — ${response.roll}/${response.target}</p>`,
            speaker:ChatMessage.getSpeaker({actor}), flags:{[SCOPE]:{partyResponse:response}}};
        ChatMessage.applyRollMode(chat, game.settings.get('core','rollMode'));
        await ChatMessage.create(chat);
    } finally { responding.delete(key); }
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
export function openPartyPanel() { return panel?.render(true); }

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
    class PartyPanel extends BasePanel {
        static DEFAULT_OPTIONS = {id:'dh-party-panel', window:{title:'PARTY.TITLE'}};
        constructor(...args) {super(...args); this.selected = null;}
        async _renderHTML() {
            const list = actors();
            return `<div class="dh-party-content"><div class="dh-party-toolbar"><button data-action="refresh">${esc(t('REFRESH'))}</button>
                ${game.user.isGM ? `<button data-action="request">${esc(t('REQUEST'))}</button><button data-action="merchant">${esc(t('MAKE_MERCHANT'))}</button>` : ''}</div>
                <div class="dh-party-roster">${list.map(actor => {
                    const s = actor.system;
                    const states = [...actor.effects].filter(e => !e.disabled && !e.isSuppressed && e.statuses?.size).map(e => e.name).join(', ');
                    return `<article data-actor="${esc(actor.uuid)}"><input type="checkbox" name="recipient" value="${esc(actor.uuid)}" ${this.selected === null || this.selected.has(actor.uuid) ? 'checked' : ''}>
                        <img src="${esc(actor.img)}" alt=""><div><strong>${esc(actor.name)}</strong><p>${esc(t('WOUNDS'))}: ${Number(s.wounds?.value) || 0}/${Number(s.wounds?.max) || 0} · ${esc(t('CRITICAL'))}: ${Number(s.wounds?.critical) || 0}<br>
                        ${esc(t('FATIGUE'))}: ${Number(s.fatigue?.value) || 0}/${Number(s.fatigue?.max) || 0} · ${esc(t('FATE'))}: ${Number(s.fate?.value) || 0}/${Number(s.fate?.max) || 0}<br>${esc(states || t('NO_CONDITIONS'))}</p></div>
                        <div class="dh-party-actions"><button data-action="sheet">${esc(t('SHEET'))}</button><button data-action="inventory">${esc(t('INVENTORY'))}</button><button data-action="condition">${esc(t('CONDITION'))}</button></div></article>`;
                }).join('') || `<p>${esc(t('EMPTY'))}</p>`}</div><p>${esc(t('REQUEST_HINT'))}</p></div>`;
        }
        _onRender(context, options) {
            super._onRender(context, options);
            this.element.querySelectorAll('[name=recipient]').forEach(input => input.addEventListener('change', () => {
                this.selected = new Set([...this.element.querySelectorAll('[name=recipient]:checked')].map(i => i.value));
            }));
            bind(this, async (action, button) => {
                const actor = actorFrom(button.closest('[data-actor]')?.dataset.actor);
                if (action === 'refresh') return this.render(true);
                if (action === 'sheet') return actor.sheet.render(true);
                if (action === 'inventory') return openInventory(actor);
                if (action === 'condition') return conditionDialog(actor);
                if (action === 'merchant') return makeMerchant();
                if (action === 'request') {
                    const recipients = [...this.element.querySelectorAll('[name=recipient]:checked')].map(input => input.value);
                    return requestDialog(recipients);
                }
            });
        }
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
    panel = new PartyPanel();
}
async function requestDialog(actorUuids) {
    if (!actorUuids.length) throw new Error(t('SELECT_ACTORS'));
    const actor = actorFrom(actorUuids[0]);
    const options = [...Object.entries(actor.characteristics ?? {}).map(([key,value]) => [`c:${key}`,value.label ?? key]),
        ...Object.entries(actor.skills ?? {}).filter(([,value])=>!value.isSpecialist).map(([key,value]) => [`s:${key}`,value.label ?? key])];
    return foundry.applications.api.DialogV2.prompt({window:{title:t('REQUEST')},content:`<div class="dh-party-form"><label>${esc(t('TEST'))}<select name="test">${options.map(([key,label]) => `<option value="${esc(key)}">${esc(game.i18n.localize(label))}</option>`).join('')}</select></label>
        <label>${esc(t('MODIFIER'))}<input name="modifier" type="number" value="0"></label><label>${esc(t('REASON'))}<input name="reason" maxlength="500"></label></div>`,
        ok:{label:t('REQUEST'),callback:(_event,button) => {
            const form = button.form, [type,key] = form.elements.test.value.split(':');
            return requestChecks({actorUuids,characteristic:type==='c'?key:'',skill:type==='s'?key:'',modifier:form.elements.modifier.value,reason:form.elements.reason.value});
        }}});
}
async function conditionDialog(actor) {
    owned(actor);
    return foundry.applications.api.DialogV2.prompt({window:{title:t('CONDITION')},content:`<div class="dh-party-form"><select name="condition">${CONFIG.statusEffects.map(e => `<option value="${esc(e.id)}">${esc(game.i18n.localize(e.name ?? e.label))}</option>`).join('')}</select><label><input type="checkbox" name="active" checked>${esc(t('ACTIVE'))}</label><label>${esc(t('ROUNDS'))}<input type="number" name="rounds" value="1" min="1" step="1"></label></div>`,
        ok:{callback:(_event, button) => game.darkHeresy.api.applyCondition({actorUuid:actor.uuid,condition:button.form.elements.condition.value,active:button.form.elements.active.checked,rounds:Number(button.form.elements.rounds.value)})}});
}
async function makeMerchant() {
    if (!game.user.isGM) throw new Error(t('GM_ONLY'));
    const tokens = canvas.tokens?.controlled ?? [];
    if (!tokens.length) throw new Error(t('SELECT_TOKEN'));
    if (!game.modules.get('item-piles')?.active || !game.itempiles?.API) throw new Error(t('INSTALL_ITEM_PILES'));
    await game.itempiles.API.turnTokensIntoItemPiles(tokens.map(token => token.document), {pileSettings:{enabled:true,type:'merchant'}});
}

Hooks.once('setup', registerItemPiles);
Hooks.on('item-piles-preTradeItems', guardContainerTrade);
Hooks.once('ready', () => {
    createApplications();
    game.darkHeresy.party = {version:1, open:openPartyPanel, requestChecks, respondCheck, openInventory, moveItem, configureItem};
    for (const hook of ['updateActor','createItem','updateItem','deleteItem','createActiveEffect','updateActiveEffect','deleteActiveEffect','updateUser','canvasReady','controlToken']) Hooks.on(hook, () => {
        if (panel?.rendered) panel.render(true);
        for (const app of inventoryWindows) if (app.rendered) app.render(true);
    });
});
Hooks.on('getSceneControlButtons', controls => {
    if (!controls.tokens?.tools) return;
    controls.tokens.tools.dhParty = {name:'dhParty',title:'PARTY.TITLE',icon:'fa-solid fa-users',order:95,button:true,onChange:openPartyPanel};
});
Hooks.on('renderChatMessageHTML', (message, html) => {
    const request = message.getFlag(SCOPE,'partyRequest');
    if (!request || !message.author?.isGM) return;
    const body = html.querySelector('.message-content');
    if (!body) return;
    body.innerHTML = requestHTML(message,request);
    body.querySelectorAll('[data-party-roll]').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try {await respondCheck(message.id,button.dataset.partyRoll);} catch(error) {ui.notifications.error(error.message);}
        finally {ui.chat?.render(true);}
    }));
    body.querySelector('[data-party-close]')?.addEventListener('click', async () => {
        if (game.user.isGM) await message.setFlag(SCOPE,'partyRequest',{...request,closed:true});
    });
});
Hooks.on('createChatMessage', message => { if (message.getFlag(SCOPE,'partyResponse')) ui.chat?.render(true); });
Hooks.on('getActorSheetHeaderButtons', (sheet, buttons) => {
    if (!sheet.actor?.isOwner && !game.user.isGM) return;
    buttons.unshift({label:t('INVENTORY'),class:'dh-inventory',icon:'fa-solid fa-box-open',onclick:() => openInventory(sheet.actor)});
});
