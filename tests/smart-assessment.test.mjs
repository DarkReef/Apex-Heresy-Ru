import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fieldCatalog,assessChange,searchFields} from '../modules/riftan-smart-assessment/scripts/fields.mjs';
import {SCOPE,rollData,fateActor,validateReroll,copyReroll,createFateService,visibleTo} from '../modules/riftan-smart-assessment/scripts/fate.mjs';
import {loadSystem} from './helpers/system.mjs';
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const ru=json('../modules/riftan-smart-assessment/lang/ru.json'),en=json('../modules/riftan-smart-assessment/lang/en.json');
const localize=key=>ru[key]??key;
function message(id,data,extra={}) {
    const flags={'dark-heresy':{rollData:data}};
    return {id,isRoll:true,author:{id:'owner'},whisper:[],blind:false,flags,getFlag(scope,key){return this.flags[scope]?.[key];},...extra};
}
function fixture() {
    const user={id:'owner',isGM:false},actor={uuid:'Actor.a',id:'a',name:'A',type:'acolyte',system:{fate:{value:3,max:4}},attributeBoni:{strength:/SB/},testUserPermission:u=>u?.id==='owner',async update(patch){this.system.fate.value=patch['system.fate.value'];}};
    const source=message('source',{actorUuid:actor.uuid,ownerId:actor.id,result:87,target:{base:35,modifier:10,final:45},difficulty:{value:0},aim:{val:10},rangeMod:-20,flags:{isSuccess:false,isCombatRoll:true},damages:[{amount:8}]});
    const list=[source];let count=0,seen;
    const adapter={actor:()=>actor,source:()=>source,user:()=>user,done:r=>r.done,messages:()=>list,config:()=>({}),clone:structuredClone,
        async execute(data,original,history){count++;seen=data;await Promise.resolve();const result=message('result',{...data,result:24,flags:{...data.flags,isSuccess:true}});result.flags[SCOPE]={fate:{...history,after:24}};list.push(result);return result;},
        async finish(request,original,result){original.flags[SCOPE]={replacement:result.id};request.done=true;}};
    return {user,actor,source,list,adapter,get count(){return count;},get seen(){return seen;}};
}
test('field assistance finds Russian characteristics, filters the real target and handles dynamic specialities',()=>{
    const target={system:{characteristics:{strength:{tempModifier:0}},movement:{run:12},skills:{trade:{label:'Ремесло',specialities:{smith:{name:'Кузнец',advance:10,cost:100,starter:true}}}}}};
    const catalog=fieldCatalog(target,{'system.characteristics.strength.tempModifier':{label:'broken'},'system.movement.run':{label:'Бег'},'system.damage':{label:'Урон'}},localize);
    assert.equal(searchFields(catalog,'сила временный')[0].key,'system.characteristics.strength.tempModifier');
    assert.equal(searchFields(catalog,'кузнец').length,3);assert.ok(!catalog.some(e=>e.key==='system.damage'));
    assert.equal(catalog.find(e=>e.key==='system.movement.run').phase,'final');
});
test('assessment warns about computed phases and rejects invalid values and operations',()=>{
    const number={type:'Number',phase:'final'};
    assert.deepEqual(assessChange(number,'10','add','initial'),{state:'warning',hint:'FINAL'});
    assert.equal(assessChange(number,'10','add','final').state,'valid');
    assert.equal(assessChange(number,'','add','final').state,'invalid');
    assert.equal(assessChange(number,'Infinity','add','final').state,'invalid');
    assert.equal(assessChange(number,'@system.psy.rating','add','final').state,'warning');
    assert.equal(assessChange({type:'String',phase:'initial'},'1d10','add','initial').state,'invalid');
    assert.equal(assessChange({type:'Boolean',phase:'initial'},'false','override','initial').state,'valid');
    assert.equal(assessChange(null,'10','add','initial').hint,'UNKNOWN');
});
test('reroll copies the original modifiers without mutating the source and resolves reaction ownership',()=>{
    const f=fixture(),next=copyReroll(rollData(f.source),f.actor,'r',structuredClone);
    assert.deepEqual(next.target,{base:35,modifier:10,final:45});assert.equal(next.aim.val,10);assert.equal(next.rangeMod,-20);
    assert.equal(next.flags.isReRoll,true);assert.equal(next.damages,undefined);assert.ok(rollData(f.source).damages);
    assert.ok(next.attributeBoni.strength instanceof RegExp);
    const data={ownerId:'attacker',actorUuid:'Actor.attacker',flags:{isEvasion:true},evasions:{selected:'dodge',dodge:{ownerId:'defender'}}};
    assert.equal(fateActor(data,()=>({id:'attacker'}),new Map([['defender',f.actor]])),f.actor);
});
test('ownership, private visibility, damage, regeneration and repeated Fate checks are enforced',()=>{
    const f=fixture();validateReroll(f.source,f.actor,f.user,f.list);
    assert.equal(visibleTo({...f.source,author:{id:'other'},whisper:['other']},f.user),false);
    assert.equal(visibleTo({...f.source,blind:true},f.user),false);
    assert.throws(()=>validateReroll(f.source,f.actor,{id:'other'},f.list),/NO_PERMISSION/);
    for(const flag of ['isDamageRoll','isRegeneration']) {rollData(f.source).flags[flag]=true;assert.throws(()=>validateReroll(f.source,f.actor,f.user,f.list),/UNSUPPORTED/);delete rollData(f.source).flags[flag];}
    rollData(f.source).flags.isSuccess=true;assert.throws(()=>validateReroll(f.source,f.actor,f.user,f.list),/NOT_FAILED/);rollData(f.source).flags.isSuccess=false;
    f.actor.system.fate.value=0;assert.throws(()=>validateReroll(f.source,f.actor,f.user,f.list),/NO_FATE/);
    f.actor.system.fate.value=.5;assert.throws(()=>validateReroll(f.source,f.actor,f.user,f.list),/NO_FATE/);
    f.actor.system.fate.value=3;rollData(f.source).flags.isReRoll=true;assert.throws(()=>validateReroll(f.source,f.actor,f.user,f.list),/USED/);
});
test('Infamy keeps existing Nurgle and corruption-level restrictions',()=>{
    const f=fixture();f.actor.type='heretic';f.actor.system.patron='nurgle';f.actor.corruption=30;
    assert.throws(()=>validateReroll(f.source,f.actor,f.user,f.list,{getInfamyLevel:()=>2,infamyPatronRules:{nurgle:{deny:['reroll']}}}),/UNSUPPORTED/);
    f.actor.system.patron='none';assert.throws(()=>validateReroll(f.source,f.actor,f.user,f.list,{getInfamyLevel:()=>1}),/UNSUPPORTED/);
    validateReroll(f.source,f.actor,f.user,f.list,{getInfamyLevel:()=>2});
});
test('simultaneous requests for the same roll spend one current point and keep the maximum',async()=>{
    const f=fixture(),service=createFateService(f.adapter);
    const results=await Promise.allSettled([service({id:'one'}),service({id:'two'})]);
    assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.match(results[1].reason.message,/USED/);
    assert.equal(f.actor.system.fate.value,2);assert.equal(f.actor.system.fate.max,4);assert.equal(f.count,1);
});
test('failed native rolls refund Fate and permit retry',async()=>{
    const f=fixture(),original=f.adapter.execute;f.adapter.execute=async()=>{throw new Error('cancelled');};const service=createFateService(f.adapter);
    await assert.rejects(service({id:'one'}),/cancelled/);assert.equal(f.actor.system.fate.value,3);
    f.adapter.execute=original;await service({id:'retry'});assert.equal(f.actor.system.fate.value,2);
});
test('history failure after a result exists never refunds or permits duplicate spending',async()=>{
    const f=fixture();f.adapter.finish=async()=>{throw new Error('history unavailable');};const service=createFateService(f.adapter);
    await assert.rejects(service({id:'one'}),/history unavailable/);assert.equal(f.actor.system.fate.value,2);
    await assert.rejects(service({id:'two'}),/USED/);assert.equal(f.count,1);
});
test('native target computation can preserve a snapshot before consulting live conditions',async()=>{
    const s=loadSystem({Hooks:{once(){},on(){},call(name,data){assert.equal(name,'darkHeresy.preComputeRollTarget');data.target.final=45;return false;}}});
    for(const name of ['_computeCommonTarget','_computeCombatTarget']) {const data={target:{final:12}};await s.get(name)(data);assert.equal(data.target.final,45);}
});
test('translations include ten distinct phrases for each outcome, all UI keys, and package prerequisites',()=>{
    assert.deepEqual(Object.keys(ru),Object.keys(en));
    for(const language of [ru,en])for(const outcome of ['SUCCESS','FAILURE'])assert.equal(new Set(Array.from({length:10},(_,i)=>language[`RSA.${outcome}_${i}`])).size,10);
    const source=readFileSync(new URL('../modules/riftan-smart-assessment/scripts/main.mjs',import.meta.url),'utf8');
    for(const [,key]of source.matchAll(/\bt\(['"]([A-Z_]+)['"]\)/g))assert.ok(ru['RSA.'+key]&&en['RSA.'+key],key);
    assert.equal(json('../modules/riftan-smart-assessment/module.json').relationships.systems[0].compatibility.minimum,'1.5.1');
});

test('native single-roll chat creation is awaited and propagates persistence errors',async()=>{
    const s=loadSystem({fromUuidSync:()=>({id:'a',name:'A'}),ChatMessage:{create:async()=>{throw new Error('database unavailable');}}});
    s.context.game.user={id:'gm'};s.context.foundry.applications={handlebars:{renderTemplate:async()=>'<p>Roll</p>'}};
    await assert.rejects(s.get('_sendSingleRollToChat')({actorUuid:'Actor.a',flags:{}}),/database unavailable/);
});
