import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {ruleTerm,ruleText} from '../script/localization/rule-text.mjs';
import {loadSystem} from './helpers/system.mjs';
const json=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
test('Only War UI agrees with the reviewed glossary except documented contextual meanings',()=>{
 const en=json('../lang/en.json'),ru=json('../lang/ru.json'),terms=json('../localization/ru/only-war-rule-terms.json'),overrides=json('../localization/ru/interface-overrides.json');
 for(const [key,value] of Object.entries(en))if(terms[value])assert.equal(ru[key],overrides[key]??terms[value],key);
 assert.equal(ru['CHAT.DOS'],'Ступени успеха');assert.equal(ru['CHAT.DOF'],'Ступени провала');
 assert.equal(ru['DIFFICULTY.SIMPLE'],'Очень лёгкий');assert.equal(ru['DIFFICULTY.CHALLENGING'],'Средний');
 assert.equal(ru['WEAPON.BOLT'],'Болтерное');assert.equal(ru['PSYCHIC_POWER.BOLT'],'Разряд');
 assert.equal(ru['WEAPON.VEHICLE'],'Станковое');assert.equal(ru['TYPES.Actor.vehicle'],'Техника');
 for(const key of Object.keys(overrides))assert.ok(Object.hasOwn(en,key),key);
});
test('public display translators preserve unknown terms, English and other books',()=>{
 assert.equal(ruleTerm('Storm','ow','ru'),'Шквальное');assert.equal(ruleTerm('Storm','ow','en'),'Storm');
 assert.equal(ruleTerm('Storm','dh2','ru'),'Storm');assert.equal(ruleTerm('Unknown','ow','ru'),'Unknown');
 assert.equal(ruleText('Blast (3), Reliable','ow','ru'),'Взрыв (3), Надёжное');
 assert.equal(ruleTerm('Psyker','ow','ru','aptitudes'),'Псайкерство');
});
test('snapshot hook preserves the original target for both common and combat rolls',async()=>{
 const calls=[];const s=loadSystem({Hooks:{on(){},once(){},call:(event,data)=>{calls.push(event);data.target.final=42;return false;}}});
 for(const name of ['_computeCommonTarget','_computeCombatTarget']){
  const data={target:{base:30,modifier:12,final:42}};await s.get(name)(data);assert.equal(data.target.final,42);
 }
 assert.deepEqual(calls,['darkHeresy.preComputeRollTarget','darkHeresy.preComputeRollTarget']);
});
test('system distribution excludes optional modules',()=>{
 assert.equal(existsSync(new URL('../modules',import.meta.url)),false);
 const manifest=json('../system.json');assert.equal(manifest.version,'1.5.4');
 assert.ok(manifest.manifest.endsWith('/releases/latest/download/system.json'));
});

test('native target computation can preserve a snapshot before consulting live conditions',async()=>{
    const s=loadSystem({Hooks:{once(){},on(){},call(name,data){assert.equal(name,'darkHeresy.preComputeRollTarget');data.target.final=45;return false;}}});
    for(const name of ['_computeCommonTarget','_computeCombatTarget']) {const data={target:{final:12}};await s.get(name)(data);assert.equal(data.target.final,45);}
});

test('native single-roll chat creation is awaited and propagates persistence errors',async()=>{
    const s=loadSystem({fromUuidSync:()=>({id:'a',name:'A'}),ChatMessage:{create:async()=>{throw new Error('database unavailable');}}});
    s.context.game.user={id:'gm'};s.context.foundry.applications={handlebars:{renderTemplate:async()=>'<p>Roll</p>'}};
    await assert.rejects(s.get('_sendSingleRollToChat')({actorUuid:'Actor.a',flags:{}}),/database unavailable/);
});
