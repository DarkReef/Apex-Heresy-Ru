/** A single attack card. Rules, dice and damage remain in the native system.
 * This module records their results and orders writes; it never rolls or spends.
 * Only an elected GM/controller should persist this state for other users.
 */
export const ATTACK_WORKFLOW_VERSION = 1;
const clone = value => structuredClone(value);
const integer = (value, name, {minimum=0, maximum=Number.MAX_SAFE_INTEGER}={}) => {
    const n=Number(value);
    if(!Number.isSafeInteger(n)||n<minimum||n>maximum) throw Error(`Invalid ${name}`);
    return n;
};
const tokenIdentity = target => target.tokenUuid || (target.sceneId && target.tokenId
    ? `Scene.${target.sceneId}.Token.${target.tokenId}` : null);
const text = value => typeof value==='string' ? value : '';
const fail = message => {throw Error(message);};
const operationKinds = {reactionStart:'reaction',reactionResolved:'reaction',damageStart:'damage',
    damageResolved:'damage',applyStart:'apply',applied:'apply',pinningStart:'pinning',pinningResolved:'pinning'};

function attackSnapshot(data) {
    return {name:text(data.name),actorName:text(data.actorName),itemName:text(data.itemName||data.weapon?.name),
        result:Number.isFinite(Number(data.result))?Number(data.result):null,
        target:Number.isFinite(Number(data.target?.final))?Number(data.target.final):null,
        success:!!data.flags?.isSuccess,dos:Math.max(Number(data.dos)||0,0),dof:Math.max(Number(data.dof)||0,0),
        hits:integer(data.numberOfHits??0,'attack hits'),attackType:text(data.attackType?.name),
        isRanged:data.weapon?.isRange===true,jammed:!!data.weaponJammed,overheated:!!data.weaponOverheated};
}

function rowFor(target,index,hits,{suppression=false,spray=false}={}) {
    const tokenUuid=tokenIdentity(target);
    if(!tokenUuid||!/^Scene\.[^.]+\.Token\.[^.]+$/.test(tokenUuid)) throw Error('Exact target Token UUID required');
    return {tokenUuid,actorUuid:text(target.actorUuid),
        // A hidden token's name must never be copied into public message flags.
        name:target.hidden ? '' : text(target.publicName??target.name),hidden:!!target.hidden,index,
        hits,remainingHits:hits,phase:hits>0?'reaction':'resolved',defenseType:spray?'agility':'evasion',reaction:null,damage:null,applied:null,
        pinning:suppression?{phase:'pending',result:null,operation:null,conditionApplied:false}:null,
        operation:null,receipts:[]};
}

export function createAttackWorkflow(rollData,{id,attackerUuid,createdBy,targetHits={},area=false}={}) {
    if(!text(id)||!text(attackerUuid)||!text(createdBy)) throw Error('Attack identity is required');
    const attack=attackSnapshot(rollData),seen=new Set(),areaKind=text(rollData.attackArea?.kind);
    area=area||['blast','spray'].includes(areaKind);
    const targets=(rollData.targets??[]).map((target,index)=>{
        const key=tokenIdentity(target);
        if(seen.has(key)) throw Error('Duplicate target Token UUID');
        seen.add(key);
        // A burst's hits are not cloned onto every selected target. Area attacks
        // supply their native per-target allocation explicitly.
        return rowFor(target,index,integer(targetHits[key]??(index===0?attack.hits:0),'target hits'),
            {suppression:attack.attackType==='suppression',spray:areaKind==='spray'});
    });
    const total=targets.reduce((sum,row)=>sum+row.hits,0);
    if(area ? targets.some(row=>row.hits>attack.hits) : total>attack.hits) throw Error('Allocated hits exceed the native attack');
    return {version:1,id,attackerUuid,createdBy,generation:0,revision:0,attack,targets,allocationMode:area?'area':'shared',
        areaKind,attackReceipts:[],sharedDamage:areaKind==='blast'?{phase:'unrolled',rollData:null,operationId:null}:null};
}

