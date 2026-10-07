import {characteristicTerm} from "../../script/localization/field-terms.mjs";
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {applyTraitOverrides, editTraitOverrides, validateTraitOverrides, WEAPON_TRAIT_TYPES, traitOverridesFromRows, traitOverridePatch} from '../../script/data/weapon-traits.mjs';
import {patronOf} from '../../script/creation/bc-talents.mjs';
import {targetSizeModifier, sizeToHitModifier, armourSizeModifier, describeTargetSize} from '../../script/data/size-rules.mjs';
import {renownRankFor, traumaModifier as dwTraumaModifier, insanityStep as dwInsanityStep, PURITY_THRESHOLD, purityBroken, cohesionPool, FOCUS_AUTO_FAIL} from '../../script/data/deathwatch-rules.mjs';
import {rankForExperience} from '../../script/creation/advance-list.mjs';
import {halfRoundedUp} from '../../script/data/rounding.mjs';
import {effectiveMaxAgility} from '../../script/data/max-agility.mjs';
import {traitArmour} from '../../script/data/armour-traits.mjs';
import {resolveJamClear} from '../../script/combat/jam.mjs';
import {collapseRepeatedText} from '../../script/data/repeated-text.mjs';
import {OVERHEAT_THRESHOLD, overheatArm, overheatSelfDamage} from '../../script/combat/overheat.mjs';
import {fieldProtects} from '../../script/combat/force-field.mjs';
import {corrosiveBite} from '../../script/combat/corrosive.mjs';
import {remainingWounds, remainingWoundsPatch, woundsAfterDamage, woundsAfterHealing} from '../../script/combat/vitals.mjs';
import {applyMeleeEngagement} from '../../script/combat/range-rules.mjs';
import {FATE_ABILITIES, FATE_INITIATIVE_ROLL, fateHealing, fateOwnerId} from '../../script/combat/fate.mjs';
import {COUNTER_ATTACK_FLAG, canCounterAttack} from '../../script/combat/counter-attack.mjs';
import {CONTROLLER_OPTIONS, TARGET_OPTIONS, UNARMED_DAMAGE, grappleOutcome, optionsFor} from '../../script/combat/grapple.mjs';
import {resolveOpposed} from '../../script/combat/opposed.mjs';
import {carryingLimits, baseLeapAndJump} from '../../script/data/carry.mjs';
import {EXTRA_DAMAGE, MAX_CHAIN, confirmationHits, explodes, extraDamage, righteousFuryMode} from '../../script/combat/righteous-fury.mjs';
import {RT_ABSENT_CHARACTERISTICS, RT_ABSENT_SKILLS, RT_SKILLS, RT_ADVANCE_TIERS, RT_CHARACTERISTIC_COSTS, rtCharacteristicCost, rtSkillType, rtSkillBase} from '../../script/data/rogue-trader.mjs';
import {stepsFor, backgroundExperienceFor} from '../../script/creation/ruleset-data.mjs';
import {PATRON_RELATIONS, BC_CHARACTERISTIC_COSTS, BC_SKILL_COSTS, BC_TALENT_COSTS,
        BC_CHARACTERISTIC_PATRONS, BC_SKILL_PATRONS, BC_INFAMY_ADVANCE, alignmentLeader}
    from '../../script/creation/patron-data.mjs';

const LANG = JSON.parse(readFileSync(new URL('../../lang/en.json', import.meta.url), 'utf8'));

