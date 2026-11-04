import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildEffectClockUpdate, restartEffectClockUpdate, processEffectBoundary, combatBoundaryEvents,
    effectClockView, decorateEffectClockView, registerEffectClockHooks, expireEffectClocksForCombat, EFFECT_CLOCK_EXPIRY} from '../script/combat/effect-clock.mjs';
import {openEffectClockDialog} from '../script/combat/effect-clock-ui.mjs';

function apply(document, patch) {
    for (const [path,value] of Object.entries(patch)) {
        const keys=path.split('.'); let object=document;
        while(keys.length>1) object=object[keys.shift()]??={};
        const key=keys[0];
        if(key.startsWith('-=')) delete object[key.slice(2)];
        else object[key]=structuredClone(value);
    }
}

function fixture() {
    const actors=['A','B','C'].map(name=>({id:name,uuid:`Actor.${name}`,documentName:'Actor',name,effects:[],items:[]}));
    const turns=actors.map(actor=>({id:`cb${actor.id}`,name:actor.name,actor,initiative:30}));
    const combat={id:'battle',started:true,round:2,turn:1,turns,combatants:turns,combatant:turns[1],
        previous:{round:2,turn:0},current:{round:2,turn:1}};
    const gm={id:'gm',isGM:true};
    const game={user:gm,users:{activeGM:gm},actors};
    const updates=[];
    const effect={id:'effect',uuid:'Actor.B.ActiveEffect.effect',name:'Aim bonus',actor:actors[1],parent:actors[1],
        origin:'Actor.A.Item.weapon',flags:{},disabled:false,duration:{value:60,units:'seconds',expiry:null,expired:false},
        start:{time:10},_source:{duration:{value:60,units:'seconds',expiry:null,expired:false},start:{time:10}},
        async update(patch){updates.push(patch);apply(this,patch);return this;},delete(){assert.fail('effect source deleted');}};
    actors[1].effects.push(effect);
    return {actors,turns,combat,game,effect,updates};
}

function arm(f, options={}) {apply(f.effect,buildEffectClockUpdate(f.effect,{mode:'targetStart',combat:f.combat,worldTime:100,...options}));}
function advance(f, previous, current) {f.combat.previous=previous;f.combat.current=current;f.combat.round=current.round;f.combat.turn=current.turn;f.combat.combatant=f.turns[current.turn];}
async function boundary(f, phase, index, round) {return processEffectBoundary(f.combat,f.turns[index],phase,{round,turn:index},{game:f.game});}

test('arming a target boundary preserves native timer and schedules strictly the next target start',()=>{
    const f=fixture();arm(f);
    assert.deepEqual(f.effect.flags['dark-heresy'].effectClock.nativeDuration,{value:60,units:'seconds',expiry:null,expired:false});
    assert.equal(f.effect.flags['dark-heresy'].effectClock.dueRound,3);
    assert.equal(f.effect.flags['dark-heresy'].effectClock.referenceCombatantId,'cbB');
    assert.equal(f.effect.duration.value,null);
    assert.equal(f.effect.duration.expiry,EFFECT_CLOCK_EXPIRY);
    assert.equal(f.effect.start.time,100);
});

test('duration can end at the upcoming target/source boundary without ticking ordinary timers',async()=>{
    const f=fixture();arm(f,{mode:'sourceEnd',sourceActorUuid:'Actor.A'});
    const native={id:'native',duration:{value:1,units:'rounds'},update(){assert.fail('native effect double-ticked');}};
    f.actors[0].effects.push(native);
    advance(f,{round:2,turn:2},{round:3,turn:0});
    await boundary(f,'start',0,3);
    assert.equal(f.updates.length,0);
    advance(f,{round:3,turn:0},{round:3,turn:1});
    await boundary(f,'end',0,3);
    assert.equal(f.effect.disabled,true);
    assert.equal(f.effect.duration.expired,true);
    assert.equal(f.updates.length,1);
});

