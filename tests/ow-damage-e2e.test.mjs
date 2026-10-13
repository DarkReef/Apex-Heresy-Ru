import {test} from 'node:test';
import assert from 'node:assert/strict';

import {damageFixture} from './helpers/ow-damage-fixture.mjs';
import {owCharacteristicBonus} from '../script/combat/ow-damage.mjs';
const prepare=async(f,decision={reactionReason:'No reaction remaining'})=>{
    game.user=f.player;const request=await f.api.request(f.input);game.user=f.gm;
    const input={requestId:request.id,decision};const preview=await f.api.preview(input);
    return {request,input,preview};
};

test('player request → GM preview → native OW calculation → persisted receipt, acceptance matrix',async()=>{
    for(const [pen,felling,armour,tb,damage]of [[0,0,6,7,5],[4,0,2,7,9],[10,0,0,7,11],[4,2,2,5,11],[4,10,2,4,12]]){
        const f=damageFixture({pen,traits:{felling}}),p=await prepare(f);
        assert.equal(p.preview.status,'ready');assert.equal(f.writes(),0);assert.equal(f.rolls(),0);
        const row=p.preview.plan.rows[0];assert.deepEqual([row.armourAfterPen,row.toughnessForHit,row.damage],[armour,tb,damage]);
        const receipt=await f.api.commit({...p.input,expected:p.preview.fingerprint});
        assert.equal(receipt.status,'applied');assert.equal(f.actor.wounds.value,damage);
        assert.equal(f.writes(),1);assert.equal((await f.api.getReceipt(receipt.id)).after.value,damage);
        assert.deepEqual(f.actor._source.system.characteristics.toughness,f.actor.system.characteristics.toughness);
    }
});

test('True Grit receives Felling context; native preview and apply use the same planner',async()=>{
    const f=damageFixture({pen:4,traits:{felling:2},trueGrit:true,value:9});
    const decision={reactionReason:'No reaction',criticalReason:'Table read by GM; no additional automated consequence'};
    const p=await prepare(f,decision),plan=p.preview.plan;
    assert.deepEqual([plan.rows[0].normalAdded,plan.rows[0].newCriticalRaw,plan.rows[0].criticalAdded,plan.remainingAfter],[3,8,3,-3]);
    const native=f.actor.previewDamage([{amount:18,penetration:4,location:'ARMOUR.BODY',weaponTraits:{felling:2}}]);
    assert.deepEqual([native.wounds,native.criticalWounds],[12,3]);
    const receipt=await f.api.commit({...p.input,expected:p.preview.fingerprint});
    assert.equal(receipt.status,'applied');assert.deepEqual([f.actor.wounds.value,f.actor.wounds.critical],[12,3]);
});

test('hit-by-hit armour, zero absorption and RF effects remain separate from accumulated wounds',async()=>{
    const f=damageFixture({hits:[{total:13,penetration:0,location:'ARMOUR.BODY'},
        {total:13,penetration:10,location:'ARMOUR.HEAD',righteousFury:2}]});
    const p=await prepare(f,{reactionReason:'No reaction',criticalReason:'RF table resolved manually'});
    assert.deepEqual(p.preview.plan.rows.map(r=>r.damage),[0,6]);
    assert.equal(p.preview.plan.rows[1].rfEffect,2);assert.equal(p.preview.plan.criticalWounds,0);
    await f.api.commit({...p.input,expected:p.preview.fingerprint});assert.equal(f.actor.wounds.value,6);
    const noUnnatural=damageFixture({unnatural:0,traits:{felling:10}});
    assert.equal((await prepare(noUnnatural)).preview.plan.rows[0].toughnessForHit,4);
});

