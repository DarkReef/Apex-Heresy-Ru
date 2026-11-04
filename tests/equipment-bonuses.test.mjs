import {test} from 'node:test';
import assert from 'node:assert/strict';
import {equipmentEffectApplies, equipmentItemEquippable, conditionalEquipmentBonuses, snapshotEquipmentBonuses, localizeEquipmentEffectNames} from '../script/data/equipment-bonuses.mjs';

function fixture({conditional = false, activation = 'equipped', quality, selectors = ['skill:stealth']} = {}) {
    const actor = {documentName:'Actor', system:{ruleset:'ow'}, items:[], effects:[]};
    const item = {id:'a', uuid:'Actor.a.Item.a', documentName:'Item', parent:actor, type:'gear', name:'Синтекожа',
        system:{equipped:true, quantity:1, craftsmanship:'common'}, effects:[]};
    const effect = {id:'bonus', name:'Условие', parent:item, transfer:!conditional, disabled:false,
        system:{changes:[{key:'system.skills.stealth.total', type:'add', phase:'final', value:10}]},
        flags:{'dark-heresy':{activation, equipmentBonus:{id:'ow.synskin.stealth', conditional, selectors, ...(quality ? {quality} : {})}}}};
    item.effects.push(effect); actor.items.push(item);
    return {actor, item, effect};
}

test('passive equipment follows wearing, quantity, container, expiration and ruleset without writing data', () => {
    const {actor,item,effect}=fixture();
    assert.equal(equipmentItemEquippable(item),true);
    assert.equal(equipmentEffectApplies(effect,actor),true);
    for (const change of [{equipped:false},{quantity:0},{inventory:{containerId:'bag'}}]) {
        const before={...item.system}; Object.assign(item.system,change);
        assert.equal(equipmentEffectApplies(effect,actor),false); item.system=before;
    }
    for (const change of [{disabled:true},{duration:{expired:true}},{system:{...effect.system,isSuppressed:true}}]) {
        const before={...effect}; Object.assign(effect,change);
        assert.equal(equipmentEffectApplies(effect,actor),false); Object.assign(effect,before);
        delete effect.duration;
    }
    assert.equal(equipmentEffectApplies(effect,actor,{ruleset:'dh2'}),false);
    assert.equal(equipmentEffectApplies(effect,{...actor}),false,'foreign actor does not receive a carried source');
    assert.equal(item.system.equipped,true); assert.equal(item.system.quantity,1);
});

test('installed cybernetic and quality gates do not turn carried gear into an active implant', () => {
    const {actor,item,effect}=fixture({activation:'installed',quality:['good','best']});
    item.system.equipped=false;
    assert.equal(equipmentEffectApplies(effect,actor),false);
    item.type='cybernetic';item.system.craftsmanship='good';
    assert.equal(equipmentEffectApplies(effect,actor),false,'an uninstalled spare does not apply');
    item.system.installed=true;
    assert.equal(equipmentEffectApplies(effect,actor),true);
    item.system.inventory={containerId:'bag'};
    assert.equal(equipmentEffectApplies(effect,actor),false);
});

test('an overloaded force field ceases to give its equipment modifiers', () => {
    const {actor,item,effect}=fixture();item.type='forceField';
    assert.equal(equipmentEffectApplies(effect,actor),true);
    item.flags={'dark-heresy':{overloaded:true}};
    assert.equal(equipmentEffectApplies(effect,actor),false);
    item.flags['dark-heresy'].overloaded=false;
    assert.equal(equipmentEffectApplies(effect,actor),true);
});

test('duplicate catalog copies and legacy actor-origin copies contribute at most once', () => {
    const {actor,item,effect}=fixture();
    const second={...item,id:'b',uuid:'Actor.a.Item.b',effects:[]};
    const duplicate={...effect,parent:second}; second.effects.push(duplicate);actor.items.unshift(second);
    const old={...effect,id:'old',parent:actor,transfer:false,origin:item.uuid};actor.effects.push(old);
    assert.equal(equipmentEffectApplies(effect,actor),true);
    assert.equal(equipmentEffectApplies(duplicate,actor),false);
    assert.equal(equipmentEffectApplies(old,actor),false);
    effect.disabled=true;
    assert.equal(equipmentEffectApplies(duplicate,actor),true);
    assert.equal(equipmentEffectApplies(old,actor),false);
    duplicate.disabled=true;
    assert.equal(equipmentEffectApplies(old,actor),true,'existing actor copy remains usable when it is the only active source');
});

