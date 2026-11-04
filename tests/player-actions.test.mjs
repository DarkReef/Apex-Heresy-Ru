import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
const combatTab = readFileSync(new URL('../template/sheet/actor/tab/combat.hbs', import.meta.url), 'utf8');

// ── Rolling your own initiative ───────────────────────────────────────────

test('the sheet offers a roll button beside the initiative formula', () => {
    // The report: "No way for a player to roll their own initiative." The sheet
    // carried the formula and the characteristic, but nothing to roll with.
    const start = combatTab.indexOf('class="information initiative"');
    const block = combatTab.slice(start, combatTab.indexOf('</div>', combatTab.indexOf('initiative-row', start)) + 200);
    assert.match(block, /class="roll-initiative"/);
});

test('the button is bound to a handler', () => {
    assert.match(source, /\.roll-initiative"\)\.click/);
    assert.match(source, /async _onRollInitiative\(event\)/);
});

test('the roll goes through the combat document, not around it', () => {
    // Routing through Combat#rollInitiative keeps Lightning Reflexes and the
    // rest of the system's handling; a second mechanism here would drift.
    const fn = source.slice(source.indexOf('async _onRollInitiative(event)'));
    const body = fn.slice(0, fn.indexOf('\n    }'));
    assert.match(body, /combat\.rollInitiative\(\[combatant\.id\]\)/);
});

test('it explains itself when there is nothing to roll into', () => {
    const fn = source.slice(source.indexOf('async _onRollInitiative(event)'));
    const body = fn.slice(0, fn.indexOf('\n    }'));
    assert.match(body, /INITIATIVE_NO_COMBAT/, 'no combat running');
    assert.match(body, /INITIATIVE_NOT_IN_COMBAT/, 'actor not a combatant');
    assert.match(body, /INITIATIVE_ALREADY_ROLLED/, 'and it will not reroll silently');
});

// ── Applying a roll as damage or healing ──────────────────────────────────

test('an ordinary roll card offers to apply its total', () => {
    assert.match(source, /function _addApplyRollButtons\(message, html\)/);
    const fn = source.slice(source.indexOf('function _addApplyRollButtons'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /data-mode="damage"/);
    assert.match(body, /data-mode="healing"/);
});

test('attack cards keep their own buttons and gain no second pair', () => {
    const fn = source.slice(source.indexOf('function _addApplyRollButtons'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /getLegacyFlag\(message, "rollData"\)\) return;/);
});

test('only the owner or the GM is offered the buttons', () => {
    const fn = source.slice(source.indexOf('function _addApplyRollButtons'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /isGM && !message\.isOwner\) return;/);
});

test('applying works on the selected tokens, and only on ones you own', () => {
    const fn = source.slice(source.indexOf('async function onApplyRollClick'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /canvas\?\.tokens\?\.controlled/);
    assert.match(body, /actor\?\.isOwner/);
    assert.match(body, /_applyDirectHealing/);
    assert.match(body, /_applyDirectDamage/);
});

test('damage and healing share the wound arithmetic', () => {
    // Both go through the same pure module, so the two cannot disagree about
    // where the critical boundary is.
    const damage = source.slice(source.indexOf('async function _applyDirectDamage'));
    assert.match(damage.slice(0, damage.indexOf('\n}')), /woundsAfterDamage/);
    const healing = source.slice(source.indexOf('async function _applyDirectHealing'));
    assert.match(healing.slice(0, healing.indexOf('\n}')), /woundsAfterHealing/);
});

test('the strings both features need exist', () => {
    for (const key of ['INITIATIVE_ROLL', 'INITIATIVE_NO_COMBAT', 'INITIATIVE_NOT_IN_COMBAT',
                       'INITIATIVE_ALREADY_ROLLED', 'CHAT.APPLY_DAMAGE', 'CHAT.APPLY_HEALING',
                       'CHAT.APPLY_NO_SELECTION', 'CHAT.APPLY_DAMAGED', 'CHAT.APPLY_HEALED'])
        assert.ok(lang[key], key);
});
