import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFoundryAttackWorkflowBridge,serializeWorkflowRollData} from '../script/combat/foundry-attack-workflow.mjs';

const flag=(doc,key)=>doc.flags?.['dark-heresy']?.[key];
function setPath(object,path,value) {
    const keys=path.split('.'),last=keys.pop();let target=object;
    for(const key of keys) target=target[key]??={};target[last]=structuredClone(value);
}
async function fixture({hidden=false,suppression=false,area=null,hits=3}={}) {
    let counter=0;
    const gm={id:'gm',isGM:true,active:true},attackerUser={id:'attacker',isGM:false,active:true},defenderUser={id:'defender',isGM:false,active:true},outsider={id:'outsider',isGM:false,active:true};
    const users=new Map([gm,attackerUser,defenderUser,outsider].map(user=>[user.id,user]));users.activeGM=gm;
    const makeActor=(uuid,owner)=>({uuid,type:'acolyte',horde:0,testUserPermission:user=>user.isGM||user.id===owner});
    const attacker=makeActor('Actor.attacker','attacker'),defender=makeActor('Scene.scene.Token.target.Actor.defender','defender');
    const scene={id:'scene',uuid:'Scene.scene',tokens:new Map()};
    const token={id:'target',uuid:'Scene.scene.Token.target',actor:defender,name:'Target',hidden,parent:scene,object:{visible:true}};
    scene.tokens.set(token.id,token);
    const documents=new Map([[attacker.uuid,attacker],[defender.uuid,defender],[token.uuid,token]]),messages=new Map(),warnings=[];
    const game={user:gm,users,messages,scenes:new Map([[scene.id,scene]]),i18n:{localize:key=>key},socket:{emit:()=>{}}};
    const ChatMessage={create:async data=>{
        const id=data._id??`request${++counter}`,created={id,author:users.get(data.user),whisper:data.whisper??[],blind:!!data.blind,flags:{},content:data.content??'',rolls:data.rolls??[],updates:[]};
        for(const [key,value] of Object.entries(data.flags??{})) setPath(created.flags,key,value);
        created.update=async patch=>{created.updates.push(patch);for(const [key,value] of Object.entries(patch)) setPath(created,key,value);return created;};
        messages.set(id,created);return created;
    }};
    const calls={damage:0,apply:0,pinning:0,opened:[]};
    const runtime={game,ChatMessage,fromUuid:async uuid=>documents.get(uuid),ui:{notifications:{warn:text=>warnings.push(text)}},foundry:{utils:{randomID:()=>`attack${++counter}`},applications:{handlebars:{renderTemplate:async(_path,view)=>`<section class="dh-attack-workflow">${view.targets.map(row=>row.name+':'+row.status).join('|')}</section>`}}}};
    let bridge;
    const native={host:runtime,enabled:()=>true,actorFromRoll:data=>documents.get(data.actorUuid),getRollData:doc=>flag(doc,'rollData'),
        buildReaction:(_root,_row,type)=>({actorUuid:defender.uuid,target:{final:40},flags:{isAttack:false,isEvasion:type!=='suppression'}}),
        openReaction:async data=>calls.opened.push(data),unnaturalDosBonus:()=>0,
        computeRemaining:(_root,row,data)=>data.flags.isSuccess?Math.max(0,row.hits-data.dos):row.hits,
        rollDamage:async data=>{calls.damage++;data.damages=Array.from({length:data.numberOfHits},()=>({total:7,penetration:2,location:'body'}));return bridge.submitRoll(data);},
        applyDamage:async(_root,_row,operationId)=>{calls.apply++;return {receiptId:`receipt-${operationId}`,summary:{wounds:7}};},
        applyPinning:async()=>{calls.pinning++;},attackHits:data=>data.flags.isSuccess?Math.min(data.dos,3):0,
        renderRoll:async data=>`<article>Attack ${data.result}</article>`};
    bridge=createFoundryAttackWorkflowBridge(native);
    const data={actorUuid:attacker.uuid,ownerId:'attacker',name:'Autogun',actorName:'Guard',itemId:'weapon',numberOfHits:hits,
        result:20,unmodifiedResult:20,target:{final:40},dos:3,dof:0,attackDos:3,attackResult:20,shotsFired:3,
        weapon:{isRange:true,traits:{},clip:{value:20,max:30}},flags:{isAttack:true,isSuccess:true},
        attackType:{name:suppression?'suppression':'full_auto'},targets:[{sceneId:'scene',tokenId:'target',name:'Target'}]};
    if(area)data.attackArea={kind:area};
    const chatData={user:gm.id,content:'<article>Original attack</article>',flags:{'dark-heresy.rollData':data}};
    await bridge.create(data,chatData);const root=await ChatMessage.create(chatData);
    const request=async(action,{user=gm,resultData,operationId,rolls=[],expectedGeneration=flag(root,'combatWorkflow').generation,tokenUuid=token.uuid,targetHits}={})=>{
        const spec={workflowId:root.id,tokenUuid,expectedGeneration,action};
        if(resultData)spec.resultData=resultData;if(operationId)spec.operationId=operationId;if(targetHits)spec.targetHits=targetHits;
        const req=await ChatMessage.create({user:user.id,blind:true,whisper:[gm.id],rolls,flags:{'dark-heresy.combatWorkflowRequest':spec}});
        await bridge.processRequest(req.id);return req;
    };
    const reaction=(operationId,{result=20,target=40,success=true,type='dodge',dos=3,dof=0}={})=>({actorUuid:defender.uuid,result,
        unmodifiedResult:result,target:{final:target,modifier:0},flags:{isAttack:false,isEvasion:true,isSuccess:success},dos,dof,
        workflow:{messageId:root.id,tokenUuid:token.uuid,generation:flag(root,'combatWorkflow').generation,action:type,operationId}});
    return {bridge,native,game,runtime,ChatMessage,root,data,calls,warnings,request,reaction,token,documents,attacker,defender,
        gm,attackerUser,defenderUser,outsider,messages,state:()=>flag(root,'combatWorkflow')};
}

