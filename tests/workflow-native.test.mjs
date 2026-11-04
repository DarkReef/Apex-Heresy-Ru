import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkflowNativeAdapters} from '../script/combat/workflow-native.mjs';
import {planOWDamage} from '../script/combat/ow-damage.mjs';

const clone=structuredClone;
function fixture({confirmation={confirmed:true},dialogHook,field=null,applyError=false,userIsGM=true,veto=false}={}) {
    const writes=[],events=[],renders=[],dialogs=[],calculations=[],fieldCalls=[];
    const gm={id:'gm',isGM:true},user=userIsGM?gm:{id:'player',isGM:false};
    const wounds={value:4,max:20,critical:0};
    const actor={id:'defender',uuid:'Actor.defender',name:'Guard',isOwner:true,
        system:{wounds},_source:{system:{wounds}},flags:{},items:[],effects:[],
        allApplicableEffects(){return this.effects;},
        _owDamageDefense(){return {armour:{head:2,body:2,leftArm:2,rightArm:2,leftLeg:2,rightLeg:2},
            effectiveToughness:30,unnaturalToughness:0,unnaturalMultiplier:1,daemonic:0,
            trueGrit:false,warpArmourConfirmed:true,review:this.review??[],wounds:clone(this.system.wounds)};},
        previewDamage(damages){events.push('preview');return planOWDamage(this._owDamageDefense(),damages);},
        async update(patch){
            writes.push(clone(patch));
            for(const [path,value]of Object.entries(patch)){
                const keys=path.split('.'),last=keys.pop();let target=this;
                for(const key of keys)target=target[key]??={};target[last]=clone(value);
            }
            return this;
        },
        async applyDamage(damages){
            if(veto){this._workflowDamageVeto=true;return this;}
            events.push('apply');const plan=planOWDamage(this._owDamageDefense(),damages);
            await this.update({'system.wounds.value':plan.wounds,'system.wounds.critical':plan.criticalWounds});
            if(applyError)throw Error('Lost connection after native wound write');
            return this;
        }
    };
    const scene={id:'scene',tokens:new Map()},token={id:'target',uuid:'Scene.scene.Token.target',name:'Guard token',
        parent:scene,actor,object:{name:'TokenObject'}};scene.tokens.set(token.id,token);
    const game={user,users:{activeGM:gm},scenes:new Map([[scene.id,scene]]),i18n:{
        localize:key=>key,format:(key,data)=>`${key}: ${JSON.stringify(data)}`}};
    const dialog=async config=>{dialogs.push(config);await dialogHook?.({actor,token,game,config});return typeof confirmation==='function'?confirmation(config):confirmation;};
    const foundry={utils:{deepClone:clone},applications:{handlebars:{renderTemplate:async(path,data)=>{
        renders.push({path,data:clone(data)});return '<p>Native damage review</p>';
    }},api:{DialogV2:{prompt:dialog,confirm:dialog}}}};
    const util={
        createCharacteristicRollData:(target,key)=>({name:key,actorUuid:target.uuid,characteristicKey:key,
            target:{base:key==='agility'?43:35,modifier:7},flags:{}}),
        createSkillRollData:(target,key)=>({name:key,actorUuid:target.uuid,target:{base:key==='dodge'?53:44,modifier:0},flags:{}})
    };
    const adapters=createWorkflowNativeAdapters({host:{game,foundry},util,
        computeRemainingHits:(...args)=>{calculations.push(args);return 3;},
        entriesFromRoll:data=>(data.damages??[]).map(d=>({amount:Number(d.total),penetration:Number(d.penetration??0),
            location:d.location,weaponTraits:d.weaponTraits??{}})),
        queue:async(key,work)=>{events.push(`queue:${key}`);return work();},
        interceptField:async(...args)=>{fieldCalls.push(args);events.push('field');return field;},
        readFlag:(document,key)=>document.flags?.['dark-heresy']?.[key]
    });
    const row={tokenUuid:token.uuid,actorUuid:actor.uuid,index:0,hits:2,remainingHits:2,
        damage:{rollData:{damages:[{total:12,penetration:0,location:'ARMOUR.BODY'}]}}};
    const message={id:'attack',flags:{'dark-heresy':{combatWorkflow:{generation:3}}}};
    return {adapters,actor,token,scene,game,row,message,writes,events,renders,dialogs,calculations,fieldCalls};
}