test('conditional choices match skills, specialities, alternate attributes and wildcard tests', () => {
    const {actor,effect}=fixture({conditional:true,selectors:['skill:navigate.surface','skill:commonLore.*','basedOn:perception']});
    const choices=roll=>conditionalEquipmentBonuses(actor,{flags:{isAttack:false},...roll});
    assert.equal(choices({skillKey:'navigate',specialityKey:'surface',characteristicKey:'intelligence'}).length,1);
    assert.equal(choices({skillKey:'navigate',specialityKey:'stellar',characteristicKey:'intelligence'}).length,0);
    assert.equal(choices({skillKey:'commonLore',specialityKey:'imperium',characteristicKey:'intelligence'}).length,1);
    assert.equal(choices({skillKey:'awareness',characteristicKey:'perception'}).length,1);
    assert.equal(choices({skillKey:'awareness',characteristicKey:'intelligence'}).length,0);
    assert.equal(choices({flags:{isEvasion:true},skillKey:'awareness',characteristicKey:'perception'}).length,0);
    effect.flags['dark-heresy'].equipmentBonus.selectors=['characteristic:agility'];
    assert.equal(choices({characteristicKey:'agility'}).length,1);
    assert.equal(choices({skillKey:'stealth',characteristicKey:'agility'}).length,0,'test-only penalty does not leak into skills');
    effect.flags['dark-heresy'].equipmentBonus.selectors=['skill:*','characteristic:*'];
    assert.equal(choices({skillKey:'medicae',characteristicKey:'intelligence'}).length,1);
    assert.equal(choices({characteristicKey:'toughness'}).length,1);
    assert.equal(choices({}).length,0);
    effect.system.changes[0].value='@characteristics.agility.total';
    assert.equal(choices({characteristicKey:'toughness'}).length,0,'unsafe/unknown formula is not guessed');
});

test('checked bonuses are revalidated once per computation and Fate keeps the original snapshot', () => {
    const {actor,item}=fixture({conditional:true});
    const roll={skillKey:'stealth',characteristicKey:'agility',flags:{},target:{base:40,modifier:5}};
    const [choice]=conditionalEquipmentBonuses(actor,roll);
    assert.equal(snapshotEquipmentBonuses(actor,roll),0,'initially unchecked');
    roll.equipmentBonusSelection=[choice.id,choice.id,'forged:99'];
    assert.equal(snapshotEquipmentBonuses(actor,roll),10);
    assert.equal(snapshotEquipmentBonuses(actor,roll),10,'recomputation does not accumulate');
    assert.equal(roll.target.modifier,5);
    assert.match(roll.equipmentBonusSources,/Синтекожа.*\+10/);
    item.system.equipped=false;
    roll.flags.isReRoll=true;
    assert.equal(snapshotEquipmentBonuses(actor,roll),10,'reroll retains original equipment');
    roll.flags.isReRoll=false;
    assert.equal(snapshotEquipmentBonuses(actor,roll),0,'new test cannot use removed equipment');
    item.system.equipped=true;roll.characteristicKey='intelligence';roll.skillKey='medicae';
    assert.equal(snapshotEquipmentBonuses(actor,roll),0,'changed test cannot reuse old choice');
});

test('new catalog effect names localize without altering source data or custom names', () => {
    const marked={name:'EQUIPMENT_BONUS.SYNSKIN',flags:{'dark-heresy':{equipmentBonus:{id:'synskin'}}},system:{changes:[{key:'system.skills.stealth.total',value:10}]}};
    const custom={...structuredClone(marked),name:'Мой бонус'};
    const untagged={name:'EQUIPMENT_BONUS.SYNSKIN',flags:{module:{custom:true}}};
    const source=[marked,custom,untagged];const before=structuredClone(source);
    const localize=key=>key==='EQUIPMENT_BONUS.SYNSKIN'?'Надет комбинезон из синтекожи':key;
    const result=localizeEquipmentEffectNames(source,localize);
    assert.equal(result.changed,true);assert.equal(result.effects[0].name,'Надет комбинезон из синтекожи');
    assert.deepEqual(result.effects[1],custom);assert.deepEqual(result.effects[2],untagged);assert.deepEqual(source,before);
    assert.equal(localizeEquipmentEffectNames(result.effects,localize).changed,false);
    assert.equal(localizeEquipmentEffectNames(source,key=>key).changed,false,'unavailable translations leave source keys intact');
});
