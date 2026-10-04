import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';
import {readFileSync} from 'node:fs';

/** An ammunition item the reload can find and spend. */
function round(id, name, weaponTypes, quantity = 1) {
    return {
        id, name, type: 'ammunition', isAmmunition: true,
        system: {quantity, weaponTypes, weaponClasses: []},
        updates: [],
        async update(data) { this.updates.push(data); Object.assign(this.system, data['system.quantity'] !== undefined ? {quantity: data['system.quantity']} : {}); }
    };
}

/** A weapon with an empty magazine, optionally pointing at a chosen round. */
function weapon(id, name, type, ammo = '') {
    return {
        id, name, type: 'weapon',
        system: {type, class: 'basic', ammo, clip: {value: 0, max: 30}},
        updates: [],
        async update(data) { this.updates.push(data); }
    };
}

function worldWith(items) {
    const system = loadSystem();
    const actor = {
        id: 'base', type: 'acolyte', isToken: false,
        items: {
            get: id => items.find(item => item.id === id),
            find: predicate => items.find(predicate),
            filter: predicate => items.filter(predicate),
            [Symbol.iterator]: () => items[Symbol.iterator]()
        },
        getFlag: () => false,
        prototypeToken: {actorLink: true}
    };
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
    assert.deepEqual({...lasgun.updates[0]}, {'system.clip.value': 30, 'system.ammo': 'a1'});
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
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    for (const reason of ['out_of_ammo', 'no_ammunition', 'wrong_ammunition', 'no_compatible_ammunition'])
        assert.match(source, new RegExp(`reason === "${reason}"`), reason);
    const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
    assert.ok(lang['CHAT.RELOAD_NO_COMPATIBLE'], 'the new reason has a string of its own');
});
