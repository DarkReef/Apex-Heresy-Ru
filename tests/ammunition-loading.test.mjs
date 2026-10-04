import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSystem} from './helpers/system.mjs';
import {resolveTypeTemplate} from '../script/data/models.mjs';

const template = JSON.parse(readFileSync(new URL('../template.json', import.meta.url), 'utf8'));

/** An owner with a weapon and whatever ammunition is handed in. */
function armed({clip = 0, ammo = '', rounds = []} = {}) {
    const system = loadSystem();
    const apply = (doc, change) => {
        for (const [path, value] of Object.entries(change)) {
            const keys = path.split('.');
            const last = keys.pop();
            keys.reduce((node, key) => node[key], doc)[last] = value;
        }
    };
    const stored = doc => { doc.update = async change => { apply(doc, change); return doc; }; return doc; };
    const weapon = stored({id: 'gun', type: 'weapon', name: 'Autogun',
        system: {ammo, type: '', class: '', clip: {value: clip, max: 30}}});
    const items = [weapon, ...rounds.map(round => stored({type: 'ammunition', isAmmunition: true,
        system: {quantity: 2, weaponTypes: [], weaponClasses: []}, ...round}))];
    const actor = {id: 'owner', name: 'Acolyte', isToken: false, type: 'acolyte',
        items: {get: id => items.find(item => item.id === id), find: fn => items.find(fn)}};
    system.context.game.actors.set('owner', actor);
    return {system, actor, weapon, items};
}

test('the weapon sheet stores its ammunition in a field the weapon has', () => {
    // The select was named system.ammunitionId, which the weapon model does not
    // define: a strict schema drops the write, so the choice never survived and
    // the rules that read the loaded round found nothing.
    const sheet = readFileSync(new URL('../template/sheet/weapon.hbs', import.meta.url), 'utf8');
    const model = resolveTypeTemplate(template, 'Item', 'weapon');
    const [, field] = sheet.match(/<select name="system\.([\w.]+)">\s*{{#each ammunitionOptions}}/) ?? [];
    assert.ok(field, 'the weapon sheet offers a choice of ammunition');
    assert.notEqual(model[field], undefined,
        `the choice is written to system.${field}, which the weapon model does not define`);
});

test('reloading without a chosen round loads the one found and remembers it', async () => {
    const f = armed({rounds: [{id: 'dumdum', name: 'Dumdum Bullets'}]});
    const got = await f.system.get('_reloadWeapon')(f.weapon, 'owner', null, false);
    assert.equal(got.success, true);
    assert.equal(f.weapon.system.clip.value, 30);
    assert.equal(f.weapon.system.ammo, 'dumdum', 'the round now in the weapon is recorded');
    assert.equal(f.system.get('DarkHeresyUtil').getLoadedAmmunition(f.actor, f.weapon)?.id, 'dumdum',
        'so its effects reach the next attack');
});

test('reloading uses the round chosen on the weapon, not the first one found', async () => {
    const f = armed({ammo: 'manstopper', rounds: [
        {id: 'dumdum', name: 'Dumdum Bullets'}, {id: 'manstopper', name: 'Man-Stopper Bullets'}]});
    await f.system.get('_reloadWeapon')(f.weapon, 'owner', null, false);
    assert.equal(f.items.find(item => item.id === 'manstopper').system.quantity, 1);
    assert.equal(f.items.find(item => item.id === 'dumdum').system.quantity, 2);
});

test('reloading with nothing to load fails and leaves the weapon empty', async () => {
    const f = armed();
    const got = await f.system.get('_reloadWeapon')(f.weapon, 'owner', null, false);
    assert.equal(got.success, false);
    assert.equal(f.weapon.system.clip.value, 0);
});

const burst = clipSeenByDialog => ({
    ownerId: 'owner', itemId: 'gun', flags: {},
    weapon: {isRange: true, name: 'Autogun', clip: {value: clipSeenByDialog, max: 30},
        rateOfFire: {single: 1, burst: 3, full: 10}, traits: {}},
    attackType: {name: 'full_auto'}
});

test('a shot is paid for out of what the weapon holds now, not what a dialog remembered', async () => {
    // Two attack dialogs opened together both remember a full magazine. The
    // second used to write "30 - 10" over the first one's "30 - 10".
    const f = armed({clip: 30});
    const consume = f.system.get('_consumeAmmo');
    const first = burst(30), second = burst(30);
    await consume(first);
    await consume(second);
    assert.equal(f.weapon.system.clip.value, 10);
    assert.equal(second.weapon.clip.value, 10, 'and the roll is told what is really left');
});

test('the reload prompt speaks of the magazine, not of ammunition being unavailable', () => {
    // "available: 0" read as "you own no ammunition", and then the reload worked.
    const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
    assert.match(lang['DIALOG.RELOAD_MESSAGE'], /in the weapon/i);
    assert.doesNotMatch(lang['DIALOG.RELOAD_MESSAGE'].replace(/{\w+}/g, ''), /available/i);
});
