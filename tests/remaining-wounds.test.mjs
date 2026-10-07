import {test} from 'node:test';
import assert from 'node:assert/strict';
import {remainingWounds,remainingWoundsPatch,woundsAfterDamage,woundsAfterHealing} from '../script/combat/vitals.mjs';
import {characteristicTerm} from '../script/localization/field-terms.mjs';
import {loadSystem} from './helpers/system.mjs';
test('negative remaining wounds persist as compatible damage and critical values across JSON reload',()=>{
 for(const value of [-1,-5,0,7,10]){const patch=remainingWoundsPatch(value,10);const stored=JSON.parse(JSON.stringify({max:10,value:patch['system.wounds.value'],critical:patch['system.wounds.critical']}));assert.equal(remainingWounds(stored),value);assert.ok(stored.value>=0);assert.ok(stored.critical>=0);}
 assert.throws(()=>remainingWoundsPatch(11,10));assert.throws(()=>remainingWoundsPatch(NaN,10));
});
test('damage and healing cross zero while critical damage remains correct',()=>{
 const hurt=woundsAfterDamage({wounds:8,critical:0,max:10,amount:7});assert.deepEqual(hurt,{wounds:10,critical:5});assert.equal(remainingWounds({value:hurt.wounds,critical:hurt.critical,max:10}),-5);
 const healed=woundsAfterHealing({...hurt,amount:8});assert.deepEqual(healed,{wounds:7,critical:0});assert.equal(remainingWounds({value:healed.wounds,critical:healed.critical,max:10}),3);
});
test('effect-modified damage and critical values can display negative remaining wounds',()=>{assert.equal(remainingWounds({value:12,critical:3,max:10}),-5);});
test('OW canonical terminology is actor-specific and aliases do not replace primary labels',()=>{
 const actor={system:{ruleset:'ow',characteristics:{ballisticSkill:{label:'CHARACTERISTIC.BALLISTIC_SKILL'}}}};
 const t=characteristicTerm(actor,'ballisticSkill',{language:'ru',localize:()=> 'Стрельба'});assert.equal(t.label,'Дальний бой');assert.ok(t.aliases.includes('Стрельба'));assert.ok(t.aliases.includes('Ballistic Skill'));
 actor.system.ruleset='dh2';assert.equal(characteristicTerm(actor,'ballisticSkill',{language:'ru',localize:()=> 'Стрельба'}).label,'Стрельба');
});
test('actual sheet handler saves negative remaining wounds and actual meters preserve them after unrelated updates',async()=>{
 const runtime=loadSystem(),actor=Object.create(runtime.get('DarkHeresyActor.prototype'));
 actor.type='acolyte';actor.isOwner=true;actor.system={ruleset:'ow',wounds:{max:10,value:0,critical:0},fatigue:{value:0,max:5},fate:{value:1,max:1}};
 actor._source={system:structuredClone(actor.system)};
 actor.update=async patch=>{for(const [key,value]of Object.entries(patch)){const name=key.split('.').at(-1);actor._source.system.wounds[name]=value;}actor.system=structuredClone(actor._source.system);actor._computeVitalMeters();};
 const sheet=Object.create(runtime.get('DarkHeresySheet.prototype'));sheet.actor=actor;
 for(const value of [-1,-5]){
  await sheet._onRemainingWoundsChange({preventDefault(){},stopPropagation(){},currentTarget:{value:String(value)}});
  actor._source=JSON.parse(JSON.stringify(actor._source));await actor.update({});
  assert.equal(actor.system.wounds.remaining,value);assert.equal(actor.system.wounds.sourceRemaining,value);assert.equal(actor.system.wounds.showRemaining,true);assert.equal(actor.system.wounds.spentPercent,100);
 }
 actor.system.ruleset='dh2';actor._computeVitalMeters();assert.equal(actor.system.wounds.showRemaining,false);
});
