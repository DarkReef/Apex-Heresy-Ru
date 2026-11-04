import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COUNTER_ATTACK_FLAG, hasCounterAttack, canCounterAttack} from '../script/combat/counter-attack.mjs';

const armed = {selected: 'parry', success: true, talents: ['Counter Attack']};

test('the talent is recognised however it is written', () => {
    for (const name of ['Counter Attack', 'counter attack', 'Counter-Attack'])
        assert.equal(hasCounterAttack([name]), true, name);
});

test('a similarly named talent is not mistaken for it', () => {
    assert.equal(hasCounterAttack(['Counter Attack Mastery']), false);
    assert.equal(hasCounterAttack(['Lightning Attack']), false);
    assert.equal(hasCounterAttack([]), false);
});

test('a successful Parry by a holder of the talent earns the riposte', () => {
    assert.equal(canCounterAttack(armed), true);
});

test('it follows a Parry and nothing else', () => {
    // p. 126 says "after successfully Parrying"; dodging does not qualify.
    for (const selected of ['dodge', 'deny', 'willpower', 'agility'])
        assert.equal(canCounterAttack({...armed, selected}), false, selected);
});

test('a failed Parry earns nothing', () => {
    assert.equal(canCounterAttack({...armed, success: false}), false);
});

test('without the talent there is no riposte', () => {
    assert.equal(canCounterAttack({...armed, talents: []}), false);
});

test('once per turn means once', () => {
    assert.equal(canCounterAttack({...armed, usedThisTurn: true}), false);
});

test('the offer reaches the evasion card and is spent when taken', () => {
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    assert.match(source, /canCounterAttack/, 'the rule decides');
    assert.match(source, /getLegacyFlag\(actor, COUNTER_ATTACK_FLAG\)/,
        'and the once-per-turn mark is read');
    assert.match(source, /setLegacyFlag\(actor, COUNTER_ATTACK_FLAG, true\)/,
        'and set when the riposte is taken');
    const card = readFileSync(new URL('../template/chat/evasion.hbs', import.meta.url), 'utf8');
    assert.match(card, /counter-attack/, 'the card offers it');
});

test('the mark is cleared when the turn comes round again', () => {
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    assert.match(source, /unsetLegacyFlag\(actor, COUNTER_ATTACK_FLAG\)/,
        'otherwise one riposte would last the whole fight');
});
