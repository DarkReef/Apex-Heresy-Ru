import {rtSkillBase, rtSkillType} from './rogue-trader.mjs';

const FALLBACK = {
    'MODIFIERS.BASE': 'Base value', 'MODIFIERS.ADVANCE': 'Characteristic advance',
    'MODIFIERS.TRAINING': 'Skill training', 'MODIFIERS.TEMPORARY': 'Temporary modifier',
    'MODIFIERS.MINIMUM': 'Minimum value', 'MODIFIERS.AGILITY_CAP': 'Maximum Agility',
    'MODIFIERS.UNTRAINED': 'Untrained skill rule', 'MODIFIERS.OTHER': 'Other prepared modifiers',
    'MODIFIERS.TOTAL': 'Total',
    'MODIFIERS.UNRESOLVED': 'Effect calculation could not be attributed',
    'WEAPON.TRAIT.BALANCED': 'Balanced', 'WEAPON.TRAIT.UNBALANCED': 'Unbalanced',
    'WEAPON.TRAIT.DEFENSIVE': 'Defensive'
};
const MODES = {0: 'custom', 1: 'multiply', 2: 'add', 3: 'downgrade', 4: 'upgrade', 5: 'override'};
const PRIORITIES = {custom: 0, multiply: 10, add: 20, subtract: 20, downgrade: 30, upgrade: 40, override: 50};
const get = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const values = collection => collection?.contents ?? (typeof collection?.values === 'function' ? [...collection.values()] : collection ?? []);
const signed = value => `${value < 0 ? '−' : '+'}${Math.abs(Number(value.toFixed(6)))}`;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function sourceItem(actor, effect) {
    if (effect.parent?.documentName === 'Item') return effect.parent;
    if (typeof effect.origin !== 'string') return null;
    const ownerUuid = actor.uuid ?? (actor.id ? `Actor.${actor.id}` : null);
    return values(actor.items).find(item => {
        const uuid = item.uuid ?? (ownerUuid && item.id ? `${ownerUuid}.Item.${item.id}` : null);
        return uuid && (effect.origin === uuid || effect.origin.startsWith(`${uuid}.`));
    }) ?? null;
}

function activeChanges(actor, localize) {
    const items = values(actor.items);
    const effects = typeof actor.allApplicableEffects === 'function' ? [...actor.allApplicableEffects()]
        : [...values(actor.effects), ...items.flatMap(item => values(item.effects).filter(effect => effect.transfer !== false))];
    const seen = new Set();
    const changes = [];
    for (const effect of effects) {
        if (!effect || seen.has(effect)) continue;
        seen.add(effect);
        if (effect.active === false || effect.disabled || effect.isSuppressed || effect.duration?.expired) continue;
        const item = sourceItem(actor, effect);
        const parentItem = effect.parent?.documentName === 'Item' ? item : null;
        if (parentItem) {
            if (effect.transfer === false) continue;
            const activation = effect.flags?.['dark-heresy']?.activation;
            if (activation !== 'always' && (activation === 'equipped' || ['weapon', 'armour', 'forceField'].includes(item.type))
                && item.system?.equipped !== true) continue;
        }
        let source = item?.name || effect.name || effect.sourceName || localize('MODIFIERS.OTHER');
        if (item?.name) {
            const key = `TYPES.Item.${item.type}`;
            const type = localize(key);
            if (type !== key && !source.toLocaleLowerCase().startsWith(type.toLocaleLowerCase())) source = `${type} ${source}`;
        }
        for (const change of effect.system?.changes ?? effect.changes ?? []) {
            if (!change.key?.startsWith('system.')) continue;
            const type = change.type || MODES[change.mode] || 'custom';
            changes.push({key: change.key, value: change.value, type, source,
                phase: change.phase || 'initial', priority: Number.isFinite(Number(change.priority))
                    ? Number(change.priority) : PRIORITIES[type] ?? 0});
        }
    }
    return changes.sort((left, right) => left.priority - right.priority);
}

