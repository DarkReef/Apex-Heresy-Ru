import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WEAPON_TRAIT_TYPES,validateTraitOverrides} from '../script/data/weapon-traits.mjs';
import {ruleText} from '../script/localization/rule-text.mjs';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
test('all picker and structured trait keys have English and Russian labels and hints',()=>{
 const source=readFileSync(new URL('../script/dark-heresy.js',import.meta.url),'utf8');
 const catalog=source.slice(source.indexOf('const DH_WEAPON_TRAITS = ['),source.indexOf('];',source.indexOf('const DH_WEAPON_TRAITS = [')));
 const aliases={rfFace:'vengeful',skipAttackRoll:'spray',overheating:'overheats'};
 const keys=new Set([...catalog.matchAll(/key: "([^"]+)"/g)].map(m=>m[1]));
 for(const k of Object.keys(WEAPON_TRAIT_TYPES))keys.add(aliases[k]??k);
 for(const lang of ['en','ru']){const dict=read('../lang/'+lang+'.json');for(const k of keys)for(const prefix of ['WEAPON.QUALITY.','WEAPON.QUALITY_HINT.'])assert.ok(dict[prefix+k],prefix+k);}
});
test('las setting and corrosive are translated without altering numbered traits',()=>{
 assert.equal(ruleText('Las Weapon Setting, Reliable, Corrosive, Blast (3)','ow','ru'),'Смена режима лазерного оружия, Надёжное, Коррозийное, Взрыв (3)');
 assert.deepEqual(validateTraitOverrides({corrosive:true}),{corrosive:true});
});