function authorize(state,command,context) {
    if(!context?.userId||context.visible===false) throw Error('Attack card is not visible');
    const target=state.targets.find(row=>row.tokenUuid===command.tokenUuid);
    const ownsTarget=target&&(typeof context.ownsTarget==='function' ? context.ownsTarget(target) : context.ownsTarget===true);
    const defense=['reactionStart','reactionResolved','declineReaction','pinningStart','pinningResolved'].includes(command.type)
        ||['operationFailed','operationCancelled'].includes(command.type)&&(target?.operation?.kind==='reaction'||target?.pinning?.operation?.id===command.operationId);
    const gmOnly=['applyStart','applied','resetOperation','allocateHits'].includes(command.type);
    if(context.isGM) return;
    if(['operationFailed','operationCancelled','reactionResolved','pinningResolved','damageResolved'].includes(command.type)) {
        const operation=target?.pinning?.operation?.id===command.operationId?target.pinning.operation:target?.operation;
        if(operation&&operation.by!==context.userId) throw Error('Operation belongs to another user');
    }
    if(gmOnly) throw Error('Only the GM can confirm damage or repair an operation');
    if(defense ? !ownsTarget : !context.ownsAttacker) throw Error('Actor ownership required');
}

function remember(row,id,kind) {
    row.receipts.push({id,kind});
    if(row.receipts.length>16) row.receipts.splice(0,row.receipts.length-16);
}
function active(row,kind,id) {
    if(row.operation?.kind!==kind||row.operation?.id!==id) throw Error('Operation claim does not match');
}
function resultSnapshot(result) {
    if(!result||!Number.isFinite(Number(result.result))||!Number.isFinite(Number(result.target))) throw Error('Native reaction result required');
    if(!['dodge','parry','suppression','agility'].includes(result.type)) throw Error('Invalid reaction type');
    return {type:result.type,result:Number(result.result),target:Number(result.target),success:!!result.success,
        dos:Math.max(Number(result.dos)||0,0),dof:Math.max(Number(result.dof)||0,0),
        modifiers:text(result.modifiers),rollData:result.rollData?clone(result.rollData):null};
}

function sharedDamageForRow(pool,row) {
    const rollData=clone(pool),[,sceneId,,tokenId]=row.tokenUuid.split('.');
    rollData.damages=rollData.damages.slice(0,row.remainingHits);
    rollData.numberOfHits=row.remainingHits;
    rollData.targets=[{tokenUuid:row.tokenUuid,actorUuid:row.actorUuid,sceneId,tokenId,name:row.name}];
    return {rollData,total:rollData.damages.reduce((sum,damage)=>sum+Number(damage.total),0),hits:rollData.damages.length,shared:true};
}
function useSharedDamage(state,row) {
    if(state.sharedDamage?.phase==='rolled'&&row.phase==='damage'&&row.remainingHits>0) {
        row.damage=sharedDamageForRow(state.sharedDamage.rollData,row);row.phase='readyApply';
    }
}

/** Pure, immutable transition. `context` must come from resolved Foundry documents,
 * never from player-supplied role/owner booleans. Result commands require trusted
 * native roll evidence; the controller's verify callback enforces that boundary.
 */
