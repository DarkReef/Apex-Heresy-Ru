import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currencyConfig,createCurrencyLoot,syncCurrency} from '../modules/itempileffg/scripts/currency.mjs';
test('currency name and image change while wallet path stays stable',()=>{
 const c=currencyConfig({get:(_s,k)=>k==='currencyName'?'Троны':'icons/custom/throne.webp'});
 assert.equal(c.name,'Троны');assert.equal(c.img,'icons/custom/throne.webp');assert.equal(c.data.path,'system.economy.credits');assert.equal(c.abbreviation,'{#} Троны');
});
test('currency loot is a real pile with the entered wallet amount; invalid values and players cannot create it',async()=>{
 const writes=[];globalThis.canvas={scene:{id:'scene'}};
 globalThis.game={user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}},settings:{get:()=>undefined},itempiles:{API:{createItemPile:async d=>{writes.push(d);return 'Actor.loot';}}}};
 assert.equal(await createCurrencyLoot({amount:25,position:{x:100,y:200}}),'Actor.loot');
 assert.equal(writes[0].actorOverrides.system.economy.credits,25);assert.equal(writes[0].itemPileFlags.type,'pile');
 await assert.rejects(createCurrencyLoot({amount:-1,position:{x:1,y:1}}));
 game.user.isGM=false;await assert.rejects(createCurrencyLoot({amount:1,position:{x:1,y:1}}));assert.equal(writes.length,1);
});
test('currency synchronization preserves secondary currencies and custom external wallets',async()=>{
 const secondary={name:'Gems',data:{path:'system.gems'},secondary:true};const writes=[];
 globalThis.game={user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}},settings:{get:()=>undefined},itempiles:{API:{CURRENCIES:[{data:{path:'system.economy.credits'}},secondary],setCurrencies:async d=>writes.push(d)}}};
 await syncCurrency();assert.equal(writes[0][0].name,'Троны');assert.equal(writes[0][1],secondary);
 game.itempiles.API.CURRENCIES=[secondary];await syncCurrency();assert.equal(writes.length,1);
});
