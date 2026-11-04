import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';
import {ammunitionSnapshot, ammunitionProfileFingerprint, getAmmunitionProfile,
    ammunitionSelectionUpdate} from '../script/data/ammunition-link.mjs';

let serial=0;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function fixture({clip=1}={}) {
    const system=loadSystem(),events=[],warnings=[],resolved=[];
    const first={id:'first',type:'ammunition',name:'AP',system:{quantity:1,effect:{penetrationModifier:2}}};
    const second={id:'second',type:'ammunition',name:'Other AP',system:{quantity:2,effect:{penetrationModifier:5}}};
    const makeWeapon=(id,value)=>({id,type:'weapon',name:id,system:{class:'basic',type:'solidProjectile',
        ammo:'first',clip:{value,max:30},loadedAmmo:ammunitionSnapshot(first)}});
    const weapon=makeWeapon('one',clip),other=makeWeapon('two',0),items=[first,second,weapon,other];
    items.get=id=>items.find(item=>item.id===id);
    const actor={id:`queue${++serial}`,uuid:`Actor.queue${serial}`,documentName:'Actor',isOwner:true,
        type:'acolyte',items,hasCondition:()=>false,batches:[]};
    const apply=(item,patch)=>{
        for(const [path,value] of Object.entries(patch)){
            if(path==='_id')continue;
            const keys=path.split('.'),last=keys.pop();let target=item;
            for(const key of keys)target=target[key]??={};
            target[last]=structuredClone(value);
        }
        return item;
    };
    for(const item of items){
        item.parent=actor;item.uuid=`${actor.uuid}.Item.${item.id}`;
        item.update=async patch=>{events.push(`update:${item.id}`);return apply(item,patch);};
    }
    actor.updateEmbeddedDocuments=async(type,patches)=>{
        assert.equal(type,'Item');actor.batches.push(structuredClone(patches));events.push(`reload:${patches[1]._id}:begin`);
        if(actor.batchGate)await actor.batchGate();
        const written=patches.map(patch=>apply(items.get(patch._id),patch));
        events.push(`reload:${patches[1]._id}:end`);return written;
    };
    system.context.game.actors.set(actor.id,actor);
    system.context.fromUuid=async uuid=>uuid===actor.uuid?actor:null;
    system.context.fromUuidSync=uuid=>uuid===actor.uuid?actor:null;
    system.context.ui.notifications.warn=message=>warnings.push(message);
    // Dice/chat resolution is the boundary here. The actual combat entry,
    // validation, profile guard, queues, reload and clip write all run unchanged.
    system.context._resolveCombatRoll=async data=>{
        resolved.push(data);events.push(`resolve:${data.itemId}`);
        if(actor.attackGate)await actor.attackGate();
        await system.get('_consumeAmmo')(data);
    };
    const attack=(item=weapon)=>({actorUuid:actor.uuid,ownerId:actor.id,itemId:item.id,flags:{},
        attackType:{name:'standard'},weapon:{isRange:true,traits:{},clip:{...item.system.clip},
            rateOfFire:{single:1,burst:3,full:10},
            ammunitionFingerprint:ammunitionProfileFingerprint(getAmmunitionProfile(actor,item))}});
    const reload=item=>system.get('_reloadWeapon')(item,actor.uuid,null,false);
    return {system,actor,weapon,other,first,second,events,warnings,resolved,attack,reload};
}

test('a reload changing loaded effects cancels an old attack before rolling or spending; a fresh attack works',async()=>{
    const f=fixture({clip:0}),stale=f.attack();
    f.weapon.system.ammo='second';assert.equal((await f.reload(f.weapon)).success,true);
    const before=f.events.length;
    const result=await f.system.get('combatRoll')(stale);
    assert.equal(result.status,'cancelled');assert.equal(result.reason,'ammunitionProfile');
    assert.equal(f.resolved.length,0);assert.equal(f.events.length,before);
    assert.equal(f.weapon.system.clip.value,30);assert.equal(f.second.system.quantity,1);
    assert.equal(f.warnings.length,1);
    assert.equal((await f.system.get('combatRoll')(f.attack())).status,'resolved');
    assert.equal(f.resolved.length,1);assert.equal(f.weapon.system.clip.value,29);
    assert.equal(f.second.system.quantity,1,'attack does not spend the reserve a second time');
});