function applyChanges(ledger, key, phase, changes) {
    for (const change of changes.filter(change => change.key === key && change.phase === phase)) {
        // Do not re-evaluate a formula or call effect.apply: that can mutate data
        // or invoke module hooks. Unknown calculations are reconciled with the
        // actual prepared total, without inventing per-source numeric values.
        const operand = typeof change.value === 'number' || typeof change.value === 'string' && change.value.trim() !== ''
            ? Number(change.value) : NaN;
        if (!Number.isFinite(operand)) {ledger.unresolved.add(change.source); continue;}
        const before = ledger.value;
        let after;
        switch (change.type) {
            case 'add': after = before + operand; break;
            case 'subtract': after = before - operand; break;
            case 'multiply': after = before * operand; break;
            case 'override': after = operand; break;
            case 'upgrade': after = Math.max(before, operand); break;
            case 'downgrade': after = Math.min(before, operand); break;
            default: ledger.unresolved.add(change.source); continue;
        }
        add(ledger, after - before, change.source);
    }
    return ledger;
}

function add(ledger, amount, source, {base = false} = {}) {
    if (!Number.isFinite(amount)) return;
    ledger.value += amount;
    if (amount !== 0 || base) ledger.rows.push({amount, source, base});
}

function field(actor, path, label, changes) {
    const stored = get(actor._source, path);
    const raw = stored === undefined ? get(actor, path) : stored;
    const ledger = {value: 0, rows: [], unresolved: new Set()};
    add(ledger, number(raw), label);
    return applyChanges(ledger, path, 'initial', changes);
}

function append(target, source) {
    target.value += source.value;
    target.rows.push(...source.rows);
    for (const name of source.unresolved) target.unresolved.add(name);
}

function copy(ledger) {
    return {value: ledger.value, rows: ledger.rows.map(row => ({...row})), unresolved: new Set(ledger.unresolved)};
}

function finish(ledger, actual, localize) {
    add(ledger, number(actual) - ledger.value, localize('MODIFIERS.OTHER'));
    const lines = ledger.rows.map(row => `${row.base ? row.amount : signed(row.amount)} — ${row.source}`);
    for (const source of ledger.unresolved) lines.push(`${localize('MODIFIERS.UNRESOLVED')}: ${source}`);
    lines.push(`${localize('MODIFIERS.TOTAL')}: ${ledger.value}`);
    return {value: ledger.value, rows: ledger.rows, text: lines.join('\n'), html: lines.map(escape).join('<br>')};
}

/**
 * Explain the prepared figures without applying any rule a second time. Numeric
 * ActiveEffects are shown in their application order, including the effective
 * delta of multiply/min/max/override. Non-numeric/custom changes are explicitly
 * left unattributed. Initial changes to derived totals are deliberately ignored:
 * prepareDerivedData overwrites them; final changes to input fields likewise do
 * not retroactively affect already-computed totals.
 */
