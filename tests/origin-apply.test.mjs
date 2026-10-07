import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyPlan} from '../script/creation/grant-data.mjs';
import {planToActorUpdate, planToItemData, revertUpdate,
        GRANT_FLAG_SCOPE, GRANT_FLAG_KEY} from '../script/creation/origin-apply.mjs';

const actor = () => ({items: [], system: {
    characteristics: {strength: {base: 30}, toughness: {base: 28}, fellowship: {base: 31},
                      influence: {base: 25}},
    skills: {
        survival: {advance: -20, starter: false, isSpecialist: false, specialities: {}},
        commonLore: {advance: -20, isSpecialist: true, specialities: {
            adeptusArbites: {label: 'Adeptus Arbites', advance: -20, starter: false, cost: 0},
            imperium: {label: 'Imperium', advance: -20, starter: false, cost: 0}
        }}
    },
    wounds: {max: 0, value: 0}, fate: {max: 0, value: 0},
    corruption: 0, insanity: 0, aptitudes: {}
}});
const withAptitudes = (subject, ...names) => {
    subject.items = names.map(name => ({type: 'aptitude', name}));
    return subject;
};

test('characteristic modifiers raise base values and are recorded for the undo', () => {
    const plan = {...emptyPlan(), characteristics: {strength: 5, fellowship: -5}};
    const {update, applied} = planToActorUpdate(actor(), plan);
    assert.equal(update['system.characteristics.strength.base'], 35);
    assert.equal(update['system.characteristics.fellowship.base'], 26);
    assert.deepEqual(applied.characteristics, {strength: 5, fellowship: -5});
});

test('under a generation ruleset a characteristic modifier is recorded, not written', () => {
    // Dark Heresy modifiers are a generation rule (p. 31): a "+" rolls 3d10 and keeps the best
    // two, point buy starts at 30. The modifier is already inside the generated value, so
    // writing it to base as well would count it twice.
    const plan = {...emptyPlan(), characteristics: {strength: 5, fellowship: -5}};
    const {update, applied} = planToActorUpdate(actor(), plan, {characteristicMode: 'generation'});
    assert.equal(update['system.characteristics.strength.base'], undefined);
    assert.deepEqual(applied.characteristics, {});
    assert.deepEqual(applied.generationModifiers, {strength: 5, fellowship: -5});
});

test('a recorded generation modifier is not undone, because it was never written', () => {
    const subject = actor();
    const {applied} = planToActorUpdate(subject, {...emptyPlan(), characteristics: {strength: 5}},
                                        {characteristicMode: 'generation'});
    assert.deepEqual(revertUpdate(subject, applied), {});
});

test('a flat ruleset writes the modifier and is the default', () => {
    const plan = {...emptyPlan(), characteristics: {strength: 5}};
    const asDefault = planToActorUpdate(actor(), plan);
    const asFlat = planToActorUpdate(actor(), plan, {characteristicMode: 'flat'});
    assert.equal(asDefault.update['system.characteristics.strength.base'], 35);
    assert.deepEqual(asDefault.update, asFlat.update);
    assert.deepEqual(asDefault.applied.generationModifiers, {});
});

test('a characteristic the actor does not have is skipped rather than written blindly', () => {
    const {update, applied} = planToActorUpdate(actor(), {...emptyPlan(), characteristics: {luck: 5}});
    assert.equal(update['system.characteristics.luck.base'], undefined);
    assert.deepEqual(applied.characteristics, {});
});

test('a skill is only raised, never lowered, and only the raise is recorded', () => {
    const raised = actor();
    raised.system.skills.survival.advance = 10;
    const {update, applied} = planToActorUpdate(raised, {...emptyPlan(), skills: [{key: 'survival', advance: 0}]});
    assert.equal(update['system.skills.survival.advance'], undefined);
    assert.deepEqual(applied.skills, {});
});

test('an untrained skill moves to the granted advance and is marked as a free starting rank', () => {
    // The XP engine charges for every rank except those marked starter. A skill handed out
    // at creation is free, so without the mark auto-calculated costs would bill the player
    // for their own home world.
    const {update, applied} = planToActorUpdate(actor(), {...emptyPlan(), skills: [{key: 'survival', advance: 0}]});
    assert.equal(update['system.skills.survival.advance'], 0);
    assert.equal(update['system.skills.survival.starter'], true);
    assert.deepEqual(applied.skills, {survival: {from: -20, to: 0, starterWas: false}});
});

