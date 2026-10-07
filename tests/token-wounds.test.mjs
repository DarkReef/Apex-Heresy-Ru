import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tokenWoundsUpdate,woundsTokenDocument} from '../script/combat/token-wounds.mjs';
test('OW token bar preserves negative remaining and delegates other rulesets',()=>{
 const Base=class{getBarAttribute(){return {type:'bar',value:10,max:10};}};
 const Token=woundsTokenDocument(Base,a=>({id:a.ruleset}));const token=new Token();token.bar1={attribute:'wounds'};token.actor={ruleset:'ow',system:{wounds:{max:10,value:10,critical:5}}};
 assert.equal(token.getBarAttribute('bar1').value,-5);token.actor.ruleset='dh2';assert.equal(token.getBarAttribute('bar1').value,10);
});
test('token absolute and relative edits cross zero without changing stored damage semantics',()=>{
 const a={_source:{system:{wounds:{max:10,value:9,critical:0}}}};
 assert.deepEqual(tokenWoundsUpdate(a,-5),{'system.wounds.value':10,'system.wounds.critical':5});
 assert.deepEqual(tokenWoundsUpdate(a,-2,true),{'system.wounds.value':10,'system.wounds.critical':1});
 a._source.system.wounds={max:10,value:10,critical:5};assert.deepEqual(tokenWoundsUpdate(a,7,true),{'system.wounds.value':8,'system.wounds.critical':0});
 assert.throws(()=>tokenWoundsUpdate(a,NaN));
});