export function transitionAttackWorkflow(state,command,context={}) {
    if(state?.version!==1||!Array.isArray(state.targets)) throw Error('Unsupported attack workflow');
    if(!command||typeof command.type!=='string') throw Error('Command required');
    authorize(state,command,context);
    if(command.expectedGeneration!==undefined&&command.expectedGeneration!==state.generation) throw Error('Attack was replaced by a reroll');
    if(command.type==='rerollAttack') {
        if(!text(command.operationId)) throw Error('Operation identity required');
        if(state.attackReceipts?.some(receipt=>receipt.id===command.operationId)) return clone(state);
        if(state.targets.some(row=>row.operation||row.pinning?.operation||row.pinning?.conditionApplied
            ||['applied','applying','needsReview'].includes(row.phase)))
            throw Error('Attack has committed or unresolved dependent operations');
        if(!command.rollData) throw Error('Native reroll result required');
        const next=createAttackWorkflow({...command.rollData,attackArea:command.rollData.attackArea??{kind:state.areaKind},targets:state.targets},
            {id:state.id,attackerUuid:state.attackerUuid,createdBy:state.createdBy,targetHits:command.targetHits,area:state.allocationMode==='area'});
        next.generation=state.generation+1;next.revision=state.revision+1;
        next.attackReceipts=[...(state.attackReceipts??[]),{id:command.operationId,kind:'rerollAttack'}].slice(-16);
        return next;
    }
    if(command.type==='allocateHits') {
        if(state.targets.some(row=>row.operation||row.pinning?.operation||row.reaction||row.damage||row.applied||row.phase==='needsReview'))
            throw Error('Hit allocation is locked by dependent operations');
        const next=clone(state),allocation=command.targetHits;
        if(!allocation||typeof allocation!=='object'||Array.isArray(allocation)) throw Error('Hit allocation required');
        if(Object.keys(allocation).some(key=>!state.targets.some(row=>row.tokenUuid===key))) throw Error('Unknown allocation target');
        for(const row of next.targets) {
            row.hits=integer(allocation[row.tokenUuid]??0,'target hits');row.remainingHits=row.hits;
            row.phase=row.hits?'reaction':'resolved';
        }
        if(next.allocationMode==='area' ? next.targets.some(row=>row.hits>next.attack.hits)
            : next.targets.reduce((sum,row)=>sum+row.hits,0)>next.attack.hits) throw Error('Allocated hits exceed the native attack');
        next.revision++;return next;
    }
    const next=clone(state),row=next.targets.find(row=>row.tokenUuid===command.tokenUuid);
    if(!row) throw Error('Target is not recorded in this attack');
    const id=text(command.operationId);
    if(!id) throw Error('Operation identity required');
    const cancellation=['operationFailed','operationCancelled'].includes(command.type);
    const kind=operationKinds[command.type]??(cancellation
        ?(row.pinning?.operation?.id===id?row.pinning.operation.kind:row.operation?.kind):command.type);
    const previous=row.receipts.find(receipt=>receipt.id===id);
    if(previous) {
        if(previous.kind!==kind) throw Error('Operation identity was reused');
        return clone(state);
    }
    const claimed=kind==='pinning'?row.pinning?.operation:row.operation;
    if(claimed?.id===id&&command.type.endsWith('Start')) {
        if(claimed.kind!==kind) throw Error('Operation identity was reused');
        return clone(state);
    }
    if(command.type==='damageStart'&&next.sharedDamage?.phase==='rolled'&&row.damage?.shared) return clone(state);
    switch(command.type) {
        case 'declineReaction':
            if(row.phase!=='reaction') throw Error('Reaction is already resolved');
            row.reaction={type:'none',by:context.userId};
            row.phase=row.remainingHits?'damage':'resolved';useSharedDamage(next,row);remember(row,id,kind);break;
        case 'reactionStart':
            if(row.phase!=='reaction'||row.operation) throw Error('Reaction is already claimed');
            row.phase='reacting';row.operation={id,kind,by:context.userId};break;
        case 'reactionResolved': {
            active(row,'reaction',id);
            if(row.phase!=='reacting') throw Error('Reaction is not pending');
            const reaction=resultSnapshot(command.result);
            if(row.defenseType==='agility'?reaction.type!=='agility':!['dodge','parry'].includes(reaction.type)) throw Error('Reaction does not match this attack');
            // Hit cancellation is computed by the native system, not repeated here.
            row.remainingHits=integer(command.remainingHits,'remaining hits',{maximum:row.hits});
            row.reaction=reaction;row.phase=row.remainingHits?'damage':'resolved';row.operation=null;useSharedDamage(next,row);
            remember(row,id,kind);break;
        }
        case 'pinningStart':
            if(!row.pinning||row.pinning.phase!=='pending'||row.pinning.operation) throw Error('Pinning check is already claimed or unavailable');
            row.pinning.phase='rolling';row.pinning.operation={id,kind,by:context.userId};break;
        case 'pinningResolved': {
            if(!row.pinning) throw Error('No pinning check required');
            active(row.pinning,'pinning',id);
            if(row.pinning.phase!=='rolling') throw Error('Pinning check is not pending');
            const result=resultSnapshot(command.result);
            if(result.type!=='suppression') throw Error('Native pinning check required');
            row.pinning.result=result;row.pinning.phase='resolved';row.pinning.operation=null;
            row.pinning.conditionApplied=!!command.conditionApplied;
            remember(row,id,kind);break;
        }
        case 'damageStart':
            if(row.phase!=='damage'||!row.remainingHits||row.operation) throw Error('Damage is not available');
            if(next.sharedDamage) {
                if(next.sharedDamage.phase!=='unrolled') throw Error('Blast damage is already claimed');
                next.sharedDamage.phase='rolling';next.sharedDamage.operationId=id;
            }
            row.phase='damaging';row.operation={id,kind,by:context.userId};break;
        case 'damageResolved': {
            active(row,'damage',id);
            if(row.phase!=='damaging') throw Error('Damage is not pending');
            const damages=command.rollData?.damages;
            if(!Array.isArray(damages)||!damages.length||damages.some(d=>!Number.isFinite(Number(d.total))||Number(d.total)<0))
                throw Error('Native damage result required');
            if(next.sharedDamage) {
                if(next.sharedDamage.phase!=='rolling'||next.sharedDamage.operationId!==id) throw Error('Shared Blast claim does not match');
                if(damages.length<next.attack.hits) throw Error('Full native Blast damage pool required');
                next.sharedDamage={phase:'rolled',operationId:id,rollData:clone(command.rollData)};
                row.phase='damage';row.operation=null;
                for(const target of next.targets) useSharedDamage(next,target);
            } else {
                row.damage={rollData:clone(command.rollData),total:damages.reduce((sum,d)=>sum+Number(d.total),0),hits:damages.length};
                row.phase='readyApply';row.operation=null;
            }
            remember(row,id,kind);break;
        }
        case 'applyStart':
            if(row.phase!=='readyApply'||!row.damage||row.operation) throw Error('Damage cannot be applied');
            row.phase='applying';row.operation={id,kind,by:context.userId};break;
        case 'applied':
            active(row,'apply',id);
            if(row.phase!=='applying'||!text(command.receiptId)) throw Error('Confirmed application receipt required');
            row.applied={receiptId:command.receiptId};
            if(text(command.summary)) row.applied.summary=command.summary.slice(0,500);
            if(typeof command.field?.blocked==='boolean') row.applied.field={blocked:command.field.blocked};
            row.phase='applied';row.operation=null;remember(row,id,kind);break;
        case 'operationFailed':
            if(row.pinning?.operation?.id===id) {
                row.pinning.phase='needsReview';row.pinning.operation.error=text(command.error).slice(0,240);break;
            }
            if(!row.operation||row.operation.id!==id) throw Error('Operation claim does not match');
            // Failed persistence may already have changed an Actor. Never blindly retry.
            if(next.sharedDamage?.operationId===id) next.sharedDamage.phase='needsReview';
            row.phase='needsReview';row.operation.error=text(command.error).slice(0,240);break;
        case 'operationCancelled':
            // Only for a trusted host's explicit pre-roll/pre-write cancellation.
            if(row.pinning?.operation?.id===id) {
                row.pinning.phase='pending';row.pinning.operation=null;remember(row,id,kind);break;
            }
            if(!row.operation||row.operation.id!==id) throw Error('Operation claim does not match');
            if(next.sharedDamage?.operationId===id) next.sharedDamage={phase:'unrolled',rollData:null,operationId:null};
            row.phase={reaction:'reaction',damage:'damage',apply:'readyApply'}[row.operation.kind]??fail('Unknown operation');
            row.operation=null;remember(row,id,kind);break;
        case 'resetOperation':
            if(row.pinning?.phase==='needsReview'&&row.pinning.operation&&text(command.reason).trim()) {
                row.pinning.phase='pending';row.pinning.operation=null;remember(row,id,kind);break;
            }
            if(row.phase!=='needsReview'||!row.operation||!text(command.reason).trim()) throw Error('GM review reason required');
            if(next.sharedDamage?.operationId===row.operation.id) next.sharedDamage={phase:'unrolled',rollData:null,operationId:null};
            row.phase={reaction:'reaction',damage:'damage',apply:'readyApply'}[row.operation.kind]??fail('Unknown operation');
            row.operation=null;remember(row,id,kind);break;
        default: throw Error('Unknown attack workflow command');
    }
    next.revision++;return next;
}

