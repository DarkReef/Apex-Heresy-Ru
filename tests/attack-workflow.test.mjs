import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAttackWorkflow,transitionAttackWorkflow,attackWorkflowView,createAttackWorkflowController}
    from '../script/combat/attack-workflow.mjs';

const first='Scene.scene.Token.one',second='Scene.scene.Token.two';
const gm={userId:'gm',isGM:true,ownsAttacker:true,ownsTarget:true};
const attacker={userId:'attacker',ownsAttacker:true,ownsTarget:false};
const defender={userId:'defender',ownsTarget:row=>row?.tokenUuid===first};
const roll=(extra={})=>({name:'Autogun',result:18,target:{final:45},dos:3,dof:0,numberOfHits:3,
    flags:{isSuccess:true},attackType:{name:'full_auto'},targets:[
        {tokenUuid:first,actorUuid:'Actor.guard',name:'Guard'},
        {tokenUuid:second,actorUuid:'Actor.guard',name:'Guard'}],...extra});
const fixture=(data=roll(),options={})=>createAttackWorkflow(data,{id:'attack',attackerUuid:'Actor.shooter',createdBy:'attacker',...options});
const change=(state,type,extra={},context=gm)=>transitionAttackWorkflow(state,{type,tokenUuid:first,
    operationId:`${type}-operation`,...extra},context);
const noReaction=state=>change(state,'declineReaction');
const reaction={type:'dodge',result:32,target:50,success:true,dos:2,dof:0,modifiers:'+10 armour'};
const damageData={damages:[{total:12,penetration:3,location:'body'},{total:8,penetration:3,location:'body'}]};
const readyDamage=()=>{
    let state=noReaction(fixture());state=change(state,'damageStart',{operationId:'damage'});
    return change(state,'damageResolved',{operationId:'damage',rollData:damageData});
};

test('exact token rows stay separate, immutable and never clone burst hits onto every target',()=>{
    const data=roll(),state=fixture(data);
    assert.deepEqual(state.targets.map(row=>row.hits),[3,0]);
    assert.equal(state.targets[0].actorUuid,state.targets[1].actorUuid);
    assert.notEqual(state.targets[0].tokenUuid,state.targets[1].tokenUuid);
    data.targets[0].name='Edited';assert.equal(state.targets[0].name,'Guard');
    assert.throws(()=>fixture(roll({targets:[{tokenId:'one'}]})),/Exact target/);
    assert.throws(()=>fixture(roll({targets:[roll().targets[0],roll().targets[0]]})),/Duplicate target/);
    const next=noReaction(state);assert.equal(state.targets[0].reaction,null);assert.equal(next.targets[0].phase,'damage');
});

test('only target owners resolve reactions; attackers roll damage and only GM confirms it',()=>{
    let state=fixture();
    assert.throws(()=>change(state,'declineReaction',{},attacker),/ownership/);
    assert.throws(()=>change(state,'declineReaction',{tokenUuid:second},defender),/ownership/);
    state=change(state,'reactionStart',{operationId:'react'},defender);
    state=change(state,'reactionResolved',{operationId:'react',result:reaction,remainingHits:1},defender);
    assert.equal(state.targets[0].remainingHits,1);
    assert.deepEqual(state.targets[0].reaction,{...reaction,rollData:null});
    assert.throws(()=>change(state,'damageStart',{},defender),/ownership/);
    state=change(state,'damageStart',{operationId:'damage'},attacker);
    state=change(state,'damageResolved',{operationId:'damage',rollData:damageData},attacker);
    assert.throws(()=>change(state,'applyStart',{},attacker),/Only the GM/);
    state=change(state,'applyStart',{operationId:'apply'});
    state=change(state,'applied',{operationId:'apply',receiptId:'native-receipt'});
    assert.equal(state.targets[0].phase,'applied');
    assert.deepEqual(state.targets[0].applied,{receiptId:'native-receipt'});
    assert.throws(()=>change(state,'rerollAttack',{rollData:roll()}),/committed/);
});

test('invalid remaining hits, foreign tokens, premature damage and invalid totals are refused',()=>{
    let state=fixture();
    assert.throws(()=>change(state,'damageStart'),/not available/);
    assert.throws(()=>change(state,'declineReaction',{tokenUuid:'Scene.other.Token.one'}),/not recorded/);
    state=change(state,'reactionStart',{operationId:'r'});
    assert.throws(()=>change(state,'reactionResolved',{operationId:'r',result:reaction,remainingHits:4}),/remaining hits/);
    assert.throws(()=>change(state,'reactionResolved',{operationId:'other',result:reaction,remainingHits:1}),/claim/);
    state=change(state,'reactionResolved',{operationId:'r',result:reaction,remainingHits:0});
    assert.equal(state.targets[0].phase,'resolved');
    state=change(noReaction(fixture()),'damageStart',{operationId:'d'});
    for(const total of [NaN,-1,Infinity]) assert.throws(()=>change(state,'damageResolved',{operationId:'d',rollData:{damages:[{total}]}}),/Native damage/);
});