test('duplicate and concurrent combat notifications expire once; backward and reordered turns never expire',async()=>{
    const f=fixture();arm(f,{mode:'targetEnd'});
    advance(f,{round:2,turn:1},{round:2,turn:0});
    await boundary(f,'end',1,2);
    assert.equal(f.updates.length,0);
    advance(f,{round:2,turn:1},{round:2,turn:1});
    await boundary(f,'end',1,2);
    assert.equal(f.updates.length,0,'initiative reorder is not the end of a turn');
    advance(f,{round:2,turn:1},{round:2,turn:2});
    await Promise.all([boundary(f,'end',1,2),boundary(f,'end',1,2)]);
    assert.equal(f.updates.length,1);
    await boundary(f,'end',1,2);
    assert.equal(f.updates.length,1);
});

test('only the elected active GM expires effects, including an exact synthetic-token actor',async()=>{
    const f=fixture();
    const tokenActor={...f.actors[1],uuid:'Scene.scene.Token.token.Actor.B',effects:[],items:[]};
    f.effect.actor=tokenActor;f.effect.parent=tokenActor;tokenActor.effects.push(f.effect);
    f.turns[1].actor=tokenActor;arm(f,{mode:'targetEnd'});
    const baseEffect={...f.effect,uuid:'Actor.B.ActiveEffect.other',flags:{},update(){assert.fail('base actor changed');}};
    f.actors[1].effects=[baseEffect];
    advance(f,{round:2,turn:1},{round:2,turn:2});
    f.game.user={id:'otherGM',isGM:true};await boundary(f,'end',1,2);
    assert.equal(f.updates.length,0);
    f.game.user=f.game.users.activeGM;await boundary(f,'end',1,2);
    assert.equal(f.updates.length,1);
});

test('an explicitly timed equipment source is disabled and retained; unscheduled item effects are untouched',async()=>{
    const f=fixture();
    const item={id:'armour',documentName:'Item',actor:f.actors[1],effects:[f.effect]};
    f.actors[1].items.push(item);f.actors[1].effects=[];f.effect.parent=item;f.effect.transfer=true;
    arm(f,{mode:'targetEnd'});
    advance(f,{round:2,turn:1},{round:2,turn:2});await boundary(f,'end',1,2);
    assert.equal(item.effects.length,1);assert.equal(f.effect.disabled,true);
    item.effects.push({id:'untimed',transfer:false,flags:{},duration:{},update(){assert.fail('untimed effect changed');}});
    f.effect.disabled=false;f.effect.duration.expired=false;f.effect.transfer=false;
    await boundary(f,'end',1,2);assert.equal(f.updates.length,2,'explicit item-local clock expires its own effect too');
});

test('multiple-cycle expiry and skipped turns use absolute rounds, not update counts',async()=>{
    const f=fixture();arm(f,{mode:'targetStart',cycles:3});
    assert.equal(f.effect.flags['dark-heresy'].effectClock.dueRound,5);
    const previous={round:2,turn:1},current={round:5,turn:2};advance(f,previous,current);
    const events=combatBoundaryEvents(f.combat,previous,current);
    assert.equal(events.filter(e=>e.phase==='start'&&e.combatant.id==='cbB').length,3);
    for(const event of events) await processEffectBoundary(f.combat,event.combatant,event.phase,event,{game:f.game});
    assert.equal(f.updates.length,1);
    assert.deepEqual(f.effect.flags['dark-heresy'].effectClock.expiredAt,{round:5,turn:1,phase:'start'});
});

test('round-start and round-end schedules expire at the specified round edge only',async()=>{
    const f=fixture();arm(f,{mode:'roundEnd',cycles:2});
    assert.equal(f.effect.flags['dark-heresy'].effectClock.dueRound,3);
    advance(f,{round:2,turn:2},{round:3,turn:0});await boundary(f,'end',2,2);
    assert.equal(f.updates.length,0);
    advance(f,{round:3,turn:2},{round:4,turn:0});await boundary(f,'end',2,3);
    assert.equal(f.updates.length,1);
    const g=fixture();arm(g,{mode:'roundStart'});advance(g,{round:2,turn:2},{round:3,turn:0});
    await boundary(g,'start',0,3);assert.equal(g.updates.length,1);
});

