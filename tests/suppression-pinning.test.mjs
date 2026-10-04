import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSystem} from './helpers/system.mjs';

/**
 * A target of Suppressing Fire, and a record of what happened to it.
 *
 * DH2 p. 225: "All targets within the kill zone must make a Difficult (-10)
 * Pinning test or become Pinned as per page 230. If the attacker fired a Full
 * Auto burst, the Pinning test is Hard (-20) instead."
 * DH2 p. 231: "Pinning ... this is a Challenging (+0) Willpower test. If the
 * character succeeds, he can act normally. If he fails, he instead becomes
 * Pinned."
 */
function suppressedActor(held = []) {
    const conditions = new Set(held);
    const added = [];
    const actor = {
        name: 'Guardsman',
        conditions,
        added,
        hasCondition: id => conditions.has(id),
        addCondition: async id => { conditions.add(id); added.push(id); },
        removeCondition: async id => { conditions.delete(id); },
        getActiveTokens: () => [{name: 'Guardsman', actor: null, document: {effects: []}}]
    };
    actor.getActiveTokens = () => [{name: 'Guardsman', actor, document: {effects: []}}];
    return actor;
}

test('a failed suppression test pins the target rather than frightening it', async () => {
    const system = loadSystem();
    const actor = suppressedActor();
    await system.get('applySuppressionPinning')(actor);
    assert.ok(actor.added.includes('pinned'), 'the target is Pinned');
    assert.equal(actor.added.includes('fear'), false, 'and is not made afraid');
});

test('a target already pinned is not pinned twice', async () => {
    const system = loadSystem();
    const actor = suppressedActor(['pinned']);
    await system.get('applySuppressionPinning')(actor);
    assert.deepEqual([...actor.added], []);
    assert.equal(actor.hasCondition('pinned'), true, 'and stays pinned');
});

test('the suppression test is a Willpower test, as Pinning is', () => {
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    const builder = source.slice(source.indexOf('static createFearTestRolldata'));
    assert.match(builder.slice(0, 200), /characteristics\.willpower/);
});

test('the difficulty is -10 for a burst and -20 for full auto (p. 225)', () => {
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    const flow = source.slice(source.indexOf('createFearTestRolldata(actor)'));
    const block = flow.slice(0, flow.indexOf('SUPPRESSION.HEADER'));
    assert.match(block, /suppressionLength === "full"[\s\S]*?suppressionModifier = -20/);
    assert.match(block, /suppressionModifier = -10/);
});

test('nothing in the suppression flow still speaks of fear', () => {
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /addFearCondition/, 'the old function is gone');
    const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
    const stale = Object.keys(lang).filter(key => key.startsWith('SUPPRESSION.') && key.includes('FEAR'));
    assert.deepEqual(stale, [], 'no suppression string is named for fear');
    const card = readFileSync(new URL('../template/chat/suppression.hbs', import.meta.url), 'utf8');
    assert.doesNotMatch(card, /FEAR/);
});

/** The conditions a piece of a template sits under, innermost last. */
function conditionsAround(template, needle) {
    const found = [];
    const stack = [];
    const token = /{{#(if|unless) ([^}]+)}}|{{else}}|{{\/(if|unless)}}/g;
    let last = 0;
    const scan = upTo => {
        for (let at = template.indexOf(needle, last); at !== -1 && at < upTo; at = template.indexOf(needle, at + 1))
            found.push(stack.map(entry => `${entry.holds ? '' : 'not '}${entry.condition}`));
    };
    for (const match of template.matchAll(token)) {
        scan(match.index);
        last = match.index;
        if (match[1]) stack.push({condition: match[2].trim(), holds: match[1] === 'if'});
        else if (match[0] === '{{else}}') stack.at(-1).holds = !stack.at(-1).holds;
        else stack.pop();
    }
    scan(template.length);
    return found;
}

test('the suppression test is offered whether or not the burst hit anyone (p. 225)', () => {
    // "All targets within the kill zone must make a ... Pinning test": the test
    // is for being under fire. The button sat inside the branch for a successful
    // attack roll, so a burst that hit nobody pinned nobody.
    const card = readFileSync(new URL('../template/chat/roll.hbs', import.meta.url), 'utf8');
    const places = conditionsAround(card, 'invoke-suppression');
    assert.ok(places.length > 0, 'the card has a suppression button');
    assert.ok(places.some(under => !under.includes('flags.isSuccess')),
        `every suppression button requires a hit: ${JSON.stringify(places)}`);
    assert.ok(places.every(under => under.some(condition => condition.includes('"suppression"'))),
        'and it is still offered only for Suppressing Fire');
});
