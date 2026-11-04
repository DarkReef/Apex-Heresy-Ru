import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';
import {ammunitionSnapshot} from '../script/data/ammunition-link.mjs';

function fixture() {
    const system=loadSystem(),warnings=[],opened=[];
    const first={id:'ap',type:'ammunition',name:'Loaded AP',img:'icons/ap.webp',
        system:{quantity:8,quantityUnit:'rounds',effect:{penetrationModifier:2}}};
    const second={id:'next',type:'ammunition',name:'Next reserve',img:'icons/next.webp',
        system:{quantity:12,quantityUnit:'rounds',effect:{penetrationModifier:9},inventory:{containerId:'pouch'}}};
    const pack={id:'pack',type:'gear',name:'Pack',system:{inventory:{isContainer:true}}};
    const pouch={id:'pouch',type:'gear',name:'Pouch',system:{inventory:{isContainer:true,containerId:'pack'}}};
    const weapon={id:'gun',type:'weapon',name:'Autogun',system:{class:'basic',type:'solidProjectile',ammo:'ap',clip:{value:5,max:30}},updates:[]};
    const items=[weapon,first,second,pack,pouch];items.get=id=>items.find(item=>item.id===id);
    const actor={id:'sheet-owner',uuid:'Actor.sheet-owner',isOwner:true,system:{ruleset:'ow'},items};
    for(const item of items){item.parent=actor;item.actor=actor;item.uuid=`${actor.uuid}.Item.${item.id}`;}
    for(const ammunition of [first,second])ammunition.sheet={render:show=>opened.push([ammunition.id,show])};
    weapon.update=async patch=>{
        weapon.updates.push(structuredClone(patch));
        for(const [path,value] of Object.entries(patch)){
            const keys=path.split('.'),last=keys.pop();let target=weapon;
            for(const key of keys)target=target[key]??={};
            target[last]=structuredClone(value);
        }
        return weapon;
    };
    const parent=system.get('DarkHeresyItemSheet.prototype');
    parent.activateListeners=()=>{};
    parent.getData=async()=>({system:structuredClone(weapon.system)});
    parent._updateObject=async(_event,patch)=>weapon.update(patch);
    system.context.ui.notifications.warn=message=>warnings.push(message);
    const sheet=Object.create(system.get('WeaponSheet.prototype'));
    Object.assign(sheet,{item:weapon,document:weapon,actor,isEditable:true});
    const registrations=new Map();
    const html={find:selector=>({on:(event,handler)=>registrations.set(`${selector}:${event}`,handler)})};
    return {system,sheet,weapon,actor,first,second,items,warnings,opened,registrations,html};
}

function dropData(uuid, type='Item') {
    return {preventDefault(){},stopPropagation(){},dataTransfer:{getData:()=>JSON.stringify({type,uuid})}};
}

test('weapon slot registers its drag/drop/open/clear actions and readonly sheets register none',()=>{
    const f=fixture();f.sheet.activateListeners(f.html);
    for(const event of ['[data-ammunition-drop]:dragover','[data-ammunition-drop]:drop',
        '.ammunition-link-open:click','.ammunition-link-clear:click']){
        assert.equal(typeof f.registrations.get(event),'function',event);
    }
    f.registrations.clear();f.sheet.isEditable=false;f.sheet.activateListeners(f.html);
    assert.equal(f.registrations.size,0);
});

test('dropping owned ammo connects its reserve, preserves loaded profile and never consumes quantities',async()=>{
    const f=fixture();f.sheet.activateListeners(f.html);
    await f.registrations.get('[data-ammunition-drop]:drop')(dropData(f.second.uuid));
    assert.equal(f.weapon.system.ammo,'next');
    assert.equal(f.weapon.system.loadedAmmo.itemId,'ap');
    assert.equal(f.weapon.system.loadedAmmo.effect.penetrationModifier,2);
    assert.equal(f.weapon.system.clip.value,5);assert.equal(f.first.system.quantity,8);assert.equal(f.second.system.quantity,12);
    assert.deepEqual(Object.keys(f.weapon.updates[0]).sort(),['system.ammo','system.loadedAmmo']);
    f.registrations.get('.ammunition-link-open:click')({preventDefault(){}});
    assert.deepEqual(f.opened,[['next',true]]);
    await f.registrations.get('.ammunition-link-clear:click')({preventDefault(){}});
    assert.equal(f.weapon.system.ammo,'');assert.equal(f.weapon.system.loadedAmmo.itemId,'ap');
    assert.equal(f.weapon.system.loadedAmmo.effect.penetrationModifier,2);
});

test('foreign, incompatible and unauthorized reserve links are refused before an item update',async()=>{
    const f=fixture();
    await f.sheet._onAmmunitionDrop(dropData('Actor.foreign.Item.next'));
    assert.equal(f.weapon.updates.length,0);assert.equal(f.warnings.length,1);
    f.second.system.weaponTypes=['bolt'];
    await f.sheet._connectAmmunition(f.second.uuid);
    assert.equal(f.weapon.updates.length,0);assert.equal(f.warnings.length,2);
    f.second.system.weaponTypes=[];f.actor.isOwner=false;
    await f.sheet._connectAmmunition(f.second.uuid);
    assert.equal(f.weapon.updates.length,0);assert.equal(f.warnings.length,3);
});

test('weapon context names the connected backpack reserve separately from current loaded effects',async()=>{
    const f=fixture();f.weapon.system.loadedAmmo=ammunitionSnapshot(f.first);f.weapon.system.ammo='next';
    const data=await f.sheet.getData();
    assert.equal(data.linkedAmmunition.name,'Next reserve');
    assert.equal(data.linkedAmmunition.containerPath,'Pack › Pouch');
    assert.match(data.linkedAmmunition.reserveLabel,/12/);
    assert.equal(data.loadedAmmunition.name,'Loaded AP');
    assert.match(data.loadedAmmunition.effectSummary,/\+2/);
    assert.doesNotMatch(data.loadedAmmunition.effectSummary,/\+9/);
    const option=data.ammunitionOptions.find(option=>option.id==='next');
    assert.equal(option.selected,true);assert.equal(option.compatible,true);assert.match(option.name,/Pack › Pouch/);
    f.weapon.system.clip.value=0;assert.equal((await f.sheet.getData()).loadedAmmunition,null);
});

test('source dropdown save freezes old loaded effects while ordinary form edits stay ordinary',async()=>{
    const f=fixture();
    await f.sheet._updateObject({target:{name:'system.ammo'}},{'system.ammo':'next'});
    assert.equal(f.weapon.system.ammo,'next');assert.equal(f.weapon.system.loadedAmmo.itemId,'ap');
    await f.sheet._updateObject({target:{name:'name'}},{name:'Renamed autogun','system.ammo':'next'});
    assert.equal(f.weapon.name,'Renamed autogun');assert.equal(f.weapon.system.loadedAmmo.itemId,'ap');
    assert.equal(f.first.system.quantity,8);assert.equal(f.second.system.quantity,12);
});
