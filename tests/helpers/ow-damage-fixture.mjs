import {loadSystem} from './system.mjs';
import {createFoundryDamageAPI} from '../../script/combat/damage-api.mjs';

class Collection extends Map {
    get contents(){return [...this.values()];}
    filter(fn){return this.contents.filter(fn);}
    find(fn){return this.contents.find(fn);}
    some(fn){return this.contents.some(fn);}
    [Symbol.iterator](){return this.values();}
}
const set=(object,path,value)=>{
    const keys=path.split('.'),last=keys.pop();
    for(const key of keys)object=object[key]??= {};
    object[last]=structuredClone(value);
};
export function damageFixture(options={}) {
    const system=loadSystem(),context=system.context;
    const gm={id:'gm',isGM:true},player={id:'player',isGM:false},other={id:'other',isGM:false};
    const players=new Collection([['gm',gm],['player',player],['other',other]]);players.activeGM=gm;
    let actorWrites=0,fieldRolls=0,failBefore=false,failAfter=false,failAnnouncement=false;
    const items=new Collection();
    if(options.trueGrit)items.set('grit',{id:'grit',type:'talent',name:'True Grit'});
    const actor=Object.create(system.get('DarkHeresyActor.prototype'));
    const data={ruleset:'ow',wounds:{value:options.value??0,critical:options.critical??0,max:12},
        characteristics:{toughness:{total:45,displayTotal:45+(options.temp??0),base:45,tempModifier:options.temp??0,unnatural:options.unnatural??3,unnaturalMultiplier:1}},
        armour:Object.fromEntries(['head','body','leftArm','rightArm','leftLeg','rightLeg'].map(p=>[p,{value:6,toughnessBonus:7,total:13}]))};
    Object.assign(actor,{id:'npc',uuid:'Scene.scene.Token.enemy.Actor.npc',type:'npc',name:'Secret NPC',system:data,
        _source:{system:structuredClone(data),flags:{}},items,effects:new Collection(),getActiveTokens:()=>[],
        allApplicableEffects:function*(){yield* this.effects.values();},getFlag:(_,key)=>actor._source.flags['dark-heresy']?.[key],
        async update(patch){
            if(failBefore && 'system.wounds.value' in patch)throw Error('before write');
            if('system.wounds.value' in patch)actorWrites++;
            for(const [key,value]of Object.entries(patch)){set(actor._source,key,value);if(key.startsWith('system.'))set(actor,key,value);}
            if(failAfter && 'system.wounds.value' in patch)throw Error('write response lost');return actor;
        },async addCondition(condition,{rounds}){const effect={id:condition,condition,rounds,active:true,changes:[],toObject(){return {id:this.id,condition:this.condition,rounds:this.rounds,changes:this.changes};}};actor.effects.set(condition,effect);return effect;}});
    const attacker={id:'pc',uuid:'Actor.pc',type:'acolyte',name:'Attacker',items:new Collection(),system:{ruleset:'ow',characteristics:{toughness:{unnatural:3}}},
        testUserPermission:user=>user?.id==='player'||user?.isGM};
    const token={id:'enemy',uuid:'Scene.scene.Token.enemy',documentName:'Token',parent:{id:'scene'},actor};
    const lookup=new Map([[actor.uuid,actor],[attacker.uuid,attacker],[token.uuid,token]]);
    const messages=new Collection();
    const makeMessage=(id,flags,author=player)=>({id,author,whisper:[],blind:false,isOwner:true,isContentVisible:true,
        flags:structuredClone(flags),getFlag(scope,key){return this.flags[scope]?.[key];},getRollData(){return this.getFlag('dark-heresy','rollData');},
        async setFlag(scope,key,value){this.flags[scope]??={};this.flags[scope][key]=structuredClone(value);},async update(){}});
    const base=makeMessage('attack',{'dark-heresy':{rollData:{actorUuid:attacker.uuid,ownerId:attacker.id,flags:{isAttack:true,isSuccess:true},result:35,dos:4}}});
    const dataRoll={actorUuid:attacker.uuid,ownerId:attacker.id,sourceMessageId:'attack',itemId:'gun',
        flags:{isDamageRoll:true},targets:[{sceneId:'scene',tokenId:'enemy'}],attackDos:4,
        weapon:{damageProfileVersion:1,unresolvedTraits:[],damageType:'impact',weaponClass:'ranged',traits:options.traits??{}},
        damages:(options.hits??[{total:18,penetration:options.pen??0,location:'ARMOUR.BODY'}])};
    const source=makeMessage('damage',{'dark-heresy':{rollData:dataRoll}});
    messages.set(base.id,base);messages.set(source.id,source);
    let next=0;
    const clientSettings=new Map();
    Object.assign(context.game,{user:gm,users:players,messages,modules:new Collection(),
        settings:{get:(_,key)=>clientSettings.get(key),async set(_,key,value){clientSettings.set(key,value);}},
        actors:new Collection([['pc',attacker]]),scenes:new Collection([['scene',{tokens:new Collection([['enemy',token]])}]])});
    const field=options.field ? {id:'field',uuid:actor.uuid+'.Item.field',type:'forceField',name:'Refractor Field',
        system:{equipped:true,protectionRating:50,overloadChance:10,craftsmanship:'common'},flags:{},
        getFlag:(_,key)=>field.flags[key],async setFlag(_,key,value){field.flags[key]=value;}} : null;
    if(field)items.set('field',field);
    globalThis.game=context.game;globalThis.foundry=context.foundry;globalThis.CONFIG=context.CONFIG;
    globalThis.fromUuid=async uuid=>lookup.get(uuid);
    context.fromUuidSync=globalThis.fromUuidSync=uuid=>lookup.get(uuid);
    const fieldValues=[...(options.fieldRolls??[60])];
    globalThis.Roll=class {async evaluate(){fieldRolls++;this.total=fieldValues.shift();return this;}};
    globalThis.ChatMessage={async create(data){
        if(failAnnouncement && data.flags?.['dark-heresy']?.damageSummary)throw Error('chat failure');
        const m=makeMessage('new'+(++next),data.flags??{},game.user);Object.assign(m,{whisper:data.whisper??[],blind:data.blind??false,content:data.content});
        messages.set(m.id,m);return m;
    }};
    context.CONFIG.statusEffects=[{id:'prone'}];
    const build=()=>createFoundryDamageAPI({queue:system.get('_queueDocumentOperation'),
        rulesetFor:system.get('Dh.rulesetFor'),attackerFromRoll:system.get('_actorFromRollData')});
    const api=build();context.game.darkHeresy={api:{damage:api},config:{}};
    const input={messageId:source.id,tokenUuid:token.uuid,actorUuid:actor.uuid};
    return {system,api,build,input,gm,player,other,actor,attacker,token,lookup,messages,source,base,field,clientSettings,
        writes:()=>actorWrites,rolls:()=>fieldRolls,failBefore:()=>{failBefore=true;},failAfter:()=>{failAfter=true;},failChat:()=>{failAnnouncement=true;}};
}
