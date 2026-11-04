import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSystem} from './helpers/system.mjs';
import {RULESET_DEFS, stepsFor, auditedRulesets, characteristicKeysFor, fateFromTable, contentPacksFor}
    from '../script/creation/ruleset-data.mjs';
import {characteristicLadder, advanceCost, CHARACTERISTIC_LEVELS, CHARACTERISTIC_COSTS}
    from '../script/creation/advancement-data.mjs';
import {pointBuyRules, pointBuyProblems, POINT_BUY} from '../script/creation/creation-roll-data.mjs';
import {characteristicOffers, purchaseCharacteristic} from '../script/creation/shop-data.mjs';
import {CHARACTERISTIC_KEYS, STAGES} from '../script/creation/origin-data.mjs';

test('Dark Heresy keeps its five-step characteristic ladder', () => {
    const ladder = characteristicLadder('dh2');
    assert.deepEqual(ladder.levels, CHARACTERISTIC_LEVELS);
    assert.deepEqual(ladder.costs, CHARACTERISTIC_COSTS);
    assert.equal(characteristicLadder('unknown'), ladder);
});

test('Only War has four characteristic steps with its own prices (Table 3-14, p. 102)', () => {
    const ladder = characteristicLadder('ow');
    assert.deepEqual(ladder.levels, ['simple', 'intermediate', 'trained', 'expert']);
    assert.deepEqual(Object.values(ladder.costs[2]), [100, 250, 500, 750]);
    assert.deepEqual(Object.values(ladder.costs[1]), [250, 500, 750, 1000]);
    assert.deepEqual(Object.values(ladder.costs[0]), [500, 750, 1000, 2500]);
    assert.equal(advanceCost('characteristic', 'expert', 0, 'ow'), 2500);
    assert.equal(advanceCost('characteristic', 'proficient', 2, 'ow'), null);
    assert.equal(advanceCost('characteristic', 'proficient', 2), 750, 'the ruleset defaults to Dark Heresy');
});

test('the shop stops an Only War characteristic after its fourth step', () => {
    const snapshot = advance => ({
        ruleset: 'ow', aptitudes: new Set(['Weapon Skill', 'Offence']),
        characteristics: {weaponSkill: {advance, cost: 0, aptitudes: ['Weapon Skill', 'Offence']}}
    });
    const offer = characteristicOffers(snapshot(15)).find(o => o.key === 'weaponSkill');
    assert.equal(offer.nextLevel, 'expert');
    assert.equal(offer.cost, 750);
    assert.equal(characteristicOffers(snapshot(20)).find(o => o.key === 'weaponSkill').maxed, true);
    assert.equal(purchaseCharacteristic(snapshot(15), 'weaponSkill').update['system.characteristics.weaponSkill.cost'],
        100 + 250 + 500 + 750);
});

test('Only War point buy starts at 20 with 100 points and at most +20 per characteristic (p. 75)', () => {
    assert.deepEqual(pointBuyRules('ow'), {base: 20, points: 100, cap: 40});
    assert.deepEqual(pointBuyRules('dh2'), POINT_BUY);
    const keys = characteristicKeysFor('ow');
    const even = Object.fromEntries(keys.map(key => [key, 31]));   // 9 x 11 = 99 points
    assert.deepEqual(pointBuyProblems(even, pointBuyRules('ow'), keys), []);
    assert.match(pointBuyProblems({...even, strength: 41}, pointBuyRules('ow'), keys).join(' '), /cap/);
    assert.match(pointBuyProblems({...even, strength: 33}, pointBuyRules('ow'), keys).join(' '), /budget/);
});

test('Only War characters have no Influence; Dark Heresy ones do', () => {
    assert.deepEqual(characteristicKeysFor('ow'), CHARACTERISTIC_KEYS.filter(key => key !== 'influence'));
    assert.deepEqual(characteristicKeysFor('dh2'), CHARACTERISTIC_KEYS);
});

test('Only War starting fate comes from Table 3-13 (p. 100)', () => {
    const table = RULESET_DEFS.ow.fate.table;
    assert.equal(RULESET_DEFS.ow.fate.formula, '1d10');
    assert.deepEqual([1, 7, 8, 9, 10].map(total => fateFromTable(total, table)), [1, 1, 2, 2, 3]);
    assert.equal(RULESET_DEFS.dh2.fate, undefined, 'Dark Heresy takes fate from the home world');
});

test('the rule differences are ruleset fields, with Dark Heresy unchanged', () => {
    const {dh2, ow} = RULESET_DEFS;
    assert.equal(ow.characteristicModifiers, 'flat');
    assert.equal(ow.characteristicRerolls, 1, 'one re-roll, p. 74');
    assert.equal(dh2.characteristicRerolls ?? 0, 0);
    assert.equal(ow.startingExperience, 600);
    assert.equal(dh2.startingExperience, 1000);
    assert.deepEqual(ow.duplicates, {skill: 'advance', talentExperience: 100});
    assert.deepEqual(dh2.duplicates ?? {skill: 'best', talentExperience: 0}, {skill: 'best', talentExperience: 0});
    assert.equal(contentPacksFor('ow')[0], 'apex-heresy-ru.only-war');
    assert.equal(contentPacksFor('dh2')[0], 'apex-heresy-ru.dark-heresy');
    assert.deepEqual(new Set(contentPacksFor('ow')), new Set(contentPacksFor('dh2')), 'same packs, different order');
});

test('Only War runs regiment, characteristics, speciality, experience, comrade (p. 73)', () => {
    assert.deepEqual(stepsFor('ow').map(step => step.id), ['regiment', 'characteristics', 'speciality', 'experience', 'comrade']);
    assert.ok(STAGES.ow.includes('regiment') && STAGES.ow.includes('speciality'));
    assert.equal(STAGES.ow.includes('standardKit'), false, 'the kit is bought from Table 2-6, not picked as an origin');
});

test('the wizard offers the books it can actually run', () => {
    assert.deepEqual(auditedRulesets(), ['dh2', 'ow', 'bc', 'dw']);
});

test('the sheet charges Only War characteristics along its own ladder', () => {
    const system = loadSystem();
    const ladder = characteristicLadder('ow');
    const rows = system.get('Dh.rulesets.ow.characteristicCosts');
    assert.deepEqual([...rows[0]], [0, 0, 0]);
    ladder.levels.forEach((level, index) =>
        assert.deepEqual([...rows[index + 1]], [ladder.costs[2][level], ladder.costs[1][level], ladder.costs[0][level]], level));
    assert.equal(system.get('Dh.rulesets.dh2.characteristicCosts'), undefined, 'Dark Heresy falls back to Dh.characteristicCosts');
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    assert.match(source, /Dh\.rulesetFor\(this\)\.characteristicCosts \?\? config\.characteristicCosts/);
});

test('elite advances belong to Dark Heresy; Only War has none (p. 86)', () => {
    assert.equal(RULESET_DEFS.dh2.eliteAdvances, true);
    assert.ok(!RULESET_DEFS.ow.eliteAdvances, 'the Sanctioned Psyker is a speciality there, not an advance');
});