const LABELS={reaction:'COMBAT_FLOW.REACTION_PENDING',reacting:'COMBAT_FLOW.REACTION_ROLLING',
    damage:'COMBAT_FLOW.DAMAGE_PENDING',damaging:'COMBAT_FLOW.DAMAGE_ROLLING',readyApply:'COMBAT_FLOW.APPLY_PENDING',
    applying:'COMBAT_FLOW.APPLYING',applied:'COMBAT_FLOW.APPLIED',resolved:'COMBAT_FLOW.NO_HITS',needsReview:'COMBAT_FLOW.NEEDS_REVIEW'};
const FALLBACK={'COMBAT_FLOW.REACTION_PENDING':'Ожидается реакция','COMBAT_FLOW.REACTION_ROLLING':'Выполняется реакция',
    'COMBAT_FLOW.DAMAGE_PENDING':'Ожидается урон','COMBAT_FLOW.DAMAGE_ROLLING':'Бросок урона',
    'COMBAT_FLOW.APPLY_PENDING':'Урон готов к подтверждению','COMBAT_FLOW.APPLYING':'Применение урона',
    'COMBAT_FLOW.APPLIED':'Урон применён','COMBAT_FLOW.NO_HITS':'Попаданий нет','COMBAT_FLOW.NEEDS_REVIEW':'Требуется проверка мастера',
    'COMBAT_FLOW.DODGE':'Уклонение','COMBAT_FLOW.PARRY':'Парирование','COMBAT_FLOW.DECLINE':'Без реакции',
    'COMBAT_FLOW.ROLL_DAMAGE':'Бросить урон','COMBAT_FLOW.APPLY':'Подтвердить урон','COMBAT_FLOW.HITS':'Попадания',
    'COMBAT_FLOW.DAMAGE':'Урон','COMBAT_FLOW.TARGET':'Цель','COMBAT_FLOW.TITLE':'Ход атаки',
    'COMBAT_FLOW.PINNING':'Проверка на подавление','COMBAT_FLOW.ALLOCATE':'Распределить попадания',
    'COMBAT_FLOW.SUCCESS_DEGREES':'ст. успеха','COMBAT_FLOW.FAILURE_DEGREES':'ст. провала',
    'COMBAT_FLOW.AGILITY':'Проверка Ловкости','COMBAT_FLOW.FIELD_BLOCKED':'Атака остановлена силовым полем'};