test('GM allocations respect a single burst budget and lock after reactions; areas use per-target limits',()=>{
    let state=change(fixture(),'allocateHits',{targetHits:{[first]:1,[second]:2}});
    assert.deepEqual(state.targets.map(row=>row.hits),[1,2]);
    assert.throws(()=>change(state,'allocateHits',{targetHits:{[first]:2,[second]:2}}),/exceed/);
    assert.throws(()=>change(state,'allocateHits',{targetHits:{[first]:1}},attacker),/Only the GM/);
    assert.throws(()=>change(noReaction(state),'allocateHits',{targetHits:{[first]:3}}),/locked/);
    assert.throws(()=>change(state,'allocateHits',{targetHits:{'Scene.scene.Token.other':1}}),/Unknown/);
    const area=fixture(roll({numberOfHits:1}),{area:true,targetHits:{[first]:1,[second]:1}});
    assert.deepEqual(area.targets.map(row=>row.hits),[1,1]);
    assert.throws(()=>change(area,'allocateHits',{targetHits:{[first]:2}}),/exceed/);
});

test('suppression pinning is independent from hit evasion and still required on a complete miss',()=>{
    let state=fixture(roll({numberOfHits:0,flags:{isSuccess:false},attackType:{name:'suppression'}}));
    assert.deepEqual(state.targets.map(row=>[row.phase,row.pinning.phase]),[['resolved','pending'],['resolved','pending']]);
    state=change(state,'pinningStart',{operationId:'p'},defender);
    state=change(state,'pinningResolved',{operationId:'p',result:{...reaction,type:'suppression',success:false,dos:0,dof:2},conditionApplied:true},defender);
    assert.equal(state.targets[0].phase,'resolved');assert.equal(state.targets[0].reaction,null);
    assert.equal(state.targets[0].pinning.conditionApplied,true);
    assert.throws(()=>change(state,'rerollAttack',{rollData:roll()}),/committed/);
    let hit=fixture(roll({attackType:{name:'suppression'}}));
    hit=change(hit,'pinningStart',{operationId:'p'});
    hit=change(hit,'pinningResolved',{operationId:'p',result:{...reaction,type:'suppression'},conditionApplied:false});
    assert.equal(hit.targets[0].phase,'reaction');
    hit=change(hit,'reactionStart',{operationId:'r'});
    hit=change(hit,'reactionResolved',{operationId:'r',result:reaction,remainingHits:1});
    assert.equal(hit.targets[0].remainingHits,1);
});

test('Fate invalidates prior reaction and damage results but rejects stale-generation commands',()=>{
    let state=readyDamage();
    state=change(state,'rerollAttack',{rollData:roll({numberOfHits:1,result:24})},attacker);
    assert.equal(state.generation,1);assert.equal(state.attack.result,24);
    assert.equal(state.targets[0].phase,'reaction');assert.equal(state.targets[0].damage,null);
    assert.equal(state.targets[0].reaction,null);
    assert.throws(()=>change(state,'declineReaction',{expectedGeneration:0}),/replaced/);
});

test('view uses client rights, excludes hidden rows, gives result tooltip without health/defence data',()=>{
    const data=roll();data.targets[1]={...data.targets[1],name:'Secret daemon',hidden:true};
    let state=fixture(data);
    assert.equal(state.targets[1].name,'');
    state=change(state,'reactionStart',{operationId:'r'});
    state=change(state,'reactionResolved',{operationId:'r',result:reaction,remainingHits:1});
    const view=attackWorkflowView(state,{...attacker,canSeeTarget:row=>!row.hidden});
    assert.equal(view.targets.length,1);assert.equal(view.targets[0].canDamage,true);assert.equal(view.targets[0].canApply,false);
    assert.match(view.targets[0].reactionTooltip,/32\/50; \+10 armour/);
    assert.match(view.targets[0].reactionText,/2 ст. успеха/);
    assert.equal(attackWorkflowView(state,gm).targets.length,2);
});

function service(state=fixture(),{save:customSave,isAuthority=()=>true}={}) {
    let current=structuredClone(state);const writes=[],events=[];
    const controller=createAttackWorkflowController({
        load:async()=>structuredClone(current),
        save:async(id,next)=>{writes.push(structuredClone(next));events.push(next.targets[0].phase);if(customSave)await customSave(next);current=structuredClone(next);},
        context:async(id,evidence)=>{if(!evidence?.trusted)throw Error('No authored evidence');return evidence.user??gm;},
        verify:async(id,command,evidence)=>{if(!evidence?.trusted)throw Error('No native evidence');},isAuthority
    });
    return {controller,writes,events,state:()=>structuredClone(current)};
}