test('creates a single root card with immutable attack roll data and exact target actors; hidden attacks whisper GMs',async()=>{
    const f=await fixture({hidden:true});
    assert.equal(f.data.workflowRootMessageId,f.root.id);assert.equal(f.state().targets[0].actorUuid,f.defender.uuid);
    assert.equal(f.state().targets[0].name,'');assert.deepEqual(f.root.whisper,['gm']);assert.equal(f.root.blind,true);
    assert.match(f.root.content,/Original attack/);assert.equal(f.messages.size,1);
    f.game.users.activeGM=null;assert.equal(f.bridge.enabled(f.data),false);
});

test('authored defender result updates the root card and wrong authors or dice evidence are refused',async()=>{
    const f=await fixture();
    const denied=await f.request('dodge',{user:f.outsider});
    assert.equal(flag(denied,'combatWorkflowRequestStatus').status,'error');assert.equal(f.state().targets[0].phase,'reaction');
    const claim=await f.request('dodge',{user:f.defenderUser});assert.equal(f.state().targets[0].phase,'reacting');
    const data=f.reaction(claim.id);
    const forged=await f.request('reactionResult',{user:f.defenderUser,operationId:claim.id,resultData:data,rolls:[{total:80}]});
    assert.equal(flag(forged,'combatWorkflowRequestStatus').status,'error');assert.equal(f.state().targets[0].phase,'reacting');
    const result=await f.request('reactionResult',{user:f.defenderUser,operationId:claim.id,resultData:data,rolls:[{total:20}]});
    assert.equal(flag(result,'combatWorkflowRequestStatus').status,'complete');assert.equal(f.state().targets[0].remainingHits,0);
    assert.equal(f.state().targets[0].phase,'resolved');assert.equal(f.state().targets[0].reaction.rollData,null);
    assert.equal(flag(f.root,'rollData').result,20);assert.equal(flag(f.root,'rollData').flags.isAttack,true);
});

test('native damage and confirmed application stay in the original card and duplicate requests never repeat them',async()=>{
    const f=await fixture();
    await f.bridge.request('decline',f.root.id,f.token.uuid);
    const rolled=await f.bridge.request('damage',f.root.id,f.token.uuid);
    assert.equal(f.calls.damage,1);assert.equal(f.state().targets[0].phase,'readyApply');
    assert.equal(f.state().targets[0].damage.total,21);assert.equal(f.messages.size,3);
    await f.bridge.processRequest(rolled.request.id);assert.equal(f.calls.damage,1);
    const applied=await f.bridge.request('apply',f.root.id,f.token.uuid);
    assert.equal(f.calls.apply,1);assert.equal(f.state().targets[0].phase,'applied');
    await f.bridge.processRequest(applied.request.id);assert.equal(f.calls.apply,1);
    assert.equal(f.bridge.canReroll(flag(f.root,'rollData')),false);
});

test('ambiguous native application failure persists needsReview and error requests are never replayed',async()=>{
    const f=await fixture();await f.request('decline');await f.request('damage');
    f.native.applyDamage=async()=>{f.calls.apply++;throw Error('backend lost acknowledgement');};
    const failed=await f.request('apply');
    assert.equal(flag(failed,'combatWorkflowRequestStatus').status,'error');
    assert.equal(f.state().targets[0].phase,'needsReview');assert.equal(f.calls.apply,1);
    await f.bridge.processRequest(failed.id);await f.request('apply');assert.equal(f.calls.apply,1);
});

