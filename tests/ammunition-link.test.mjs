import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveOwnedAmmunition, ammunitionQuantityUnit, ammunitionSnapshot, getAmmunitionProfile,
    ammunitionProfileFingerprint, ammunitionContainerPath, ammunitionOptions, ammunitionSelectionUpdate,
    planAmmunitionReload, reloadAmmunition, withAmmunitionLock, ammunitionPenetration} from '../script/data/ammunition-link.mjs';

const ammo = (id='ammo', quantity=2, extra={}) => ({id,type:'ammunition',name:'Armour-piercing rounds',
    system:{quantity,effect:{penetrationModifier:2},...extra}});
const gun = (id='gun', value=0, extra={}) => ({id,type:'weapon',name:'Autogun',
    system:{ammo:'ammo',clip:{value,max:30},...extra}});
function owner(items, uuid='Actor.owner') {
    const actor={id:uuid.split('.').at(-1),uuid,isOwner:true,items:new Map(items.map(item=>[item.id,item])),writes:[]};
    for(const item of items){item.parent=actor;item.uuid=`${uuid}.Item.${item.id}`;}
    actor.updateEmbeddedDocuments=async(type,patches)=>{
        assert.equal(type,'Item');actor.writes.push(structuredClone(patches));
        await Promise.resolve();
        return patches.map(patch=>{
            const item=actor.items.get(patch._id);
            for(const [path,value] of Object.entries(patch)){
                if(path==='_id')continue;
                const keys=path.split('.'),last=keys.pop();let target=item;
                for(const key of keys)target=target[key]??={};
                target[last]=structuredClone(value);
            }
            return item;
        });
    };
    return actor;
}

test('only the actual owner inventory resolves; names and foreign/world UUIDs cannot alias it',()=>{
    const a=ammo(),actor=owner([a]);
    assert.equal(resolveOwnedAmmunition(actor,'ammo'),a);
    assert.equal(resolveOwnedAmmunition(actor,'Actor.owner.Item.ammo'),a);
    assert.equal(resolveOwnedAmmunition(actor,'Actor.other.Item.ammo'),null);
    assert.equal(resolveOwnedAmmunition(actor,'Item.ammo'),null);
    assert.equal(resolveOwnedAmmunition(actor,a.name),null);
    assert.equal(resolveOwnedAmmunition(actor,'Compendium.system.ammo.Item.ammo'),null);
});

test('synthetic actor inherited UUID resolves to its own item and never a same-name base item',()=>{
    const baseAmmo=ammo(),base=owner([baseAmmo],'Actor.base');
    const localAmmo=ammo(),actor=owner([localAmmo],'Scene.scene.Token.token.Actor.base');
    actor.isToken=true;actor.token={baseActor:base};
    assert.equal(resolveOwnedAmmunition(actor,baseAmmo.uuid),localAmmo);
    actor.items.delete('ammo');actor.items.set('copy',ammo('copy'));
    assert.equal(resolveOwnedAmmunition(actor,baseAmmo.uuid),null);
    assert.equal(baseAmmo.system.quantity,2);
});

test('container paths include nested backpacks and stop on malformed cycles',()=>{
    const backpack={id:'pack',type:'gear',name:'Backpack',system:{inventory:{isContainer:true}}};
    const pouch={id:'pouch',type:'gear',name:'Pouch',system:{inventory:{isContainer:true,containerId:'pack'}}};
    const a=ammo('ammo',20,{quantityUnit:'rounds',inventory:{containerId:'pouch'}}),w=gun(),actor=owner([backpack,pouch,a,w]);
    assert.equal(ammunitionContainerPath(actor,a),'Backpack › Pouch');
    const options=ammunitionOptions(actor,w,{fits:()=>true});
    assert.equal(options[0].selected,true);assert.equal(options[0].quantity,20);assert.equal(options[0].quantityUnit,'rounds');
    backpack.system.inventory.containerId='pouch';
    assert.equal(ammunitionContainerPath(actor,a),'Backpack › Pouch');
});

test('selection freezes the current profile and never changes already loaded effects',()=>{
    const first=ammo(),second=ammo('other',2,{effect:{damage:{modifier:4}}}),w=gun('gun',10),actor=owner([first,second,w]);
    const selection=ammunitionSelectionUpdate(actor,w,'Actor.owner.Item.other');
    assert.equal(selection.success,true);assert.equal(selection.reference,'other');
    assert.equal(selection.update['system.loadedAmmo'].effect.penetrationModifier,2);
    assert.equal(w.system.ammo,'ammo','selection planning does not write');
    w.system.loadedAmmo=selection.update['system.loadedAmmo'];w.system.ammo='other';
    actor.items.delete('ammo');
    assert.equal(getAmmunitionProfile(actor,w).system.effect.penetrationModifier,2);
    assert.equal(getAmmunitionProfile(actor,w).system.effect.damage,undefined);
    const copy=getAmmunitionProfile(actor,w);copy.system.effect.penetrationModifier=999;
    assert.equal(w.system.loadedAmmo.effect.penetrationModifier,2);
});

test('linking from a generic loaded magazine freezes an explicit generic profile',()=>{
    const a=ammo(),w=gun('gun',8,{ammo:''}),actor=owner([a,w]);
    const update=ammunitionSelectionUpdate(actor,w,'ammo');
    assert.deepEqual(update.update['system.loadedAmmo'],{itemId:null,uuid:null,name:'',effect:{}});
    assert.equal(ammunitionSelectionUpdate(actor,w,'Actor.stranger.Item.ammo').success,false);
    assert.equal(ammunitionSelectionUpdate(actor,w,'ammo',{fits:()=>false}).reason,'wrong_ammunition');
    actor.isOwner=false;assert.equal(ammunitionSelectionUpdate(actor,w,'ammo').reason,'no_permission');
});