test('controller persists claim first and serializes repeated/concurrent native operations exactly once',async()=>{
    const fixture=service(noReaction(createAttackWorkflow(roll(),{id:'attack',attackerUuid:'Actor.a',createdBy:'attacker'})));
    const command={type:'damageStart',tokenUuid:first,operationId:'d'};let calls=0;
    const producer=async()=>{calls++;assert.equal(fixture.state().targets[0].phase,'damaging');await Promise.resolve();return {rollData:damageData};};
    const result=await Promise.all([
        fixture.controller.perform('attack',command,{trusted:true},producer),
        fixture.controller.perform('attack',command,{trusted:true},producer)]);
    assert.equal(calls,1);assert.equal(result[1].duplicate,true);
    assert.deepEqual(fixture.events,['damaging','readyApply']);assert.equal(fixture.state().targets[0].damage.total,20);
    assert.throws(()=>change(fixture.state(),'declineReaction',{operationId:'d'}),/reused/);
});

test('ambiguous native failure becomes review marker, repeated click never replays application',async()=>{
    const fixture=service(readyDamage());let applications=0;
    const command={type:'applyStart',tokenUuid:first,operationId:'apply'};
    const producer=async()=>{applications++;throw Error('Connection lost after Actor update');};
    await assert.rejects(fixture.controller.perform('attack',command,{trusted:true},producer),/Connection lost/);
    assert.equal(fixture.state().targets[0].phase,'needsReview');
    await fixture.controller.perform('attack',command,{trusted:true},producer);
    assert.equal(applications,1);assert.equal(fixture.state().targets[0].phase,'needsReview');
});

test('pre-roll cancellation releases the claim without a result or replay of the cancelled request',async()=>{
    const fixture=service();let calls=0;
    const command={type:'reactionStart',tokenUuid:first,operationId:'r'};
    const producer=async()=>{calls++;return {cancelled:true};};
    await fixture.controller.perform('attack',command,{trusted:true,user:defender},producer);
    assert.equal(fixture.state().targets[0].phase,'reaction');assert.equal(fixture.state().targets[0].reaction,null);
    await fixture.controller.perform('attack',command,{trusted:true,user:defender},producer);assert.equal(calls,1);
});

test('untrusted evidence and authority handoff prevent persistence/native execution',async()=>{
    const fixture=service();let calls=0;
    await assert.rejects(fixture.controller.perform('attack',{type:'reactionStart',tokenUuid:first,operationId:'r'},{},async()=>{calls++;}),/evidence/);
    assert.equal(calls,0);assert.equal(fixture.writes.length,0);
    const passive=service(undefined,{isAuthority:()=>false});
    await assert.rejects(passive.controller.dispatch('attack',{type:'declineReaction',tokenUuid:first,operationId:'n'},{trusted:true}),/active GM/);
    assert.equal(passive.writes.length,0);
    let checks=0;const changed=service(undefined,{isAuthority:()=>++checks===1});
    await assert.rejects(changed.controller.dispatch('attack',{type:'declineReaction',tokenUuid:first,operationId:'n'},{trusted:true}),/changed/);
    assert.equal(changed.writes.length,0);
});

test('failed state persistence leaves the original state unchanged and does not roll',async()=>{
    const fixture=service(undefined,{save:async()=>{throw Error('write failed');}});let calls=0;
    await assert.rejects(fixture.controller.perform('attack',{type:'reactionStart',tokenUuid:first,operationId:'r'},
        {trusted:true},async()=>{calls++;}),/write failed/);
    assert.equal(calls,0);assert.equal(fixture.state().targets[0].phase,'reaction');
});

test('Blast shares exactly one native damage pool and waits for each target reaction before applying its slice',async()=>{
    const data=roll({attackArea:{kind:'blast'},numberOfHits:2});
    let state=fixture(data,{targetHits:{[first]:2,[second]:2}});
    state=change(state,'reactionStart',{operationId:'r'});
    state=change(state,'reactionResolved',{operationId:'r',result:reaction,remainingHits:1});
    const fixtureService=service(state);let rolls=0;
    const command={type:'damageStart',tokenUuid:first,operationId:'d'};
    await fixtureService.controller.perform('attack',command,{trusted:true},async()=>{rolls++;return {rollData:damageData};});
    state=fixtureService.state();
    assert.equal(state.sharedDamage.phase,'rolled');
    assert.equal(state.targets[0].phase,'readyApply');assert.equal(state.targets[0].damage.total,12);
    assert.equal(state.targets[0].damage.rollData.damages.length,1);
    assert.equal(state.targets[0].damage.rollData.targets[0].tokenUuid,first);
    assert.equal(state.targets[1].phase,'reaction');assert.equal(state.targets[1].damage,null);
    state=change(state,'declineReaction',{tokenUuid:second,operationId:'no-two'});
    assert.equal(state.targets[1].phase,'readyApply');assert.equal(state.targets[1].damage.total,20);
    assert.deepEqual(state.targets[1].damage.rollData.damages,damageData.damages);
    const done=service(state);
    await done.controller.perform('attack',{type:'damageStart',tokenUuid:second,operationId:'another'},
        {trusted:true},async()=>{rolls++;return {rollData:damageData};});
    assert.equal(rolls,1);
});

