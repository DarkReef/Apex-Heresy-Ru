import {test} from 'node:test';
import assert from 'node:assert/strict';
import {traitParts,shortChip} from '../modules/riftan-smart-assessment/scripts/chat.mjs';
globalThis.Hooks={once(){},on(){}};
const {repairEconomy}=await import('../modules/itempileffg/scripts/main.mjs');
test('chat translates traits without splitting comma-separated trait parameters or losing unknown names',()=>{
    assert.deepEqual(traitParts('Las Weapon Setting, Reliable, Custom (1, 2)',true).map(p=>p.label),
        ['Смена режима лазерного оружия','Надёжное','Custom (1, 2)']);
    assert.equal(traitParts('Blast (3)',true)[0].label,'Взрывное (3)');
    assert.equal(traitParts('Reliable',false)[0].label,'Reliable');
    assert.equal(shortChip('Максимальный (+2 урон, +2 ББ, ×4 боеприпасы)'),'Максимальный');
});
function economy(price='',currencies=[]) {
    const writes=[];
    globalThis.CONFIG={Actor:{dataModels:{acolyte:class {},npc:class {}}}};
    globalThis.game={user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}},modules:new Map([['item-piles',{active:true}]]),
        settings:{get:()=>0,set:async(...args)=>writes.push(args)},itempiles:{API:{ACTOR_CLASS_TYPE:'acolyte',setActorClassType:async type=>{writes.push(['actorType',type]);game.itempiles.API.ACTOR_CLASS_TYPE=type;},ITEM_PRICE_ATTRIBUTE:price,
            ITEM_QUANTITY_ATTRIBUTE:'system.quantity',CURRENCIES:currencies,addSystemIntegration:()=>{},
            setItemPriceAttribute:async path=>writes.push(['price',path]),setCurrencies:async value=>writes.push(['currencies',value])}}};
    return writes;
}
test('existing worlds with the built-in blank FFG price and currency settings are repaired',async()=>{
    const writes=economy(); await repairEconomy();
    assert.equal(writes[0][1],'system.price');assert.equal(writes[1][1][0].data.path,'system.economy.credits');
    assert.equal(writes.at(-1)[1],'economyAdapterVersion');
});
test('automatic repair preserves configured custom economy; only the active GM writes',async()=>{
    const writes=economy('flags.custom.price',[{data:{path:'flags.custom.money'}}]);
    await repairEconomy(); assert.equal(writes.length,1);
    game.user.isGM=false; assert.equal(await repairEconomy(true),false); assert.equal(writes.length,1);
});

test('map drop receives a valid actor type when stored settings are blank or obsolete',async()=>{
    for (const invalid of [undefined,'','character']) {
        const writes=economy('system.price',[{data:{path:'system.economy.credits'}}]);
        game.itempiles.API.ACTOR_CLASS_TYPE=invalid;
        game.settings.get=()=>2; // already migrated worlds must still be repaired
        await repairEconomy();
        assert.deepEqual(writes,[['actorType','acolyte']]);
        const actorData={name:'Default Item Pile',type:game.itempiles.API.ACTOR_CLASS_TYPE};
        assert.ok(Object.hasOwn(CONFIG.Actor.dataModels,actorData.type));
        await repairEconomy();assert.equal(writes.length,1);
    }
});
test('a valid custom pile actor type is preserved on load',async()=>{
    const writes=economy('system.price',[{data:{path:'system.economy.credits'}}]);
    game.itempiles.API.ACTOR_CLASS_TYPE='npc';game.settings.get=()=>2;
    await repairEconomy();assert.equal(writes.length,0);
    game.users.activeGM.id='other-gm';game.itempiles.API.ACTOR_CLASS_TYPE=undefined;
    assert.equal(await repairEconomy(),false);assert.equal(writes.length,0);
});
