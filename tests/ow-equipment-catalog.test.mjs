import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {OW_EQUIPMENT_CATALOG, OW_EQUIPMENT_LABELS, getOWEquipmentEntry} from '../script/data/ow-equipment-catalog.mjs';
import {packEffectData} from '../tools/lib/pack-effects.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const sourceId = item => [...createHash('sha1').update(`rt:item:${item.folder}:${item.name}`).digest().subarray(0, 16)]
    .map(value => alphabet[value % 62]).join('');
const sources = ['07-armour', '08-gear', '10-tools', '11-cybernetics']
    .flatMap(name => read(`packs-src/only-war/${name}.json`));
const effects = OW_EQUIPMENT_CATALOG.flatMap(item => item.effects);
const named = id => effects.find(effect => effect.flags['dark-heresy'].equipmentBonus.id === id);
const values = effect => effect.system.changes.map(change => Number(change.value));
const atQuality = (id, quality) => getOWEquipmentEntry(id).effects.filter(effect => {
    const eligible = effect.flags['dark-heresy'].equipmentBonus.quality;
    return !eligible || eligible.includes(quality);
});

test('catalogue identities exactly resolve OW source documents and Russian Babele names', () => {
    const translations = read('localization/ru/apex-heresy-ru.only-war.json').entries;
    assert.equal(new Set(OW_EQUIPMENT_CATALOG.map(item => item.sourceId)).size, OW_EQUIPMENT_CATALOG.length);
    for (const item of OW_EQUIPMENT_CATALOG) {
        const source = sources.find(source => sourceId(source) === item.sourceId);
        assert.ok(source, item.sourceId);
        assert.equal(source.type, item.type);
        assert.equal(source.name, item.name);
        assert.equal(translations[item.sourceId]?.name, item.ruName);
        assert.ok(Number.isInteger(item.sourcePdfPage) && item.sourcePdfPage >= 193 && item.sourcePdfPage <= 206);
    }
    assert.equal(getOWEquipmentEntry('Synskin'), null, 'names must not be accepted as identity');
});

test('source compendiums preserve complete native effects and exact-source markers', () => {
    for (const catalog of OW_EQUIPMENT_CATALOG) {
        const item = sources.find(source => sourceId(source) === catalog.sourceId);
        const managed = item.effects.filter(effect => effect.flags?.['dark-heresy']?.equipmentBonus);
        assert.deepEqual(managed, catalog.effects, item.name);
        assert.equal(item.flags['dark-heresy'].owEquipmentSource, catalog.sourceId);
        const packed = packEffectData(item);
        assert.deepEqual(packed.effects, item.effects);
        assert.equal(packed.flags['dark-heresy'].owEquipmentSource, catalog.sourceId);
    }
});

test('conditions never transfer Actor changes and do not count alternative selectors twice', () => {
    const ids = new Set();
    const ruleIds = new Set();
    for (const effect of effects) {
        const metadata = effect.flags['dark-heresy'].equipmentBonus;
        assert.match(effect._id, /^[a-zA-Z0-9]{16}$/);
        assert.equal(ids.has(effect._id), false); ids.add(effect._id);
        assert.equal(ruleIds.has(metadata.id), false); ruleIds.add(metadata.id);
        assert.ok(OW_EQUIPMENT_LABELS[effect.name]?.en);
        assert.ok(OW_EQUIPMENT_LABELS[effect.name]?.ru);
        assert.equal(effect.transfer, !metadata.conditional);
        if (metadata.conditional) assert.equal(effect.system.changes.length, 1, metadata.id);
        for (const change of effect.system.changes) {
            assert.equal(change.type, 'add');
            assert.equal(change.phase, 'final');
            assert.ok(Number.isFinite(Number(change.value)));
            assert.doesNotMatch(change.key, /\.(advance|base|tempModifier|unnatural|bonus)$/);
        }
    }
    assert.deepEqual(values(named('ow.diagnostor.diagnose')), [20]);
    assert.deepEqual(named('ow.diagnostor.diagnose').flags['dark-heresy'].equipmentBonus.selectors,
        ['skill:medicae', 'characteristic:perception']);
});

