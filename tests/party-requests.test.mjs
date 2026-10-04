import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRequest,canRespond,acceptedResponses} from '../script/party/requests.mjs';
const actor={uuid:'Actor.a',testUserPermission:user=>user.id==='owner'};
test('requests require one valid test, bounded modifier and unique recipients',()=>{
    assert.throws(()=>validateRequest({actorUuids:[],skill:'dodge'}));
    assert.throws(()=>validateRequest({actorUuids:['Actor.a'],characteristic:'agility',skill:'dodge'}));
    assert.throws(()=>validateRequest({actorUuids:['Actor.a'],skill:'dodge',modifier:Infinity}));
    assert.deepEqual(validateRequest({actorUuids:['Actor.a','Actor.a'],skill:'dodge',modifier:'10'}).actorUuids,['Actor.a']);
});
test('only owners or GM respond to included actors while requests remain open',()=>{
    const request={actorUuids:['Actor.a'],closed:false};
    assert.equal(canRespond(request,actor,{id:'owner'}),true);assert.equal(canRespond(request,actor,{id:'other'}),false);
    assert.equal(canRespond({...request,closed:true},actor,{isGM:true}),false);assert.equal(canRespond({actorUuids:[]},actor,{id:'owner'}),false);
});
test('aggregation rejects impersonation and duplicate results and respects blind visibility',()=>{
    const request={actorUuids:['Actor.a']}, response={requestId:'r',actorUuid:'Actor.a',roll:34,target:40,success:true,degrees:2};
    const message=(author,value=response)=>({author:{id:author},getFlag:()=>value});
    const users=new Map([['owner',{id:'owner'}],['other',{id:'other'}]]);
    assert.equal(acceptedResponses([message('other')],'r',request,()=>actor,id=>users.get(id)).size,0);
    const result=acceptedResponses([message('owner'),message('owner',{...response,roll:20})],'r',request,()=>actor,id=>users.get(id));
    assert.equal(result.get('Actor.a').roll,34);
    assert.equal(acceptedResponses([{...message('owner'),isContentVisible:false}],'r',request,()=>actor,id=>users.get(id)).size,0);
    assert.equal(acceptedResponses([message('owner',{...response,roll:101})],'r',request,()=>actor,id=>users.get(id)).size,0);
});
