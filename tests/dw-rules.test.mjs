import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {loadSystem} from './helpers/system.mjs';
import {RENOWN_RANKS, renownRankFor, INSANITY_TRACK, insanityStep, traumaModifier,
        PURITY_THRESHOLD, purityBroken, cohesionPool, cohesionChallengeTarget,
        FOCUS_AUTO_FAIL} from '../script/data/deathwatch-rules.mjs';

const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
const template = JSON.parse(readFileSync(new URL('../template.json', import.meta.url), 'utf8'));

test('Deathwatch is a profile of its own, not a copy of Dark Heresy', () => {
    const dw = loadSystem().get('Dh.rulesets.dw');
    assert.equal(dw.id, 'dw');
    // Any level of Fatigue is a flat -10, and past the threshold he faints, not dies (p. 251).
    assert.deepEqual({...dw.fatigue}, {threshold: 'tb', penalty: 'flat10', deathAtDoubleThreshold: false});
    assert.equal(dw.corruption.track, 'purity');
    assert.equal(dw.corruption.purityThreshold, 100);
    assert.equal(dw.insanity.traumaTable, 'dw');
    // A Battle-Brother never gains Insanity from a failed Fear Test (p. 278).
    assert.equal(dw.insanity.fearGivesInsanity, false);
    assert.equal(dw.bloodLoss.spaceMarineImmune, true);
});

test('the Focus Power Test: +5 per rating point, Fettered halves, 91-00 always fails (pp. 185-186)', () => {
    const dw = loadSystem().get('Dh.rulesets.dw');
    assert.equal(dw.psychic.ratingBonus, 'perPoint', '+5 times the Psy Rating used');
    assert.equal(dw.psychic.fetteredHalving, true, 'Fettered halves PR, rounding up');
    assert.equal(dw.psychic.focusAutoFail, FOCUS_AUTO_FAIL);
    assert.equal(FOCUS_AUTO_FAIL, 91);
    assert.equal(dw.psychic.pushFatigueOnDouble, true);
    assert.equal(dw.psychic.unnaturalWillpowerToRating, true);

    // The ceiling belongs to psychic rolls alone: an ordinary test is still only
    // failed outright by a natural 100.
    assert.match(source, /const focusAutoFail = rollData\.psy\?\.useModifier/);
    assert.match(source, /\|\| \(focusAutoFail > 0 && unmodifiedResult >= focusAutoFail\)/);
    // Pushing on a double costs a level of Fatigue, and the card says so.
    assert.match(source, /rollData\.psy\.pushFatigue = !!\(psyRules\.pushFatigueOnDouble && isPush && isDouble\)/);
    assert.ok(lang['CHAT.PSY_PUSH_FATIGUE']);
    const card = readFileSync(new URL('../template/chat/roll.hbs', import.meta.url), 'utf8');
    assert.match(card, /psy\.pushFatigue/);
});