/** Client-specific controls are only presentation; persistence always rechecks rights. */
export function attackWorkflowView(state,{userId,isGM=false,ownsAttacker=false,ownsTarget=()=>false,
    canSeeTarget=row=>!row.hidden,localize=key=>key}={}) {
    const tr=key=>{const value=localize(key);return value&&value!==key?value:FALLBACK[key]??key;};
    const outcome=result=>`${result.success?result.dos:result.dof} ${tr(result.success?'COMBAT_FLOW.SUCCESS_DEGREES':'COMBAT_FLOW.FAILURE_DEGREES')}`;
    return {id:state.id,generation:state.generation,revision:state.revision,title:tr('COMBAT_FLOW.TITLE'),
        canAllocate:isGM&&state.targets.length>1&&!state.targets.some(row=>row.operation||row.pinning?.operation||row.reaction||row.damage||row.applied||row.phase==='needsReview'),
        labels:Object.fromEntries(Object.keys(FALLBACK).map(key=>[key.slice(12).toLowerCase(),tr(key)])),
        targets:state.targets.filter(row=>isGM||canSeeTarget(row)).map(row=>{
            const defense=isGM||(typeof ownsTarget==='function'?ownsTarget(row):ownsTarget===true);
            const reaction=row.reaction;
            const reactionText=reaction?.type==='none'?tr('COMBAT_FLOW.DECLINE'):reaction
                ?`${tr(reaction.type==='parry'?'COMBAT_FLOW.PARRY':reaction.type==='agility'?'COMBAT_FLOW.AGILITY':reaction.type==='suppression'?'COMBAT_FLOW.PINNING':'COMBAT_FLOW.DODGE')}: ${outcome(reaction)}`:'';
            return {...clone(row),name:row.name||`${tr('COMBAT_FLOW.TARGET')} ${row.index+1}`,status:tr(LABELS[row.phase]),
                canReact:!!userId&&defense&&row.phase==='reaction',
                canParry:row.defenseType!=='agility'&&!state.attack.isRanged,dodgeLabel:tr(row.defenseType==='agility'?'COMBAT_FLOW.AGILITY':'COMBAT_FLOW.DODGE'),
                canSuppress:!!userId&&defense&&row.pinning?.phase==='pending',
                canDamage:!!userId&&(isGM||ownsAttacker)&&row.phase==='damage'&&(!state.sharedDamage||state.sharedDamage.phase==='unrolled'),
                canApply:!!userId&&isGM&&row.phase==='readyApply',
                pinningText:row.pinning?.result?`${tr('COMBAT_FLOW.PINNING')}: ${outcome(row.pinning.result)}`:'',
                pinningTooltip:row.pinning?.result?`${row.pinning.result.result}/${row.pinning.result.target}${row.pinning.result.modifiers?`; ${row.pinning.result.modifiers}`:''}`:'',
                reactionText,reactionTooltip:reaction&&reaction.type!=='none'
                    ?`${reaction.result}/${reaction.target}${reaction.modifiers?`; ${reaction.modifiers}`:''}`:''};
        })};
}