test('Blast simultaneous damage clicks for different targets produce only one shared roll',async()=>{
    let state=fixture(roll({attackArea:{kind:'blast'},numberOfHits:2}),{targetHits:{[first]:2,[second]:2}});
    state=noReaction(state);state=change(state,'declineReaction',{tokenUuid:second,operationId:'no-two'});
    const fixtureService=service(state);let rolls=0;
    await Promise.all([first,second].map((tokenUuid,index)=>fixtureService.controller.perform('attack',
        {type:'damageStart',tokenUuid,operationId:`damage-${index}`},{trusted:true},async()=>{rolls++;return {rollData:damageData};})));
    assert.equal(rolls,1);
    const final=fixtureService.state();
    assert.equal(final.targets[0].damage.total,20);assert.equal(final.targets[1].damage.total,20);
    assert.notEqual(final.targets[0].damage.rollData.targets[0].tokenUuid,final.targets[1].damage.rollData.targets[0].tokenUuid);
});

test('Blast rejects reduced pools that could give later targets missing damage dice',()=>{
    let state=fixture(roll({attackArea:{kind:'blast'},numberOfHits:2}),{targetHits:{[first]:2,[second]:2}});
    state=noReaction(state);state=change(state,'damageStart',{operationId:'d'});
    assert.throws(()=>change(state,'damageResolved',{operationId:'d',rollData:{damages:[{total:12}]}}),/Full native Blast/);
});

test('Spray offers native Agility check, never Dodge or Parry',()=>{
    let state=fixture(roll({attackArea:{kind:'spray'},numberOfHits:1}),{targetHits:{[first]:1,[second]:1}});
    const view=attackWorkflowView(state,{userId:'defender',ownsTarget:true});
    assert.equal(view.targets[0].canReact,true);assert.equal(view.targets[0].canParry,false);
    assert.match(view.targets[0].dodgeLabel,/Ловкости/);
    state=change(state,'reactionStart',{operationId:'r'});
    assert.throws(()=>change(state,'reactionResolved',{operationId:'r',result:reaction,remainingHits:0}),/does not match/);
    state=change(state,'reactionResolved',{operationId:'r',result:{...reaction,type:'agility'},remainingHits:0});
    assert.equal(state.targets[0].phase,'resolved');
});

test('application summary and field interception stay inline; trusted false releases pre-write apply claim',async()=>{
    let state=change(readyDamage(),'applyStart',{operationId:'apply'});
    state=change(state,'applied',{operationId:'apply',receiptId:'field-receipt',summary:'Силовое поле остановило атаку',field:{blocked:true}});
    assert.deepEqual(state.targets[0].applied,{receiptId:'field-receipt',summary:'Силовое поле остановило атаку',field:{blocked:true}});
    const fixtureService=service(readyDamage());
    await fixtureService.controller.perform('attack',{type:'applyStart',tokenUuid:first,operationId:'cancel'},
        {trusted:true},async()=>false);
    assert.equal(fixtureService.state().targets[0].phase,'readyApply');assert.equal(fixtureService.state().targets[0].applied,null);
});

test('repeated Fate command does not replace the attack twice and view data cannot mutate stored state',()=>{
    let state=change(fixture(),'rerollAttack',{rollData:roll({numberOfHits:1}),operationId:'fate'},attacker);
    const repeated=change(state,'rerollAttack',{rollData:roll({numberOfHits:2}),operationId:'fate'},attacker);
    assert.equal(repeated.generation,1);assert.equal(repeated.attack.hits,1);
    state=readyDamage();const view=attackWorkflowView(state,gm);
    view.targets[0].damage.rollData.damages[0].total=999;
    assert.equal(state.targets[0].damage.rollData.damages[0].total,12);
});

test('ranged attack view does not offer the parry action rejected by native rules',()=>{
    const state=fixture(roll({weapon:{isRange:true}}));
    const view=attackWorkflowView(state,{userId:'defender',ownsTarget:true});
    assert.equal(view.targets[0].canReact,true);assert.equal(view.targets[0].canParry,false);
});
