import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';
import {RULESET_DEFS, stepsFor, contentPacksFor} from '../script/creation/ruleset-data.mjs';
import {pointBuyRules, pointBuyProblems, rollExpression} from '../script/creation/creation-roll-data.mjs';
import {CHARACTERISTIC_KEYS, STAGES} from '../script/creation/origin-data.mjs';
import {PATRON_RELATIONS, patronRelation, stepCost, ladderTotal, infamyAdvanceCost,
    alignmentLeader, BC_CHARACTERISTIC_PATRONS, BC_SKILL_PATRONS, BC_INFAMY_ADVANCE,
    MARK_OF_CHAOS_ADVANCES} from '../script/creation/patron-data.mjs';

test('Black Crusade runs race, characteristics, archetype, passions, experience, equipment, gods (p. 48)', () => {
    assert.deepEqual(stepsFor('bc').map(step => step.id),
        ['race', 'characteristics', 'archetype', 'passions', 'experience', 'equipment', 'darkGods']);
    assert.ok(STAGES.bc.includes('race') && STAGES.bc.includes('archetype'));
});

test('the book rolls 2d10 over a base the race decides, with one re-roll (p. 53)', () => {
    const bc = RULESET_DEFS.bc;
    assert.equal(bc.characteristicModifiers, 'flat');
    assert.equal(bc.characteristicRerolls, 1, 'blessed by the Dark Gods: one re-roll, kept');
    assert.equal(bc.characteristicBase, 25, 'the human base; the race overrides it');
    assert.equal(rollExpression('flat', 0, 25), '2d10+25');
    assert.equal(rollExpression('flat', 0, 30), '2d10+30', 'a Chaos Space Marine adds 30');
    assert.equal(rollExpression('flat', 5, 30), '2d10+30+5', 'archetype and passions are flat');
    assert.equal(rollExpression('generation', 0), '2d10+20', 'Dark Heresy is unchanged');
});

test('Infamy sits on the Influence characteristic and rolls 1d5+19 (p. 53)', () => {
    assert.deepEqual(RULESET_DEFS.bc.infamy, {key: 'influence', formula: '1d5+19'});
    assert.ok(CHARACTERISTIC_KEYS.includes('influence'));
    assert.equal(RULESET_DEFS.dh2.infamy, undefined, 'Dark Heresy has Influence, not Infamy');
});

test('point buy starts at the race base with 100 points and +20 on any one (p. 53)', () => {
    assert.deepEqual(pointBuyRules('bc'), {base: 25, points: 100, cap: 45});
    assert.deepEqual(pointBuyRules('bc', 30), {base: 30, points: 100, cap: 50},
        'a Chaos Space Marine starts higher and so may reach higher');
    const rules = pointBuyRules('bc', 30);
    const even = Object.fromEntries(CHARACTERISTIC_KEYS.map(key => [key, 40]));   // 10 x 10 = 100
    assert.deepEqual(pointBuyProblems(even, rules, CHARACTERISTIC_KEYS), []);
    assert.match(pointBuyProblems({...even, strength: 51}, rules, CHARACTERISTIC_KEYS).join(' '), /cap/);
    assert.deepEqual(pointBuyRules('ow'), {base: 20, points: 100, cap: 40}, 'Only War is unchanged');
});

test('starting experience is 1,000, and the race may say otherwise (p. 75)', () => {
    assert.equal(RULESET_DEFS.bc.startingExperience, 1000);
    assert.equal(RULESET_DEFS.bc.aptitudes, false, 'the book has no aptitudes at all');
    assert.equal(contentPacksFor('bc')[0], 'apex-heresy-ru.black-crusade');
});

test('Table 2-4: Khorne and Nurgle stand together, Slaanesh and Tzeentch stand together (p. 76)', () => {
    assert.equal(patronRelation('khorne', 'khorne'), 'own');
    assert.equal(patronRelation('khorne', 'nurgle'), 'ally');
    assert.equal(patronRelation('khorne', 'slaanesh'), 'enemy');
    assert.equal(patronRelation('slaanesh', 'tzeentch'), 'ally');
    assert.equal(patronRelation('tzeentch', 'khorne'), 'enemy');
    for (const god of Object.keys(PATRON_RELATIONS))
        assert.equal(patronRelation('undivided', god), 'ally', 'the unaligned oppose nobody');
    assert.equal(patronRelation(null, null), 'ally', 'an unmarked purchase falls to the undivided');
});

