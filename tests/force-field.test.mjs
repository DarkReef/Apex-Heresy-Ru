import {damageFixture} from './helpers/ow-damage-fixture.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OVERLOAD_BY_CRAFTSMANSHIP, overloadChanceFor, fieldCoversAttack, fieldProtects}
    from '../script/combat/force-field.mjs';

const refractor = (over = {}) => ({
    name: 'Refractor Field', protectionRating: 30, overloadChance: 10,
    craftsmanship: 'common', overloaded: false, ...over
});

test('the overload table is the one on p. 170', () => {
    assert.deepEqual({...OVERLOAD_BY_CRAFTSMANSHIP}, {poor: 15, common: 10, good: 5, best: 1});
});

test('craftsmanship decides the overload chance, not the flat ten in the pack', () => {
    assert.equal(overloadChanceFor(refractor({craftsmanship: 'poor'})), 15);
    assert.equal(overloadChanceFor(refractor({craftsmanship: 'common'})), 10);
    assert.equal(overloadChanceFor(refractor({craftsmanship: 'good'})), 5);
    assert.equal(overloadChanceFor(refractor({craftsmanship: 'best'})), 1);
});

test('a field with no craftsmanship is treated as common', () => {
    assert.equal(overloadChanceFor({protectionRating: 30}), 10);
});

test('a stated chance that is not the common default is honoured', () => {
    assert.equal(overloadChanceFor(refractor({craftsmanship: 'best', overloadChance: 25}), 25), 25);
});

test('a roll at or below the rating turns the attack aside', () => {
    assert.equal(fieldProtects({field: refractor(), roll: 30}).blocked, true);
    assert.equal(fieldProtects({field: refractor(), roll: 1}).blocked, true);
});

test('a roll above the rating does nothing', () => {
    assert.equal(fieldProtects({field: refractor(), roll: 31}).blocked, false);
    assert.equal(fieldProtects({field: refractor(), roll: 100}).blocked, false);
});

test('the same roll decides the burnout', () => {
    assert.equal(fieldProtects({field: refractor(), roll: 10}).overloaded, true);
    assert.equal(fieldProtects({field: refractor(), roll: 11}).overloaded, false);
    // Overloading still blocked the attack that caused it.
    assert.equal(fieldProtects({field: refractor(), roll: 10}).blocked, true);
});

test('a better field burns out less often', () => {
    assert.equal(fieldProtects({field: refractor({craftsmanship: 'best'}), roll: 5}).overloaded, false);
    assert.equal(fieldProtects({field: refractor({craftsmanship: 'poor'}), roll: 15}).overloaded, true);
});

test('an overloaded field protects nothing until it is repaired', () => {
    const dead = fieldProtects({field: refractor({overloaded: true}), roll: 1});
    assert.equal(dead.blocked, false);
    assert.equal(dead.reason, 'overloaded');
});

test('a Power Field does not defend in melee or at a metre (p. 170)', () => {
    const power = {name: 'Power Field (Personal)', protectionRating: 80,
                   craftsmanship: 'common', overloaded: false};
    assert.equal(fieldProtects({field: power, roll: 5, isMelee: true}).blocked, false);
    assert.equal(fieldProtects({field: power, roll: 5, rangeMetres: 1}).blocked, false);
    assert.equal(fieldProtects({field: power, roll: 5, rangeMetres: 0.5}).blocked, false);
    assert.equal(fieldProtects({field: power, roll: 5, rangeMetres: 2}).blocked, true);
});

test('the close-quarters limit belongs to power fields alone', () => {
    assert.equal(fieldCoversAttack(refractor(), {isMelee: true}), true);
    assert.equal(fieldProtects({field: refractor(), roll: 5, isMelee: true}).blocked, true);
});

test('a refused close-quarters attack says why, and does not burn the field out', () => {
    const power = {name: 'Power Field (Personal)', protectionRating: 80,
                   craftsmanship: 'common', overloaded: false};
    const got = fieldProtects({field: power, roll: 1, isMelee: true});
    assert.equal(got.reason, 'closeQuarters');
    assert.equal(got.overloaded, false, 'a field that never engaged cannot overload');
});

test('no field means no protection, and no crash', () => {
    assert.deepEqual({...fieldProtects({field: null, roll: 1})},
        {blocked: false, overloaded: false, reason: null});
});

// ── Reaching the damage path ──────────────────────────────────────────────

test('native field intercept is inside the repeat guard and prevents wounds', async () => {
    const f=damageFixture({field:true,fieldRolls:[30]});
    f.system.context.Roll=globalThis.Roll;
    f.system.context.ChatMessage=globalThis.ChatMessage;
    const apply=f.system.get('applyAutoDamageFromSocket');
    const input={sceneId:'scene',tokenId:'enemy',messageId:'damage'};
    await Promise.all([apply(input),apply(input)]);
    assert.equal(f.rolls(),1);
    assert.equal(f.writes(),0);
    assert.equal(f.source.getFlag('dark-heresy','appliedDamage').blocked,true);
});

test('a blocked attack applies no damage and says so', () => {
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('async function applyAutoDamageFromSocket'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /if \(field\?\.blocked\)[\s\S]{0,200}_announceForceField/);
    assert.match(body, /if \(field\?\.blocked\)[\s\S]{0,300}return;/);
});

test('a burnt-out field is remembered on the item', () => {
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('async function _forceFieldIntercept'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /setFlag\("dark-heresy", "overloaded", true\)/);
    assert.match(body, /getFlag\?\.\("dark-heresy", "overloaded"\)/, 'and read back on the next hit');
});

test('only an equipped field protects', () => {
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    const fn = source.slice(source.indexOf('function _wornForceField'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /system\?\.equipped === true/);
});

test('the strings the field needs exist', () => {
    const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
    for (const key of ['FORCE_FIELD.BLOCKED', 'FORCE_FIELD.BLOCKED_AND_OVERLOADED', 'FORCE_FIELD.OVERLOADED'])
        assert.ok(lang[key], key);
});
