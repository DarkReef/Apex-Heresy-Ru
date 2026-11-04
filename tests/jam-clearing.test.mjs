import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveJamClear} from '../script/combat/jam.mjs';

test('a successful test clears the jam, dumps the magazine and demands a reload', () => {
    assert.deepEqual({...resolveJamClear({success: true})},
        {cleared: true, emptyMagazine: true, needsReload: true});
});

test('a failed test leaves the weapon jammed and the magazine untouched', () => {
    assert.deepEqual({...resolveJamClear({success: false})},
        {cleared: false, emptyMagazine: false, needsReload: false});
});

test('a missing or malformed test result is treated as a failure', () => {
    assert.equal(resolveJamClear(undefined).cleared, false);
    assert.equal(resolveJamClear({}).cleared, false);
});

test('clearing a jam rolls Ballistic Skill and empties the clip', () => {
    // The handler used to unset a flag and nothing else, so a jam cost a click.
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    const handler = source.slice(source.indexOf('async _onClearJam(event)'));
    const body = handler.slice(0, handler.indexOf('\n    }'));
    assert.match(body, /ballisticSkill/, 'a Ballistic Skill test is rolled');
    assert.match(body, /resolveJamClear/, 'the book rule decides the outcome');
    assert.match(body, /clip\.value/, 'the ammunition in the weapon is lost');
});

test('a jam does not survive the roll that replaces it', () => {
    // A Fate re-roll repeats the same shot on the same rollData. The flags were
    // only ever set, never cleared, so a jam outlived a successful re-roll and
    // went on cancelling the damage.
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    const check = source.slice(source.indexOf('// Check for weapon jam and overheating'));
    const block = check.slice(0, check.indexOf('rollData.result = result;'));
    assert.match(block, /rollData\.weaponJammed = false;/, 'the jam flag is reset per roll');
    assert.match(block, /rollData\.weaponOverheated = false;/, 'and so is the overheat flag');
    assert.match(block, /isReRoll[\s\S]*unsetLegacyFlag\(rolledWeapon, "jammed"\)/,
        'a re-roll that does not jam also clears the persisted flag');
});