test('a Fate reroll keeps the historical loaded profile and never consumes the replacement magazine',async()=>{
    const f=fixture({clip:0}),reroll=f.attack(),historical=reroll.weapon.ammunitionFingerprint;
    f.weapon.system.ammo='second';await f.reload(f.weapon);
    const before=f.events.length;reroll.flags.isReRoll=true;
    assert.equal((await f.system.get('combatRoll')(reroll)).status,'resolved');
    assert.equal(f.resolved.length,1);assert.equal(f.resolved[0].weapon.ammunitionFingerprint,historical);
    assert.equal(f.weapon.system.clip.value,30);assert.equal(f.second.system.quantity,1);
    assert.deepEqual(f.events.slice(before),['resolve:one'],'no replacement inventory write occurs');
});

test('linking a different reserve without reloading does not invalidate the still-loaded magazine',async()=>{
    const f=fixture({clip:2}),openAttack=f.attack();
    const selected=ammunitionSelectionUpdate(f.actor,f.weapon,'second');
    assert.equal(selected.success,true);await f.weapon.update(selected.update);
    assert.equal((await f.system.get('combatRoll')(openAttack)).status,'resolved');
    assert.equal(f.weapon.system.clip.value,1);
    assert.equal(f.first.system.quantity,1);assert.equal(f.second.system.quantity,2);
    assert.equal(f.weapon.system.loadedAmmo.itemId,'first');
});

test('an ongoing attack holds the Actor inventory queue against a different weapon reload',async()=>{
    const f=fixture({clip:1}),entered=deferred(),release=deferred();
    f.actor.attackGate=async()=>{entered.resolve();await release.promise;};
    const shot=f.system.get('combatRoll')(f.attack());await entered.promise;
    const reload=f.reload(f.other);await flush();
    assert.equal(f.actor.batches.length,0,'a different weapon cannot bypass the Actor lock');
    assert.equal(f.first.system.quantity,1);assert.equal(f.other.system.clip.value,0);
    release.resolve();const [shotResult,reloadResult]=await Promise.all([shot,reload]);
    assert.equal(shotResult.status,'resolved');assert.equal(reloadResult.success,true);
    assert.deepEqual(f.events,['resolve:one','update:one','reload:two:begin','reload:two:end']);
    assert.equal(f.weapon.system.clip.value,0);assert.equal(f.other.system.clip.value,30);assert.equal(f.first.system.quantity,0);
    assert.equal(f.actor.batches.length,1);
    assert.equal((await f.reload(f.other)).reason,'clip_full');assert.equal(f.actor.batches.length,1,'repeated reload spends nothing');
});

test('attack waits for an in-flight reload then validates its completed profile, not the old snapshot',async()=>{
    const f=fixture({clip:0}),stale=f.attack(),entered=deferred(),release=deferred();
    f.weapon.system.ammo='second';
    f.actor.batchGate=async()=>{entered.resolve();await release.promise;};
    const reload=f.reload(f.weapon);await entered.promise;
    const shot=f.system.get('combatRoll')(stale);await flush();
    assert.equal(f.resolved.length,0);assert.equal(f.warnings.length,0,'validation must wait until reload completes');
    release.resolve();const [reloadResult,shotResult]=await Promise.all([reload,shot]);
    assert.equal(reloadResult.success,true);assert.equal(shotResult.reason,'ammunitionProfile');
    assert.equal(f.resolved.length,0);assert.equal(f.weapon.system.clip.value,30);assert.equal(f.second.system.quantity,1);
    assert.deepEqual(f.events,['reload:one:begin','reload:one:end']);
});