test('double clicks, two API callers, reload and native message handler cannot replay a hit',async()=>{
    const f=damageFixture(),p=await prepare(f),api2=f.build();
    const input={...p.input,expected:p.preview.fingerprint};
    const results=await Promise.all([f.api.commit(input),api2.commit(input)]);
    assert.ok(results.every(r=>r.status==='applied'));assert.equal(f.writes(),1);
    await f.build().commit(input);assert.equal(f.writes(),1);
    // Native route, even with module disabled, recognises the same root claim.
    const legacy=f.system.get('applyAutoDamageFromSocket');
    await legacy({sceneId:'scene',tokenId:'enemy',messageId:'damage'});assert.equal(f.writes(),1);
});

test('field preview is inert; explicit per-hit ruling preserves rolls and overload once',async()=>{
    const f=damageFixture({field:true,fieldRolls:[30,5],hits:[
        {total:18,penetration:0,location:'ARMOUR.BODY'}, {total:18,penetration:0,location:'ARMOUR.HEAD'},
        {total:18,penetration:0,location:'ARMOUR.LEFT_ARM'}]});
    const p=await prepare(f,{reactionReason:'Reaction spent',fieldReason:'GM rules each hit separately',fieldMode:'per-hit'});
    assert.equal(p.preview.status,'pending-defense');assert.equal(f.rolls(),0);
    const resolved=await f.api.resolveField({...p.input,expected:p.preview.fingerprint});
    assert.equal(f.rolls(),2);assert.equal(f.field.flags.overloaded,true);
    assert.deepEqual(resolved.plan.rows.map(r=>r.damage),[0,0,5]);
    await f.api.resolveField({...p.input,expected:p.preview.fingerprint});assert.equal(f.rolls(),2);
    const r=await f.api.commit({...p.input,expected:resolved.fingerprint});assert.equal(r.status,'applied');assert.equal(f.actor.wounds.value,5);
    await f.api.commit({...p.input,expected:resolved.fingerprint});assert.equal(f.rolls(),2);assert.equal(f.writes(),1);
});

test('missing reaction, unsupported mechanism and stale state stop before a write',async()=>{
    const f=damageFixture(),p=await prepare(f,{});assert.equal(p.preview.status,'pending-defense');
    await f.api.commit({...p.input,expected:p.preview.fingerprint});assert.equal(f.writes(),0);
    const ready=await f.api.preview({...p.input,decision:{reactionReason:'GM waives reaction'}});
    f.actor.system.characteristics.toughness.displayTotal=55;
    assert.equal((await f.api.commit({...p.input,decision:ready.decision,expected:ready.fingerprint})).status,'stale');
    assert.equal(f.writes(),0);
    const bad=damageFixture({traits:{toxic:2}}),bp=await prepare(bad);
    assert.equal(bp.preview.status,'needs-review');await bad.api.commit({...bp.input,expected:bp.preview.fingerprint});assert.equal(bad.writes(),0);
    const manual={...bp.input.decision,reason:'GM resolved toxin manually; record only these wound totals',manual:{'attack:hit-0':5}};
    const fresh=await bad.api.preview({...bp.input,decision:manual});assert.equal(fresh.status,'ready');
    assert.equal((await bad.api.commit({...bp.input,decision:manual,expected:fresh.fingerprint})).status,'applied');
});

test('Fate replacement and lost rights invalidate uncommitted results; payload userId cannot confer authority',async()=>{
    const f=damageFixture(),p=await prepare(f);
    await f.base.setFlag('riftan-smart-assessment','replacement','reroll');
    await assert.rejects(f.api.commit({...p.input,expected:p.preview.fingerprint}),/stale/);assert.equal(f.writes(),0);
    const other=damageFixture(),op=await prepare(other);game.user=other.player;
    await assert.rejects(other.api.commit({...op.input,userId:'gm',expected:op.preview.fingerprint}),/active GM/);
    other.attacker.testUserPermission=()=>false;game.user=other.gm;
    await assert.rejects(other.api.preview(op.input),/own/);assert.equal(other.writes(),0);
});

