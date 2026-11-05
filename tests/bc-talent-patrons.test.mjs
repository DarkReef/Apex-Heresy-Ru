import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TIER_ONE, TIER_TWO, TIER_THREE, TALENT_TABLES, SPECIAL_TALENTS, talentPatron, patronOf,
    TALENT_COUNT} from '../script/creation/bc-talents.mjs';
import {PATRONS, UNDIVIDED} from '../script/creation/patron-data.mjs';

test('the three talent tables together hold the book\'s 131 named talents (pp. 80-82)', () => {
    const names = TALENT_TABLES.flatMap(table => Object.values(table).flat());
    assert.equal(names.length, 131, 'Psychic Power is listed as Special, not under a god');
    assert.equal(TALENT_COUNT, 131);
    assert.equal(new Set(names).size, names.length, 'no talent is listed twice');
    assert.deepEqual(SPECIAL_TALENTS, ['Psychic Power']);
    for (const table of TALENT_TABLES)
        assert.deepEqual(Object.keys(table).sort(), [...PATRONS, UNDIVIDED].sort());
});

test('a talent knows its god and its tier', () => {
    assert.deepEqual(talentPatron('Frenzy'), {patron: 'khorne', tier: 1});
    assert.deepEqual(talentPatron('Jaded'), {patron: 'nurgle', tier: 1});
    assert.deepEqual(talentPatron('Rapid Reload'), {patron: 'slaanesh', tier: 1});
    assert.deepEqual(talentPatron('Warp Sense'), {patron: 'tzeentch', tier: 1});
    assert.deepEqual(talentPatron('Quick Draw'), {patron: 'undivided', tier: 1});
    assert.deepEqual(talentPatron('Swift Attack'), {patron: 'khorne', tier: 2});
    assert.deepEqual(talentPatron('Mighty Shot'), {patron: 'nurgle', tier: 3});
    assert.deepEqual(talentPatron('Psy Rating'), {patron: 'undivided', tier: 3});
    assert.equal(talentPatron('Psychic Power'), null, 'the book marks it Special');
    assert.equal(talentPatron('Nonesuch'), null);
});

test('a group talent is recognised through its speciality, and a curly apostrophe through its spelling', () => {
    assert.deepEqual(talentPatron('Hatred (Servants of Chaos)'), {patron: 'khorne', tier: 2});
    assert.deepEqual(talentPatron('Weapon Training (Las)'), {patron: 'undivided', tier: 1});
    assert.deepEqual(talentPatron('Heightened Senses (Hearing)'), {patron: 'tzeentch', tier: 1});
    assert.deepEqual(talentPatron('Blood God’s Contempt'), {patron: 'khorne', tier: 3});
});

test('a card that names its god is believed; one that does not asks the book', () => {
    assert.equal(patronOf({name: 'Frenzy', system: {patron: 'undivided'}}), 'khorne',
        'an unmarked card from the old pack still costs what the book says');
    assert.equal(patronOf({name: 'Frenzy', system: {}}), 'khorne');
    assert.equal(patronOf({name: 'Rain of Foulness', system: {patron: 'nurgle'}}), 'nurgle',
        'psychic powers carry their own god');
    assert.equal(patronOf({name: 'Quick Draw', system: {patron: 'undivided'}}), 'undivided');
    assert.equal(patronOf({name: 'Some Homebrew Talent', system: {}}), 'undivided',
        'what the book never named belongs to nobody');
    assert.equal(patronOf(null), 'undivided');
});

test('tiers are disjoint: no talent sits on two rungs', () => {
    const seen = new Map();
    TALENT_TABLES.forEach((table, index) => {
        for (const name of Object.values(table).flat()) {
            assert.equal(seen.get(name), undefined, `${name} is in tier ${seen.get(name)} and ${index + 1}`);
            seen.set(name, index + 1);
        }
    });
    assert.equal(Object.values(TIER_ONE).flat().length, 50);
    assert.equal(Object.values(TIER_TWO).flat().length, 45);
    assert.equal(Object.values(TIER_THREE).flat().length, 36);
});
