import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extendSchemas} from '../modules/itempileffg/scripts/schema.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const json=path=>JSON.parse(readFileSync(path,'utf8'));
function files(directory) {return readdirSync(directory).flatMap(name=>{const path=join(directory,name);return statSync(path).isDirectory()?files(path):[path];});}
test('each module is a self-contained installable package with its own name and dependencies',()=>{
    for(const id of ['riftan-charbar','itempileffg','riftan-smart-assessment']) {
        const directory=join(root,'modules',id),manifest=json(join(directory,'module.json'));
        assert.equal(manifest.id,id);assert.equal(manifest.version,'0.1.0');assert.equal(manifest.compatibility.minimum,'14');
        assert.match(manifest.manifest,new RegExp(`/modules/${id}/module.json$`));
        assert.match(manifest.download,new RegExp(`/releases/download/${id}-v0.1.0/${id}.zip$`));
        for(const path of [...manifest.esmodules,...manifest.styles,...manifest.languages.map(lang=>lang.path),'README.md','LICENSE']) assert.ok(statSync(join(directory,path)).isFile());
        for(const path of files(directory).filter(path=>path.endsWith('.mjs'))) {
            const text=readFileSync(path,'utf8');
            for(const [,specifier]of text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
                assert.ok(resolve(dirname(path),specifier).startsWith(directory+'/'), `${id}: cross-package import ${specifier}`);
                assert.ok(statSync(resolve(dirname(path),specifier)).isFile());
            }
        }
        if(id!=='itempileffg') assert.deepEqual(manifest.relationships.requires??[],[]);
        else assert.deepEqual(manifest.relationships.requires.map(item=>item.id),['item-piles','lib-wrapper','socketlib']);
    }
});
test('module translations contain every UI key in Russian and English without relying on system PARTY labels',()=>{
    for(const [id,prefix]of [['riftan-charbar','RIFTAN_CHARBAR'],['itempileffg','ITEMPILEFFG']]) {
        const directory=join(root,'modules',id),en=json(join(directory,'lang/en.json')),ru=json(join(directory,'lang/ru.json'));
        assert.deepEqual(Object.keys(en),Object.keys(ru));
        assert.equal(en[prefix+'.TITLE'],id==='riftan-charbar'?'Riftan Charbar':'ItemPileFFG');
        const source=readFileSync(join(directory,'scripts/main.mjs'),'utf8');
        for(const [,key]of source.matchAll(/\bt\(['"]([A-Z_]+)['"]\)/g)) assert.ok(en[prefix+'.'+key] && ru[prefix+'.'+key],key);
        assert.doesNotMatch(source,/PARTY\./);
    }
});
test('ItemPileFFG extends old system models before loading documents and preserves existing definitions',()=>{
    class Field {constructor(options){this.options=options;}}
    class SchemaField {constructor(fields){this.fields=fields;}}
    const runtime={data:{fields:{NumberField:Field,StringField:Field,BooleanField:Field,SchemaField}}};
    const originalQuantity=new Field({initial:0});
    class ActorModel {static defineSchema(){return {name:new Field({})};} static migrateData(source){return source;}}
    class AmmoModel {static defineSchema(){return {quantity:originalQuantity};}}
    class GearModel {static defineSchema(){return {};}}
    const config={Actor:{dataModels:{acolyte:ActorModel}},Item:{dataModels:{ammunition:AmmoModel,gear:GearModel,talent:GearModel}}};
    extendSchemas(config,runtime);
    assert.equal(config.Actor.dataModels.acolyte.defineSchema().economy.fields.credits.options.initial,0);
    assert.equal(config.Item.dataModels.ammunition.defineSchema().quantity,originalQuantity);
    assert.equal(config.Item.dataModels.gear.defineSchema().quantity.options.initial,1);
    assert.equal(config.Item.dataModels.gear.defineSchema().inventory.fields.capacity.options.min,0);
    assert.equal(config.Item.dataModels.talent,GearModel);
    const extended=config.Item.dataModels.gear;extendSchemas(config,runtime);assert.equal(config.Item.dataModels.gear,extended);
});