/** Adapter contract:
 * load(id) -> state; save(id,next,{previous}) persists content + flag in ONE write.
 * context(id,evidence) resolves author/visibility/Actor ownership from actual docs.
 * verify(id,command,evidence,state) validates authored/native roll evidence.
 * isAuthority() must elect one GM for cross-user writes. A raw socket senderId,
 * role, result, amount or ownership boolean is never adequate evidence.
 */
export function createAttackWorkflowController({load,save,context,verify,isAuthority}) {
    if([load,save,context,verify,isAuthority].some(fn=>typeof fn!=='function')) throw Error('Complete trusted workflow adapter required');
    const queues=new Map();
    const queue=(id,operation)=>{
        const previous=queues.get(id)??Promise.resolve();
        const next=previous.catch(()=>{}).then(operation);queues.set(id,next);
        return next.finally(()=>{if(queues.get(id)===next) queues.delete(id);});
    };
    const transition=async(id,command,evidence)=>{
        if(!isAuthority()) throw Error('Only the active GM may persist the combat workflow');
        const state=await load(id);if(!state) throw Error('Attack card no longer exists');
        const caller=await context(id,evidence,state);
        await verify(id,command,evidence,state,caller);
        const next=transitionAttackWorkflow(state,command,caller);
        if(next.revision===state.revision) return {state:next,duplicate:true};
        if(!isAuthority()) throw Error('Active GM changed during operation');
        await save(id,next,{previous:state});
        return {state:next,duplicate:false};
    };
    return Object.freeze({
        dispatch:(id,command,evidence)=>queue(id,()=>transition(id,command,evidence)),
        /** Persist intent before running native reaction/damage/application. If a
         * write/result becomes ambiguous, leave a review marker, never replay it.
         * producer is a trusted host callback, not code accepted over a socket.
         */
        perform:(id,command,evidence,producer)=>queue(id,async()=>{
            if(!['reactionStart','damageStart','applyStart','pinningStart'].includes(command.type)||typeof producer!=='function') throw Error('Native operation required');
            const started=await transition(id,command,evidence);
            if(started.duplicate) return started;
            try {
                const result=await producer(clone(started.state));
                if(result===false||result?.cancelled===true) return await transition(id,{...command,type:'operationCancelled'},evidence);
                const type={reactionStart:'reactionResolved',damageStart:'damageResolved',applyStart:'applied',pinningStart:'pinningResolved'}[command.type];
                return await transition(id,{...command,...result,type,tokenUuid:command.tokenUuid,
                    operationId:command.operationId,expectedGeneration:command.expectedGeneration},evidence);
            } catch(error) {
                try {await transition(id,{...command,type:'operationFailed',error:String(error?.message??error)},evidence);} catch { /* Original failure must remain visible. */ }
                throw error;
            }
        })
    });
}
