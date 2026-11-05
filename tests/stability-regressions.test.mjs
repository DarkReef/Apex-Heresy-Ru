import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildEffectClockUpdate,restartEffectClockUpdate,processEffectBoundary,EFFECT_CLOCK_EXPIRY} from '../script/combat/effect-clock.mjs';
import {loadSystem,actorWithEffects,effect as makeEffect} from './helpers/system.mjs';
import {createFoundryAttackWorkflowBridge} from '../script/combat/foundry-attack-workflow.mjs';

test('private workflow journals bypass generic roll controls and remain hidden with Foundry message flex styling',()=>{
    for(const isGM of [false,true]) {
        const s=loadSystem();s.context.game.user={id:isGM?'gm':'player',isGM};
        s.context.__renderCalls=[];
        s.get('_addApplyRollButtons = () => __renderCalls.push("apply"); _combatWorkflow = () => {__renderCalls.push("workflow"); return {activate:async()=>{}}}; _activateShipChatListeners = () => __renderCalls.push("ship")');
        const request={id:'journal',isOwner:true,blind:true,rolls:[{total:55}],
            flags:{'dark-heresy':{combatWorkflowRequest:{workflowId:'root',action:'reactionResult'},
                combatWorkflowRequestStatus:{status:'complete'}}}};
        const flags=structuredClone(request.flags),container={hidden:false,style:{display:'flex'}};
        const html={closest:selector=>{assert.equal(selector,'li.message');return container;},
            querySelectorAll:()=>{throw Error('private journals must not enter ordinary card rendering');}};
        for(const render of s.listeners.get('renderChatMessageHTML')) render(request,html,{});
        assert.equal(container.hidden,true);
        assert.equal(container.style.display,'none');
        assert.equal(s.context.__renderCalls.length,0,'private journals must return before apply/heal or other card listeners');
        assert.deepEqual(request.flags,flags,'the private persisted receipt remains available to GM recovery');
    }
});

test('ordinary roll cards still enter normal render handlers after the private-journal guard',()=>{
    const s=loadSystem();s.context.__renderCalls=[];
    s.get('_addApplyRollButtons = () => __renderCalls.push("apply"); _combatWorkflow = () => ({activate:async()=>{__renderCalls.push("workflow")}}); _activateShipChatListeners = () => __renderCalls.push("ship")');
    const html={hidden:false,style:{display:'flex'},querySelectorAll:()=>[]};
    for(const render of s.listeners.get('renderChatMessageHTML')) render({flags:{},rolls:[{total:55}]},html,{});
    assert.deepEqual(Array.from(s.context.__renderCalls),['apply','workflow','ship']);
    assert.equal(html.hidden,false);assert.equal(html.style.display,'flex');
});

/** Foundry's nested document updates merge objects and honor explicit deletion keys. */
function mergeUpdate(target,updates) {
    for(const [path,value] of Object.entries(updates)) {
        const keys=path.split('.');let object=target;
        while(keys.length>1)object=object[keys.shift()]??={};
        const key=keys[0];
        if(key.startsWith('-=')){delete object[key.slice(2)];continue;}
        if(value&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof Set)){
            object[key]??={};mergeUpdate(object[key],value);
        } else object[key]=structuredClone(value);
    }
}

function clockFixture() {
    const actor={id:'target',uuid:'Actor.target',documentName:'Actor',effects:[],items:[]};
    const other={id:'other',uuid:'Actor.other'};
    const turns=[{id:'targetTurn',actor},{id:'otherTurn',actor:other}];
    const combat={id:'battle',started:true,round:1,turn:0,combatant:turns[0],turns,combatants:turns,
        previous:{round:0,turn:null},current:{round:1,turn:0}};
    const gm={id:'gm',isGM:true},game={user:gm,users:{activeGM:gm},actors:[actor],scenes:[]};
    const effect={id:'timed',uuid:'Actor.target.ActiveEffect.timed',actor,parent:actor,flags:{},disabled:false,
        duration:{value:null,units:'seconds',expiry:null,expired:false},start:{time:0},
        async update(patch){mergeUpdate(this,patch);return this;}};
    actor.effects.push(effect);
    mergeUpdate(effect,buildEffectClockUpdate(effect,{mode:'targetStart',combat,worldTime:1}));
    return {actor,effect,combat,game,turns};
}

test('a manually disabled scheduled effect still expires at its deadline and cannot revive one round late',async()=>{
    const f=clockFixture();f.effect.disabled=true;
    Object.assign(f.combat,{round:2,turn:0,previous:{round:1,turn:1},current:{round:2,turn:0}});
    await processEffectBoundary(f.combat,f.turns[0],'start',{round:2,turn:0},{game:f.game});
    assert.equal(f.effect.duration.expired,true,'disabling an effect must not pause its absolute deadline');
    f.effect.disabled=false;
    assert.equal(f.effect.duration.expired,true,'reenabling after the boundary must not reactivate an expired bonus');
});

