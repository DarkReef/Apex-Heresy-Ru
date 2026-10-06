import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {defaultEnv,normalizeEnv,envView,formatDose,weatherMeta,localizeRow,WEATHER,RAD_PROTECTION,RAD_TABLE} from '../script/environment-data.mjs';
import {registerSystemSettings} from '../script/settings.mjs';
const ru=JSON.parse(readFileSync(new URL('../lang/ru.json',import.meta.url)));
const en=JSON.parse(readFileSync(new URL('../lang/en.json',import.meta.url)));
const i18n={format:(key,data={})=>(ru[key]??key).replace(/\{(\w+)\}/g,(m,k)=>data[k]??m),localize:key=>ru[key]??key};

test('environment resolves translated labels lazily and preserves custom text',()=>{
 const before=globalThis.game;globalThis.game={i18n};
 try {
  for(const item of WEATHER)assert.match(localizeRow(item).label,/[А-Яа-я]/);
  for(const item of [...RAD_PROTECTION,...RAD_TABLE])assert.match(localizeRow(item).label,/[А-Яа-я]/);
  const normal=envView(defaultEnv());assert.equal(normal.weather.label,'Ясно');assert.equal(normal.rad.unit,'мкЗв/ч');
  const custom=envView({...defaultEnv(),weatherText:'UI.CLEAR',note:'Captain’s note',gravity:0.5,temp:65,radDose:30});
  assert.equal(custom.weather.label,'UI.CLEAR');assert.equal(custom.note,'Captain’s note');
  assert.match(custom.gravity.label,/Низкая/);assert.match(custom.gravity.note,/Вес/);assert.match(custom.temp.freq,/раунд/);assert.match(custom.rad.band,/Загрязнение/);
 }finally{globalThis.game=before;}
});

test('small scientific doses retain exponent digits and invalid selections are normalized',()=>{
 assert.equal(Number(formatDose(1.2e-10,'uSv').text),1.2e-10);
 assert.equal(formatDose(Infinity,'uSv').text,'0');assert.equal(formatDose(1,'constructor').value,1);
 const normalized=normalizeEnv({weather:'constructor',gravity:-5,radUnit:'__proto__',note:{},weatherText:12});
 assert.equal(normalized.weather,'clear');assert.equal(normalized.gravity,0);assert.equal(normalized.radUnit,'uSv');
 assert.equal(normalized.note,'');assert.equal(normalized.weatherText,'');assert.equal(weatherMeta('constructor').key,'clear');
});

test('every visible system setting has localized name and hint without changing saved defaults',()=>{
 const before=globalThis.game,settings=new Map();globalThis.game={settings:{register:(_scope,key,config)=>settings.set(key,config)}};
 try{registerSystemSettings();for(const [key,config] of settings){assert.ok(en[config.name],key);assert.ok(ru[config.name],key);assert.ok(ru[config.hint],key);}
 assert.equal(settings.get('autoCalcXPCosts').default,false);assert.equal(settings.get('worldSchemaVersion').default,0);assert.equal(settings.get('atmosphericEffects').scope,'client');
 }finally{globalThis.game=before;}
});

test('templates have no nested translation expressions or untranslated English tooltips',()=>{
 const root=new URL('../template/',import.meta.url);
 for(const file of readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.hbs'))){const text=readFileSync(new URL(file.replaceAll('\\','/'),root),'utf8');
 assert.doesNotMatch(text,/\{\{[^{}]*\{\{/,file);
 assert.doesNotMatch(text.split("\n").filter(line=>!line.trim().startsWith("{{>")).join("\n"),/(?:title|placeholder)="[A-Za-z][^"{}]*"/,file);
 }
});

test('environment v2 serializes writes and rejects writes by players',async()=>{
 const saved={foundry:globalThis.foundry,game:globalThis.game,canvas:globalThis.canvas,ui:globalThis.ui};
 globalThis.foundry={applications:{api:{ApplicationV2:class {get state(){return 0;}},HandlebarsApplicationMixin:Base=>Base}}};
 globalThis.game={user:{isGM:true},i18n};globalThis.ui={notifications:{warn(){},error(){}}};
 let source=defaultEnv(),writes=0;globalThis.canvas={scene:{getFlag:()=>source,async setFlag(_scope,_flag,value){await Promise.resolve();source=value;writes++;}}};
 try {const {EnvironmentApp}=await import('../script/environment.mjs');const app=new EnvironmentApp();
 await Promise.all([app._patch({temp:40}),app._patch({gravity:2})]);assert.equal(source.temp,40);assert.equal(source.gravity,2);
 globalThis.game.user.isGM=false;await app._patch({temp:100});assert.equal(writes,2);
 }finally{Object.assign(globalThis,saved);}
});