test('Spray builds an ordinary Agility test, retaining actual token ownership and no reaction flag',()=>{
    const f=fixture({userIsGM:false});
    const data=f.adapters.buildReaction({attackArea:{kind:'spray'},evasionModifier:-20,damages:[{total:99}],
        flags:{isAttack:true,isDamageRoll:true}},f.row,'agility');
    assert.equal(data.characteristicKey,'agility');assert.equal(data.target.base,43);
    assert.equal(data.target.modifier,0);assert.equal(data.flags.isEvasion,false);
    assert.equal(data.flags.isAttack,false);assert.equal(data.flags.isCombatRoll,false);
    assert.equal(data.flags.isDamageRoll,false);assert.equal(data.actorUuid,f.actor.uuid);
    assert.equal(data.targets[0].tokenUuid,f.token.uuid);assert.equal(data.damages,undefined);
    assert.equal(f.writes.length,0);
});

test('ordinary Dodge and Parry reuse native skill builders; suppression uses Willpower with native difficulty',()=>{
    const f=fixture();
    const root={weapon:{isRange:true},flags:{isAttack:true},evasionModifier:-10,damages:[{total:99}]};
    const dodge=f.adapters.buildReaction(root,f.row,'dodge');
    assert.equal(dodge.flags.isEvasion,true);assert.equal(dodge.evasions.selected,'dodge');
    assert.equal(dodge.target.base,53);assert.equal(dodge.target.modifier,-10);
    assert.deepEqual(dodge.workflowEvasionOptions,[{value:'dodge',label:'SKILL.DODGE'}]);
    const parry=f.adapters.buildReaction(root,f.row,'parry');
    assert.equal(parry.target.base,44);assert.equal(parry.evasions.selected,'parry');
    for(const [suppressionLength,expected]of[['full',-20],['semi',-10]]) {
        const pinning=f.adapters.buildReaction({suppressionLength},f.row,'suppression');
        assert.equal(pinning.characteristicKey,'willpower');assert.equal(pinning.target.modifier,expected);
        assert.equal(pinning.flags.isSuppressionTest,true);assert.equal(pinning.flags.isEvasion,false);
    }
});

test('missing/foreign/replaced targets and loss of defender ownership refuse a native roll',()=>{
    const f=fixture({userIsGM:false});
    assert.throws(()=>f.adapters.buildReaction({}, {...f.row,tokenUuid:'Scene.other.Token.target'},'dodge'),/TARGET_CHANGED/);
    assert.throws(()=>f.adapters.buildReaction({}, {...f.row,actorUuid:'Actor.other'},'dodge'),/TARGET_CHANGED/);
    f.actor.isOwner=false;
    assert.throws(()=>f.adapters.buildReaction({},f.row,'dodge'),/NO_PERMISSION/);
    assert.equal(f.writes.length,0);
});

test('hit cancellation delegates native attack math and subtracts only cancelled hits from the allocated target',()=>{
    const f=fixture(),root={attackDos:4,numberOfHits:5,shotsFired:5,attackType:{name:'full_auto'},weapon:{traits:{storm:true}}};
    const success={flags:{isSuccess:true},dos:2};
    assert.equal(f.adapters.computeRemaining(root,f.row,success),0);
    assert.deepEqual(f.calculations,[[4,2,root.attackType,5,root.weapon.traits]]);
    assert.equal(f.adapters.computeRemaining(root,f.row,{flags:{isSuccess:false},dos:0}),2);
    assert.equal(f.calculations.length,1);
    assert.equal(f.adapters.computeRemaining({attackArea:{kind:'spray'}},f.row,success),0);
    assert.equal(f.adapters.computeRemaining({},f.row,{flags:{isSuccess:true},dos:1}),1);
});

test('GM native application previews, confirms, persists intent and receipt, and refuses any second execution',async()=>{
    const f=fixture();
    const result=await f.adapters.applyDamage(f.message,f.row,'apply');
    assert.equal(result.receiptId,'attack_0_3');assert.equal(result.field.blocked,false);
    assert.equal(f.renders[0].data.woundsBefore,4);assert.equal(f.renders[0].data.woundsAfter,11);
    assert.equal(f.dialogs.length,1);assert.equal(f.actor.system.wounds.value,11);
    assert.deepEqual(f.events,['preview','queue:Actor.defender','field','apply']);
    const receipt=f.actor.flags['dark-heresy'].combatWorkflowReceipts.attack_0_3;
    assert.equal(receipt.status,'applied');assert.equal(receipt.operationId,'apply');
    assert.match(receipt.summary,/"wounds":7/);
    assert.equal(f.actor._damageSourceMessageId,undefined);
    await assert.rejects(f.adapters.applyDamage(f.message,f.row,'another'),/NEEDS_REVIEW/);
    assert.equal(f.events.filter(e=>e==='apply').length,1);assert.equal(f.dialogs.length,1);
});