test('reapplying a dormant condition with a new native duration discards its old custom expiry schedule',async()=>{
    const s=loadSystem();s.context.CONST.ACTIVE_EFFECT_SHOW_ICON={ALWAYS:2};
    s.context.ActiveEffect.getEffectStart=()=>({time:500,combat:'battle',round:4,turn:1});
    const old=makeEffect('stunned',{disabled:true,active:false,isSuppressed:true,
        duration:{value:null,units:'seconds',expiry:EFFECT_CLOCK_EXPIRY,expired:true},
        flags:{'dark-heresy':{key:'stunned',type:'minor',effectClock:{version:1,mode:'targetStart',combatId:'battle',
            dueRound:2,referenceCombatantId:'oldTurn',anchor:{round:1,turn:0}}}},
        async update(patch){mergeUpdate(this,patch);return this;}});
    const actor=actorWithEffects(s,[old]);actor.effects.find=predicate=>[old].find(predicate);
    await actor.addCondition('stunned',{rounds:3});
    assert.equal(old.duration.value,3);assert.equal(old.duration.units,'rounds');assert.equal(old.duration.expired,false);
    assert.equal(old.duration.expiry,'turnStart','reapplication uses the same expiry default as a fresh native timed effect');
    assert.equal(old.flags['dark-heresy'].effectClock,undefined,'the old due round must not expire a freshly reapplied condition');
});

test('a fresh native condition restart preserves an explicit null or turn-end expiry',async()=>{
    for(const expiry of [null,'turnEnd']) {
        const s=loadSystem();s.context.CONST.ACTIVE_EFFECT_SHOW_ICON={ALWAYS:2};
        s.context.ActiveEffect.getEffectStart=()=>({time:500});
        s.context.foundry.utils.mergeObject=(target,updates)=>{mergeUpdate(target,updates);return target;};
        const old=makeEffect('stunned',{disabled:true,active:false,isSuppressed:true,
            duration:{value:null,units:'seconds',expiry:EFFECT_CLOCK_EXPIRY,expired:true},
            flags:{'dark-heresy':{key:'stunned',type:'minor',effectClock:{version:1}}},
            async update(patch){mergeUpdate(this,patch);return this;}});
        const actor=actorWithEffects(s,[old]);actor.effects.find=predicate=>[old].find(predicate);
        await actor.addCondition('stunned',{rounds:3},{duration:{value:3,units:'rounds',expiry}});
        assert.equal(old.duration.expiry,expiry);assert.equal(old.duration.expired,false);
    }
});

test('expired effect toggles never extend its deadline; an explicit clock restart creates a new one',async()=>{
    const f=clockFixture();f.effect.disabled=true;f.effect.duration.expired=true;
    Object.assign(f.combat,{round:2,turn:0,previous:{round:1,turn:1},current:{round:2,turn:0}});
    await processEffectBoundary(f.combat,f.turns[0],'start',{round:2,turn:0},{game:f.game});
    assert.equal(f.effect.disabled,true);assert.equal(f.effect.duration.expired,true);
    f.effect.disabled=false;
    await processEffectBoundary(f.combat,f.turns[0],'start',{round:2,turn:0},{game:f.game});
    assert.equal(f.effect.duration.expired,true);assert.equal(f.effect.flags['dark-heresy'].effectClock.dueRound,2);
    mergeUpdate(f.effect,restartEffectClockUpdate(f.effect,{combat:f.combat,worldTime:50}));
    assert.equal(f.effect.disabled,false);assert.equal(f.effect.duration.expired,false);
    assert.equal(f.effect.flags['dark-heresy'].effectClock.dueRound,3);
    Object.assign(f.combat,{round:3,turn:0,previous:{round:2,turn:1},current:{round:3,turn:0}});
    await processEffectBoundary(f.combat,f.turns[0],'start',{round:3,turn:0},{game:f.game});
    assert.equal(f.effect.duration.expired,true);
});

