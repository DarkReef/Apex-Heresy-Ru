import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';

/**
 * When a shot jams the weapon.
 *
 * Dark Heresy Second Edition, p. 224 (Weapon Jams): an unmodified 96-100 jams.
 * Semi-Auto Burst (p. 224), Full Auto Burst (p. 222) and Suppressing Fire
 * (p. 225) each say "a dice result of 94 or higher indicates the weapon has
 * jammed". The system used 96 for every attack.
 */
async function fire(die, attack, traits = {}, extra = {}) {
    class Roll {
        constructor() { this.total = die; this.terms = [{faces: 100, results: [{result: die}]}]; }
        async evaluate() { return this; }
    }
    const system = loadSystem({Roll});
    const rollData = {
        weapon: {isRange: true, name: 'Autogun', traits},
        attackType: {name: attack}, target: {final: 50}, flags: {}, ownerId: 'nobody', ...extra
    };
    await system.get('_rollTarget')(rollData);
    return rollData.weaponJammed;
}

test('a full auto burst jams on 94', async () => {
    assert.equal(await fire(94, 'full_auto'), true);
    assert.equal(await fire(93, 'full_auto'), false);
});

test('a semi-auto burst jams on 94', async () => {
    assert.equal(await fire(94, 'semi_auto'), true);
    assert.equal(await fire(93, 'semi_auto'), false);
});

test('suppressing fire jams on 94', async () => {
    assert.equal(await fire(94, 'suppression', {}, {suppressionLength: 'full'}), true);
    assert.equal(await fire(94, 'suppression', {}, {suppressionLength: 'semi'}), true);
});

test('a single shot still jams only from 96', async () => {
    assert.equal(await fire(95, 'standard'), false);
    assert.equal(await fire(96, 'standard'), true);
});

test('a Reliable weapon jams only on 100, whatever the rate of fire', async () => {
    assert.equal(await fire(99, 'full_auto', {reliable: true}), false);
    assert.equal(await fire(100, 'full_auto', {reliable: true}), true);
});

test('an Unreliable weapon jams from 91, whatever the rate of fire', async () => {
    assert.equal(await fire(91, 'standard', {unreliable: true}), true);
    assert.equal(await fire(91, 'full_auto', {unreliable: true}), true);
});