test('synthetic target stays independent; changed Actor UUID, no GM and hidden rolls are rejected',async()=>{
    const f=damageFixture();game.user=f.player;
    const prototype={uuid:'Actor.npc',system:{wounds:{value:0}}};
    f.lookup.set(prototype.uuid,prototype);const p=await prepare(f);
    await f.api.commit({...p.input,expected:p.preview.fingerprint});assert.equal(prototype.system.wounds.value,0);
    const changed=damageFixture(),c=await prepare(changed);changed.token.actor={...changed.actor,uuid:'Actor.changed'};
    await assert.rejects(changed.api.commit({...c.input,expected:c.preview.fingerprint}),/changed/);
    const hidden=damageFixture();hidden.source.blind=true;game.user=hidden.player;
    await assert.rejects(hidden.api.request(hidden.input),/visible/);
    hidden.source.blind=false;game.users.activeGM=null;await assert.rejects(hidden.api.request(hidden.input),/No active GM/);
});

test('before/after write failures and another GM key never blindly replay; chat failure preserves applied receipt',async()=>{
    for(const stage of ['before','after']){
        const f=damageFixture(),p=await prepare(f);stage==='before'?f.failBefore():f.failAfter();
        const r=await f.api.commit({...p.input,expected:p.preview.fingerprint});assert.equal(r.status,'needs-review');
        assert.equal(r.woundsRecorded,stage==='after');
        await f.build().commit({...p.input,expected:p.preview.fingerprint});assert.equal(f.writes(),stage==='after'?1:0);
    }
    const f=damageFixture(),p=await prepare(f);f.failChat();const r=await f.api.commit({...p.input,expected:p.preview.fingerprint});
    assert.equal(r.status,'applied');assert.equal(f.writes(),1);
    f.clientSettings.set('damageJournalKey','ab'.repeat(32));game.users.activeGM=game.user={id:'newGM',isGM:true};
    const unavailable=await f.build().commit({...p.input,expected:p.preview.fingerprint});assert.equal(unavailable.status,'needs-review');assert.equal(f.writes(),1);
});

test('replicated journal/Actor flags contain no cleartext private defense or wound receipt',async()=>{
    const f=damageFixture(),p=await prepare(f),r=await f.api.commit({...p.input,expected:p.preview.fingerprint});
    const entry=f.messages.get(r.id);
    assert.deepEqual(Object.keys(entry.getFlag('dark-heresy','damageJournal')).sort(),['ciphertext','iv','version']);
    assert.ok(!JSON.stringify(entry.flags).includes('Secret NPC'));assert.ok(!JSON.stringify(entry.flags).includes('toughnessForHit'));
    assert.deepEqual(f.actor.getFlag('dark-heresy','damageReceipts')[r.id],{status:'applied'});
    assert.ok(!JSON.stringify(f.messages.contents.map(m=>m.flags).filter(f=>f['dark-heresy']?.damageSummary)).includes('remaining'));
});

test('OW +X increases bonus and successful test degrees; test modifiers never change defense',async()=>{
    const f=damageFixture();assert.equal(owCharacteristicBonus(45,3),7);
    const roll=f.system.get('_rollTarget');let die=35;
    f.system.context.Roll=class {async evaluate(){this.total=die;return this;}};
    const data={actorUuid:'Actor.pc',ownerId:'pc',characteristicKey:'toughness',target:{final:45},flags:{}};
    await roll(data);assert.equal(data.flags.isSuccess,true);assert.equal(data.dos,4);
    die=55;await roll(data);assert.equal(data.flags.isSuccess,false);assert.equal(data.dos,0);
    const p=await prepare(f);data.target.final=85;await roll(data);
    const next=await f.api.preview(p.input);assert.equal(next.fingerprint,p.preview.fingerprint);
    const temporary=damageFixture({temp:10,pen:4});const t=await prepare(temporary);
    assert.equal(t.preview.plan.rows[0].naturalToughness,5);
    await temporary.api.commit({...t.input,expected:t.preview.fingerprint});
    assert.equal(temporary.actor._source.system.characteristics.toughness.base,45);
});