test('native mode restores the original duration and restart re-arms chosen boundaries from now',()=>{
    const f=fixture();arm(f);advance(f,{round:4,turn:0},{round:4,turn:1});
    apply(f.effect,restartEffectClockUpdate(f.effect,{combat:f.combat,worldTime:200}));
    assert.equal(f.effect.flags['dark-heresy'].effectClock.dueRound,5);
    assert.equal(f.effect.start.time,200);
    apply(f.effect,buildEffectClockUpdate(f.effect,{mode:'native'}));
    assert.equal(f.effect.flags['dark-heresy'].effectClock,undefined);
    assert.deepEqual(f.effect.duration,{value:60,units:'seconds',expiry:null,expired:false});
    assert.deepEqual(f.effect.start,{time:10});
});

test('ambiguous/foreign references, inactive combat, and invalid duration reject before persistence',()=>{
    const f=fixture();
    assert.throws(()=>arm(f,{mode:'sourceStart',sourceActorUuid:'Actor.foreign'}),/REFERENCE_MISSING/);
    assert.throws(()=>arm(f,{cycles:0}),/INVALID_CYCLES/);
    f.combat.turns.push({...f.turns[1],id:'duplicateB'});
    assert.throws(()=>arm(f),/REFERENCE_AMBIGUOUS/);
    arm(f,{referenceCombatantId:'cbB'});
    f.combat.started=false;assert.throws(()=>arm(f),/REQUIRES_COMBAT/);
    assert.equal(f.updates.length,0);
});

test('effect presentation carries its source boundary and pending combat without mutating the document',()=>{
    const f=fixture();arm(f,{mode:'sourceStart',sourceActorUuid:'Actor.A'});
    const before=structuredClone(f.effect.flags);
    const view=decorateEffectClockView({name:'Buff'},f.effect,{combat:f.combat,localize:key=>key});
    assert.equal(view.effectClock.referenceName,'A');assert.equal(view.temporary,true);
    assert.match(view.durationLabel,/sourceStart.*A.*3/);
    assert.equal(effectClockView(f.effect,{combat:{id:'other'}}).combatMissing,true);
    assert.deepEqual(f.effect.flags,before);
});

test('optional hook binding installs once and can be removed; direct native integration adds no hooks',()=>{
    const listeners=new Map();let count=0;
    const Hooks={on(name,callback){listeners.set(++count,{name,callback});return count;},off(name,id){listeners.delete(id);}};
    const dispose=registerEffectClockHooks({Hooks,boundaries:false});
    assert.equal(listeners.size,0);assert.equal(registerEffectClockHooks({Hooks}),dispose);dispose();
    registerEffectClockHooks({Hooks});assert.equal(listeners.size,1);
    const f=fixture();assert.deepEqual(combatBoundaryEvents(f.combat,{round:3,turn:0},{round:2,turn:0}),[]);
    assert.deepEqual(combatBoundaryEvents(f.combat,{round:2,turn:1},{round:2,turn:1}),[]);
});

function dialogOptions(f, values, {onPrompt}={}) {
    const warnings=[],errors=[];
    return {game:f.game,combat:f.combat,localize:key=>key,notifications:{warn:value=>warnings.push(value),error:value=>errors.push(value)},
        warnings,errors,renderTemplate:async(path,data)=>{assert.match(path,/effect-clock\.hbs$/);assert.equal(data.targets.length,1);return '<div>fixture</div>';},
        DialogV2:{async prompt(options){
            await onPrompt?.();
            if(values===null)return null;
            const elements=Object.fromEntries(Object.entries({mode:'native',cycles:'1',sourceCombatantId:'',targetCombatantId:'',...values}).map(([key,value])=>[key,{value}]));
            return options.ok.callback(null,{form:{elements}});
        }}};
}