test('cancelled confirmation and non-GM attempts produce zero Actor writes and no field dice',async()=>{
    for(const confirmation of [false,null,{confirmed:false}]) {
        const f=fixture({confirmation});
        const result=await f.adapters.applyDamage(f.message,f.row,'cancel');
        assert.equal(result.cancelled,true);assert.equal(f.writes.length,0);assert.equal(f.fieldCalls.length,0);
    }
    const player=fixture({userIsGM:false});
    await assert.rejects(player.adapters.applyDamage(player.message,player.row,'p'),/GM_REQUIRED/);
    assert.equal(player.dialogs.length,0);assert.equal(player.writes.length,0);
});

test('defence changes or authority handoff while review is open refuse stale application before any intent/write',async()=>{
    const changed=fixture({dialogHook:({actor})=>{actor.system.wounds.value++;}});
    await assert.rejects(changed.adapters.applyDamage(changed.message,changed.row,'a'),/DEFENSE_CHANGED/);
    assert.equal(changed.writes.length,0);assert.equal(changed.fieldCalls.length,0);
    const authority=fixture({dialogHook:({game})=>{game.users.activeGM={id:'newGM',isGM:true};}});
    await assert.rejects(authority.adapters.applyDamage(authority.message,authority.row,'a'),/GM_REQUIRED/);
    assert.equal(authority.writes.length,0);
    const replaced=fixture({dialogHook:({token})=>{token.actor={uuid:'Actor.replacement'};}});
    await assert.rejects(replaced.adapters.applyDamage(replaced.message,replaced.row,'a'),/TARGET_CHANGED/);
    assert.equal(replaced.writes.length,0);
});

test('force-field interception is recorded inline without applying wounds or replaying its dice',async()=>{
    const f=fixture({field:{blocked:true,name:'Refractor',roll:12}});
    const result=await f.adapters.applyDamage(f.message,f.row,'field');
    assert.equal(result.field.blocked,true);assert.match(result.summary,/Refractor/);
    assert.equal(f.actor.system.wounds.value,4);assert.equal(f.events.includes('apply'),false);
    await assert.rejects(f.adapters.applyDamage(f.message,f.row,'again'),/NEEDS_REVIEW/);
    assert.equal(f.fieldCalls.length,1);
});

test('ambiguous native apply failure preserves changed wounds and blocks retries with a needsReview receipt',async()=>{
    const f=fixture({applyError:true});
    await assert.rejects(f.adapters.applyDamage(f.message,f.row,'a'),/Lost connection/);
    assert.equal(f.actor.system.wounds.value,11);
    assert.equal(f.actor.flags['dark-heresy'].combatWorkflowReceipts.attack_0_3.status,'needsReview');
    assert.equal(f.actor._damageSourceMessageId,undefined);
    await assert.rejects(f.adapters.applyDamage(f.message,f.row,'again'),/NEEDS_REVIEW/);
    assert.equal(f.events.filter(e=>e==='apply').length,1);
});

test('unresolved defence rules are displayed and require the GM review acknowledgement',async()=>{
    const confirmation=checked=>config=>config.ok.callback(null,{form:{elements:{reviewAcknowledged:{checked}}}});
    const blocked=fixture({confirmation:confirmation(false)});blocked.actor.review=['Unverified protective trait'];
    const cancelled=await blocked.adapters.applyDamage(blocked.message,blocked.row,'unreviewed');
    assert.equal(cancelled.cancelled,true);assert.equal(blocked.writes.length,0);
    assert.ok(blocked.renders[0].data.review.includes('Unverified protective trait'));
    const accepted=fixture({confirmation:confirmation(true)});accepted.actor.review=['Unverified protective trait'];
    const result=await accepted.adapters.applyDamage(accepted.message,accepted.row,'reviewed');
    assert.equal(result.receiptId,'attack_0_3');assert.equal(accepted.actor.system.wounds.value,11);
});

test('native hook veto never becomes an applied receipt and clears temporary actor markers',async()=>{
    const f=fixture({veto:true});
    await assert.rejects(f.adapters.applyDamage(f.message,f.row,'veto'),/APPLICATION_VETO/);
    assert.equal(f.actor.system.wounds.value,4);
    assert.equal(f.actor.flags['dark-heresy'].combatWorkflowReceipts.attack_0_3.status,'needsReview');
    assert.equal(f.actor._workflowApplying,undefined);assert.equal(f.actor._workflowDamageVeto,undefined);
});
