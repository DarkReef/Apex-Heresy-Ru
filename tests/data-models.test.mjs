import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const path=new URL('../script/data/models.mjs',import.meta.url);
test('type defaults combine reusable templates without sharing mutable data',async()=>{
    let resolve;
    try {resolve=(await import(path)).resolveTypeTemplate;} catch {}
    assert.equal(typeof resolve,'function');
    const data={Actor:{templates:{base:{wounds:{value:0,max:10}}},npc:{templates:['base'],wounds:{max:20}}}};
    const one=resolve(data,'Actor','npc'),two=resolve(data,'Actor','npc');
    assert.deepEqual(one,{wounds:{value:0,max:20}});
    one.wounds.value=7;assert.equal(two.wounds.value,0);
});
test('every shipped type resolves without leaving template directives',async()=>{
    let resolve;
    try {resolve=(await import(path)).resolveTypeTemplate;} catch {}
    assert.equal(typeof resolve,'function');
    const data=JSON.parse(readFileSync(new URL('../template.json',import.meta.url),'utf8'));
    for(const documentName of ['Actor','Item']) for(const type of data[documentName].types) {
        const value=resolve(data,documentName,type);
        assert.equal(value.templates,undefined);
        assert.ok(Object.keys(value).length>0);
    }
});

test('only explicitly nullable loaded-ammunition snapshots have null defaults',async()=>{
    // createDataModels maps a null default to a plain ObjectField with initial null, and an
    // ObjectField is not nullable: every document of that type then fails validation on
    // creation with "may not be null". Nothing reports this until an item is actually made.
    const data=JSON.parse(readFileSync(new URL('../template.json',import.meta.url),'utf8'));
    const found=[];
    const walk=(node,path)=>{
        if(node===null){found.push(path);return;}
        if(node&&typeof node==='object'&&!Array.isArray(node))
            for(const [k,v] of Object.entries(node)) {if(k==='types')continue;walk(v,path?`${path}.${k}`:k);}
    };
    walk(data,'');
    assert.deepEqual(found,['Item.weapon.loadedAmmo','Item.vehicleWeapon.loadedAmmo']);
    const {createDataModels}=await import(path);
    class Field {constructor(a,b){this.options=b??a;}}
    const fields={NumberField:Field,BooleanField:Field,StringField:Field,AnyField:Field,ObjectField:Field,ArrayField:Field,SchemaField:Field};
    class TypeDataModel {}
    const models=createDataModels(data,{data:{fields},abstract:{TypeDataModel}});
    for(const type of ['weapon','vehicleWeapon']) {
        assert.equal(models.Item[type].defineSchema().loadedAmmo.options.nullable,true);
        assert.equal(models.Item[type].defineSchema().loadedAmmo.options.initial,null);
    }
});

test('migration preserves unknown fields and repairs old numeric arrays without losing the source',async()=>{
    const module=await import(path);
    assert.equal(typeof module.migrateModelSource,'function');
    const result=module.migrateModelSource({wounds:{value:[8,8],custom:4},customField:'keep'}, {wounds:{value:0}});
    assert.equal(result.wounds.value,8);
    assert.deepEqual(result.legacyData,{wounds:{value:[8,8],custom:4},customField:'keep'});
});

test('structured traits belong to weapon and power schemas and survive model migration',async()=>{
    const {resolveTypeTemplate,migrateModelSource}=await import(path);
    const data=JSON.parse(readFileSync(new URL('../template.json',import.meta.url),'utf8'));
    for(const type of ['weapon','vehicleWeapon','psychicPower']) {
        const defaults=resolveTypeTemplate(data,'Item',type);
        assert.deepEqual(defaults.traitOverrides,{});
        const migrated=migrateModelSource({traitOverrides:{toxic:3,reliable:false}},defaults);
        assert.deepEqual(migrated.traitOverrides,{toxic:3,reliable:false});
        assert.equal(migrated.legacyData.traitOverrides,undefined);
    }
});

test('array and object defaults are fresh per document, never one shared instance', async () => {
    // Found in play: one document's default array leaked into every document created after
    // it, because every document of a type started from the same default instance.
    const {createDataModels} = await import(path);
    class Field { constructor(a, b) { this.options = b ?? a; } }
    const fields = {NumberField: Field, BooleanField: Field, StringField: Field, AnyField: Field,
        ObjectField: Field, ArrayField: Field,
        SchemaField: class { constructor(inner) { this.fields = inner; } }};
    class TypeDataModel { static migrateData(source) { return source; } }
    const data = JSON.parse(readFileSync(new URL('../template.json', import.meta.url), 'utf8'));
    const models = createDataModels(data, {data: {fields}, abstract: {TypeDataModel}});
    const initial = options => typeof options.initial === 'function' ? options.initial() : options.initial;
    const weaponTypes = models.Item.ammunition.defineSchema().weaponTypes.options;
    initial(weaponTypes).push('las');
    assert.deepEqual(initial(weaponTypes), []);
    const overrides = models.Item.weapon.defineSchema().traitOverrides.options;
    initial(overrides).toxic = 3;
    assert.deepEqual(initial(overrides), {});
});