export function buildModifierBreakdowns(actor, options = {}) {
    const localize = key => {
        const translated = options.localize?.(key);
        return translated && translated !== key ? translated : FALLBACK[key] ?? key;
    };
    const ruleset = options.ruleset ?? {id: actor.system?.ruleset};
    const changes = activeChanges(actor, localize);
    const system = actor.system ?? {};
    const chars = system.characteristics ?? {};
    const items = values(actor.items);
    const characteristics = {}, skills = {}, initialCharacteristics = {};
    for (const [key, characteristic] of Object.entries(chars)) {
        const prefix = `system.characteristics.${key}`;
        const ledger = field(actor, `${prefix}.base`, localize('MODIFIERS.BASE'), changes);
        // The first line is an absolute starting value; every following line is
        // a delta. Keep even a zero base visible so the arithmetic is explicit.
        if (ledger.rows[0]?.source === localize('MODIFIERS.BASE')) ledger.rows[0].base = true;
        else ledger.rows.unshift({amount: 0, source: localize('MODIFIERS.BASE'), base: true});
        append(ledger, field(actor, `${prefix}.advance`, localize('MODIFIERS.ADVANCE'), changes));
        if (ledger.value < 0) add(ledger, -ledger.value, localize('MODIFIERS.MINIMUM'));
        if (key === 'agility') {
            const capped = items.filter(item => item.isEquipped ?? item.system?.equipped)
                .filter(item => number(item.system?.maxAgility) > 0);
            const limit = capped.length ? Math.min(...capped.map(item => number(item.system.maxAgility))) : null;
            if (limit !== null && ledger.value > limit) {
                const names = capped.filter(item => number(item.system.maxAgility) === limit).map(item => item.name).join(', ');
                add(ledger, limit - ledger.value, `${localize('MODIFIERS.AGILITY_CAP')}: ${names}`);
            }
        }
        append(ledger, field(actor, `${prefix}.tempModifier`, localize('MODIFIERS.TEMPORARY'), changes));
        if (ruleset.id === 'ow' && ledger.value < 0) add(ledger, -ledger.value, localize('MODIFIERS.MINIMUM'));
        initialCharacteristics[key] = copy(ledger);
        applyChanges(ledger, `${prefix}.displayTotal`, 'final', changes);
        characteristics[key] = finish(ledger, characteristic.displayTotal ?? characteristic.total, localize);
    }

    const characteristicFor = short => Object.entries(chars).find(([key, c]) => c.short === short || key === short)?.[0];
    const skillLedger = (key, skill, prefix, characteristicShort, {parry = false} = {}) => {
        const charKey = characteristicFor(characteristicShort);
        const ledger = initialCharacteristics[charKey] ? copy(initialCharacteristics[charKey]) : {value: 0, rows: [], unresolved: new Set()};
        const characteristicValue = ledger.value;
        const charLabel = chars[charKey]?.label ? localize(chars[charKey].label) : characteristicShort;
        if (charLabel && ledger.rows[0]) ledger.rows[0].source += ` (${charLabel})`;
        const advance = field(actor, `${prefix}.advance`, localize('MODIFIERS.TRAINING'), changes);
        append(ledger, advance);
        const model = ruleset.skills?.model ?? (ruleset.id === 'rt' ? 'basicAdvanced' : 'dh2');
        if (model === 'basicAdvanced') {
            const computed = rtSkillBase({characteristic: characteristicValue, advance: advance.value, type: rtSkillType(key)});
            add(ledger, computed.base - ledger.value, localize('MODIFIERS.UNTRAINED'));
        }
        if (parry) {
            const weapon = items.find(item => item.type === 'weapon' && item.system?.equipped === true
                && (item.system?.class === 'melee' || item.class === 'melee'));
            if (weapon) {
                const traits = options.extractWeaponTraits?.(weapon.system?.special || weapon.special || '', weapon.system?.traitOverrides)
                    ?? weapon.system?.traitOverrides ?? {};
                for (const [trait, amount] of [['unbalanced', -10], ['balanced', 10], ['defensive', 15]]) {
                    if (traits[trait]) add(ledger, amount, `${weapon.name} (${localize(`WEAPON.TRAIT.${trait.toUpperCase()}`)})`);
                }
            }
        }
        applyChanges(ledger, `${prefix}.total`, 'final', changes);
        return finish(ledger, skill.total, localize);
    };
    for (const [key, skill] of Object.entries(system.skills ?? {})) {
        const short = skill.characteristics?.[0];
        const prefix = `system.skills.${key}`;
        const result = skillLedger(key, skill, prefix, short, {parry: key === 'parry'});
        result.specialities = {};
        for (const [specialityKey, speciality] of Object.entries(skill.specialities ?? {})) {
            result.specialities[specialityKey] = skillLedger(key, speciality, `${prefix}.specialities.${specialityKey}`,
                speciality.characteristics?.[0] ?? short);
        }
        skills[key] = result;
    }
    return {characteristics, skills};
}

/** Apply strings to the sheet's cloned context only, never to the Actor. */
export function decorateModifierTooltips(contextSystem, actor, options = {}) {
    const breakdowns = buildModifierBreakdowns(actor, options);
    const decorate = (target, breakdown) => {
        if (!target || !breakdown) return;
        target.modifierTooltip = breakdown.text;
        target.modifierTooltipHtml = breakdown.html;
    };
    for (const [key, breakdown] of Object.entries(breakdowns.characteristics)) decorate(contextSystem.characteristics?.[key], breakdown);
    for (const [key, breakdown] of Object.entries(breakdowns.skills)) {
        decorate(contextSystem.skills?.[key], breakdown);
        for (const [speciality, part] of Object.entries(breakdown.specialities)) decorate(contextSystem.skills?.[key]?.specialities?.[speciality], part);
    }
    return contextSystem;
}