test('native DialogV2 timer form cancel writes nothing and selecting source uses its exact Actor UUID',async()=>{
    const f=fixture();
    await openEffectClockDialog(f.effect,dialogOptions(f,null));assert.equal(f.updates.length,0);
    await openEffectClockDialog(f.effect,dialogOptions(f,{mode:'sourceStart',cycles:'2',sourceCombatantId:'cbC'}));
    assert.equal(f.updates.length,1);
    const policy=f.effect.flags['dark-heresy'].effectClock;
    assert.equal(policy.sourceActorUuid,'Actor.C');assert.equal(policy.referenceCombatantId,'cbC');assert.equal(policy.dueRound,3);
});

test('timer form refuses removed source and revoked ownership before saving',async()=>{
    const f=fixture();
    const removed=dialogOptions(f,{mode:'sourceStart',sourceCombatantId:'missing'});
    await openEffectClockDialog(f.effect,removed);assert.deepEqual(removed.errors,['COMBAT_EFFECTS.REFERENCE_MISSING']);assert.equal(f.updates.length,0);
    f.game.user={id:'player',isGM:false};f.effect.isOwner=true;
    const revoked=dialogOptions(f,{mode:'targetStart'},{onPrompt:()=>{f.effect.isOwner=false;}});
    await openEffectClockDialog(f.effect,revoked);assert.deepEqual(revoked.warnings,['COMBAT_EFFECTS.NO_PERMISSION']);assert.equal(f.updates.length,0);
});

test('source boundaries include effects on unlinked scene actors outside the combat',async()=>{
    const f=fixture();
    const sceneActor={id:'B',uuid:'Scene.other.Token.extra.Actor.B',effects:[f.effect],items:[]};
    f.effect.actor=sceneActor;f.effect.parent=sceneActor;f.actors[1].effects=[];
    f.game.scenes=[{tokens:[{actor:sceneActor}]}];
    arm(f,{mode:'sourceEnd',sourceActorUuid:'Actor.A'});
    advance(f,{round:3,turn:0},{round:3,turn:1});await boundary(f,'end',0,3);
    assert.equal(f.updates.length,1);
});

test('combat deletion expires only its own clock schedules and retains even item sources',async()=>{
    const f=fixture();arm(f,{mode:'sourceStart',sourceActorUuid:'Actor.A'});
    const other={...f.effect,id:'other',uuid:'Actor.C.ActiveEffect.other',flags:structuredClone(f.effect.flags),
        duration:{...f.effect.duration},update(){assert.fail('other combat effect modified');}};
    other.flags['dark-heresy'].effectClock.combatId='otherBattle';
    const native={id:'native',duration:{value:60,units:'seconds'},update(){assert.fail('native effect modified');}};
    f.actors[2].effects.push(other,native);
    const item={documentName:'Item',actor:f.actors[1],effects:[f.effect]};
    f.effect.parent=item;f.effect.transfer=false;f.effect.disabled=true;
    f.actors[1].effects=[];f.actors[1].items.push(item);
    f.game.user={id:'otherGM',isGM:true};await expireEffectClocksForCombat(f.combat,{game:f.game});
    assert.equal(f.updates.length,0);
    f.game.user=f.game.users.activeGM;
    await Promise.all([expireEffectClocksForCombat(f.combat,{game:f.game}),expireEffectClocksForCombat(f.combat,{game:f.game})]);
    assert.equal(f.updates.length,1);assert.equal(item.effects.length,1);
    assert.equal(f.effect.duration.expired,true);assert.equal(f.effect.flags['dark-heresy'].effectClock.expiredAt.phase,'combatEnd');
});

test('custom expiry is registered for the native ActiveEffect editor without enabling extra boundary hooks',()=>{
    const CONFIG={ActiveEffect:{expiryEvents:{existing:'Existing'}}};
    const Hooks={on(){assert.fail('duplicate boundary hooks registered');},off(){}};
    registerEffectClockHooks({Hooks,CONFIG,boundaries:false});
    assert.equal(CONFIG.ActiveEffect.expiryEvents.darkHeresyBoundary,'COMBAT_EFFECTS.BOUNDARY');
    assert.equal(CONFIG.ActiveEffect.expiryEvents.existing,'Existing');
});
