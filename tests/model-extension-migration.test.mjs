import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDataModels} from '../script/data/models.mjs';

class Field {constructor(options={}){this.options=options;}}
class NumberField extends Field {}
class StringField extends Field {}
class ObjectField extends Field {}
class SchemaField extends Field {
    constructor(fields,options={}){super(options);this.fields=fields;}
    get(key){return this.fields[key];}
}
const fields={NumberField,StringField,ObjectField,SchemaField,BooleanField:class extends Field {},
    AnyField:class extends Field {},ArrayField:class extends Field {}};
class TypeDataModel {
    static get schema(){return new SchemaField(this.defineSchema());}
    static migrateData(source){return source;}
}
function fixture() {
    const data={Actor:{types:['npc'],npc:{wounds:{value:0},skills:{}}},
        Item:{types:['weapon'],weapon:{weight:0,quantity:1,profile:{rating:0}}}};
    const models=createDataModels(data,{data:{fields},abstract:{TypeDataModel}});
    class ExtendedItem extends models.Item.weapon {
        static defineSchema(){return {...super.defineSchema(),price:new NumberField(),
            inventory:new SchemaField({containerId:new StringField(),isContainer:new fields.BooleanField(),
                capacity:new NumberField()}),
            profile:new SchemaField({...super.defineSchema().profile.fields,moduleRank:new NumberField()}),
            moduleBag:new ObjectField()};}
    }
    class ExtendedActor extends models.Actor.npc {
        static defineSchema(){return {...super.defineSchema(),economy:new SchemaField({credits:new NumberField()})};}
    }
    return {models,ExtendedItem,ExtendedActor};
}

test('registered subclass inventory, quantity, price and wallet fields are not treated as unknown legacy data',()=>{
    const {ExtendedItem,ExtendedActor}=fixture();
    const source={quantity:7,price:32,inventory:{containerId:'backpack',isContainer:false,capacity:10}};
    const migrated=ExtendedItem.migrateData(source);
    assert.deepEqual(migrated.inventory,source.inventory);assert.equal(migrated.price,32);assert.equal(migrated.quantity,7);
    assert.deepEqual(migrated.legacyData,{});
    const actor=ExtendedActor.migrateData({economy:{credits:55}});
    assert.equal(actor.economy.credits,55);assert.deepEqual(actor.legacyData,{});
});

test('nested extension fields and ObjectField maps survive while truly unknown fields remain archived',()=>{
    const {ExtendedItem}=fixture();
    const migrated=ExtendedItem.migrateData({profile:{rating:3,moduleRank:8,unregistered:9},
        inventory:{containerId:'backpack',unregistered:'keep'},moduleBag:{arbitrary:{userKey:3}},unknownRoot:'keep'});
    assert.deepEqual(migrated.legacyData,{profile:{unregistered:9},inventory:{unregistered:'keep'},unknownRoot:'keep'});
    assert.equal(migrated.profile.moduleRank,8);assert.deepEqual(migrated.moduleBag,{arbitrary:{userKey:3}});
});

test('numeric legacy repairs use the registered field type and retain the original source',()=>{
    const {ExtendedItem,models}=fixture();
    const migrated=ExtendedItem.migrateData({price:['12','12'],profile:{rating:'3,3',moduleRank:[8,8]}});
    assert.equal(migrated.price,12);assert.equal(migrated.profile.moduleRank,8);assert.equal(migrated.profile.rating,3);
    assert.deepEqual(migrated.legacyData,{price:['12','12'],profile:{rating:'3,3',moduleRank:[8,8]}});
    class ChangedQuantity extends models.Item.weapon {static defineSchema(){return {...super.defineSchema(),quantity:new StringField()};}}
    const changed=ChangedQuantity.migrateData({quantity:['7','8']});
    assert.deepEqual(changed.quantity,['7','8'],'a module override must not inherit the old template numeric coercion');
});

test('enabling a schema extension never overwrites live fields from an older archive or restores them automatically',()=>{
    const {ExtendedItem}=fixture();
    const archived={price:9,quantity:10,inventory:{containerId:'old-backpack'}};
    const migrated=ExtendedItem.migrateData({price:3,quantity:2,inventory:{containerId:'new-backpack'},legacyData:archived});
    assert.equal(migrated.price,3);assert.equal(migrated.quantity,2);assert.equal(migrated.inventory.containerId,'new-backpack');
    assert.deepEqual(migrated.legacyData,archived,'keep the previous archive as a backup, not a source to apply silently');
    const absent=ExtendedItem.migrateData({legacyData:archived});
    assert.equal(absent.price,undefined);assert.equal(absent.quantity,undefined);assert.equal(absent.inventory,undefined);
    assert.deepEqual(absent.legacyData,archived);
});