test('suppression validates the pending claim before pinning and a replay cannot apply a condition twice',async()=>{
    const f=await fixture({suppression:true,hits:0});
    const claim=await f.request('suppression',{user:f.defenderUser});
    const data=f.reaction(claim.id,{result:80,success:false,type:'suppression',dos:0,dof:5});
    await f.request('suppressionResult',{user:f.defenderUser,operationId:claim.id,resultData:data,rolls:[{total:80}]});
    assert.equal(f.calls.pinning,1);assert.equal(f.state().targets[0].pinning.conditionApplied,true);
    await f.request('suppressionResult',{user:f.defenderUser,operationId:claim.id,resultData:data,rolls:[{total:80}]});
    assert.equal(f.calls.pinning,1);
});

test('pinning failure after possible mutation requires GM review and is never silently retried',async()=>{
    const f=await fixture({suppression:true,hits:0});const claim=await f.request('suppression');
    f.native.applyPinning=async()=>{f.calls.pinning++;throw Error('condition save unknown');};
    const data=f.reaction(claim.id,{result:80,success:false,type:'suppression',dos:0,dof:5});
    const result=await f.request('suppressionResult',{operationId:claim.id,resultData:data,rolls:[{total:80}]});
    assert.equal(f.state().targets[0].pinning.phase,'needsReview');assert.equal(f.calls.pinning,1);
    await f.bridge.processRequest(result.id);assert.equal(f.calls.pinning,1);
});

test('Fate reroll updates state, native header and root evidence in a single write while preserving the weapon snapshot',async()=>{
    const f=await fixture();const data={...structuredClone(f.data),result:40,unmodifiedResult:40,dos:1,dof:0,numberOfHits:100,
        flags:{isAttack:true,isSuccess:true,isReRoll:true},weapon:{damageFormula:'999d100'}};
    const before=f.root.updates.length;
    const result=await f.request('reroll',{tokenUuid:null,resultData:data,rolls:[{total:40}]});
    assert.equal(flag(result,'combatWorkflowRequestStatus').status,'complete');assert.equal(f.root.updates.length,before+1);
    assert.equal(f.state().generation,1);assert.equal(f.state().attack.hits,1);assert.equal(flag(f.root,'rollData').result,40);
    assert.equal(flag(f.root,'rollData').weapon.damageFormula,undefined);assert.match(f.root.content,/Attack 40/);
});

test('workflow serialization removes executable/live objects while preserving repeated values and harmless cycles',()=>{
    const shared={value:3},input={one:shared,two:shared,rollObject:{evaluate(){}},damages:[{damageRoll:{total:8},total:8}]};input.self=input;
    assert.deepEqual(serializeWorkflowRollData(input),{one:{value:3},two:{value:3},damages:[{total:8}]});
});

test('area preparation is available before targets but no empty workflow card is created',async()=>{
    const f=await fixture(),data={...structuredClone(f.data),targets:[],weapon:{...f.data.weapon,traits:{blast:3}}};
    assert.equal(f.bridge.enabled(data),true);
    const chat={content:'ordinary',flags:{}};await f.bridge.create(data,chat);
    assert.deepEqual(chat,{content:'ordinary',flags:{}});
});

test('cancel and close callbacks release one reaction claim through only one authored request',async()=>{
    const f=await fixture();await f.bridge.startReaction(f.root.id,f.token.uuid,'dodge');
    const data=f.calls.opened[0];assert.equal(f.state().targets[0].phase,'reacting');
    await Promise.all([f.bridge.cancelRoll(data),f.bridge.cancelRoll(data)]);
    assert.equal(f.state().targets[0].phase,'reaction');assert.equal(f.messages.size,3);
});

test('another missing target does not block a surviving target, while actor substitution is refused',async()=>{
    const f=await fixture();
    const other=structuredClone(f.state().targets[0]);other.tokenUuid='Scene.scene.Token.deleted';other.actorUuid='Actor.deleted';
    other.hits=0;other.remainingHits=0;other.phase='resolved';f.state().targets.push(other);
    const result=await f.request('decline');assert.equal(flag(result,'combatWorkflowRequestStatus').status,'complete');
    f.token.actor={uuid:'Actor.replacement',testUserPermission:()=>true};
    const denied=await f.request('damage');assert.equal(flag(denied,'combatWorkflowRequestStatus').status,'error');assert.equal(f.calls.damage,0);
});

test('native damage failure requires review and cannot be replayed by a later request',async()=>{
    const f=await fixture();await f.request('decline');
    f.native.rollDamage=async()=>{f.calls.damage++;throw Error('dice persistence failed');};
    const failed=await f.request('damage');assert.equal(f.state().targets[0].phase,'needsReview');
    await f.bridge.processRequest(failed.id);await f.request('damage');assert.equal(f.calls.damage,1);
});

test('private command journals are hidden from rendered chat without revealing their contents',async()=>{
    const f=await fixture(),request=await f.request('decline'),container={hidden:false};
    await f.bridge.activate(request,{closest:selector=>{assert.equal(selector,'li.message');return container;}});
    assert.equal(container.hidden,true);
});
