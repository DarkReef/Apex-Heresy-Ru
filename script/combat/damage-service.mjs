/** Authoritative confirmation workflow. Adapter owns documents, rules and private storage. */
export function createDamageService(a) {
    const decisions = (op, input = {}) => {
        if (!op) return input;
        const next = {...op.decision,...input};
        if (op.decision.fieldResolved) Object.assign(next,{fieldResolved:true,blocked:op.decision.blocked,
            fieldReason:op.decision.fieldReason,fieldMode:op.decision.fieldMode,fieldWaived:false});
        return next;
    };
    const gm = () => {
        if (!a.isAuthority()) throw Error('Only the active GM may execute damage');
    };
    const check = async input => {
        const evidence = await a.evidence(input);
        if (!evidence) throw Error('Missing or unauthorized attack evidence');
        return evidence;
    };
    const calculate = async (e, decision = {}) => {
        const defense = await a.defense(e.actor);
        const plan = a.plan(defense, e.attack.hits, {manual: decision.manual ?? null,
            blocked: decision.blocked ?? []});
        const review = a.review(defense, e.attack.hits, e.attack);
        const requiresTable = plan.rows.some(row => row.criticalAdded > 0 || row.rfEffect > 0) ||
            Boolean(decision.manual && e.attack.hits.some(hit=>hit.righteousFury>0));
        const field = a.field(e.actor);
        const fieldDone = (decision.fieldResolved || decision.fieldWaived) && decision.fieldReason?.trim();
        const reactionDone = e.reactionResolved || decision.reactionReason?.trim();
        const manualDone = decision.reason?.trim() && decision.manual &&
            e.attack.hits.every(hit => Number.isSafeInteger(decision.manual[hit.id]) && decision.manual[hit.id] >= 0);
        const state = {attack: e.attack, target: e.target, defense, field,
            effects: a.effects(e.actor), sourceState: e.sourceState};
        const warnings = [...review];
        if (requiresTable) warnings.push('Critical/Righteous Fury table effects need a recorded GM decision');
        let status = 'ready';
        if (decision.manual && !manualDone) status = 'needs-review';
        else if (review.length && !manualDone) status = 'needs-review';
        else if (!reactionDone || (field && !fieldDone)) status = 'pending-defense';
        else if (requiresTable && !decision.criticalReason?.trim()) status = 'needs-review';
        return {version:1, status, fingerprint:await a.fingerprint(state), target:e.target,
            sourceId:e.message.id, rootId:e.root.id, attacker:e.attackerName, targetName:e.targetName, attack:e.attack,
            plan, warnings, field, reactionResolved:Boolean(reactionDone), decision};
    };
    const preview = async input => {
        gm();const e=await check(input),op=await existing(e);
        if(op && (op.status!=='pending' || op.stage!=='field-resolved')) return op;
        return {...await calculate(e,decisions(op,input.decision)),...(op?{journalId:op.id}:{})};
    };
    const receipt = async id => { gm();return a.readJournal(id); };
    const locked = async (input, run) => {
        gm();const e=await check(input);
        return a.queue(`damage-root:${e.root.id}`, () => a.queue(e.actor.uuid, async () => {
            gm();const fresh=await check(input);
            if (fresh.actor.uuid!==e.actor.uuid) return {status:'stale',reason:'Target changed'};
            return run(fresh);
        }));
    };
    const existing = async e => {
        const claim=a.claim(e);
        if (!claim) return null;
        if (claim.legacy) return {status:'needs-review',reason:'Damage already claimed by the native interface'};
        try {
            const op=await a.readJournal(claim.id);
            if(op.target?.actorUuid!==e.target.actorUuid)
                return {id:op.id,status:'needs-review',target:op.target,reason:'Attack is already fixed to a different target Actor'};
            if(op.status==='processing') return {...op,status:'needs-review',woundsRecorded:Boolean(a.actorMarker(e.actor,op.id)),
                reason:'Unresolved processing operation; inspect the journal before any manual correction'};
            if(op.status!=='applied' && JSON.stringify(op.attack)!==JSON.stringify(e.attack))
                return {id:op.id,status:'needs-review',reason:'Attack result changed after operation began; do not reuse defense results'};
            return op;
        }
        catch {return {id:claim.id,status:'needs-review',reason:'Journal unavailable on this GM/client; do not replay'};}
    };
    const start = async (e, p, input) => {
        const op={version:1,status:'pending',stage:'confirmed',target:e.target,sourceId:e.message.id,
            rootId:e.root.id,attack:e.attack,attacker:p.attacker,targetName:p.targetName,before:p.plan.before,fingerprint:p.fingerprint,
            decision:input.decision??{},plan:p.plan,fieldResults:[],effects:[],confirmedBy:a.userId()};
        const id=await a.createJournal(op);op.id=id;
        try {await a.claimAttack(e,id);} // Persist intent BEFORE any dice or mutations.
        catch(error) {
            op.status='needs-review';op.error=String(error.message);op.woundsRecorded=false;
            await a.saveJournal(op).catch(()=>{});
        }
        return op;
    };
    const resolveField = input => locked(input, async e => {
        let op=await existing(e);
        if (op && (op.status!=='pending' || op.stage!=='field-resolved')) return op;
        if(op?.decision?.fieldResolved) return {...await calculate(e,op.decision),journalId:op.id};
        const p=await calculate(e,decisions(op,input.decision));
        if (p.fingerprint!==input.expected) return {status:'stale'};
        if(!p.reactionResolved) return {status:'pending-defense',reason:'Resolve reaction before the field'};
        if(p.warnings.some(w=>!w.startsWith('Critical/'))) return {status:'needs-review',warnings:p.warnings};
        if(!p.field) return p;
        // The general OW field text is attack-based. Multi-hit policy requires GM ruling.
        if(e.attack.hits.length>1 && (!input.decision?.fieldReason?.trim() || input.decision?.fieldMode!=='per-hit'))
            return {status:'needs-review',reason:'Choose per-hit field policy with a reason; whole bursts are not silently cancelled'};
        if(p.field.review) return {status:'needs-review',reason:p.field.review};
        op??=await start(e,p,input);
        if(op.status==='needs-review') return op;
        op.decision=p.decision;
        try {
            op.status='processing';op.stage='field-rolling';await a.saveJournal(op);
            let overloaded=Boolean(p.field.overloaded);
            for(const hit of e.attack.hits) {
                gm();
                if(overloaded) {op.fieldResults.push({id:hit.id,skipped:true,reason:'overloaded'});continue;}
                if(JSON.stringify(a.field(e.actor))!==JSON.stringify(p.field)) throw Error('Field changed during resolution; inspect stored results');
                const result=await a.rollField(p.field,e,hit);
                op.fieldResults.push({id:hit.id,...result});
                await a.saveJournal(op); // Same result is saved before overload is written.
                if(result.overloaded) {await a.overload(e.actor,p.field);overloaded=true;}
            }
            op.decision={...op.decision,fieldResolved:true,fieldReason:op.decision.fieldReason||'Native OW single-hit field check',blocked:op.fieldResults.filter(r=>r.blocked).map(r=>r.id)};
            const after=await calculate(e,op.decision);
            op.fingerprint=after.fingerprint;op.plan=after.plan;op.stage='field-resolved';op.status='pending';
            await a.saveJournal(op);
            return {...after,journalId:op.id};
        } catch(error) {
            op.status='needs-review';op.error=String(error.message);await a.saveJournal(op).catch(()=>{});
            return op; // Never reroll an uncertain field stage.
        }
    });
    const commit = input => locked(input, async e => {
        let op=await existing(e);
        if(op?.status==='applied' || op?.status==='needs-review') return op;
        if(op && !(op.status==='pending' && op.stage==='field-resolved')) return {status:'needs-review',reason:'Interrupted operation; do not replay',id:op.id};
        const decision=decisions(op,input.decision);
        const p=await calculate(e,decision);
        if(p.fingerprint!==input.expected || (op && op.fingerprint!==input.expected)) return {status:'stale'};
        if(p.status!=='ready') return p;
        if((decision?.fieldWaived && !decision.fieldReason?.trim()) || (decision?.effects?.length && !decision.criticalReason?.trim()))
            return {status:'needs-review',reason:'A manual defense/effect decision requires a reason'};
        a.validateEffects(decision?.effects??[]);
        op??=await start(e,p,input);
        if(op.status==='needs-review') return op;
        op.originalBefore??=op.before;
        op.before=p.plan.before;op.decision=decision??{};op.plan=p.plan;op.status='processing';op.stage='wounds';
        try {
            await a.saveJournal(op);gm();
            const recheck=await calculate(await check(input),decision);
            if(recheck.fingerprint!==p.fingerprint) {
                op.status='pending';op.stage='field-resolved';op.fingerprint=recheck.fingerprint;
                await a.saveJournal(op);
                return {...recheck,status:'stale',journalId:op.id};
            }
            // One Actor update contains both wounds and a minimal nonsecret operation marker.
            await a.apply(e.actor,p.plan,op.id,op.rootId,op.sourceId);
            op.after=await a.wounds(e.actor);op.stage='effects';await a.saveJournal(op);
            if(op.after.value!==p.plan.wounds || op.after.critical!==p.plan.criticalWounds)
                throw Error('Effective wounds differ after persistence; inspect effects before proceeding');
            for(const effect of decision?.effects??[]) {
                gm();
                op.effectIntent=effect;await a.saveJournal(op);
                const created=await a.addEffect(e.actor,effect,op.id);
                op.effects.push({spec:effect,id:created?.id??null,created:created?.created??null});delete op.effectIntent;
                await a.saveJournal(op);
            }
            op.status='applied';op.stage='complete';await a.saveJournal(op);
            await a.announce(e,op).catch(error=>{op.presentationError=String(error.message);});
            return op;
        } catch(error) {
            op.status='needs-review';op.error=String(error.message);
            // Actor marker distinguishes an ambiguous write response from no recorded update.
            op.woundsRecorded=Boolean(a.actorMarker(e.actor,op.id));
            op.after=await a.wounds(e.actor);
            await a.saveJournal(op).catch(()=>{});
            return op;
        }
    });
    return Object.freeze({version:1,preview,commit,resolveField,getReceipt:receipt});
}