test('wearable stealth bonuses and a specific Navigation speciality use final totals, not training or base characteristics', () => {
    for (const [id, amount] of [['ow.synskin.stealth', 10], ['ow.chameleoline.stealth', 20]]) {
        const effect = named(id);
        assert.equal(effect.transfer, true);
        assert.equal(effect.flags['dark-heresy'].activation, 'equipped');
        assert.deepEqual(effect.system.changes, [{key: 'system.skills.stealth.total', type: 'add', value: String(amount), phase: 'final', priority: 20}]);
    }
    assert.deepEqual(named('ow.multicompass.navigation').system.changes.map(change => change.key),
        ['system.skills.survival.total', 'system.skills.navigate.specialities.surface.total']);
    assert.equal(named('ow.void-suit.agility').system.changes[0].key, 'system.characteristics.agility.displayTotal');
});

test('quality alternatives select one correct bonus rather than stacking base and upgraded rules', () => {
    for (const [id, expected] of [
        ['7Tiv9q01Kg52pJeF', [20, 20, 30, 30]],
        ['cBq10SKdjPZa6sMw', [30, 30, 40, 40]],
        ['S3h9Z7Cf10vxYKyD', [20, 20, 25, 30]],
        ['b2nt86pBygaRqGtP', [20, 20, 30, 30]]
    ]) {
        for (const [index, quality] of ['poor', 'common', 'good', 'best'].entries()) {
            const found = atQuality(id, quality);
            assert.equal(found.length, 1, `${id}/${quality}`);
            assert.deepEqual(values(found[0]), [expected[index]]);
        }
    }
    assert.equal(atQuality('IWWjI6Ep2ghJXHn5', 'good').length, 0);
    assert.equal(atQuality('IWWjI6Ep2ghJXHn5', 'best').length, 0);
});

test('implants retain installed gating, conditional custom lore and non-duplicated existing armour data', () => {
    for (const item of OW_EQUIPMENT_CATALOG.filter(item => item.type === 'cybernetic')) {
        for (const effect of item.effects) assert.equal(effect.flags['dark-heresy'].activation, 'installed');
    }
    const lore = named('ow.calculus.scholastic');
    assert.equal(lore.transfer, false);
    assert.deepEqual(lore.flags['dark-heresy'].equipmentBonus.selectors, ['skill:scholasticLore.*']);
    for (const id of ['1QXo3hzMQ23yRt1k', 'EOiQLhRReICiBcBX', 'erAwcD0r0I9E0V9O']) {
        assert.equal(getOWEquipmentEntry(id).effects.length, 0);
        const item = sources.find(source => sourceId(source) === id);
        assert.equal(item.system.grantsArmour.enabled, true);
        assert.equal(item.system.grantsArmour.isAdditive, true);
    }
});

test('unsupported combat, derived bonus and ambiguous optical stacking rules remain explicit', () => {
    assert.equal(getOWEquipmentEntry('JmqJ5nr871cST1Ki').effects.length, 0);
    assert.equal(getOWEquipmentEntry('gpMWmrrCbB0Rb2ow').effects.length, 0);
    assert.equal(getOWEquipmentEntry('DfmeuaYux63PX8nO').effects.length, 0);
    const optical = getOWEquipmentEntry('y8hnABy3KnwVKzwu');
    assert.deepEqual(optical.effects.flatMap(values), [10]);
    assert.match(optical.unsupported.join(' '), /\+20.*\+30/);
    assert.match(getOWEquipmentEntry('aD5OhczhpYUzuNze').unsupported.join(' '), /−10.*−5/);
});

test('lookup returns independent document data and unknown identifiers never guess by name', () => {
    const first = getOWEquipmentEntry('odfSnUGRld48FdiA');
    first.effects[0].system.changes[0].value = '999';
    first.effects[0].flags['dark-heresy'].equipmentBonus.selectors.push('skill:logic');
    assert.deepEqual(values(getOWEquipmentEntry('odfSnUGRld48FdiA').effects[0]), [10]);
    assert.equal(getOWEquipmentEntry('Комбинезон из синтекожи'), null);
});