test('a speciality the skill already lists is raised under its own key, not duplicated', () => {
    // Specialities are keyed (adeptusArbites) with a display label (Adeptus Arbites).
    // Writing under the label would create a second, label-less entry beside the real one.
    const plan = {...emptyPlan(), specialities: [{key: 'commonLore', name: 'Adeptus Arbites', advance: 0}]};
    const {update, applied} = planToActorUpdate(actor(), plan);
    assert.equal(update['system.skills.commonLore.specialities.adeptusArbites.advance'], 0);
    assert.equal(update['system.skills.commonLore.specialities.adeptusArbites.starter'], true);
    assert.equal(Object.keys(update).some(k => k.includes('Adeptus Arbites')), false);
    assert.deepEqual(applied.specialities,
        [{key: 'commonLore', specKey: 'adeptusArbites', created: false, from: -20, starterWas: false}]);
});

test('matching a speciality ignores case and spacing', () => {
    const plan = {...emptyPlan(), specialities: [{key: 'commonLore', name: '  adeptus  ARBITES ', advance: 0}]};
    const {update} = planToActorUpdate(actor(), plan);
    assert.equal(update['system.skills.commonLore.specialities.adeptusArbites.advance'], 0);
});

test('a speciality the skill does not list is created with a key and its label', () => {
    const plan = {...emptyPlan(), specialities: [{key: 'commonLore', name: 'Tactica Imperialis', advance: 0}]};
    const {update, applied} = planToActorUpdate(actor(), plan);
    assert.deepEqual(update['system.skills.commonLore.specialities.tacticaImperialis'],
        {label: 'Tactica Imperialis', advance: 0, starter: true, cost: 0});
    assert.deepEqual(applied.specialities,
        [{key: 'commonLore', specKey: 'tacticaImperialis', created: true, from: -20, starterWas: false}]);
});

test('origin wound grants increase capacity without inflicting damage', () => {
    const wounded = actor();
    wounded.system.wounds.max = 9;
    wounded.system.wounds.value = 9;
    const {update, applied} = planToActorUpdate(wounded, {...emptyPlan(), wounds: 2, corruption: 3, insanity: 1});
    assert.equal(update['system.wounds.max'], 11);
    assert.equal(update['system.wounds.value'], undefined);
    assert.equal(update['system.corruption'], 3);
    assert.equal(update['system.insanity'], 1);
    assert.equal(applied.wounds, 2);
});

test('influence is a characteristic, not a counter of its own', () => {
    const {update, applied} = planToActorUpdate(actor(), {...emptyPlan(), influence: 5});
    assert.equal(update['system.characteristics.influence.base'], 30);
    assert.equal(applied.influence, 5);
});

test('aptitudes are not written to system.aptitudes, which neither the sheet nor XP costs read', () => {
    // The progression tab lists aptitude ITEMS and the XP engine counts aptitude ITEMS.
    // system.aptitudes is a legacy object nothing reads, so a grant there is invisible.
    const {update, applied} = planToActorUpdate(actor(), {...emptyPlan(), aptitudes: ['Toughness']});
    assert.equal(update['system.aptitudes'], undefined);
    assert.deepEqual(applied.aptitudes, ['Toughness']);
});

test('an aptitude the actor already holds as an item is not granted again', () => {
    const veteran = withAptitudes(actor(), 'Toughness');
    const {applied} = planToActorUpdate(veteran, {...emptyPlan(), aptitudes: ['Toughness']});
    assert.deepEqual(applied.aptitudes, []);
});

test('an aptitude that arrives twice is recorded as owed, not dropped', () => {
    // p. 79: a duplicate aptitude is replaced by another characteristic aptitude.
    const veteran = withAptitudes(actor(), 'Toughness');
    const {applied} = planToActorUpdate(veteran, {...emptyPlan(), aptitudes: ['Toughness', 'Knowledge']});
    assert.deepEqual(applied.aptitudes, ['Knowledge']);
    assert.deepEqual(applied.duplicateAptitudes, ['Toughness']);
});

test('General is held by every character, so granting it is never new', () => {
    // p. 79: all characters in Dark Heresy have the General aptitude.
    const {applied} = planToActorUpdate(actor(), {...emptyPlan(), aptitudes: ['General']});
    assert.deepEqual(applied.aptitudes, []);
});

test('no duplicate aptitude means nothing is owed', () => {
    const {applied} = planToActorUpdate(actor(), {...emptyPlan(), aptitudes: ['Toughness']});
    assert.deepEqual(applied.duplicateAptitudes, []);
});

test('an empty plan writes nothing at all', () => {
    const {update} = planToActorUpdate(actor(), emptyPlan());
    assert.deepEqual(update, {});
});

