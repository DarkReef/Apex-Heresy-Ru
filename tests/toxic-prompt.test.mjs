import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));

test('the poison test is offered to the player, not rolled for them', () => {
    // The report: "There is no prompt for the PC to roll a toxic test when
    // taking damage from a weapon with the toxic quality, the test is
    // automatically rolled for them." The setting that governs this already
    // existed and was honoured for fire and blood loss, but not here.
    const fn = source.slice(source.indexOf('async function _applyToxicEffect'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /_shouldPromptPlayerRoll\(actor\)/);
    assert.match(body, /roll-toxic-test/, 'the card carries a button for the owner');
});

test('the resolution is shared, so the button and the automation cannot drift', () => {
    assert.match(source, /async function _resolveToxicTest\(actor, combatant, value\)/);
    const auto = source.slice(source.indexOf('async function _applyToxicEffect'));
    assert.match(auto.slice(0, auto.indexOf('\n}')), /_resolveToxicTest\(actor, combatant, value\)/);
    const handler = source.slice(source.indexOf('async function onToxicTestClick'));
    assert.match(handler.slice(0, handler.indexOf('\n}')), /_resolveToxicTest\(actor, null, value\)/);
});

test('the resolution still applies damage that armour and Toughness do not stop', () => {
    const fn = source.slice(source.indexOf('async function _resolveToxicTest'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /_rollWeaponEffectTest\(actor, "toughness", -10 \* value/);
    assert.match(body, /_applyDirectDamage\(actor, extra\.total, true\)/);
    assert.match(body, /unsetLegacyFlag\(actor, "toxic"\)/, 'and clears the mark afterwards');
});

test('the button is wired to a handler', () => {
    assert.match(source, /"\.roll-toxic-test": onToxicTestClick/);
});

test('the strings it needs exist', () => {
    assert.match(lang['WEAPON.TRAIT.TOXIC_PROMPT'], /\{test\}/);
    assert.ok(lang['WEAPON.TRAIT.TOXIC_ROLL']);
});

test('a player who is not offered the roll still gets it rolled', () => {
    // The setting is opt-in; with it off, nothing about the old behaviour changes.
    const fn = source.slice(source.indexOf('function _shouldPromptPlayerRoll'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /hasPlayerOwner/, 'and an NPC is never asked');
    assert.match(body, /promptPlayerRolls/);
});
