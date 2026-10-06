import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));

test('the Quick Build button is gated on a setting', () => {
    // Two sheets define _getHeaderButtons; the wizard lives in the one that
    // names WIZARD.HEADER_BUTTON, so the gate is checked around that.
    const at = source.indexOf('WIZARD.HEADER_BUTTON');
    assert.ok(at > -1, 'the button still exists, it is only hidden');
    const around = source.slice(at - 800, at);
    assert.match(around, /this\.actor\.isOwner && _creationWizardVisible\(\)/);
});

test('the setting exists, is world-scoped and starts off', () => {
    const settings = readFileSync(new URL('../script/settings.mjs', import.meta.url), 'utf8');
    const block = settings.slice(settings.indexOf('"showCreationWizard"'));
    const body = block.slice(0, block.indexOf('});'));
    assert.match(body, /scope: "world"/);
    assert.match(body, /config: true/, 'so a GM can turn it on without editing code');
    assert.match(body, /default: false/);
});

test('an unregistered setting hides the button rather than showing it', () => {
    // The sheet can draw its header before settings are registered, and a throw
    // there would show the button by accident. Hiding unfinished work is the
    // safer answer to any uncertainty.
    const fn = source.slice(source.indexOf('function _creationWizardVisible'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /catch \(err\) \{ return false; \}/);
});

test('the wizard itself is untouched and still reachable for testing', () => {
    // Hiding the door is not the same as removing the room: the wizard is still
    // exported on the public API so it can be finished and tried out.
    assert.match(source, /openCharacterWizard: openCharacterWizard/);
    assert.match(source, /startCharacterCreation: startCharacterCreation/);
    // The wizard module is untouched and still loads on its own.
    assert.doesNotMatch(source, /\/\/\s*openCharacterWizard/, 'nothing was commented out');
});

test('the setting is described in English', () => {
    assert.ok(lang['SETTINGS.SHOW_WIZARD']);
    assert.match(lang['SETTINGS.SHOW_WIZARD_HINT'], /Quick Build/);
});