test('granted items are tagged with the stage and the carrier that produced them', () => {
    const lookup = (kind, name) => kind === 'talent' && name === 'Jaded'
        ? {name: 'Jaded', type: 'talent', _id: 'fromPack', system: {description: 'from the compendium'}} : null;
    const plan = {...emptyPlan(), talents: [{name: 'Jaded'}, {name: 'Nonexistent'}],
                  traits: [{name: 'Sturdy', rating: 3}], equipment: [{name: 'Sword', quantity: 2}]};
    const data = planToItemData(plan, 'dh2:homeWorld', 'carrier1', lookup);

    const jaded = data.find(d => d.name === 'Jaded');
    assert.equal(jaded.system.description, 'from the compendium');
    assert.equal(jaded._id, undefined, 'the pack id must not follow the copy onto the actor');
    assert.equal(jaded.flags[GRANT_FLAG_SCOPE][GRANT_FLAG_KEY], 'dh2:homeWorld');
    assert.equal(jaded.flags[GRANT_FLAG_SCOPE].grantedBy, 'carrier1');

    assert.equal(data.find(d => d.name === 'Nonexistent').type, 'talent');
    assert.equal(data.find(d => d.name === 'Sturdy').system.rating, 3);
    // Only ammunition holds a quantity in this system, so two swords are two items.
    assert.equal(data.filter(d => d.name === 'Sword').length, 2);
});

test('a talent handed out at creation is a free starting talent', () => {
    const data = planToItemData({...emptyPlan(), talents: [{name: 'Jaded'}]}, 'dh2:role', 'c1', () => null);
    assert.equal(data[0].system.starter, true);
});

test('aptitudes become aptitude items, tagged so the undo removes them', () => {
    const data = planToItemData(emptyPlan(), 'dh2:homeWorld', 'c1', () => null, {aptitudes: ['Toughness']});
    const item = data.find(d => d.type === 'aptitude');
    assert.equal(item.name, 'Toughness');
    assert.equal(item.flags[GRANT_FLAG_SCOPE].grantedBy, 'c1');
});

test('a talent target survives the copy out of the compendium', () => {
    const lookup = () => ({name: 'Hatred (Orks)', type: 'talent', system: {}});
    const plan = {...emptyPlan(), talents: [{name: 'Hatred (Orks)', targets: [{kind: 'faction', value: 'Orks'}]}]};
    const [hatred] = planToItemData(plan, 'dh2:role', 'carrier1', lookup);
    assert.deepEqual(hatred.system.targets, [{kind: 'faction', value: 'Orks'}]);
});

test('the undo restores exactly the recorded raises and nothing else', () => {
    const subject = actor();
    const {update, applied} = planToActorUpdate(subject, {...emptyPlan(),
        characteristics: {strength: 5}, skills: [{key: 'survival', advance: 0}],
        specialities: [{key: 'commonLore', name: 'Adeptus Arbites', advance: 0},
                       {key: 'commonLore', name: 'Tactica Imperialis', advance: 0}],
        wounds: 2, aptitudes: ['Toughness']});

    subject.system.characteristics.strength.base = update['system.characteristics.strength.base'];
    subject.system.skills.survival.advance = update['system.skills.survival.advance'];
    subject.system.skills.commonLore.specialities.adeptusArbites.advance = 0;
    subject.system.wounds.max = update['system.wounds.max'];
    assert.equal(update['system.wounds.value'], undefined);

    const back = revertUpdate(subject, applied);
    assert.equal(back['system.characteristics.strength.base'], 30);
    assert.equal(back['system.skills.survival.advance'], -20);
    assert.equal(back['system.skills.survival.starter'], false);
    // An existing speciality is put back, not deleted: it belongs to the skill list.
    assert.equal(back['system.skills.commonLore.specialities.adeptusArbites.advance'], -20);
    assert.equal(back['system.skills.commonLore.specialities.adeptusArbites.starter'], false);
    // A speciality this grant created is removed entirely.
    assert.equal(back['system.skills.commonLore.specialities.-=tacticaImperialis'], null);
    assert.equal(back['system.wounds.max'], 0);
    assert.equal(back['system.aptitudes'], undefined, 'aptitude items are removed with the carrier, not here');
});

test('the undo leaves a skill alone when something else raised it further', () => {
    const subject = actor();
    const applied = {skills: {survival: {from: -20, to: 0}}};
    subject.system.skills.survival.advance = 20;   // a later stage trained it past this grant
    assert.equal(revertUpdate(subject, applied)['system.skills.survival.advance'], undefined);
});

test('the undo of an empty record writes nothing', () => {
    assert.deepEqual(revertUpdate(actor(), {}), {});
});
