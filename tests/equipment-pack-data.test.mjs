import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OW_EQUIPMENT_CATALOG} from '../script/data/ow-equipment-catalog.mjs';
import {addEquipmentPackEffects,splitItemEffects} from '../tools/lib/equipment-pack-data.mjs';

test('release patch preserves rules text and existing effects, adds only known Only War bonuses once', () => {
    const entry=OW_EQUIPMENT_CATALOG.find(entry=>entry.name==='Synskin');
    const source={_id:entry.sourceId,name:'Translated suit',type:entry.type,system:{description:'Original HTML'},
        effects:[{_id:'customEffect0001',name:'User effect',system:{changes:[]}}],flags:{custom:{keep:1}}};
    const updated=addEquipmentPackEffects(source,'only-war');
    assert.equal(updated.effects.length,1+entry.effects.length);
    assert.equal(updated.system.description,source.system.description);
    assert.equal(updated.flags.custom.keep,1);
    assert.equal(source.effects.length,1);
    assert.deepEqual(addEquipmentPackEffects(updated,'only-war'),updated);
    assert.deepEqual(addEquipmentPackEffects(source,'dark-heresy'),source);
});

test('every supplied effect survives Foundry root IDs and the items.effects sublevel roundtrip', () => {
    for(const entry of OW_EQUIPMENT_CATALOG){
        const source={_id:entry.sourceId,type:entry.type,effects:entry.effects};
        const split=splitItemEffects(source);
        assert.ok(split.document.effects.every(id=>typeof id==='string' && id.length===16));
        const db=new Map(split.effects.map(effect=>[effect.key,effect.value]));
        const expanded=split.document.effects.map(id=>db.get(`!items.effects!${entry.sourceId}.${id}`));
        assert.deepEqual(expanded,entry.effects);
        assert.deepEqual(splitItemEffects(split.document),{document:split.document,effects:[]});
    }
});

test('invalid or colliding embedded IDs are rejected before any database writes', () => {
    for(const effects of [[{name:'No ID'}],[{_id:'x'}],[{_id:'sameEffect000001'},{_id:'sameEffect000001'}]])
        assert.throws(()=>splitItemEffects({_id:'test',effects}),/Invalid or duplicate/);
});
