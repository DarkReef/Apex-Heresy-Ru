import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';
import {buildModifierBreakdowns} from '../script/data/modifier-breakdown.mjs';

function fixture(ruleset='ow') {
    const vm=loadSystem({ActiveEffect:class {get isSuppressed(){return !!this.duration?.expired;} get active(){return !this.disabled&&!this.isSuppressed;}}});
    const actor={documentName:'Actor',id:'actor',name:'Guardsman',items:[],effects:[],getActiveTokens:()=>[],system:{ruleset},
        characteristics:{agility:{short:'Ag',label:'Agility',base:40,advance:0,tempModifier:0,total:40,displayTotal:40},
            intelligence:{short:'Int',label:'Intelligence',base:50,advance:0,tempModifier:0,total:50,displayTotal:50}},
        skills:{stealth:{label:'Stealth',characteristics:['Ag'],advance:0,total:50}}};
    actor.system.characteristics=actor.characteristics;actor.system.skills=actor.skills;
    actor._source={system:structuredClone(actor.system)};
    actor.allApplicableEffects=function*(){yield* this.effects;for(const item of this.items)yield* item.effects;};
    vm.context.game.actors.set(actor.id,actor);
    return {vm,actor};
}

test('skill roll targets preserve final effects on default and alternative characteristics',()=>{
    const {vm,actor}=fixture();
    const util=vm.get('DarkHeresyUtil');
    const data=util.createSkillRollData(actor,'stealth');
    assert.equal(data.skillKey,'stealth');assert.equal(data.target.base,50);
    assert.equal(data.characteristics.find(row=>row.key==='agility').target,50);
    assert.equal(data.characteristics.find(row=>row.key==='intelligence').target,60);
    assert.equal(actor.skills.stealth.advance,0,'equipment does not change proficiency');
});

test('speciality uses its own characteristic and retains prepared bonus across options',()=>{
    const {vm,actor}=fixture();
    actor.skills.navigate={label:'Navigate',characteristics:['Ag'],advance:0,total:40,specialities:{surface:{label:'Surface',characteristics:['Int'],advance:10,total:65}}};
    const data=vm.get('DarkHeresyUtil').createSpecialtyRollData(actor,'navigate','surface');
    assert.equal(data.skillKey,'navigate');assert.equal(data.specialityKey,'surface');
    assert.equal(data.characteristicKey,'intelligence');assert.equal(data.target.base,65);
    assert.equal(data.characteristics.find(row=>row.key==='agility').target,55);
    assert.equal(data.characteristics.find(row=>row.key==='intelligence').target,65);
});

test('Rogue Trader untrained alternative targets still halve before adding prepared bonuses',()=>{
    const {vm,actor}=fixture('rt');
    actor.skills.dodge={label:'Dodge',characteristics:['Ag'],advance:-20,total:25};
    const data=vm.get('DarkHeresyUtil').createSkillRollData(actor,'dodge');
    assert.equal(data.characteristics.find(row=>row.key==='agility').target,25);
    assert.equal(data.characteristics.find(row=>row.key==='intelligence').target,30);
});

test('native effect suppression and tooltip name the same active Synskin source',()=>{
    const {vm,actor}=fixture();
    const item=Object.assign(Object.create(vm.get('DarkHeresyItem.prototype')),{id:'synskin',documentName:'Item',name:'Комбинезон из синтекожи',parent:actor,type:'gear',system:{equipped:true,quantity:1},effects:[]});
    const effect=Object.assign(Object.create(vm.get('DarkHeresyActiveEffect.prototype')),{id:'bonus',parent:item,transfer:true,
        name:'Stealth bonus',flags:{'dark-heresy':{activation:'equipped',equipmentBonus:{id:'synskin.stealth'}}},
        system:{changes:[{key:'system.skills.stealth.total',phase:'final',type:'add',value:10}]}});
    actor.items.push(item);item.effects.push(effect);
    assert.equal(item.isEquippable,true);assert.equal(effect.isSuppressed,false);
    let part=buildModifierBreakdowns(actor).skills.stealth;
    assert.match(part.text,/\+10 — Комбинезон из синтекожи/);
    assert.doesNotMatch(part.text,/Other prepared/);
    item.system.inventory={containerId:'backpack'};
    actor.skills.stealth.total=40;
    assert.equal(effect.isSuppressed,true);
    part=buildModifierBreakdowns(actor).skills.stealth;
    assert.doesNotMatch(part.text,/синтекожи|Other prepared/);
});

test('common target revalidates selected conditions without accumulation and keeps Fate snapshot',async()=>{
    const {vm,actor}=fixture();
    const item={id:'medkit',documentName:'Item',name:'Меднабор',type:'gear',parent:actor,system:{equipped:true,quantity:1},effects:[]};
    item.effects.push({id:'bonus',name:'Лечение',parent:item,transfer:false,
        flags:{'dark-heresy':{activation:'equipped',equipmentBonus:{id:'medkit.healing',conditional:true,selectors:['skill:medicae']}}},
        system:{changes:[{key:'system.skills.medicae.total',type:'add',value:20}]}});
    actor.items.push(item);
    const data={ownerId:actor.id,skillKey:'medicae',characteristicKey:'intelligence',flags:{},target:{base:50,modifier:5},difficulty:{value:-10},equipmentBonusSelection:['medkit:bonus']};
    const compute=vm.get('_computeCommonTarget');
    await compute(data);assert.equal(data.target.final,65);assert.equal(data.equipmentBonusModifier,20);
    await compute(data);assert.equal(data.target.final,65);assert.equal(data.target.modifier,5);
    item.system.equipped=false;data.flags.isReRoll=true;
    await compute(data);assert.equal(data.target.final,65);
    data.flags.isReRoll=false;
    await compute(data);assert.equal(data.target.final,45);assert.equal(data.equipmentBonusSnapshot.length,0);
});

test('creation hook localizes full catalog effects only when needed and never writes an existing document',()=>{
    const {vm}=fixture();const writes=[];
    vm.context.game.i18n.localize=key=>key==='EQUIPMENT_BONUS.EXAMPLE'?'Применение медсумки':key;
    const effects=[{name:'EQUIPMENT_BONUS.EXAMPLE',flags:{'dark-heresy':{equipmentBonus:{id:'medkit'}}},system:{changes:[{key:'system.skills.medicae.total',value:20}]}}];
    const item={_source:{effects},updateSource:patch=>writes.push(patch),update:()=>{throw Error('No persisted document write');}};
    const [hook]=vm.listeners.get('preCreateItem');hook(item,{});
    assert.equal(writes.length,1);assert.equal(writes[0].effects[0].name,'Применение медсумки');
    assert.equal(effects[0].name,'EQUIPMENT_BONUS.EXAMPLE');
    item._source.effects=writes[0].effects;hook(item,{});assert.equal(writes.length,1);
});