// Run the actual legacy entry module without booting a world or opening sheets.
// Foundry's document persistence/UI are the external boundary, not copied rules.
export function loadSystem(overrides = {}) {
    const listeners = new Map();
    class Document {}
    const context = vm.createContext({
        characteristicTerm, console, Set, Map, Math, Number, Promise, structuredClone, setTimeout, clearTimeout,
        applyTraitOverrides, editTraitOverrides, validateTraitOverrides, WEAPON_TRAIT_TYPES, traitOverridesFromRows, traitOverridePatch,
        patronOf, targetSizeModifier, sizeToHitModifier, armourSizeModifier, describeTargetSize,
        renownRankFor, dwTraumaModifier, dwInsanityStep, PURITY_THRESHOLD, purityBroken, cohesionPool, FOCUS_AUTO_FAIL,
        rankForExperience, stepsFor, backgroundExperienceFor,
        carryingLimits, baseLeapAndJump,
        EXTRA_DAMAGE, MAX_CHAIN, confirmationHits, explodes, extraDamage, righteousFuryMode,
        halfRoundedUp, effectiveMaxAgility, traitArmour, resolveJamClear, collapseRepeatedText, OVERHEAT_THRESHOLD, overheatArm, overheatSelfDamage, fieldProtects, corrosiveBite, remainingWounds, remainingWoundsPatch, woundsAfterDamage, woundsAfterHealing, applyMeleeEngagement, FATE_ABILITIES, FATE_INITIATIVE_ROLL, fateHealing, fateOwnerId, COUNTER_ATTACK_FLAG, canCounterAttack, CONTROLLER_OPTIONS, TARGET_OPTIONS, UNARMED_DAMAGE, grappleOutcome, optionsFor, resolveOpposed,
        RT_ABSENT_CHARACTERISTICS, RT_ABSENT_SKILLS, RT_SKILLS, RT_ADVANCE_TIERS, RT_CHARACTERISTIC_COSTS, rtCharacteristicCost, rtSkillType, rtSkillBase,
        PATRON_RELATIONS, BC_CHARACTERISTIC_COSTS, BC_SKILL_COSTS, BC_TALENT_COSTS,
        BC_CHARACTERISTIC_PATRONS, BC_SKILL_PATRONS, BC_INFAMY_ADVANCE, alignmentLeader,
        Actor: Document, Item: Document, Combat: Document, ActiveEffect: Document,
        CONFIG: {statusEffects: [], ActiveEffect: {}, Actor: {}, Item: {}},
        CONST: {ACTIVE_EFFECT_MODES: {CUSTOM:0, MULTIPLY:1, ADD:2, DOWNGRADE:3, UPGRADE:4, OVERRIDE:5}},
        foundry: {appv1: {sheets: {ActorSheet: Document, ItemSheet: Document}}, utils: {
            deepClone: structuredClone,
            mergeObject: (a,b) => ({...a,...b}),
            getProperty: (o, p) => p.split('.').reduce((v,k) => v?.[k], o),
            isEmpty: o => !Object.keys(o).length
        }},
        Hooks: {on: register, once: register, call: () => true, callAll: () => {}},
        // Notifications and localisation are the user-facing edge. They are stubbed
        // rather than omitted so that a refusal which must explain itself can be
        // asserted on, instead of exploding with "ui is not defined".
        ui: {notifications: {warn: () => {}, info: () => {}, error: () => {}}},
        game: {settings: {get: () => false}, users: {}, actors: new Map(), scenes: new Map(),
               i18n: {
                   // Real English, not the key: a test that asserts on what the
                   // table reads should fail when the wording is wrong, and a
                   // missing key should be visible rather than echoed back.
                   localize: key => LANG[key] ?? key,
                   format: (key, data) => Object.entries(data ?? {}).reduce(
                       (text, [name, value]) => text.replaceAll(`{${name}}`, value),
                       LANG[key] ?? key)
               }},
        canvas: {ready: false},
        ...overrides
    });
    function register(name, fn) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(fn);
    }
    const source = readFileSync(new URL('../../script/dark-heresy.js', import.meta.url), 'utf8')
        .replace(/^import .*?;\r?\n/gm, '');
    vm.runInContext(source, context, {filename:'dark-heresy.js'});
    return {context, listeners, get: expression => vm.runInContext(expression, context)};
}

export function effect(status, options = {}) {
    return {id: 'effect', statuses: new Set([status]), disabled: false, active: true,
        isSuppressed: false, duration: {value: Infinity, seconds: Infinity},
        flags: {}, img:'custom.svg', ...options};
}

export function actorWithEffects(system, effects) {
    const actor = Object.create(system.get('DarkHeresyActor.prototype'));
    Object.assign(actor, {effects, allApplicableEffects: function* () {yield* effects;}, getActiveTokens: () => []});
    return actor;
}
