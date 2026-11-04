import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildModifierBreakdowns, decorateModifierTooltips} from '../script/data/modifier-breakdown.mjs';

function fixture({base = 30, advance = 0, temp = 0, shown = base + advance + temp, effects = [], items = []} = {}) {
    const source = {ruleset: 'ow', characteristics: {
        strength: {short: 'S', label: 'Strength', base, advance, tempModifier: temp}
    }, skills: {athletics: {characteristics: ['S'], advance: 0}}};
    const system = structuredClone(source);
    Object.assign(system.characteristics.strength, {total: base + advance, displayTotal: shown});
    Object.assign(system.skills.athletics, {total: shown});
    return {id: 'a', uuid: 'Actor.a', _source: {system: source}, system, items, effects, allApplicableEffects: function* () {yield* effects;}};
}
const change = (key, value, extra = {}) => ({key, value, type: 'add', phase: 'initial', priority: 20, ...extra});
const effect = (name, changes, extra = {}) => ({name, active: true, system: {changes}, ...extra});
const amountFrom = (breakdown, source) => breakdown.rows.filter(row => row.source === source).reduce((sum, row) => sum + row.amount, 0);

test('characteristic and dependent skill explain equipped armour bonuses without mutating actor data', () => {
    const armour = {id: 'armour', documentName: 'Item', type: 'armour', name: 'Avenger', system: {equipped: true}};
    const aura = effect('Armour assistance', [change('system.characteristics.strength.tempModifier', '10')], {parent: armour, transfer: true});
    const actor = fixture({base: 30, advance: 5, shown: 45, effects: [aura], items: [armour]});
    actor.system.characteristics.strength.tempModifier = 10;
    actor._source.system.skills.athletics.advance = 10;
    Object.assign(actor.system.skills.athletics, {advance: 10, total: 55});
    const before = JSON.stringify(actor);
    const context = structuredClone(actor.system);
    const options = {localize: key => key === 'TYPES.Item.armour' ? 'Броня' : key};
    decorateModifierTooltips(context, actor, options);
    assert.match(context.characteristics.strength.modifierTooltip, /\+10 — Броня Avenger/);
    assert.match(context.skills.athletics.modifierTooltip, /\+10 — Броня Avenger/);
    assert.match(context.skills.athletics.modifierTooltip, /\+10 — Skill training/);
    assert.match(context.skills.athletics.modifierTooltip, /Total: 55/);
    assert.equal(JSON.stringify(actor), before);
});

test('disabled, expired, suppressed, unequipped and item-only effects never gain attributed bonuses', () => {
    const item = {documentName: 'Item', type: 'armour', name: 'Carried armour', system: {equipped: false}};
    const changes = [change('system.characteristics.strength.tempModifier', 10)];
    const effects = [effect('Disabled', changes, {disabled: true}), effect('Suppressed', changes, {isSuppressed: true}),
        effect('Expired', changes, {duration: {expired: true}}), effect('Carried', changes, {parent: item, transfer: true}),
        effect('Item only', changes, {parent: {...item, system: {equipped: true}}, transfer: false}),
        effect('Inactive', changes, {active: false})];
    const result = buildModifierBreakdowns(fixture({effects}));
    assert.equal(result.characteristics.strength.value, 30);
    assert.equal(result.characteristics.strength.rows.length, 1);
});

test('always-on item effects stay visible even when not equipped, and origin resolves an actor-owned effect source', () => {
    const item = {id: 'shield', documentName: 'Item', type: 'armour', name: 'Blessed plate', system: {equipped: false}};
    const effects = [effect('Blessing', [change('system.characteristics.strength.tempModifier', 3)],
        {parent: item, transfer: true, flags: {'dark-heresy': {activation: 'always'}}}),
    effect('Copied blessing', [change('system.characteristics.strength.tempModifier', 2)],
        {parent: {documentName: 'Actor'}, origin: 'Actor.a.Item.shield'})];
    const result = buildModifierBreakdowns(fixture({shown: 35, effects, items: [item]}));
    assert.equal(amountFrom(result.characteristics.strength, 'Blessed plate'), 5);
    assert.doesNotMatch(result.characteristics.strength.text, /Other prepared modifiers/);
});

test('ordered numeric modes display their effective delta, not their operand', () => {
    const path = 'system.characteristics.strength.tempModifier';
    const effects = [effect('Multiply', [change(path, 2, {mode: 1, type: undefined, priority: 30})]),
        effect('Add', [change(path, 10, {priority: 20})]),
        effect('Minimum', [change(path, 25, {type: 'upgrade', priority: 40})]),
        effect('Maximum', [change(path, 22, {type: 'downgrade', priority: 45})]),
        effect('Set', [change(path, 4, {type: 'override', priority: 50})]),
        effect('Subtract', [change(path, 1, {type: 'subtract', priority: 60})])];
    const part = buildModifierBreakdowns(fixture({shown: 33, effects})).characteristics.strength;
    assert.deepEqual(part.rows.map(row => row.amount), [30, 10, 10, 5, -3, -18, -1]);
    assert.equal(part.value, 33);
    assert.doesNotMatch(part.text, /Other prepared modifiers/);
});

