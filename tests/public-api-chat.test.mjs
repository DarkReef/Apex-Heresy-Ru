import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';

// Exercise the real API -> commonRoll -> native target/dice/post-roll path. Only
// Foundry's document persistence, HTML rendering and dice entropy are external.
function fixture() {
    const created=[], dice=[], hooks=[], writes=[];
    const actor={id:'owner', uuid:'Actor.owner', documentName:'Actor', name:'Acolyte', isOwner:true,
        type:'acolyte', system:{ruleset:'ow', fatigue:{value:0}, wounds:{value:5, critical:0},
            characteristics:{agility:{total:30, bonus:3, unnatural:0}}},
        characteristics:{agility:{label:'CHARACTERISTIC.AGILITY', total:30, displayTotal:30, bonus:3}},
        skills:{}, items:[], flags:{}, hasCondition:()=>false, getActiveTokens:()=>[],
        allApplicableEffects:()=>[], testUserPermission:()=>true,
        async update(patch) {
            writes.push(patch);
            for (const [path,value] of Object.entries(patch)) {
                const keys=path.split('.'), last=keys.pop(); let target=this;
                for (const key of keys) target=target[key]; target[last]=value;
            }
        }};
    class Roll {
        constructor(formula) { this.formula=formula; this.total=20;
            this.terms=[{faces:100, results:[{result:20, active:true}]}]; }
        async evaluate() { dice.push(this.formula); return this; }
        async render() { return '<p>20</p>'; }
    }
    const system=loadSystem({Roll, fromUuid:async uuid=>uuid===actor.uuid?actor:null,
        fromUuidSync:uuid=>uuid===actor.uuid?actor:null,
        ChatMessage:{getSpeaker:()=>({actor:actor.id}), applyRollMode(){}, getWhisperRecipients:()=>[],
            async create(data) { created.push(data); return {id:`message${created.length}`, ...data}; }}});
    Object.assign(system.context.game,{user:{id:'player',isGM:false}, actors:new Map([[actor.id,actor]]),
        messages:new Map(), modules:new Map(), users:new Map()});
    system.context.game.settings.get=(_scope,key)=>key==='ruleset'?'ow':key==='rollMode'?'publicroll':false;
    system.context.foundry.applications={handlebars:{renderTemplate:async()=>'<p>Native check</p>'}};
    system.context.Hooks.call=(name,data)=>{hooks.push({name,data}); return true;};
    system.context.Hooks.callAll=(name,data)=>hooks.push({name,data});
    return {system, actor, created, dice, hooks, writes, api:system.get('createDarkHeresyAPI')()};
}

test('rollTest defaults to the native visible chat card and publishes the resolved hook',async()=>{
    const f=fixture();
    const result=await f.api.rollTest({actorUuid:f.actor.uuid, characteristic:'agility', modifier:15});
    assert.equal(result.status,'resolved'); assert.equal(result.context.result,20);
    assert.equal(result.context.target.final,45); assert.equal(result.context.flags.isSuccess,true);
    assert.equal(result.context.dos,3); assert.equal(f.created.length,1);
    assert.equal(f.created[0].speaker.actor,f.actor.id);
    assert.equal(f.created[0].flags['dark-heresy.rollData'],result.context);
    assert.equal(f.hooks.filter(hook=>hook.name==='darkHeresy.roll').length,1);
    assert.deepEqual(f.dice,['1d100']);
});

test('chat:false uses native dice and modifiers without posting, and cannot suppress a subsequent normal check',async()=>{
    const f=fixture();
    const silent=await f.api.rollTest({actorUuid:f.actor.uuid, characteristic:'agility', modifier:15, chat:false});
    assert.equal(silent.status,'resolved'); assert.equal(silent.context.target.final,45);
    assert.equal(silent.context.result,20); assert.equal(silent.context.dos,3);
    assert.equal(silent.context.flags.suppressChat,true); assert.equal(f.created.length,0);
    assert.equal(f.hooks.filter(hook=>hook.name==='darkHeresy.roll').length,1);
    const normal=await f.api.rollTest({actorUuid:f.actor.uuid, characteristic:'agility'});
    assert.equal(normal.context.flags.suppressChat,undefined);
    assert.equal(normal.context.target.final,30); assert.equal(f.created.length,1);
    assert.deepEqual(f.dice,['1d100','1d100']);
    assert.equal(f.hooks.filter(hook=>hook.name==='darkHeresy.roll').length,2);
    assert.equal(f.writes.length,0);
});

test('invalid chat options are rejected before dice, document writes or completion hooks',async()=>{
    const f=fixture();
    for (const chat of [null, 0, 1, 'false', {}, []]) {
        await assert.rejects(f.api.rollTest({actorUuid:f.actor.uuid, characteristic:'agility', chat}),/boolean/);
    }
    assert.equal(f.dice.length,0); assert.equal(f.created.length,0); assert.equal(f.hooks.length,0);
});

test('a silent API check still respects the native preRoll veto',async()=>{
    const f=fixture();
    f.system.context.Hooks.call=name=>name!=='darkHeresy.preRoll';
    const result=await f.api.rollTest({actorUuid:f.actor.uuid, characteristic:'agility', chat:false});
    assert.equal(result.status,'cancelled'); assert.equal(f.dice.length,0);
    assert.equal(f.created.length,0); assert.equal(f.hooks.length,0);
});

test('suppressing the card does not skip native regeneration after a successful roll',async()=>{
    const f=fixture(), data=f.system.get('DarkHeresyUtil').createCharacteristicRollData(f.actor,'agility');
    data.flags={...data.flags,suppressChat:true,isRegeneration:true}; data.regeneration=2;
    const result=await f.system.get('commonRoll')(data);
    assert.equal(result.status,'resolved'); assert.equal(result.context.flags.isSuccess,true);
    assert.equal(f.created.length,0); assert.equal(f.writes.length,1);
    assert.equal(f.actor.system.wounds.value,3); assert.equal(f.actor.system.wounds.critical,0);
    assert.equal(f.actor._suppressWoundsFloat,undefined);
    assert.equal(f.hooks.filter(hook=>hook.name==='darkHeresy.roll').length,1);
});
