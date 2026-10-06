import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';
import {editTraitOverrides} from '../script/data/weapon-traits.mjs';

for (const text of ['Unreliable','Ненадёжное','Ненадежное']) test(`${text} never grants Reliable`, () => {
    const traits=loadSystem().get('DarkHeresyUtil').extractWeaponTraits(text);
    assert.equal(traits.unreliable,true);
    assert.equal(traits.reliable,false);
});
test('Reliable is retained alongside a numbered weapon trait', () => {
    const traits=loadSystem().get('DarkHeresyUtil').extractWeaponTraits('Reliable, Toxic (2)');
    assert.equal(traits.reliable,true);
    assert.equal(traits.unreliable,false);
    assert.equal(traits.toxic,2);
});

test('structured trait values override legacy text, including explicit false',()=>{
    const util=loadSystem().get('DarkHeresyUtil');
    const traits=util.extractWeaponTraits('Reliable, Toxic (1)',{reliable:false,toxic:3,balanced:true});
    assert.equal(traits.reliable,false);assert.equal(traits.toxic,3);assert.equal(traits.balanced,true);
});

test('numbered traits cannot steal a value from the following trait',()=>{
    const traits=loadSystem().get('DarkHeresyUtil').extractWeaponTraits('Toxic, Blast (3)');
    assert.equal(traits.toxic,undefined);assert.equal(traits.blast,3);
});

test('invalid structured values are rejected instead of becoming truthy strings',()=>{
    const util=loadSystem().get('DarkHeresyUtil');
    for(const overrides of [{reliable:'false'},{toxic:-1},{toxic:Infinity},{unknown:true}]) {
        assert.throws(()=>util.extractWeaponTraits('',overrides),/trait/i);
    }
});

test('ammunition edits override only the affected structured keys',()=>{
    const util=loadSystem().get('DarkHeresyUtil');
    const original={scatter:true,toxic:2,balanced:true};
    const overrides=editTraitOverrides(original,'Toxic (4)','Scatter, Toxic',text=>util.extractWeaponTraits(text));
    assert.deepEqual(overrides,{scatter:false,toxic:4,balanced:true});
    assert.equal(original.scatter,true);
    assert.equal(editTraitOverrides(original,'','Toxic',text=>util.extractWeaponTraits(text)).toxic,false);
});

test('installed modifications derive overrides without rewriting the stored weapon',()=>{
    const system=loadSystem();
    const source={special:'Scatter',traitOverrides:{scatter:true,toxic:2},damage:'1d10',clip:{max:10}};
    const weapon={id:'weapon',type:'weapon',_source:{system:source},system:structuredClone(source)};
    const modification={type:'weaponModification',system:{installed:true,weaponId:'weapon',effect:{removeTraits:'Scatter',addTraits:'Toxic (4)',availabilityShift:0}}};
    const items=[weapon,modification];items.get=id=>items.find(item=>item.id===id);
    const actor=Object.create(system.get('DarkHeresyActor.prototype'));actor.items=items;
    actor._applyWeaponModifications();actor._applyWeaponModifications();
    assert.equal(weapon.system.traitOverrides.scatter,false);assert.equal(weapon.system.traitOverrides.toxic,4);
    assert.deepEqual(source.traitOverrides,{scatter:true,toxic:2});
});

test('canonical Russian OW traits trigger the same mechanics as English',()=>{
 const util=loadSystem().get('DarkHeresyUtil');
 const en=util.extractWeaponTraits('Spray, Storm, Recharge, Corrosive, Felling (2), Toxic (3), Haywire (4), Twin-Linked');
 const ru=util.extractWeaponTraits('Распыляющее, Шквальное, Накачка, Коррозийное, Разящее (2), Отравленное (3), Электромагнитное (4), Спаренное');
 for(const key of ['skipAttackRoll','storm','recharge','corrosive','felling','toxic','haywire','twinLinked'])assert.equal(ru[key],en[key],key);
 for(const term of ['Накачка','Шквальное','Коррозийное','Отравленное (3)','Электромагнитное (4)','Спаренное'])assert.ok(loadSystem().get('_matchSpecialEntry')(term).trait,term);
});