test('linked tokens share the actual Actor queue; repeated Item/field source is not added twice',async()=>{
    const f=damageFixture();
    f.actor.items.set('unnatural',{id:'unnatural',type:'trait',name:'Unnatural Toughness (+3)'});
    const p=await prepare(f);assert.equal(p.preview.plan.rows[0].toughnessForHit,7);
    const otherToken={...f.token,id:'linked',uuid:'Scene.scene.Token.linked'};
    f.lookup.set(otherToken.uuid,otherToken);
    f.source.getRollData().targets.push({sceneId:'scene',tokenId:'linked'});
    game.user=f.player;const request=await f.api.request({...f.input,tokenUuid:otherToken.uuid});game.user=f.gm;
    const q=await f.api.preview({requestId:request.id,decision:p.input.decision});
    assert.equal(q.target.actorUuid,p.preview.target.actorUuid);
    await f.api.commit({...p.input,expected:p.preview.fingerprint});
    const r=await f.api.commit({requestId:request.id,decision:p.input.decision,expected:q.fingerprint});
    assert.equal(r.status,'applied');assert.equal(f.writes(),1);
});

test('Daemonic stays separate from Felling and Warp Weapon requires explicit exception review',async()=>{
    const f=damageFixture({pen:4,traits:{felling:10}});
    f.actor.items.set('daemon',{id:'daemon',type:'trait',name:'Daemonic (2)'});
    const p=await prepare(f);assert.equal(p.preview.status,'needs-review');
    assert.equal(p.preview.plan.rows[0].daemonic,2);assert.equal(p.preview.plan.rows[0].toughnessForHit,4);
    const warp=damageFixture({traits:{warpWeapon:true}}),w=await prepare(warp);
    assert.equal(w.preview.status,'needs-review');assert.equal(w.preview.plan.rows[0].armourAfterPen,0);
    assert.equal(w.preview.plan.rows[0].toughnessForHit,7);
    await warp.api.commit({...w.input,expected:w.preview.fingerprint});assert.equal(warp.writes(),0);
});

test('native OW apply matches preview and manual final wounds do not subtract True Grit twice',async()=>{
    const f=damageFixture({trueGrit:true,value:9});
    const hits=[{amount:18,penetration:4,location:'ARMOUR.BODY',weaponTraits:{felling:2}}];
    const preview=f.actor.previewDamage(hits);f.actor._suppressCritChat=true;
    await f.actor.applyDamage(hits);
    assert.deepEqual([f.actor.wounds.value,f.actor.wounds.critical],[preview.wounds,preview.criticalWounds]);
    const m=damageFixture({trueGrit:true,value:9,pen:4,traits:{felling:2}});
    const p=await prepare(m,{reactionReason:'No reaction',criticalReason:'Exact critical table reviewed',
        manual:{'attack:hit-0':6},reason:'Final 6 wounds already includes True Grit'});
    await m.api.commit({...p.input,expected:p.preview.fingerprint});
    assert.deepEqual([m.actor.wounds.value,m.actor.wounds.critical],[12,3]);
});

test('prepared AE can override a duplicated Unnatural Item down to zero',async()=>{
    const f=damageFixture({unnatural:0});
    f.actor.items.set('u',{id:'u',name:'Unnatural Toughness (+3)',type:'trait'});
    assert.equal(f.actor._owDamageDefense().unnaturalToughness,3);
    const effect={active:true,changes:[{key:'system.characteristics.toughness.unnatural',value:0}],toObject(){return {active:this.active,changes:this.changes};}};
    f.actor.effects.set('effect',effect);
    const p=await prepare(f);assert.equal(p.preview.plan.rows[0].unnaturalToughness,0);
    await f.api.commit({...p.input,expected:p.preview.fingerprint});
    assert.equal(f.actor._source.system.characteristics.toughness.unnatural,0);
});