async function workflowFixture() {
    const gm={id:'gm',isGM:true},nextGM={id:'nextGM',isGM:true};
    const users=new Map([[gm.id,gm],[nextGM.id,nextGM]]);users.activeGM=gm;
    const attacker={uuid:'Actor.attacker',type:'acolyte',testUserPermission:()=>true};
    const defender={uuid:'Actor.defender',type:'acolyte',testUserPermission:()=>true};
    const token={id:'target',uuid:'Scene.scene.Token.target',actor:defender,name:'Target',hidden:false,object:{visible:true}};
    const scene={id:'scene',tokens:new Map([[token.id,token]])};token.parent=scene;
    const documents=new Map([[attacker.uuid,attacker],[defender.uuid,defender],[token.uuid,token]]),messages=new Map();
    const game={user:gm,users,messages,scenes:new Map([[scene.id,scene]]),i18n:{localize:key=>key}};
    let serial=0;
    const ChatMessage={async create(data){
        const document={id:data._id??`message${++serial}`,author:users.get(data.user),flags:{},whisper:data.whisper??[],
            blind:!!data.blind,content:data.content??'',rolls:data.rolls??[],async update(patch){mergeUpdate(this,patch);return this;}};
        for(const [key,value] of Object.entries(data.flags??{}))mergeUpdate(document,{[`flags.${key}`]:value});
        messages.set(document.id,document);return document;
    }};
    const runtime={game,ChatMessage,fromUuid:async key=>documents.get(key),ui:{notifications:{warn(){}}},
        foundry:{utils:{randomID:()=>`root${++serial}`},applications:{handlebars:{renderTemplate:async()=>'<section>workflow</section>'}}}};
    const native={host:runtime,enabled:()=>true,actorFromRoll:()=>attacker,
        getRollData:doc=>doc.flags?.['dark-heresy']?.rollData};
    const bridge=createFoundryAttackWorkflowBridge(native);
    const data={actorUuid:attacker.uuid,name:'Autogun',result:20,dos:3,dof:0,numberOfHits:1,target:{final:40},weapon:{isRange:true},
        attackType:{name:'standard'},flags:{isAttack:true,isSuccess:true},
        targets:[{tokenUuid:token.uuid,sceneId:scene.id,tokenId:token.id,name:token.name}]};
    const chatData={user:gm.id,content:'Attack',flags:{}};await bridge.create(data,chatData);
    const root=await ChatMessage.create(chatData);
    let rootWrites=0;const rootUpdate=root.update;
    root.update=async patch=>{if(patch['flags.dark-heresy.combatWorkflow'])rootWrites++;return rootUpdate.call(root,patch);};
    const request=action=>ChatMessage.create({user:gm.id,blind:true,whisper:[gm.id],flags:{'dark-heresy.combatWorkflowRequest':{
        workflowId:root.id,tokenUuid:token.uuid,expectedGeneration:0,action}}});
    return {bridge,game,users,gm,nextGM,root,request,native,get rootWrites(){return rootWrites;}};
}

test('an active-GM handoff before a queued request starts leaves it pending for the new GM',async()=>{
    const f=await workflowFixture(),request=await f.request('decline');
    const pending=f.bridge.processRequest(request.id);
    f.users.activeGM=f.nextGM;
    await pending;
    assert.equal(f.root.flags['dark-heresy'].combatWorkflow.targets[0].phase,'reaction');
    assert.equal(request.flags['dark-heresy'].combatWorkflowRequestStatus,undefined);
    assert.equal(f.rootWrites,0);
    f.game.user=f.nextGM;
    await f.bridge.processRequest(request.id);
    assert.equal(f.root.flags['dark-heresy'].combatWorkflow.targets[0].phase,'damage');
    assert.equal(request.flags['dark-heresy'].combatWorkflowRequestStatus.status,'complete');
    assert.equal(f.rootWrites,1);
    await f.bridge.processRequest(request.id);assert.equal(f.rootWrites,1);
});

test('the new GM acknowledges a persisted application receipt without repeating its native mutation',async()=>{
    const f=await workflowFixture(),row=f.root.flags['dark-heresy'].combatWorkflow.targets[0];
    row.phase='readyApply';row.damage={hits:1,total:7,rollData:{damages:[{total:7}]}};
    let mutations=0;
    f.native.applyDamage=async()=>{mutations++;return {receiptId:'native-actor-receipt'};};
    const update=f.root.update;
    f.root.update=async patch=>{
        const result=await update(patch);
        if(patch['flags.dark-heresy.combatWorkflow']?.targets[0]?.phase==='applied')f.users.activeGM=f.nextGM;
        return result;
    };
    const request=await f.request('apply');await f.bridge.processRequest(request.id);
    assert.equal(mutations,1);
    assert.equal(f.root.flags['dark-heresy'].combatWorkflow.targets[0].phase,'applied');
    assert.equal(request.flags['dark-heresy'].combatWorkflowRequestStatus,undefined,'old GM must not write a completion after handoff');
    const before=f.rootWrites;f.game.user=f.nextGM;
    await f.bridge.processRequest(request.id);
    assert.equal(request.flags['dark-heresy'].combatWorkflowRequestStatus.status,'complete');
    assert.equal(mutations,1);assert.equal(f.rootWrites,before);
});

test('an interrupted unacknowledged native application is not replayed or reported complete by the new GM',async()=>{
    const f=await workflowFixture(),row=f.root.flags['dark-heresy'].combatWorkflow.targets[0];
    row.phase='readyApply';row.damage={hits:1,total:7,rollData:{damages:[{total:7}]}};
    let mutations=0;
    f.native.applyDamage=async()=>{mutations++;f.users.activeGM=f.nextGM;throw Error('Application acknowledgement lost during handoff');};
    const request=await f.request('apply');await f.bridge.processRequest(request.id);
    assert.equal(mutations,1);assert.equal(request.flags['dark-heresy'].combatWorkflowRequestStatus,undefined);
    f.game.user=f.nextGM;await f.bridge.processRequest(request.id);
    assert.equal(mutations,1);
    assert.equal(request.flags['dark-heresy'].combatWorkflowRequestStatus.status,'error');
    assert.match(request.flags['dark-heresy'].combatWorkflowRequestStatus.error,/no completion receipt/);
});

