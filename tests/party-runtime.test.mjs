import {test} from 'node:test';
import assert from 'node:assert/strict';

globalThis.Hooks={once(){},on(){}};
globalThis.foundry={utils:{escapeHTML:value=>value.replaceAll('<','&lt;'),randomID:()=> 'bag-key'}};
globalThis.fromUuid=async()=>globalThis.currentActor;
globalThis.fromUuidSync=()=>globalThis.currentActor;
globalThis.ui={notifications:{error(){},warn(){}},chat:{render(){}}};
const {requestChecks,respondCheck}=await import('../modules/riftan-charbar/scripts/main.mjs');
const {moveItem,configureItem}=await import('../modules/itempileffg/scripts/main.mjs');
const gm={id:'gm',isGM:true},owner={id:'owner',isGM:false};
function setup() {
    const writes=[],messages=new Map();
    const actor={uuid:'Actor.a',name:'A',isOwner:true,characteristics:{agility:{label:'Agility'}},skills:{},
        items:[],testUserPermission:user=>user.id==='owner',updateEmbeddedDocuments:async(type,patches)=>writes.push(patches)};
    globalThis.currentActor=actor;
    globalThis.game={user:gm,i18n:{localize:key=>key},users:new Map([['gm',gm],['owner',owner]]),settings:{get:()=> 'gmroll'},
        messages:{get:id=>messages.get(id),get contents(){return [...messages.values()]}},
        darkHeresy:{api:{rollTest:async input=>{writes.push(input);return {status:'resolved',context:{result:24,target:{final:50},flags:{isSuccess:true},dos:3}}}}}};
    globalThis.ChatMessage={getSpeaker:()=>({}),applyRollMode:data=>{data.whisper=['gm'];},create:async data=>{
        const message={id:String(messages.size),author:game.user,...data,getFlag:(scope,key)=>data.flags?.[scope]?.[key]};messages.set(message.id,message);return message;
    }};
    return {actor,writes,messages};
}
test('GM requests persist and an owner response invokes the system API once with original UUID',async()=>{
    const {actor,writes,messages}=setup();const request=await requestChecks({actorUuids:[actor.uuid],characteristic:'agility',modifier:10});
    game.user=owner;await respondCheck(request.id,actor.uuid);await respondCheck(request.id,actor.uuid);
    assert.equal(writes.length,1);assert.equal(writes[0].actorUuid,actor.uuid);assert.equal(writes[0].dialog,false);
    const response=[...messages.values()].at(-1);assert.equal(response.getFlag('riftan-charbar','partyResponse').roll,24);
    assert.deepEqual(response.whisper,['gm']);
});
test('players cannot issue requests, operate unowned inventories or answer forged GM requests',async()=>{
    const {actor,messages,writes}=setup();game.user=owner;
    await assert.rejects(requestChecks({actorUuids:[actor.uuid],characteristic:'agility'}),/GM_ONLY/);
    messages.set('fake',{author:owner,getFlag:()=>({actorUuids:[actor.uuid]})});
    await assert.rejects(respondCheck('fake',actor.uuid),/NO_PERMISSION/);
    actor.isOwner=false;await assert.rejects(moveItem({actorUuid:actor.uuid,itemId:'i'}),/NO_PERMISSION/);assert.equal(writes.length,0);
});
test('container edits reject invalid quantity and overcapacity before writing',async()=>{
    const {actor,writes}=setup();let updates=0;
    const item={id:'bag',type:'gear',system:{quantity:1,inventory:{isContainer:true,containerKey:'bag-key'}},update:async()=>updates++};
    const child={id:'child',type:'gear',system:{quantity:2,weight:3,inventory:{containerId:'bag'}}};
    actor.items=[item,child];actor.items.get=id=>actor.items.find(i=>i.id===id);
    await assert.rejects(configureItem({actorUuid:actor.uuid,itemId:'bag',price:5,quantity:2,isContainer:true,capacity:10}),/INVALID_QUANTITY/);
    await assert.rejects(configureItem({actorUuid:actor.uuid,itemId:'bag',price:5,quantity:1,isContainer:true,capacity:5}),/CAPACITY/);
    assert.equal(updates,0);assert.equal(writes.length,0);
    await configureItem({actorUuid:actor.uuid,itemId:'bag',price:5,quantity:1,isContainer:true,capacity:10});assert.equal(updates,1);
});