test('Tables 2-6, 2-7 and 2-9 price a step by the patron (pp. 78-79)', () => {
    assert.deepEqual([0, 1, 2, 3].map(step => stepCost('characteristic', 'own', step)), [100, 250, 500, 750]);
    assert.deepEqual([0, 1, 2, 3].map(step => stepCost('characteristic', 'enemy', step)), [500, 750, 1000, 2500]);
    assert.deepEqual([0, 1, 2, 3].map(step => stepCost('skill', 'ally', step)), [200, 350, 500, 750]);
    assert.deepEqual([0, 1, 2].map(step => stepCost('talent', 'own', step)), [200, 300, 400]);
    assert.equal(stepCost('characteristic', 'own', 4), null, 'there is no fifth step');
});

test('paying for a step means paying for the ones below it (p. 78)', () => {
    assert.equal(ladderTotal('characteristic', 'own', 4), 100 + 250 + 500 + 750);
    assert.equal(ladderTotal('skill', 'enemy', 2), 250 + 500);
    assert.equal(ladderTotal('characteristic', 'ally', 0), 0);
    assert.equal(ladderTotal('characteristic', 'ally', 9), 250 + 500 + 750 + 1000, 'the ladder ends');
});

test('Infamy costs a flat 500 a step and stops being buyable at 40 (p. 78)', () => {
    assert.deepEqual(BC_INFAMY_ADVANCE, {cost: 500, cap: 40});
    assert.equal(infamyAdvanceCost(23), 500);
    assert.equal(infamyAdvanceCost(35), 500);
    assert.equal(infamyAdvanceCost(40), null, 'past 40 Infamy is earned, not bought');
    assert.equal(infamyAdvanceCost(45), null);
});

test('only four characteristics and fourteen skills have a god (Tables 2-5, 2-8, pp. 77-79)', () => {
    assert.deepEqual(BC_CHARACTERISTIC_PATRONS,
        {strength: 'khorne', toughness: 'nurgle', willpower: 'tzeentch', fellowship: 'slaanesh'});
    assert.equal(BC_CHARACTERISTIC_PATRONS.influence, undefined, 'Infamy belongs to nobody');
    assert.equal(BC_SKILL_PATRONS.psyniscience, 'tzeentch');
    assert.equal(BC_SKILL_PATRONS.parry, 'khorne');
    assert.equal(BC_SKILL_PATRONS.awareness, undefined, 'unlisted skills are undivided');
    assert.equal(Object.keys(BC_SKILL_PATRONS).length, 14);
});

test('a god claims a Heretic only five advances clear of the others (p. 76)', () => {
    assert.equal(alignmentLeader({khorne: 6, nurgle: 1}), 'khorne');
    assert.equal(alignmentLeader({khorne: 6, nurgle: 2}), 'undivided', 'four clear is not enough');
    assert.equal(alignmentLeader({}), 'undivided');
    assert.equal(MARK_OF_CHAOS_ADVANCES, 20, 'a Mark of Chaos comes at twenty advances (p. 79)');
});

test('the sheet and the wizard read the same patron tables', () => {
    const system = loadSystem();
    assert.equal(system.get('Dh.patronRelations'), PATRON_RELATIONS, 'the very same object');
    assert.equal(system.get('Dh.bcInfamyAdvanceCost'), BC_INFAMY_ADVANCE.cost);
    assert.equal(system.get('Dh.bcInfamyAdvanceCap'), BC_INFAMY_ADVANCE.cap);
    assert.equal(system.get('Dh.bcCharacteristicPatrons'), BC_CHARACTERISTIC_PATRONS);
    assert.equal(system.get('Dh.bcSkillPatrons'), BC_SKILL_PATRONS);
});