test('a foreign actor origin never borrows a local item name with the same local id', () => {
    const item = {id: 'shield', type: 'armour', name: 'Local plate', system: {equipped: true}};
    const effects = [effect('Remote blessing', [change('system.characteristics.strength.tempModifier', 5)],
        {parent: {documentName: 'Actor'}, origin: 'Actor.other.Item.shield'})];
    const part = buildModifierBreakdowns(fixture({shown: 35, effects, items: [item]})).characteristics.strength;
    assert.equal(amountFrom(part, 'Remote blessing'), 5);
    assert.doesNotMatch(part.text, /Local plate/);
});

test('effect phases respect the derived-value boundary and final characteristic changes do not leak into skills', () => {
    const effects = [effect('Initial base', [change('system.characteristics.strength.base', 5)]),
        effect('Overwritten total', [change('system.characteristics.strength.displayTotal', 100)]),
        effect('Late base', [change('system.characteristics.strength.base', 5, {phase: 'final'})]),
        effect('Final display', [change('system.characteristics.strength.displayTotal', 3, {phase: 'final'})]),
        effect('Final skill', [change('system.skills.athletics.total', -5, {phase: 'final'})])];
    const actor = fixture({shown: 38, effects});
    actor.system.characteristics.strength.base = 40;
    actor.system.skills.athletics.total = 30;
    const result = buildModifierBreakdowns(actor);
    assert.equal(amountFrom(result.characteristics.strength, 'Initial base'), 5);
    assert.equal(amountFrom(result.characteristics.strength, 'Final display'), 3);
    assert.doesNotMatch(result.characteristics.strength.text, /Overwritten total|Late base/);
    assert.equal(result.skills.athletics.value, 30);
    assert.doesNotMatch(result.skills.athletics.text, /Final display|Other prepared modifiers/);
});

test('Agility limits and equipped weapon Parry traits report their actual item sources', () => {
    const actor = fixture();
    actor._source.system.characteristics = {agility: {short: 'Ag', base: 50, advance: 0, tempModifier: 5}};
    actor.system.characteristics = {agility: {short: 'Ag', base: 50, advance: 0, tempModifier: 5, total: 40, displayTotal: 45}};
    actor._source.system.skills = {parry: {characteristics: ['Ag'], advance: 0}};
    actor.system.skills = {parry: {characteristics: ['Ag'], advance: 0, total: 55}};
    actor.items = [{name: 'Plate', isEquipped: true, system: {equipped: true, maxAgility: 40}},
        {name: 'Unused heavy plate', isEquipped: false, system: {maxAgility: 20}},
        {name: 'Sword', type: 'weapon', system: {equipped: true, class: 'melee', traitOverrides: {balanced: true}}},
        {name: 'Second sword', type: 'weapon', system: {equipped: true, class: 'melee', traitOverrides: {balanced: true}}}];
    const result = buildModifierBreakdowns(actor);
    assert.equal(amountFrom(result.characteristics.agility, 'Maximum Agility: Plate'), -10);
    assert.equal(amountFrom(result.skills.parry, 'Sword (Balanced)'), 10);
    assert.doesNotMatch(result.skills.parry.text, /Second sword|Unused heavy plate|Other prepared modifiers/);
});

test('specialities use their own characteristic and Rogue Trader untrained rules remain explicit', () => {
    const actor = fixture({base: 40});
    actor._source.system.characteristics.intelligence = {short: 'Int', base: 31, advance: 0, tempModifier: 0};
    actor.system.characteristics.intelligence = {...actor._source.system.characteristics.intelligence, total: 31, displayTotal: 31};
    actor._source.system.skills = {custom: {characteristics: ['S'], advance: 0, specialities: {test: {characteristics: ['Int'], advance: -20}}}};
    actor.system.skills = structuredClone(actor._source.system.skills);
    actor.system.skills.custom.total = 40;
    actor.system.skills.custom.specialities.test.total = 15;
    const result = buildModifierBreakdowns(actor, {ruleset: {id: 'rt', skills: {model: 'basicAdvanced'}}});
    assert.equal(result.skills.custom.specialities.test.value, 15);
    assert.match(result.skills.custom.specialities.test.text, /Untrained skill rule/);
    assert.doesNotMatch(result.skills.custom.specialities.test.text, /Other prepared modifiers/);
});

test('unknown formula contributions are not invented or executed, and tooltip HTML escapes document names', () => {
    const aura = effect('<img src=x onerror=alert(1)>', [change('system.characteristics.strength.tempModifier', '@bonus')],
        {getReplacementData() {throw Error('Must not execute effect logic');}});
    const actor = fixture({shown: 40, effects: [aura]});
    const part = buildModifierBreakdowns(actor).characteristics.strength;
    assert.equal(amountFrom(part, 'Other prepared modifiers'), 10);
    assert.equal(part.rows.some(row => row.source === aura.name), false);
    assert.match(part.text, /could not be attributed/);
    assert.match(part.html, /&lt;img/);
    assert.doesNotMatch(part.html, /<img|<script/);
});
