import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';
import {readFileSync} from 'node:fs';

function applyUpdate(item,patch) {
    item.updates.push(structuredClone(patch));
    for(const [path,value] of Object.entries(patch)){
        if(path==='_id')continue;
        const keys=path.split('.'),last=keys.pop();let target=item;
        for(const key of keys)target=target[key]??={};
        target[last]=structuredClone(value);
    }
    return item;
}

/** An ammunition item the reload can find and spend. */
function round(id, name, weaponTypes, quantity = 1) {
    return {
        id, name, type: 'ammunition', isAmmunition: true,
        system: {quantity, weaponTypes, weaponClasses: []},
        updates: [],
        async update(data) {return applyUpdate(this,data);}
    };
}

/** A weapon with an empty magazine, optionally pointing at a chosen round. */
function weapon(id, name, type, ammo = '') {
    return {
        id, name, type: 'weapon',
        system: {type, class: 'basic', ammo, clip: {value: 0, max: 30}},
        updates: [],
        async update(data) {return applyUpdate(this,data);}
    };
}

function worldWith(items) {
    const system = loadSystem();
    const actor = {
        id: 'base', uuid:'Actor.base', type: 'acolyte', isToken: false, isOwner:true, batches:[],
        items: {
            get: id => items.find(item => item.id === id),
            find: predicate => items.find(predicate),
            filter: predicate => items.filter(predicate),
            [Symbol.iterator]: () => items[Symbol.iterator]()
        },
        getFlag: () => false,
        prototypeToken: {actorLink: true},
        async updateEmbeddedDocuments(type,patches){
            assert.equal(type,'Item');this.batches.push(structuredClone(patches));
            return Promise.all(patches.map(patch=>this.items.get(patch._id).update(patch)));
        }
    };
    for(const item of items){item.parent=actor;item.uuid=`${actor.uuid}.Item.${item.id}`;}
    system.context.game.actors.set('base', actor);
    system.context.ChatMessage = {create: async () => ({}), getSpeaker: () => ({})};
    system.context.foundry.applications = {handlebars: {renderTemplate: async () => ''}};
    return system;
}

test('a weapon with no chosen round reloads from what the character carries', async () => {
    const cell = round('a1', 'Standard Lasgun Cell', ['las']);
    const lasgun = weapon('w1', 'Lasgun', 'las');
    const system = worldWith([cell, lasgun]);
    const result = await system.get('_reloadWeapon')(lasgun, 'base', null, false);
    assert.equal(result.success, true, result.reason);
    // Spread the object: deepStrictEqual compares prototypes, and this one was
    // built inside the vm realm, so a bare deepEqual fails on identity alone.
    assert.equal(lasgun.updates.length, 1);
    assert.deepEqual({...lasgun.updates[0]}, {_id:'w1','system.clip.value': 30, 'system.ammo': 'a1',
        'system.loadedAmmo':{itemId:'a1',uuid:'Actor.base.Item.a1',name:'Standard Lasgun Cell',effect:{}}});
    assert.equal(system.context.game.actors.get('base').batches.length,1);
    assert.equal(system.context.game.actors.get('base').batches[0].length,2);
    assert.equal(cell.system.quantity,0);
});

test('a weapon carrying only the wrong round says so, rather than failing blankly', async () => {
    const bolts = round('a1', 'Standard Bolt Pistol Clip', ['bolt']);
    const lasgun = weapon('w1', 'Lasgun', 'las');
    const system = worldWith([bolts, lasgun]);
    const result = await system.get('_reloadWeapon')(lasgun, 'base', null, false);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'no_compatible_ammunition');
    assert.deepEqual(bolts.updates, [], 'nothing is spent when nothing fits');
});

test('a round the character chose explicitly still wins over the search', async () => {
    const hotShot = round('a1', 'Hot-Shot Charge Packs', ['las']);
    const cell = round('a2', 'Standard Lasgun Cell', ['las']);
    const lasgun = weapon('w1', 'Lasgun', 'las', 'a1');
    const system = worldWith([hotShot, cell, lasgun]);
    const result = await system.get('_reloadWeapon')(lasgun, 'base', null, false);
    assert.equal(result.success, true, result.reason);
    assert.equal(hotShot.updates.length, 1, 'the chosen pack is the one spent');
    assert.equal(cell.updates.length, 0);
});

test('an empty pouch is reported as empty, not as a missing choice', async () => {
    const cell = round('a1', 'Standard Lasgun Cell', ['las'], 0);
    const lasgun = weapon('w1', 'Lasgun', 'las');
    const system = worldWith([cell, lasgun]);
    const result = await system.get('_reloadWeapon')(lasgun, 'base', null, false);
    assert.equal(result.success, false);
    assert.equal(result.reason, 'no_compatible_ammunition');
});

test('a universal round is found by the search too', async () => {
    const generic = round('a1', 'Sanctified Ammunition', []);
    const lasgun = weapon('w1', 'Lasgun', 'las');
    const system = worldWith([generic, lasgun]);
    const result = await system.get('_reloadWeapon')(lasgun, 'base', null, false);
    assert.equal(result.success, true, result.reason);
});

test('the refusal the player sees names the real cause', () => {
    // The report: the pop-up claimed no ammunition was available even as the
    // weapon reloaded. The reasons the reload returns must each reach a message
    // of their own, or every failure reads the same and none of them is true.
    const system=loadSystem(),message=system.get('ammunitionFailureMessage');
    const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
    const cases={out_of_ammo:'CHAT.RELOAD_OUT_OF_AMMO',no_ammunition:'CHAT.RELOAD_NO_AMMUNITION',
        wrong_ammunition:'CHAT.RELOAD_WRONG_AMMUNITION',no_compatible_ammunition:'CHAT.RELOAD_NO_COMPATIBLE',
        clip_full:'AMMUNITION.CLIP_FULL',different_ammunition_loaded:'AMMUNITION.DIFFERENT_LOADED',
        invalid_quantity:'AMMUNITION.INVALID_QUANTITY',invalid_clip:'AMMUNITION.INVALID_CLIP',
        wrong_owner:'AMMUNITION.OWNED_ONLY',no_permission:'AMMUNITION.OWNED_ONLY'};
    for(const [reason,key] of Object.entries(cases)){
        assert.ok(lang[key],key);assert.equal(message({reason},{name:'Autogun'}),lang[key].replaceAll('{weapon}','Autogun'));
    }
});
