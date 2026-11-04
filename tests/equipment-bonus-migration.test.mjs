import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OW_EQUIPMENT_CATALOG} from '../script/data/ow-equipment-catalog.mjs';
import {equipmentEntryFor, planEquipmentBonusMigration, syncEquipmentBonuses} from '../script/data/equipment-bonus-migration.mjs';

function fixture() {
    const entry = OW_EQUIPMENT_CATALOG.find(entry => entry.name === 'Synskin');
    assert.ok(entry);
    return {entry, item:{id:'ownedItem0000001', uuid:'Actor.test.Item.ownedItem0000001', type:entry.type,
        name:'Renamed player suit', _stats:{compendiumSource:`Compendium.apex-heresy-ru.only-war.Item.${entry.sourceId}`}, effects:[]}};
}

test('only verified Only War provenance identifies equipment, never name or a coincidentally matching id', () => {
    const {entry,item} = fixture();
    assert.equal(equipmentEntryFor(item)?.sourceId, entry.sourceId);
    item._stats.compendiumSource = `Compendium.dark-heresy.only-war.${entry.sourceId}`;
    assert.equal(equipmentEntryFor(item)?.sourceId, entry.sourceId);
    item._stats.compendiumSource = `Compendium.other-system.only-war.Item.${entry.sourceId}`;
    item.name = entry.name; item.id = entry.sourceId;
    assert.equal(equipmentEntryFor(item), null);
    item.flags = {'dark-heresy':{owEquipmentSource:entry.sourceId}};
    assert.equal(equipmentEntryFor(item)?.sourceId, entry.sourceId);
    item.type='talent'; assert.equal(equipmentEntryFor(item),null);
});

test('migration preserves custom conflicting effects and unrelated data; stored managed overrides are never replaced', () => {
    const {entry,item} = fixture(), supplied = entry.effects[0];
    item.system={quantity:4,equipped:false};
    const original=structuredClone(item);
    const plan=planEquipmentBonusMigration(item);
    assert.ok(plan.effects.length); assert.deepEqual(item,original);
    item.effects=[{_id:'customEffect0001',disabled:true,system:{changes:[{key:supplied.system.changes[0].key,type:'add',value:99}]}}];
    assert.ok(planEquipmentBonusMigration(item).skipped.length);
    item.effects=[structuredClone(supplied)];
    item.effects[0].disabled=true; item.effects[0].system.changes[0].value=77;
    const second=planEquipmentBonusMigration(item);
    assert.ok(second.effects.every(effect => effect.flags['dark-heresy'].equipmentBonus.id !== supplied.flags['dark-heresy'].equipmentBonus.id));
    assert.equal(item.effects[0].system.changes[0].value,77);
});

test('actor effects only prevent duplicates when their origin is this exact owned item', () => {
    const {entry,item}=fixture(), path=entry.effects[0].system.changes[0].key;
    item.actor={effects:[{origin:item.uuid,changes:[{key:path,value:10}]}]};
    assert.ok(planEquipmentBonusMigration(item).skipped.length);
    item.actor.effects[0].origin='Actor.someoneElse.Item.ownedItem0000001';
    assert.equal(planEquipmentBonusMigration(item).skipped.length,0);
});

test('embedded creation is idempotent and partial persistence is surfaced without automatic retry', async () => {
    const {item}=fixture(); let calls=0;
    item.createEmbeddedDocuments=async(type,docs,options)=>{
        calls++;assert.equal(type,'ActiveEffect');assert.equal(options.keepId,true);
        item.effects.push(...structuredClone(docs));return docs;
    };
    assert.ok((await syncEquipmentBonuses(item)).added>0);
    assert.equal((await syncEquipmentBonuses(item)).added,0);assert.equal(calls,1);
    item.effects=[];item.createEmbeddedDocuments=async()=>[];
    await assert.rejects(syncEquipmentBonuses(item),/Incomplete equipment effect migration/);
});