test('Fettered never triggers phenomena, Unfettered on a double, Push always (p. 185)', () => {
    // The Black Crusade branch already reads that way, so Deathwatch joins it rather
    // than growing a fourth copy of the same three lines.
    const phenomena = source.slice(source.indexOf('function _computePsychicPhenomena'));
    assert.match(phenomena, /if \(phenomenaRule === "dh2"\)/);
    assert.match(phenomena, /else if \(isPush\) \{/);
    assert.match(phenomena, /rollData\.psy\.class === "bound"/);
    assert.equal(loadSystem().get('Dh.rulesets.dw').psychic.phenomena, 'dw');
    // Both tables sit in the same compendium, so the card names the one to roll:
    // the Deathwatch phenomena table, not the Dark Heresy one beside it.
    const rulesets = loadSystem().get('Dh.rulesets');
    assert.equal(rulesets.dw.psychic.phenomenaTable, 'Psychic Phenomena (Deathwatch)');
    assert.equal(rulesets.dw.psychic.perilsTable, 'Perils of the Warp (Deathwatch)');
    assert.equal(rulesets.dh2.psychic.phenomenaTable, 'Psychic Phenomena');
    assert.match(source, /rollData\.psy\.phenomenaTable = psyRules\.phenomenaTable \?\? "Psychic Phenomena";/);
    const card = readFileSync(new URL('../template/chat/roll.hbs', import.meta.url), 'utf8');
    assert.match(card, /CHAT\.HAS_PSYCHIC_PHENOMENA" table=psy\.phenomenaTable/);
    assert.match(lang['CHAT.HAS_PSYCHIC_PHENOMENA'], /\{table\}/);
});

test('Unnatural Willpower adds its multiplier to the Psy Rating (p. 186)', () => {
    assert.match(source, /const unnaturalRating = psyRules\.unnaturalWillpowerToRating && willpowerMultiplier > 1/);
    // And to the degrees of success on an opposed psychic test, but nowhere else:
    // outside psychic powers the other books' half-of-unnatural rule stands.
    // That half rounds up, per the general division rule of DH2 p. 23.
    const dos = source.slice(source.indexOf('function _getUnnaturalDosBonus'));
    assert.match(dos, /psyRules\.unnaturalWillpowerToRating && rollData\?\.psy\?\.useModifier/);
    assert.match(dos, /return halfRoundedUp\(unnatural\);/);
});

test("a Battle-Brother does not bleed at all (Larraman's Organ, p. 36)", () => {
    assert.match(source, /function suffersBloodLoss\(actor\)/);
    assert.match(source, /if \(!rules\?\.spaceMarineImmune\) return true;/);
    assert.match(source, /return !getLegacyFlag\(actor, "spaceMarine"\);/);
    // The per-round effect does not fire, and the condition is taken off him.
    assert.match(source, /if \(!suffersBloodLoss\(actor\)\) \{\r?\n\s+await actor\.removeCondition\?\.\("bleeding"\);/);
});

test('Renown reads off Table 5-2 (p. 140)', () => {
    assert.deepEqual(RENOWN_RANKS.map(rank => rank.key),
        ['initiated', 'respected', 'distinguished', 'famed', 'hero']);
    assert.equal(renownRankFor(0).key, 'initiated');
    assert.equal(renownRankFor(19).key, 'initiated');
    assert.equal(renownRankFor(20).key, 'respected');
    assert.equal(renownRankFor(59).key, 'distinguished');
    assert.equal(renownRankFor(60).key, 'famed');
    assert.equal(renownRankFor(800).key, 'hero', 'the table has no ceiling');
    assert.equal(renownRankFor(-5).key, 'initiated', 'and no floor below nothing');
    for (const rank of RENOWN_RANKS) assert.ok(lang[rank.label], rank.label);
});

test("Insanity follows Table 9-8, and its steps are the Primarch's Curse (p. 278)", () => {
    assert.deepEqual(INSANITY_TRACK.map(step => step.modifier), [0, -10, -20, -30, -30]);
    assert.deepEqual([0, 30, 31, 60, 61, 90, 91, 99, 100].map(traumaModifier),
        [0, 0, -10, -10, -20, -20, -30, -30, -30]);
    assert.equal(insanityStep(45).curse, 1);
    assert.equal(insanityStep(95).curse, 3);
    assert.equal(insanityStep(100).removedFromPlay, true);
    assert.equal(insanityStep(99).removedFromPlay, undefined);

    // The test the sheet rolls takes its penalty from the character's own book.
    assert.match(source, /if \(ruleset === "dw"\) return dwTraumaModifier\(insanity\);/);
    assert.match(source, /this\.getTraumaModifier\(actor\.insanity, Dh\.rulesetFor\(actor\)\.insanity\.traumaTable \?\? "dh2"\)/);
});

test('Corruption does nothing until the Purity Threshold (p. 282)', () => {
    assert.equal(PURITY_THRESHOLD, 100);
    assert.equal(purityBroken(99), false);
    assert.equal(purityBroken(100), true);
    // No Malignancy step, no modifier: just pure or damned.
    assert.match(source, /this\.system\.corruptionDegree = purityBroken\(this\.corruption\)/);
    assert.ok(lang['CORRUPTION.DEGREE.PURE']);
});

test("Cohesion is the leader's pool, built by Table 7-8 (p. 212)", () => {
    // The book's own example: Rank 1, Fellowship Bonus 3, has the Command skill.
    assert.deepEqual(cohesionPool({fellowshipBonus: 3, rank: 1, commandAdvance: 0}),
        {total: 4, fellowshipBonus: 3, rankBonus: 0, commandBonus: 1});
    // Only the highest of each column applies.
    assert.equal(cohesionPool({fellowshipBonus: 4, rank: 7, commandAdvance: 20}).total, 4 + 2 + 3);
    assert.equal(cohesionPool({fellowshipBonus: 4, rank: 4, commandAdvance: 10}).total, 4 + 1 + 2);
    // Untrained Command is no bonus at all, and neither is a missing skill.
    assert.equal(cohesionPool({fellowshipBonus: 4, rank: 1, commandAdvance: -20}).commandBonus, 0);
    assert.equal(cohesionPool({fellowshipBonus: 4, rank: 1}).commandBonus, 0);
    assert.equal(cohesionChallengeTarget(6), 6, 'the challenge is 1d10 under the pool');
    assert.equal(cohesionChallengeTarget(-3), 0);
});

test('the sheet derives Renown, Rank, the Curse and the suggested pool', () => {
    assert.match(source, /const rank = renownRankFor\(watch\.renown\);/);
    assert.match(source, /this\.system\.primarchsCurse = dwInsanityStep\(this\.insanity\)\.curse;/);
    // Rank counts the 12,000 he already was, so it agrees with Table 2-2.
    assert.match(source, /rankForExperience\(backgroundExperienceFor\("dw"\) \+ \(Number\(this\.experience\?\.totalSpent\) \|\| 0\)\)/);
    assert.match(source, /this\.system\.cohesionSuggested = cohesionPool\(\{/);
});

test('the character carries Renown, Cohesion and his Oath, on either type', () => {
    const model = type => (template.Actor[type].templates ?? [])
        .reduce((out, name) => ({...out, ...template.Actor.templates[name]}), {...template.Actor[type]});
    for (const type of ['acolyte', 'heretic']) {
        const watch = model(type).deathwatch;
        assert.notEqual(watch, undefined, type);
        assert.equal(watch.renown, 0);
        assert.deepEqual(watch.cohesion, {value: 0, max: 0});
        assert.equal(watch.oath, '');
        assert.equal(watch.killTeam, '');
    }
    // The book's biography fields, present on either type so a character can be
    // re-pointed at another book without being re-created.
    for (const type of ['acolyte', 'heretic'])
        for (const field of ['pastEvent', 'chapterDemeanour', 'armourHistory'])
            assert.equal(template.Actor[type].bio[field], '', `${type}.${field}`);
});

test("the biography asks exactly what the book's sheet asks (p. 397)", () => {
    const bio = readFileSync(
        new URL('../template/sheet/actor/partial/bio-deathwatch.hbs', import.meta.url), 'utf8');
    // Chapter and Speciality keep the fields the wizard writes; the rest are the book's.
    for (const field of ['system.bio.homeWorld', 'system.bio.role', 'system.bio.pastEvent',
                         'system.bio.chapterDemeanour', 'system.bio.demeanour', 'system.bio.armourHistory'])
        assert.ok(bio.includes(`name="${field}"`), field);
    // Rank is counted, not typed: two ranks on one sheet would disagree.
    assert.equal(bio.includes('name="system.rank"'), false);
    assert.match(bio, /\{\{system\.rank\}\}/);
    // Nothing of the placeholder sheet is left.
    assert.equal(bio.includes('BIO.ELITE'), false);
    assert.equal(bio.includes('BIO.BACKGROUND'), false);
    for (const key of ['DEATHWATCH.PAST_EVENT', 'DEATHWATCH.CHAPTER_DEMEANOUR',
                       'DEATHWATCH.PERSONAL_DEMEANOUR', 'DEATHWATCH.ARMOUR_HISTORY',
                       'DEATHWATCH.RANK', 'DEATHWATCH.RANK_HINT'])
        assert.ok(lang[key], key);
});

test("the Deathwatch tab is the book's second sheet page (p. 399)", () => {
    const system = loadSystem();
    const sheet = system.get('Dh.bookSheets.dw');
    const tabs = sheet.tabList.map(tab => tab.id);
    assert.ok(tabs.includes('deathwatch'));
    // And nobody else grows it: Renown and Cohesion exist in one book only.
    for (const [id, other] of Object.entries(system.get('Dh.bookSheets')))
        if (id !== 'dw') assert.equal(other.tabList.some(tab => tab.id === 'deathwatch'), false, id);

    const path = new URL('../template/sheet/actor/tab/deathwatch.hbs', import.meta.url);
    assert.ok(existsSync(path));
    const tab = readFileSync(path, 'utf8');
    for (const field of ['system.deathwatch.renown', 'system.deathwatch.killTeam',
                         'system.deathwatch.cohesion.value', 'system.deathwatch.cohesion.max',
                         'system.deathwatch.oath'])
        assert.ok(tab.includes(`name="${field}"`), field);
    assert.match(tab, /system\.renownLabel/);
    assert.match(tab, /system\.purityThreshold/);
    assert.match(tab, /deathwatchModes/);
    for (const key of ['TAB.DEATHWATCH', 'DEATHWATCH.RENOWN', 'DEATHWATCH.RENOWN_RANK',
                       'DEATHWATCH.COHESION', 'DEATHWATCH.COHESION_NOTE', 'DEATHWATCH.OATH',
                       'DEATHWATCH.KILL_TEAM', 'DEATHWATCH.PURITY', 'DEATHWATCH.PURITY_HINT',
                       'MODE.SOLO_ABILITIES', 'MODE.SQUAD_ABILITIES', 'DEATHWATCH.RANK_TOO_LOW'])
        assert.ok(lang[key], key);
});

test('Solo and Squad Mode abilities know which they are, and what they cost', () => {
    const abilities = JSON.parse(readFileSync(
        new URL('../packs-src/deathwatch/15-mode-abilities.json', import.meta.url), 'utf8'));
    assert.equal(abilities.length, 36);
    const solo = abilities.filter(item => item.system.mode === 'solo');
    const squad = abilities.filter(item => item.system.mode === 'squad');
    assert.equal(solo.length, 12, 'six Codex and six Chapter (Tables 7-10, 7-11)');
    assert.equal(squad.length, 24, 'attack patterns and defensive stances (Tables 7-12 to 7-15)');
    // Solo Mode is gated by Rank; Squad Mode is paid for in Cohesion.
    for (const item of solo) assert.ok(item.system.requiredRank >= 1, item.name);
    for (const item of squad) assert.ok(Number.isFinite(item.system.cohesionCost), item.name);
    assert.equal(abilities.find(item => item.name === 'Burst of Speed').system.requiredRank, 1);
    assert.equal(abilities.find(item => item.name === 'Bolter Assault').system.cohesionCost, 3);
    assert.equal(abilities.find(item => item.name === 'Fire Support').system.cohesionCost, 1);

    // The fields are part of the item, so the sheet can edit them.
    const special = template.Item.specialAbility;
    assert.equal(special.mode, '');
    assert.equal(special.requiredRank, 0);
    assert.equal(special.cohesionCost, 0);
    const card = readFileSync(new URL('../template/sheet/special-ability.hbs', import.meta.url), 'utf8');
    for (const field of ['system.mode', 'system.requiredRank', 'system.cohesionCost'])
        assert.ok(card.includes(`name="${field}"`), field);
    for (const key of ['SPECIAL_ABILITY.MODE', 'SPECIAL_ABILITY.REQUIRED_RANK',
                       'SPECIAL_ABILITY.COHESION_COST', 'MODE.NONE', 'MODE.SOLO', 'MODE.SQUAD'])
        assert.ok(lang[key], key);
});

test('the tab splits abilities by mode and marks what his Rank cannot reach', () => {
    const sheet = source.slice(source.indexOf('class DeathwatchSheet'));
    assert.match(sheet, /const rank = Number\(this\.actor\.system\.rank\) \|\| 1;/);
    assert.match(sheet, /lockedByRank: \(Number\(item\.system\?\.requiredRank\) \|\| 0\) > rank/);
    assert.match(sheet, /\{key: "solo", label: "MODE\.SOLO_ABILITIES", isSquad: false/);
    assert.match(sheet, /\{key: "squad", label: "MODE\.SQUAD_ABILITIES", isSquad: true/);
});
