import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ruleName, matchesRuleName} from '../script/localization/rule-name.mjs';
import {findContent} from '../script/creation/content-lookup.mjs';
import {traitArmour} from '../script/data/armour-traits.mjs';
import {ownedAptitudes} from '../script/creation/origin-apply.mjs';
import {talentOffers} from '../script/creation/shop-data.mjs';
import {psyBase} from '../script/creation/psychic-data.mjs';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const en = read('../lang/en.json');
const ru = read('../lang/ru.json');
const placeholders = text => [...text.matchAll(/\{[^{}]+\}/g)].map(hit => hit[0]).sort();
const translated = (name, originalName, type) => ({name, type, flags: {babele: {originalName, translated: true}}});

test('every interface key has Russian text and preserves all formatting parameters', () => {
    assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
    for (const [key, original] of Object.entries(en)) {
        assert.equal(typeof ru[key], 'string', key);
        assert.ok(ru[key].trim(), key);
        assert.deepEqual(placeholders(ru[key]), placeholders(original), key);
        if (/[a-z]/i.test(original)) assert.match(ru[key], /[А-Яа-яЁё]/u, key);
    }
});
test('compendium lookup finds translated names through Babele index and document metadata', () => {
    const entry = {name: 'Владение оружием*', originalName: 'Weapon Training*', type: 'talent'};
    assert.equal(findContent([entry], ['talent'], 'Weapon Training (Las)'), entry);
    assert.equal(matchesRuleName(entry, 'Владение оружием*'), true);
    assert.equal(ruleName(translated('Страх', 'Fear', 'trait')), 'Fear');
    assert.equal(ruleName({...translated('Машина', 'Machine', 'trait'), name: 'Machine (5)'}), 'Machine (5)');
});
test('translated aptitudes, numeric armour traits and Sanctioned keep their mechanics', () => {
    assert.ok(ownedAptitudes({items: [translated('Выносливость', 'Toughness', 'aptitude')]}).has('Toughness'));
    assert.equal(traitArmour([translated('Машина (5)', 'Machine (5)', 'trait')]).value, 5);
    assert.equal(psyBase([translated('Санкционированный', 'Sanctioned', 'trait')], 'dh2'), 2);
});
test('a translated catalogue does not reoffer an owned talent', () => {
    const catalogue = [{name: 'Неистовство', originalName: 'Frenzy', tier: 1, aptitudes: '', prerequisites: 'None'}];
    const snapshot = {talents: [translated('Неистовство', 'Frenzy', 'talent')], aptitudes: []};
    assert.deepEqual(talentOffers(catalogue, snapshot, {}), []);
});
test('Babele maps prose only, leaving name-based mechanical inputs intact', () => {
    const system = read('../system.json');
    for (const pack of system.packs) {
        const data = read(`../localization/ru/dark-heresy.${pack.name}.json`);
        assert.ok(data.entries && data.folders, pack.name);
        for (const field of ['special', 'aptitudes', 'grants', 'key', 'damage', 'range', 'prerequisites', 'prerequisite']) {
            assert.equal(data.mapping[field], undefined, `${pack.name}:${field}`);
        }
        for (const id of Object.keys(data.entries)) assert.match(id, /^[A-Za-z0-9]{16}$/);
    }
});
test('Babele registration uses its init hook and tolerates absence of the optional module', async () => {
    const previous = globalThis.Hooks;
    const hooks = [];
    globalThis.Hooks = {once: (event, callback) => hooks.push({event, callback})};
    try {
        const {registerBabele} = await import('../script/localization/babele.mjs');
        assert.equal(hooks[0].event, 'babele.init');
        let dir;
        hooks[0].callback({setSystemTranslationsDir: value => {dir = value;}});
        assert.equal(dir, 'localization');
        assert.doesNotThrow(() => registerBabele(undefined));
    } finally {globalThis.Hooks = previous;}
});
