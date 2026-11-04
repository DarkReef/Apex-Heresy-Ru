import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSystem} from './helpers/system.mjs';

const card = readFileSync(new URL('../template/chat/evasion.hbs', import.meta.url), 'utf8');
const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));

function fixture({conditions=[],selected='parry',preparedBase=50,manual=0,difficulty=0,attackerTraits={}}={}) {
    const system=loadSystem();
    const actor={id:'defender',system:{fatigue:{value:0}},hasCondition:key=>conditions.includes(key),getActiveTokens:()=>[]};
    system.context.game.actors.set(actor.id,actor);
    const data={ownerId:actor.id,name:'SKILL.PARRY',characteristicKey:'weaponSkill',flags:{isEvasion:true},
        target:{base:preparedBase,modifier:manual},difficulty:{value:difficulty},weapon:{traits:attackerTraits},
        evasions:{selected,[selected]:{target:{base:preparedBase}}}};
    return {system,actor,data,compute:()=>system.get('_computeCommonTarget')(data)};
}

test('an evasion sums and names manual, difficulty and actor conditions without a scene token',async()=>{
    const f=fixture({conditions:['fear'],manual:5,difficulty:-10});await f.compute();
    assert.equal(f.data.target.final,35);
    assert.equal(f.data.actorConditionModifier,-10);
    assert.match(f.data.evasionSources,/\(\+5\)/);
    assert.match(f.data.evasionSources,/\(-10\)/);
    assert.ok(f.data.evasionSources.includes(lang['CHAT.TEST_MODIFIER']));
    assert.ok(f.data.evasionSources.includes(lang['DIALOG.DIFFICULTY']));
    assert.ok(f.data.evasionSources.includes(lang['CONDITION.FEAR']));
});

test('attacker Unbalanced never penalizes defender Parry; own prepared Parry already includes equipment',async()=>{
    for(const preparedBase of [50,40]) {
        const f=fixture({preparedBase,attackerTraits:{unbalanced:true}});await f.compute();
        assert.equal(f.data.target.final,preparedBase);
        assert.equal(f.data.evasionSources,'');
    }
});

test('flexible attacks refuse Parry and grappling refuses reactions even without a scene token',async()=>{
    const flexible=fixture({attackerTraits:{flexible:true}});await flexible.compute();
    assert.equal(flexible.data.target.final,0);assert.equal(flexible.data.parryBlocked,true);
    assert.ok(flexible.data.evasionSources.includes(lang['WEAPON.FLEXIBLE_NO_PARRY_SHORT']));
    const grappled=fixture({conditions:['grappled'],selected:'dodge'});await grappled.compute();
    assert.equal(grappled.data.target.final,0);assert.equal(grappled.data.evasionBlocked,true);
    assert.ok(grappled.data.evasionSources.includes(lang['CONDITION.GRAPPLED']));
});

test('zero modifiers are omitted from an actual evasion breakdown',async()=>{
    const f=fixture();await f.compute();assert.equal(f.data.target.final,50);assert.equal(f.data.evasionSources,'');
});

test('actor condition penalties and hearing warnings do not depend on active token presence',()=>{
    for(const [conditions,data,expected] of [
        [['fear','pinned'],{weapon:{class:'basic',isRange:true}},-30],
        [['blinded','prone'],{weapon:{class:'melee'},characteristicKey:'weaponSkill'},-40],
        [['prone'],{flags:{isEvasion:true}},-20]
    ]) {
        const f=fixture({conditions});
        assert.equal(f.system.get('_getActorConditionModifier')(f.actor,data),expected);
    }
    const f=fixture({conditions:['deafened']});const roll={name:'SKILL.AWARENESS'};
    assert.equal(f.system.get('_getActorConditionModifier')(f.actor,roll),0);
    assert.equal(roll.deafenedWarning,true);
});

test('the card prints the breakdown, and the bare number only without one', () => {
    assert.match(card, /\{\{#if evasionSources\}\}/);
    assert.match(card, /\{\{evasionSources\}\}/);
    assert.match(card, /\{\{else if target\.modifier\}\}/);
});

test('the strings it needs exist', () => {
    for (const key of ['CHAT.EVASION_MODIFIERS', 'WEAPON.TRAIT.UNBALANCED',
                       'WEAPON.FLEXIBLE_NO_PARRY_SHORT', 'CONDITION.GRAPPLED'])
        assert.ok(lang[key], key);
});
