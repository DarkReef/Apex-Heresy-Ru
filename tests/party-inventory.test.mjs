import {test} from 'node:test';
import assert from 'node:assert/strict';
import {descendants, contentsMass, itemMass, movePatch, remapContainers, validateMoney} from '../script/party/inventory.mjs';
import {integrationConfig, prepareContainerTrade} from '../script/party/item-piles.mjs';
class Collection extends Map { [Symbol.iterator]() { return this.values(); } }
function item(id, {parent='', key='', parentKey='', weight=0, quantity=1, capacity=0, bag=false}={}) {
    const data = {_id:id,id,type:'gear',name:id,system:{quantity,weight,price:10,equipped:true,
        inventory:{containerId:parent,containerKey:key,parentKey,isContainer:bag,capacity}}};
    data.toObject = () => JSON.parse(JSON.stringify(data, (key,value) => key === 'parent' ? undefined : value)); return data;
}
const tree = () => [item('bag',{bag:true,key:'bagKey',capacity:10,weight:1}),
    item('pouch',{bag:true,key:'pouchKey',parent:'bag',parentKey:'bagKey',capacity:5,weight:0.5}),
    item('rounds',{parent:'pouch',parentKey:'pouchKey',weight:0.1,quantity:20}),item('gun',{weight:4})];
test('nested weight counts every physical stack once, including zero ammo',()=>{
    const items=tree();assert.equal(contentsMass(items,'bag'),2.5);assert.equal(contentsMass(items,'pouch'),2);
    assert.equal(items.reduce((n,i)=>n+itemMass(i),0),7.5);assert.equal(itemMass(item('empty',{quantity:0,weight:2})),0);
});
test('moves reject cycles and enforce capacity for every ancestor',()=>{
    const items=tree();assert.throws(()=>movePatch(items,'bag','pouch'),/cycle/);
    assert.throws(()=>movePatch(items,'bag','bag'),/cycle/);assert.throws(()=>movePatch(items,'gun','pouch'),/capacity/);
    assert.equal(movePatch(items,'gun','bag')['system.inventory.parentKey'],'bagKey');
    items[0].system.inventory.capacity=6;assert.throws(()=>movePatch(items,'gun','bag'),/capacity/);
    assert.throws(()=>movePatch(items,'gun','rounds'),/container/i);
});
test('Item Piles remapping restores three nesting levels and detaches single extracted items',()=>{
    const [bag,pouch,rounds]=tree();bag._id=bag.id='newBag';pouch._id=pouch.id='newPouch';rounds._id=rounds.id='newRounds';
    pouch.system.inventory.containerId='';rounds.system.inventory.containerId='';
    remapContainers({map:{bag:{item:bag,items:[pouch]},rounds:{item:rounds,items:[]}}});
    assert.equal(pouch.system.inventory.containerId,'newBag');assert.equal(rounds.system.inventory.containerId,'newPouch');
    assert.equal(pouch.system.inventory.containerKey,'newPouch');assert.equal(rounds.system.inventory.parentKey,'newPouch');
    remapContainers({map:{rounds:{item:rounds,items:[]}}});assert.equal(rounds.system.inventory.containerId,'');assert.equal(rounds.system.inventory.parentKey,'');
});
test('container transfer handler includes all descendants and leaves source untouched',()=>{
    const items=tree(), actor={items:new Collection(items.map(i=>[i.id,i]))};for(const i of items)i.parent=actor;
    const output=[];integrationConfig().ITEM_TYPE_HANDLERS.gear.transfer({item:items[0],items:output});
    assert.deepEqual(output.map(i=>i._id),['pouch','rounds']);assert.equal(items[2].system.inventory.containerId,'pouch');
});
test('merchant bundle expands prepared inventory arrays without changing the agreed price or wallets',()=>{
    const items=tree(),seller={items:new Collection(items.map(i=>[i.id,i]))},buyer={items:new Collection()};
    const root=items[0].toObject();root._id='destinationBag';root.flags={'dark-heresy':{containerOrigin:'bagKey'}};
    const sell={itemsToDelete:['bag'],itemsToCreate:[],itemsToUpdate:[],itemDeltas:[{item:items[0].toObject(),quantity:-1}],documentChanges:{'system.economy.credits':100}};
    const buy={itemsToCreate:[root],itemsToDelete:[],itemsToUpdate:[],itemDeltas:[],documentChanges:{'system.economy.credits':90}};
    let n=0;prepareContainerTrade(seller,sell,buyer,buy,()=>`new${++n}`);
    assert.deepEqual(sell.itemsToDelete,['bag','pouch','rounds']);assert.equal(buy.itemsToCreate.length,3);
    const [bag,pouch,rounds]=buy.itemsToCreate;assert.equal(pouch.system.inventory.containerId,bag._id);assert.equal(rounds.system.inventory.containerId,pouch._id);
    assert.equal(rounds.system.quantity,20);assert.equal(rounds.system.equipped,false);
    assert.equal(buy.documentChanges['system.economy.credits'],90);assert.equal(bag.system.price,10);
});
test('infinite-stock bundle copies contents; overlapping sale is rejected before expansion',()=>{
    const items=tree(),seller={items:new Collection(items.map(i=>[i.id,i]))},buyer={items:new Collection()};
    const root=items[0].toObject();root._id='copy';root.flags={'dark-heresy':{containerOrigin:'bagKey'}};
    const sell={itemsToDelete:[],itemDeltas:[]},buy={itemsToCreate:[root]};let n=0;
    prepareContainerTrade(seller,sell,buyer,buy,()=>`new${++n}`);assert.deepEqual(sell.itemsToDelete,[]);assert.equal(buy.itemsToCreate.length,3);
    const badSell={itemsToDelete:[],itemDeltas:[{item:items[1].toObject(),quantity:-1}]},badBuy={itemsToCreate:[structuredClone(root)]};
    assert.throws(()=>prepareContainerTrade(seller,badSell,buyer,badBuy,()=>`x${++n}`),/separately/);assert.equal(badBuy.itemsToCreate.length,1);
});
test('economy rejects negative or nonfinite balances and integration maps real schema paths',()=>{
    assert.throws(()=>validateMoney(-1));assert.throws(()=>validateMoney(Infinity));assert.equal(validateMoney(1.235),1.24);
    const config=integrationConfig();assert.equal(config.CURRENCIES[0].data.path,'system.economy.credits');assert.equal(config.ITEM_PRICE_ATTRIBUTE,'system.price');
    const original={type:'gear',system:{equipped:true,inventory:{isContainer:true,containerKey:'bag'}}};
    const copy=config.ITEM_TRANSFORMER(original);assert.equal(original.system.equipped,true);assert.equal(copy.flags['item-piles'].item.canStack,'no');
});
