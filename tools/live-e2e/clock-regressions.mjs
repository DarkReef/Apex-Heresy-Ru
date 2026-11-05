/**
 * Run only from an authorized active-GM client. This file does not execute itself.
 * The exported function is self-contained and can be sent through Companion as:
 *   `return await (${runClockRegressions.toString()})('unique-qa-run-id');`
 *
 * Actor, inactive Scene, hidden Tokens and ActiveEffects are real persisted QA
 * documents. Combat is an actual configured Combat document kept IN MEMORY:
 * core Combat deletion can activate another encounter and refresh every world's
 * ActiveEffect timer, so this harness never persists/deletes/advances a Combat.
 */
export async function runClockRegressions(runId, options = {}) {
    if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(runId))
        throw Error('A unique alphanumeric QA runId (max 96 characters) is required');
    if (!game.user?.isGM || game.users.activeGM?.id !== game.user.id)
        throw Error('Only the elected active GM may run these QA regressions');
    if (game.system?.id !== 'apex-heresy-ru') throw Error('This harness requires Apex Heresy RU');

    const prefix=`QA clock ${runId}`;
    const marker={qaRunId:runId,qaHarness:'clock-regressions'};
    const flags={'dark-heresy':marker};
    const ids={actors:[],scenes:[],tokens:[],temporaryCombats:[]};
    const before={worldTime:game.time.worldTime,activeSceneId:game.scenes.active?.id??null,
        activeCombatId:game.combat?.id??null,combatIds:game.combats.contents.map(document=>document.id).sort()};
    const report={runId,system:{id:game.system.id,version:game.system.version},
        foundry:game.release?.version,checks:[],ids,cleanup:{requested:options.keepDocuments!==true,deleted:[],errors:[]},
        limitations:['Combat is an actual configured document in memory; persisted combat advancement and the global effect registry are not exercised.']};
    let actor,scene;
    const check=(id,passed,observed)=>report.checks.push({id,passed:!!passed,observed});
    const owned=document=>document?.flags?.['dark-heresy']?.qaRunId===runId
        &&document.flags['dark-heresy'].qaHarness==='clock-regressions'
        &&String(document.name??'').startsWith(prefix);
    const readEffect=effect=>({id:effect?.id,disabled:effect?.disabled,active:effect?.active,
        duration:{value:effect?.duration?.value??null,units:effect?.duration?.units??null,
            expiry:effect?.duration?.expiry??null,expired:!!effect?.duration?.expired},
        clock:effect?.flags?.['dark-heresy']?.effectClock??null});
    try {
        const clockUrl=options.clockModuleUrl??`/systems/apex-heresy-ru/script/combat/effect-clock.mjs?qaVersion=${encodeURIComponent(game.system.version)}`;
        const clock=await import(clockUrl);
        if (typeof clock.buildEffectClockUpdate!=='function'||typeof clock.processEffectBoundary!=='function')
            throw Error('The installed clock helper does not expose the expected test contract');
        actor=await Actor.create({name:`${prefix} actor`,type:'acolyte',system:{ruleset:'ow'},
            ownership:{default:0},prototypeToken:{actorLink:true},flags},{renderSheet:false});
        ids.actors.push(actor.id);
        if (!owned(actor)) throw Error('QA actor marker was not preserved');
        scene=await Scene.create({name:`${prefix} scene`,active:false,navigation:false,
            width:1000,height:1000,padding:0,grid:{type:1,size:100,distance:1,units:'m'},flags},{renderSheet:false});
        ids.scenes.push(scene.id);
        if (!owned(scene)||scene.active) throw Error('QA scene is not safely isolated');
        const tokenData=[];
        for(let index=0;index<2;index++) {
            const token=await actor.getTokenDocument({name:`${prefix} token ${index+1}`,hidden:true,actorLink:true,
                x:100+index*200,y:100,flags});
            tokenData.push(token.toObject());
        }
        const tokens=await scene.createEmbeddedDocuments('Token',tokenData);
        for(const token of tokens) ids.tokens.push(token.uuid);
        if(tokens.length!==2||tokens.some(token=>!owned(token)||!token.hidden||!token.actorLink))
            throw Error('QA hidden linked tokens were not created as requested');
        const combatId=foundry.utils.randomID();
        if(game.combats.has(combatId)) throw Error('Unexpected QA Combat ID collision');
        const CombatDocument=CONFIG.Combat.documentClass;
        const combat=new CombatDocument({_id:combatId,name:`${prefix} temporary combat`,scene:scene.id,
            active:false,round:1,turn:0,flags,
            combatants:tokens.map((token,index)=>({_id:foundry.utils.randomID(),name:token.name,
                actorId:actor.id,sceneId:scene.id,tokenId:token.id,hidden:true,initiative:20-index}))},
        {temporary:true});
        combat.setupTurns();
        ids.temporaryCombats.push(combat.id);
        if(game.combats.has(combat.id)) throw Error('QA Combat was unexpectedly persisted');
        const target=combat.turns[0];
        if(target?.actor?.uuid!==actor.uuid) throw Error('Temporary Combat did not resolve the real QA Actor');
        const clockPatch=effect=>{
            const patch=clock.buildEffectClockUpdate(effect,{mode:'targetStart',cycles:1,combat,
                referenceCombatantId:target.id,worldTime:game.time.worldTime});
            // The temporary Combat deliberately has no persistent foreign reference.
            // Its ID in the clock policy scopes processing to this QA document.
            patch.start.combat=null;
            return patch;
        };

        const [dormant]=await actor.createEmbeddedDocuments('ActiveEffect',[{
            name:`${prefix} dormant stunned`,statuses:['stunned'],disabled:false,
            duration:{value:null,units:'seconds',expiry:null,expired:false},
            flags:{'dark-heresy':{...marker,key:'stunned',type:'minor'}}}]);
        await dormant.update(clockPatch(dormant));
        await dormant.update({disabled:true,'duration.expired':true});
        const dormantBefore=readEffect(dormant);
        const reapplied=await actor.addCondition('stunned',{rounds:3});
        const restored=actor.effects.get(dormant.id);
        const dormantAfter=readEffect(restored);
        check('dormant-native-reapply',reapplied?.id===dormant.id
            &&restored.duration.value===3&&restored.duration.units==='rounds'
            &&restored.duration.expiry!==clock.EFFECT_CLOCK_EXPIRY&&!restored.duration.expired
            &&!restored.flags?.['dark-heresy']?.effectClock,{before:dormantBefore,after:dormantAfter});
        // Do not let an unrelated native-timer refresh change the second case.
        await actor.deleteEmbeddedDocuments('ActiveEffect',[dormant.id]);

        const [deadline]=await actor.createEmbeddedDocuments('ActiveEffect',[{
            name:`${prefix} disabled deadline`,disabled:false,
            duration:{value:null,units:'seconds',expiry:null,expired:false},flags}]);
        await deadline.update(clockPatch(deadline));
        await deadline.update({disabled:true});
        const deadlineBefore=readEffect(deadline);
        combat.updateSource({round:2,turn:0});
        const previous={round:1,turn:1,combatantId:combat.turns[1].id};
        const current={round:2,turn:0,combatantId:target.id};
        combat.previous=previous;combat.current=current;
        await clock.processEffectBoundary(combat,target,'start',{round:2,turn:0},{game,previous,current});
        const atDeadline=readEffect(actor.effects.get(deadline.id));
        await deadline.update({disabled:false});
        const afterToggle=readEffect(actor.effects.get(deadline.id));
        check('disabled-absolute-deadline',atDeadline.duration.expired&&afterToggle.duration.expired
            &&afterToggle.active!==true,{before:deadlineBefore,atDeadline,afterToggle});
    } catch(error) {
        report.error={name:error?.name??'Error',message:String(error?.message??error)};
    } finally {
        if(options.keepDocuments!==true) {
            for(const [kind,document] of [['Scene',scene],['Actor',actor]]) {
                if(!document)continue;
                try {
                    if(!owned(document))throw Error('QA cleanup marker mismatch; manual inspection required');
                    if(kind==='Scene'&&document.active)throw Error('QA scene became active; automatic cleanup stopped');
                    if(kind==='Actor'&&game.scenes.contents.some(candidate=>candidate.tokens.some(token=>token.actorId===document.id)))
                        throw Error('QA Actor still has scene tokens; automatic cleanup stopped');
                    await document.delete();
                    report.cleanup.deleted.push({type:kind,id:document.id});
                } catch(error) {report.cleanup.errors.push({type:kind,id:document.id,message:String(error?.message??error)});}
            }
        }
        const after={worldTime:game.time.worldTime,activeSceneId:game.scenes.active?.id??null,
            activeCombatId:game.combat?.id??null,combatIds:game.combats.contents.map(document=>document.id).sort()};
        report.environment={before,after,unchanged:JSON.stringify(before)===JSON.stringify(after)};
        report.remaining={actors:ids.actors.filter(id=>game.actors.has(id)),scenes:ids.scenes.filter(id=>game.scenes.has(id))};
        report.passed=!report.error&&report.checks.length===2&&report.checks.every(result=>result.passed)
            &&report.environment.unchanged&&report.cleanup.errors.length===0;
    }
    return report;
}