test('legacy quantities remain magazines; a full magazine consumes nothing',()=>{
    const a=ammo(),w=gun();
    assert.equal(ammunitionQuantityUnit(a),'magazines');
    const plan=planAmmunitionReload(w,a);
    assert.equal(plan.spent,1);assert.equal(plan.quantity,1);assert.equal(plan.clipValue,30);
    assert.equal(a.system.quantity,2);assert.equal(w.system.clip.value,0);
    w.system.clip.value=30;assert.equal(planAmmunitionReload(w,a).reason,'clip_full');
});

test('round stacks fill only the missing capacity and can load a short magazine',()=>{
    const a=ammo('ammo',7,{quantityUnit:'rounds'}),w=gun('gun',12);
    w.system.loadedAmmo=ammunitionSnapshot(a);
    let plan=planAmmunitionReload(w,a);
    assert.equal(plan.spent,7);assert.equal(plan.clipValue,19);assert.equal(plan.quantity,0);
    a.system.quantity=100;plan=planAmmunitionReload(w,a);
    assert.equal(plan.spent,18);assert.equal(plan.clipValue,30);assert.equal(plan.quantity,82);
});

test('partial magazines never mix another source or edited effects, regardless of quantity unit',()=>{
    for(const quantityUnit of ['rounds','magazines']){
        const a=ammo('ammo',50,{quantityUnit}),w=gun('gun',5);
        w.system.loadedAmmo=ammunitionSnapshot(a);
        assert.equal(planAmmunitionReload(w,ammo('other',50,{quantityUnit})).reason,'different_ammunition_loaded');
        a.system.effect.penetrationModifier=3;
        assert.equal(planAmmunitionReload(w,a).reason,'different_ammunition_loaded');
        w.system.clip.value=0;assert.equal(planAmmunitionReload(w,a).success,true);
    }
});

test('fingerprints ignore source name/UUID spelling but include effect and item identity',()=>{
    const a=ammo(),snapshot=ammunitionSnapshot(a),before=ammunitionProfileFingerprint(snapshot);
    snapshot.uuid='Scene.x.Token.y.Actor.z.Item.ammo';snapshot.name='Renamed ammunition';
    assert.equal(ammunitionProfileFingerprint(snapshot),before);
    snapshot.effect.penetrationModifier=3;assert.notEqual(ammunitionProfileFingerprint(snapshot),before);
});

test('concurrent weapons cannot spend the same final magazine within the client',async()=>{
    const a=ammo('ammo',1),first=gun('one'),second=gun('two'),actor=owner([a,first,second],'Actor.concurrent');
    const results=await Promise.all([reloadAmmunition(actor,first),reloadAmmunition(actor,second)]);
    assert.equal(results[0].success,true);assert.equal(results[1].reason,'out_of_ammo');
    assert.equal(actor.writes.length,1);assert.equal(actor.writes[0].length,2);
    assert.equal(a.system.quantity,0);assert.equal(first.system.clip.value,30);assert.equal(second.system.clip.value,0);
    assert.equal(getAmmunitionProfile(actor,first).system.effect.penetrationModifier,2);
});

test('an empty selection searches all owned inventory including backpack ammo',async()=>{
    const a=ammo('nested',2,{inventory:{containerId:'backpack'}}),w=gun('gun',0,{ammo:''}),actor=owner([a,w],'Actor.backpack');
    const result=await reloadAmmunition(actor,w,{fits:()=>true});
    assert.equal(result.success,true);assert.equal(w.system.ammo,'nested');assert.equal(a.system.quantity,1);
});

test('foreign ownership and incompatible ammunition are refused before writes',async()=>{
    const a=ammo(),w=gun(),actor=owner([a,w],'Actor.refusals');
    assert.equal((await reloadAmmunition(actor,{...w})).reason,'wrong_owner');
    assert.equal((await reloadAmmunition(actor,w,{fits:()=>false})).reason,'wrong_ammunition');
    w.system.ammo='Actor.other.Item.ammo';assert.equal((await reloadAmmunition(actor,w)).reason,'no_ammunition');
    assert.equal(actor.writes.length,0);
});

test('persistence errors propagate without retry or fake success and release the local queue',async()=>{
    const a=ammo(),w=gun(),actor=owner([a,w],'Actor.failure');let calls=0;
    actor.updateEmbeddedDocuments=async()=>{calls++;throw Error('database unavailable');};
    await assert.rejects(reloadAmmunition(actor,w),/database unavailable/);assert.equal(calls,1);
    assert.equal(await withAmmunitionLock(actor,async()=>42),42);
    actor.updateEmbeddedDocuments=async()=>[];
    await assert.rejects(reloadAmmunition(actor,w),/Incomplete ammunition reload/);
});

test('penetration modifier is additive while existing overrides, including zero, retain their meaning',()=>{
    assert.equal(ammunitionPenetration('3',{penetrationModifier:2}),'3+2');
    assert.equal(ammunitionPenetration('1d5+2',{penetrationModifier:2}),'1d5+2+2');
    assert.equal(ammunitionPenetration('3',{penetration:0,penetrationModifier:2}),'0+2');
    assert.equal(ammunitionPenetration('3',{penetration:'',penetrationModifier:0}),'3');
    assert.equal(ammunitionPenetration('3',{penetration:'+2'}),'+2','legacy authored override is not reinterpreted');
});
