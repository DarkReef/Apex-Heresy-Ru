import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSystem} from './helpers/system.mjs';
import {RULESET_DEFS, stepsFor, contentPacksFor, characteristicKeysFor, fateFromTable}
    from '../script/creation/ruleset-data.mjs';
import {pointBuyRules, rollExpression, woundsExpression} from '../script/creation/creation-roll-data.mjs';
import {CHARACTERISTIC_KEYS, STAGES} from '../script/creation/origin-data.mjs';
import {unnaturalFromTrait, planToActorUpdate, revertUpdate} from '../script/creation/origin-apply.mjs';
import {emptyPlan} from '../script/creation/grant-data.mjs';

test('Deathwatch runs Space Marine, characteristics, Chapter, Speciality, experience, life (p. 24)', () => {
    assert.deepEqual(stepsFor('dw').map(step => step.id),
        ['spaceMarine', 'characteristics', 'chapter', 'speciality', 'experience', 'life']);
    // advanceList is not a step the player walks: it is the menu he buys from.
    assert.deepEqual(STAGES.dw, ['spaceMarine', 'chapter', 'speciality', 'advanceList']);
    assert.equal(stepsFor('dw').some(step => step.stage === 'advanceList'), false);
});

test('a Battle-Brother rolls 2d10+30 with one re-roll (p. 26)', () => {
    const dw = RULESET_DEFS.dw;
    assert.equal(dw.characteristicBase, 30);
    assert.equal(dw.characteristicRerolls, 1);
    assert.equal(dw.characteristicModifiers, 'flat', 'the Chapter adds to the finished roll');
    assert.equal(rollExpression('flat', 0, dw.characteristicBase), '2d10+30');
    assert.deepEqual(pointBuyRules('dw'), {base: 30, points: 100, cap: 50}, 'p. 27');
});

test('he has no Influence, and no aptitudes at all (pp. 26, 58)', () => {
    assert.deepEqual(characteristicKeysFor('dw'), CHARACTERISTIC_KEYS.filter(key => key !== 'influence'));
    assert.equal(RULESET_DEFS.dw.aptitudes, false);
    assert.equal(RULESET_DEFS.dw.advanceLists, true, 'every advance is a line with its own price');
    assert.equal(contentPacksFor('dw')[0], 'apex-heresy-ru.deathwatch');
});

test('wounds are 18+1d5 and Fate comes from Table 1-2 (p. 28)', () => {
    assert.equal(woundsExpression(RULESET_DEFS.dw.wounds), '18+1d5');
    const table = RULESET_DEFS.dw.fate.table;
    assert.equal(RULESET_DEFS.dw.fate.formula, '1d10');
    assert.deepEqual([1, 7, 8, 9, 10].map(roll => fateFromTable(roll, table)), [3, 3, 4, 4, 5]);
});

test('1,000 experience to spend, and 12,000 he already is (p. 28)', () => {
    assert.equal(RULESET_DEFS.dw.startingExperience, 1000);
    assert.equal(RULESET_DEFS.dw.backgroundExperience, 12000,
        'that figure is what he has become, not what he buys');
    assert.equal(RULESET_DEFS.dh2.backgroundExperience, undefined, 'no other book carries one');
});

test('Unnatural (x2) doubles the bonus instead of adding to it (p. 136)', () => {
    assert.deepEqual(unnaturalFromTrait('Unnatural Strength (x2)'), {key: 'strength', value: 0, multiplier: 2});
    assert.deepEqual(unnaturalFromTrait('Unnatural Toughness (x2)'), {key: 'toughness', value: 0, multiplier: 2});
    // The other books keep adding, and must not be re-read as multipliers.
    assert.deepEqual(unnaturalFromTrait('Unnatural Characteristic (Strength +4)'),
        {key: 'strength', value: 4, multiplier: 1});

    const actor = () => ({items: [], system: {
        characteristics: {strength: {base: 40, unnatural: 0, unnaturalMultiplier: 1}},
        skills: {}, wounds: {max: 0, value: 0}, corruption: 0, insanity: 0, aptitudes: {}
    }});
    const {update, applied} = planToActorUpdate(actor(),
        {...emptyPlan(), traits: [{name: 'Unnatural Strength (x2)'}]});
    assert.equal(update['system.characteristics.strength.unnaturalMultiplier'], 2);
    assert.equal(update['system.characteristics.strength.unnatural'], undefined, 'no number is added');
    assert.deepEqual(applied.unnaturalMultiplier, {strength: 1}, 'what it was, so it can be put back');

    const back = revertUpdate({items: [], system: {characteristics: {strength: {unnaturalMultiplier: 2}}}},
        {unnaturalMultiplier: {strength: 1}});
    assert.equal(back['system.characteristics.strength.unnaturalMultiplier'], 1);
});

test('the sheet multiplies the bonus, and the multiplier survives the characteristic growing', () => {
    const system = loadSystem();
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    assert.match(source, /Math\.floor\(characteristic\.total \/ 10\) \* multiplier \+ unnatural/);
    assert.match(source, /Math\.floor\(characteristic\.displayTotal \/ 10\) \* multiplier \+ unnatural/);

    // Every characteristic carries the field, defaulting to a plain single bonus.
    const template = JSON.parse(readFileSync(new URL('../template.json', import.meta.url), 'utf8'));
    const characteristics = template.Actor.templates.characteristics.characteristics;
    for (const [key, entry] of Object.entries(characteristics))
        assert.equal(entry.unnaturalMultiplier, 1, key);
    assert.ok(system.get('Dh.rulesets.dw'), 'the book has a rules profile of its own');
});

test('Felling bites the unnatural part of the bonus, however that part was earned', () => {
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    // Reading the unnatural field alone would miss a doubled bonus entirely.
    assert.match(source, /const natural = Math\.floor\(\(Number\(toughness\.total\) \|\| 0\) \/ 10\);/);
    assert.match(source, /const unnatural = Math\.max\(\(Number\(toughness\.bonus\) \|\| 0\) - natural, 0\);/);
});