test('a copied/fabricated reaction by the attacker does not resolve an enemy defense',async()=>{
    const f=damageFixture();const data=f.base.getRollData();
    Object.assign(data,{flags:{isEvasion:true},evasionActorTokenId:'enemy',evasionActorSceneId:'scene',evasions:{selected:'dodge',dodge:{actorUuid:f.actor.uuid}}});
    const p=await prepare(f,{});assert.equal(p.preview.status,'pending-defense');
    f.base.author=f.gm;
    assert.equal((await f.api.preview(p.input)).status,'ready');
});

test('fully absorbed RF deals one wound; separate locations use their own prepared AP',async()=>{
    const rf=damageFixture({hits:[{total:13,penetration:0,location:'ARMOUR.BODY',righteousFury:2}]});
    const p=await prepare(rf);assert.equal(p.preview.plan.rows[0].damage,1);assert.equal(p.preview.plan.rows[0].rfEffect,0);
    await rf.api.commit({...p.input,expected:p.preview.fingerprint});assert.equal(rf.actor.wounds.value,1);assert.equal(rf.rolls(),0);
    const f=damageFixture({hits:[{total:18,penetration:0,location:'ARMOUR.BODY'},{total:18,penetration:0,location:'ARMOUR.HEAD'}]});
    Object.assign(f.actor.system.armour.head,{tempModifier:-5,total:8});
    const q=await prepare(f,{reactionReason:'No reaction',criticalReason:'Head critical table reviewed'});
    assert.deepEqual(q.preview.plan.rows.map(r=>r.damage),[5,10]);
    await f.api.commit({...q.input,expected:q.preview.fingerprint});assert.deepEqual([f.actor.wounds.value,f.actor.wounds.critical],[12,3]);
    assert.equal(f.actor._source.system.armour.head.total,13);
});

test('changing source ancestry after application cannot replay the same card or spend ammunition',async()=>{
    const f=damageFixture();f.attacker.items.set('gun',{id:'gun',system:{clip:{value:7,max:8}}});
    f.source.getRollData().weapon.clip={value:8,max:8};
    const p=await prepare(f);await f.api.commit({...p.input,expected:p.preview.fingerprint});
    delete f.source.getRollData().sourceMessageId;delete f.base.flags['dark-heresy'].damageClaim;
    const r=await f.api.commit({...p.input,expected:p.preview.fingerprint});
    assert.equal(r.status,'applied');assert.equal(f.writes(),1);assert.equal(f.attacker.items.get('gun').system.clip.value,7);
});

test('activation routes native OW apply to confirmation and preserves other-book native routes',async()=>{
    const f=damageFixture();game.modules.set('riftan-smart-assessment',{active:true});
    const publicAPI=f.system.get('createDarkHeresyAPI')();game.darkHeresy.api=publicAPI;
    game.user=f.player;
    const req=await publicAPI.applyDamage({messageId:'damage'});assert.ok(req.id);assert.equal(f.writes(),0);
    game.user=f.gm;
    await f.system.get('applyAutoDamageFromSocket')({sceneId:'scene',tokenId:'enemy',messageId:'damage'});assert.equal(f.writes(),0);
    // Existing non-OW socket route remains available with this module enabled.
    f.attacker.system.ruleset='bc';f.actor.system.ruleset='bc';
    f.system.context.foundry.applications={handlebars:{renderTemplate:async()=>''}};
    await f.system.get('applyAutoDamageFromSocket')({sceneId:'scene',tokenId:'enemy',messageId:'damage'});
    assert.equal(f.writes(),1);
});

test('manual confirmation requires a complete nonnegative integer final wound decision',async()=>{
    const f=damageFixture();
    for (const value of [0.5, -1, undefined]) {
        const run=()=>prepare(f,{reactionReason:'No reaction',reason:'Final wounds reviewed',manual:{'attack:hit-0':value}});
        if(value===0.5){const p=await run();assert.equal(p.preview.status,'needs-review');await f.api.commit({...p.input,expected:p.preview.fingerprint});}
        else await assert.rejects(run,/Invalid manual damage/);
        assert.equal(f.writes(),0);
    }
});
