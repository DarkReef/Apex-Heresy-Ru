import {createAttackWorkflow,createAttackWorkflowController,transitionAttackWorkflow,attackWorkflowView} from './attack-workflow.mjs';
import {attackAreaDefaults} from './attack-areas.mjs';

const SCOPE='dark-heresy',TEMPLATE='systems/apex-heresy-ru/template/chat/attack-workflow.hbs';
const flag=(message,key)=>message?.flags?.[SCOPE]?.[key]??message?.flags?.[`${SCOPE}.${key}`];
const documentOf=value=>value?.document??value;
const values=collection=>collection?.contents??(typeof collection?.values==='function'?[...collection.values()]:[...(collection??[])]);
const clone=value=>structuredClone(value);
const uuidFor=target=>target?.tokenUuid??(target?.sceneId&&target?.tokenId?`Scene.${target.sceneId}.Token.${target.tokenId}`:null);
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const owns=(actor,user)=>!!actor&&!!user&&(user.isGM||actor.testUserPermission?.(user,'OWNER')===true);
const visible=(message,user)=>!!user&&(user.isGM||!message?.blind&&(!(message.whisper?.length)
    ||message.whisper.some(id=>(id?.id??id)===user.id)||message.author?.id===user.id));
const randomId=()=>globalThis.foundry?.utils?.randomID?.()??crypto.randomUUID().replaceAll('-','').slice(0,16);
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
export const WORKFLOW_BRIDGE_TEXT=Object.freeze({'COMBAT_FLOW.MODIFIER':'Modifier','COMBAT_FLOW.DIFFICULTY':'Difficulty',
    'COMBAT_FLOW.REQUEST_TIMEOUT':'The GM has not acknowledged this operation. Check the card before trying again.',
    'COMBAT_FLOW.REQUEST_FAILED':'The combat operation could not be completed. Check the card before trying again.'});

/** Serializable flags never contain Roll instances, functions or live documents. */
export function serializeWorkflowRollData(value,seen=new WeakSet()) {
    if(value===null||['string','boolean','number'].includes(typeof value)) return value;
    if(typeof value!=='object') return undefined;
    if(seen.has(value)) return undefined;seen.add(value);
    if(Array.isArray(value)) {const output=value.map(entry=>serializeWorkflowRollData(entry,seen));seen.delete(value);return output;}
    const output={};
    for(const [key,entry] of Object.entries(value)) {
        if(['rollObject','damageRoll','document','parent'].includes(key)||typeof entry==='function') continue;
        const serialized=serializeWorkflowRollData(entry,seen);if(serialized!==undefined) output[key]=serialized;
    }
    seen.delete(value);return output;
}

/** Thin host adapter: only the elected GM persists the shared card. Cross-client
 * requests are authored Foundry documents; sockets contain their ID, never roles,
 * amounts or commands. Dice, hit cancellation and damage use native callbacks.
 */
export function createFoundryAttackWorkflowBridge(native={}) {
    const runtime=native.host??globalThis;
    const host=()=>runtime.game;
    const tr=key=>{const value=host()?.i18n?.localize?.(key);return value&&value!==key?value:WORKFLOW_BRIDGE_TEXT[key]??key;};
    const notify=error=>{
        const detail=String(error?.message??error);
        const key=/permission|ownership|Request author/i.test(detail)?'COMBAT_FLOW.NO_PERMISSION'
            :/active GM|connected GM/i.test(detail)?'COMBAT_FLOW.GM_REQUIRED'
            :/changed|replaced by a reroll/i.test(detail)?'COMBAT_FLOW.TARGET_CHANGED'
            :/committed|unresolved|review/i.test(detail)?'COMBAT_FLOW.NEEDS_REVIEW':'COMBAT_FLOW.REQUEST_FAILED';
        runtime.ui?.notifications?.warn?.(tr(key));
    };
    const authority=()=>!!host()?.user?.isGM&&host().users?.activeGM?.id===host().user.id;
    const gm=()=>host()?.users?.activeGM;
    const message=id=>host()?.messages?.get?.(id);
    const getData=root=>native.getRollData?.(root)??flag(root,'rollData');
    const stateFor=id=>flag(message(id),'combatWorkflow');
    const resolve=async uuid=>{
        if(typeof uuid!=='string'||!/^Scene\.[^.]+\.Token\.[^.]+$/.test(uuid)) throw Error('Exact target Token UUID required');
        const token=documentOf(await runtime.fromUuid(uuid));
        if(!token?.actor||token.uuid!==uuid) throw Error('Recorded target token is unavailable');
        return token;
    };
    const sourceActor=async(state,root)=>{
        const actor=await runtime.fromUuid(state.attackerUuid);
        if(!actor||actor.uuid!==state.attackerUuid||native.actorFromRoll?.(getData(root))?.uuid!==actor.uuid)
            throw Error('Attacking Actor changed');
        return actor;
    };
    const trustedResults=new WeakSet(),pendingNative=new Map(),processing=new Map(),rootQueues=new Map(),pendingRerolls=new Map();

    async function context(id,evidence,state) {
        const root=message(id);if(!root) throw Error('Attack card no longer exists');
        const request=evidence?.request;
        if(request&&message(request.id)!==request) throw Error('Request is not a live ChatMessage');
        const user=request?request.author:evidence?.user;
        if(!user||host().users?.get?.(user.id)!==user) throw Error('Request author no longer exists');
        const attacker=await sourceActor(state,root),owners=new Map();
        for(const row of state.targets) {
            try {const token=await resolve(row.tokenUuid);
                owners.set(row.tokenUuid,(!row.actorUuid||token.actor.uuid===row.actorUuid)&&owns(token.actor,user));}
            catch {owners.set(row.tokenUuid,false);}
        }
        return {userId:user.id,isGM:!!user.isGM,ownsAttacker:owns(attacker,user),
            ownsTarget:row=>!!row&&owners.get(row.tokenUuid)===true,visible:visible(root,user)};
    }

    function verifyNativeReaction(request,data,canonical=data) {
        const rolls=values(request?.rolls);
        const natural=Number(data?.unmodifiedResult??data?.result);
        if(!rolls.length||!Number.isFinite(Number(rolls[0].total))||Number(rolls[0].total)!==natural
            ||!request.author?.isGM&&natural!==Number(data?.result))
            throw Error('Native roll evidence does not match this reaction');
        if(!Number.isInteger(Number(data.result))||Number(data.result)<1||Number(data.result)>100
            ||!Number.isFinite(Number(data.target?.final))) throw Error('Invalid native reaction result');
        const success=natural===1||natural!==100&&Number(data.result)<=Number(data.target.final);
        if(success!==!!data.flags?.isSuccess) throw Error('Native reaction outcome does not match the dice');
        const dos=success?Math.max(1+Math.floor((Number(data.target.final)-Number(data.result))/10),1)
            +Math.max(0,Number(native.unnaturalDosBonus?.(canonical))||0):0;
        const dof=success?0:Math.max(1+Math.floor((Number(data.result)-Number(data.target.final))/10),1);
        if(Number(data.dos??0)!==dos||Number(data.dof??0)!==dof) throw Error('Native reaction degrees do not match the dice');
    }

    async function verify(id,command,evidence,state) {
        if(trustedResults.has(evidence)) return;
        const request=evidence?.request,spec=flag(request,'combatWorkflowRequest');
        if(!request||!spec||spec.workflowId!==id||spec.expectedGeneration!==state.generation)
            throw Error('Authored request does not match this attack generation');
        const allowed={dodge:'reactionStart',parry:'reactionStart',agility:'reactionStart',
            suppression:'pinningStart',decline:'declineReaction',damage:'damageStart',apply:'applyStart',
            reactionResult:'reactionResolved',suppressionResult:'pinningResolved',cancel:'operationCancelled',
            allocate:'allocateHits',reroll:'rerollAttack'};
        if(allowed[spec.action]!==command.type) throw Error('Request action does not match the transition');
        if(command.tokenUuid!==spec.tokenUuid&&command.type!=='allocateHits'&&command.type!=='rerollAttack') throw Error('Request target changed');
        if(command.operationId!==(spec.operationId??request.id)&&command.type!=='allocateHits') throw Error('Request operation changed');
        if(command.tokenUuid) {
            const row=state.targets.find(row=>row.tokenUuid===command.tokenUuid),token=await resolve(command.tokenUuid);
            if(!row||row.actorUuid!==token.actor.uuid) throw Error('Recorded target Actor changed');
        }
        if(['reactionResolved','pinningResolved'].includes(command.type)) {
            const row=state.targets.find(row=>row.tokenUuid===spec.tokenUuid);
            const canonical=await native.buildReaction(clone(getData(message(id))),clone(row),spec.resultData?.workflow?.action);
            verifyNativeReaction(request,spec.resultData,canonical);
        }
        if(command.type==='rerollAttack') verifyNativeReaction(request,spec.resultData,getData(message(id)));
        if(command.type==='reactionStart') {
            const row=state.targets.find(row=>row.tokenUuid===spec.tokenUuid);
            if(row?.defenseType==='agility'?spec.action!=='agility':!['dodge','parry'].includes(spec.action)) throw Error('Invalid defense for this area');
            if(spec.action==='parry'&&getData(message(id))?.weapon?.isRange) throw Error('Ranged attacks cannot be parried');
        }
    }

    async function render(state,permissions={isGM:true,userId:gm()?.id,ownsAttacker:true,ownsTarget:()=>true}) {
        const view=attackWorkflowView(state,{...permissions,localize:key=>host()?.i18n?.localize?.(key)??key});
        return runtime.foundry.applications.handlebars.renderTemplate(TEMPLATE,view);
    }

    const controller=createAttackWorkflowController({load:async id=>stateFor(id),isAuthority:authority,context,verify,
        save:async(id,state)=>{
            const root=message(id),reroll=pendingRerolls.get(id),base=reroll?.html??flag(root,'workflowBaseContent');
            if(typeof base!=='string') throw Error('Original attack content is unavailable');
            const patch={[`flags.${SCOPE}.combatWorkflow`]:state,content:base+await render(state)};
            if(reroll) {
                patch[`flags.${SCOPE}.workflowBaseContent`]=base;
                patch[`flags.${SCOPE}.rollData`]=serializeWorkflowRollData(reroll.data);
                patch.rolls=reroll.rolls;
            }
            await root.update(patch);
        }});

    function enabled(data) {
        if(!gm()||native.enabled?.(data)!==true||!data?.flags?.isAttack||data.flags.isEvasion||data.flags.isDamageRoll
            ||data.vehicle||data.psy?.display) return false;
        if(!Array.isArray(data.targets)||!data.targets.length) return !!attackAreaDefaults(data);
        return data.targets.every(target=>{
            const uuid=uuidFor(target);if(!uuid) return false;
            const scene=host()?.scenes?.get?.(target.sceneId??uuid.split('.')[1]);
            const token=scene?.tokens?.get?.(target.tokenId??uuid.split('.')[3]);
            const actor=token?.actor;
            return !!actor&&!['vehicle','voidship'].includes(actor.type)&&!(Number(actor.horde??actor.system?.horde?.value)>0);
        });
    }

    function canReroll(data) {
        if(data?.workflow) return false;
        const id=data?.workflowRootMessageId??data?.workflow?.messageId;if(!id) return true;
        const state=stateFor(id);if(!state) return false;
        return !state.targets.some(row=>row.operation||row.pinning?.operation||row.pinning?.conditionApplied
            ||['applied','applying','needsReview'].includes(row.phase));
    }

    async function create(data,chatData) {
        if(data?.flags?.isReRoll&&data.workflowRootMessageId) {
            // Parent must call submitRoll before ChatMessage.create for this case.
            return;
        }
        if(!enabled(data)||!Array.isArray(data.targets)||!data.targets.length) return;
        const attacker=native.actorFromRoll(data);
        if(!attacker?.uuid||!owns(attacker,host().user)) throw Error('Attacker ownership required');
        const targets=[];
        for(const target of data.targets) {
            const token=await resolve(uuidFor(target));
            if(!host().user.isGM&&(token.hidden||token.object?.visible!==true)) throw Error('Target is not visible');
            targets.push({...target,tokenUuid:token.uuid,actorUuid:token.actor.uuid,hidden:token.hidden===true,name:token.name});
        }
        data.targets=targets;
        const id=chatData._id??runtime.foundry?.utils?.randomID?.()??randomId();chatData._id=id;data.workflowRootMessageId=id;
        const area=['blast','spray'].includes(data.attackArea?.kind);
        const targetHits=area?Object.fromEntries(targets.map(target=>[target.tokenUuid,Number(data.numberOfHits)||0])):{};
        const state=createAttackWorkflow(data,{id,attackerUuid:attacker.uuid,createdBy:host().user.id,targetHits,area});
        chatData.flags??={};
        chatData.flags[`${SCOPE}.rollData`]=serializeWorkflowRollData(data);
        chatData.flags[`${SCOPE}.combatWorkflow`]=state;
        chatData.flags[`${SCOPE}.workflowBaseContent`]=chatData.content;
        chatData.content+=await render(state);
        if(targets.some(target=>target.hidden)) {
            chatData.whisper=values(host().users).filter(user=>user.isGM).map(user=>user.id);chatData.blind=true;
        }
    }

    async function request(action,rootId,tokenUuid,{operationId,resultData,rolls,targetHits}={}) {
        const state=stateFor(rootId);if(!state) throw Error('Attack card no longer exists');
        if(!gm()) throw Error('A connected GM is required');
        const spec={workflowId:rootId,tokenUuid,expectedGeneration:state.generation,action};
        if(operationId) spec.operationId=operationId;
        if(resultData) spec.resultData=serializeWorkflowRollData(resultData);
        if(targetHits) spec.targetHits=targetHits;
        const created=await runtime.ChatMessage.create({user:host().user.id,whisper:values(host().users).filter(user=>user.isGM).map(user=>user.id),
            blind:true,content:'',rolls:rolls??[],flags:{[`${SCOPE}.combatWorkflowRequest`]:spec}});
        if(authority()) await processRequest(created.id);
        else host().socket?.emit?.('system.apex-heresy-ru',{type:'combatWorkflowRequest',messageId:created.id});
        for(let attempt=0;attempt<150;attempt++) {
            const response=flag(message(created.id)??created,'combatWorkflowRequestStatus');
            if(response?.status==='complete') return {request:created,state:stateFor(rootId)};
            if(response?.status==='error') throw Error(response.error??'Combat workflow request failed');
            await sleep(100);
        }
        throw Error(tr('COMBAT_FLOW.REQUEST_TIMEOUT'));
    }

    async function startReaction(id,tokenUuid,type) {
        const claimed=await request(type,id,tokenUuid);
        const state=claimed.state,row=state?.targets?.find(target=>target.tokenUuid===tokenUuid);
        const operation=type==='suppression'?row?.pinning?.operation:row?.operation;
        if(operation?.id!==claimed.request.id||operation.by!==host().user.id) throw Error('Reaction claim was not acknowledged');
        const root=message(id),data=await native.buildReaction(clone(getData(root)),clone(row),type);
        if(!data) {await request('cancel',id,tokenUuid,{operationId:operation.id});return;}
        data.workflow={messageId:id,tokenUuid,generation:state.generation,action:type,operationId:operation.id};
        try {await native.openReaction(data);} catch(error) {
            notify(error);throw error;
        }
    }

    async function submitRoll(data) {
        data.workflowSubmitted=true;
        const workflow=data.workflow;
        if(!workflow&&data.flags?.isReRoll&&data.workflowRootMessageId) {
            if(!canReroll(data)) throw Error('Attack has committed or unresolved dependent operations');
            const rootId=data.workflowRootMessageId;
            if(typeof data.rollObject?.render==='function') data.render=await data.rollObject.render();
            await request('reroll',rootId,null,{resultData:data,rolls:data.rollObject?[data.rollObject]:[]});
            return message(rootId);
        }
        if(!workflow?.messageId) return null;
        const root=message(workflow.messageId);if(!root) throw Error('Attack card no longer exists');
        const pending=pendingNative.get(workflow.operationId);
        if(pending) {pending.data=serializeWorkflowRollData(data);return root;}
        const state=stateFor(root.id);
        if(workflow.generation!==state?.generation) throw Error('Attack was replaced by a reroll');
        const row=state.targets.find(target=>target.tokenUuid===workflow.tokenUuid);
        const token=await resolve(workflow.tokenUuid);
        if(!row||token.actor.uuid!==row.actorUuid||!owns(token.actor,host().user)) throw Error('Defender ownership required');
        const action=workflow.action==='suppression'?'suppressionResult':'reactionResult';
        await request(action,root.id,workflow.tokenUuid,{operationId:workflow.operationId,resultData:data,
            rolls:data.rollObject?[data.rollObject]:[]});
        return root;
    }

    async function cancelRoll(data) {
        const workflow=data?.workflow;if(!workflow||data.workflowSubmitted||data.workflowCancelled) return;
        data.workflowCancelled=true;
        return request('cancel',workflow.messageId,workflow.tokenUuid,{operationId:workflow.operationId});
    }

    function modifiers(data) {
        const parts=[];
        for(const [label,value] of [[tr('COMBAT_FLOW.MODIFIER'),data.target?.modifier],[tr('COMBAT_FLOW.DIFFICULTY'),data.difficulty?.value??data.difficulty]])
            if(Number(value)) parts.push(`${label}: ${Number(value)>0?'+':''}${Number(value)}`);
        return parts.join('; ');
    }

    async function executeRequest(req) {
        if(!authority()) return;
        const spec=flag(req,'combatWorkflowRequest');if(!spec||typeof spec.workflowId!=='string') return;
        const root=message(spec.workflowId),state=stateFor(spec.workflowId);
        if(!root||!state) throw Error('Attack card no longer exists');
        const evidence={request:req},command={tokenUuid:spec.tokenUuid,operationId:spec.operationId??req.id,expectedGeneration:spec.expectedGeneration};
        const row=state.targets.find(target=>target.tokenUuid===spec.tokenUuid);
        if(['dodge','parry','agility','suppression'].includes(spec.action)) {
            await controller.dispatch(root.id,{...command,type:spec.action==='suppression'?'pinningStart':'reactionStart'},evidence);return;
        }
        if(spec.action==='decline') {await controller.dispatch(root.id,{...command,type:'declineReaction'},evidence);return;}
        if(spec.action==='cancel') {await controller.dispatch(root.id,{...command,type:'operationCancelled'},evidence);return;}
        if(spec.action==='allocate') {await controller.dispatch(root.id,{...command,type:'allocateHits',targetHits:spec.targetHits},evidence);return;}
        if(spec.action==='reroll') {
            const result=spec.resultData,original=getData(root);verifyNativeReaction(req,result,original);
            if(Number(result.target?.final)!==Number(original.target?.final)||result.actorUuid!==original.actorUuid)
                throw Error('Fate reroll changed the original attack snapshot');
            const canonical=clone(original);
            for(const key of ['result','unmodifiedResult','dos','dof','autoOutcome','unnaturalDosBonus','attackDos','attackResult','weaponJammed','weaponOverheated','render'])
                if(result[key]!==undefined) canonical[key]=result[key];
            canonical.flags={...canonical.flags,isReRoll:true,isSuccess:!!result.flags?.isSuccess};
            if(typeof result.flags?.rsaRequestId==='string') canonical.flags.rsaRequestId=result.flags.rsaRequestId;
            canonical.attackDos=Number(canonical.dos)||0;canonical.attackResult=Number(canonical.result);
            if(typeof native.attackHits!=='function') throw Error('Native Fate hit calculation is unavailable');
            canonical.numberOfHits=await native.attackHits(canonical);
            const area=['blast','spray'].includes(canonical.attackArea?.kind),targetHits=area
                ?Object.fromEntries(canonical.targets.map(target=>[uuidFor(target),Number(canonical.numberOfHits)||0])):{};
            pendingRerolls.set(root.id,{data:canonical,html:await native.renderRoll(canonical),rolls:values(req.rolls)});
            try {await controller.dispatch(root.id,{...command,type:'rerollAttack',rollData:canonical,targetHits},evidence);}
            finally {pendingRerolls.delete(root.id);}
            return;
        }
        if(['reactionResult','suppressionResult'].includes(spec.action)) {
            const data=spec.resultData;
            const token=await resolve(row?.tokenUuid);
            if(data.workflow?.messageId!==root.id||data.workflow?.tokenUuid!==row.tokenUuid
                ||data.workflow?.operationId!==command.operationId||data.workflow?.generation!==state.generation)
                throw Error('Native result does not belong to the pending reaction');
            const type=spec.action==='suppressionResult'?'suppression':data.workflow.action;
            const canonical=await native.buildReaction(clone(getData(root)),clone(row),type);
            verifyNativeReaction(req,data,canonical);
            if(data.actorUuid!==token.actor.uuid) throw Error('Native reaction Actor changed');
            const result={type,result:Number(data.result),target:Number(data.target.final),success:!!data.flags?.isSuccess,
                dos:Number(data.dos)||0,dof:Number(data.dof)||0,modifiers:modifiers(data)};
            if(type==='suppression') {
                // Persist the authored/native result and condition as one claimed operation.
                const ctx=await context(root.id,evidence,state);
                if(!ctx.isGM&&!ctx.ownsTarget(row)) throw Error('Defender ownership required');
                await verify(root.id,{...command,type:'pinningResolved'},evidence,state);
                const next=transitionAttackWorkflow(state,{...command,type:'pinningResolved',result,conditionApplied:!result.success},ctx);
                if(next.revision===state.revision) return;
                let mutationStarted=false;
                try {
                    if(!result.success) {mutationStarted=true;await native.applyPinning(token.actor);}
                    await controller.dispatch(root.id,{...command,type:'pinningResolved',result,conditionApplied:!result.success},evidence);
                } catch(error) {
                    if(mutationStarted) {
                        trustedResults.add(evidence);
                        try {await controller.dispatch(root.id,{...command,type:'operationFailed',error:String(error?.message??error)},evidence);} catch {}
                    }
                    throw error;
                }
            } else {
                const remainingHits=await native.computeRemaining(clone(getData(root)),clone(row),data);
                await controller.dispatch(root.id,{...command,type:'reactionResolved',result,remainingHits},evidence);
            }
            return;
        }
        if(spec.action==='damage') {
            await controller.perform(root.id,{...command,type:'damageStart'},evidence,async next=>{
                trustedResults.add(evidence);
                const current=next.targets.find(target=>target.tokenUuid===command.tokenUuid);
                const data=clone(getData(root));data.targets=[{tokenUuid:current.tokenUuid,actorUuid:current.actorUuid,
                    sceneId:current.tokenUuid.split('.')[1],tokenId:current.tokenUuid.split('.')[3],name:current.name}];
                data.numberOfHits=next.sharedDamage?next.attack.hits:current.remainingHits;
                data.flags={...data.flags,isAttack:false,isEvasion:false,isDamageRoll:true,isCombatRoll:false};
                data.workflow={messageId:root.id,tokenUuid:current.tokenUuid,generation:next.generation,action:'damage',operationId:command.operationId};
                const capture={data:null};pendingNative.set(command.operationId,capture);
                try {await native.rollDamage(data);} finally {pendingNative.delete(command.operationId);}
                if(!capture.data?.damages?.length) throw Error('Native damage produced no result');
                trustedResults.add(evidence);return {rollData:capture.data};
            });return;
        }
        if(spec.action==='apply') {
            await controller.perform(root.id,{...command,type:'applyStart'},evidence,async next=>{
                trustedResults.add(evidence);
                const current=next.targets.find(target=>target.tokenUuid===command.tokenUuid);
                const receipt=await native.applyDamage(root,clone(current),command.operationId);
                if(receipt===false||receipt?.cancelled) {trustedResults.add(evidence);return {cancelled:true};}
                if(!receipt?.receiptId) throw Error('Native application receipt is unavailable');
                trustedResults.add(evidence);return receipt;
            });return;
        }
        throw Error('Unknown combat workflow action');
    }

    async function processRequest(id) {
        if(!authority()||typeof id!=='string') return;
        const req=message(id);if(!flag(req,'combatWorkflowRequest')) return;
        if(['complete','error'].includes(flag(req,'combatWorkflowRequestStatus')?.status)) return;
        if(processing.has(id)) return processing.get(id);
        const rootId=flag(req,'combatWorkflowRequest').workflowId;
        const previous=rootQueues.get(rootId)??Promise.resolve();
        const pending=previous.catch(()=>{}).then(async()=>{
            try {await executeRequest(req);await req.update({[`flags.${SCOPE}.combatWorkflowRequestStatus`]:{status:'complete'}});}
            catch(error) {await req.update({[`flags.${SCOPE}.combatWorkflowRequestStatus`]:{status:'error',error:String(error?.message??error).slice(0,240)}});notify(error);}
        });processing.set(id,pending);rootQueues.set(rootId,pending);
        try {await pending;} finally {processing.delete(id);if(rootQueues.get(rootId)===pending) rootQueues.delete(rootId);}
    }
    async function onRequestMessage(req) {if(authority()&&flag(req,'combatWorkflowRequest')) return processRequest(req.id);}

    async function allocate(id) {
        const state=stateFor(id);if(!host().user.isGM||!state) throw Error('Only the GM can allocate hits');
        const result=await runtime.foundry.applications.api.DialogV2.prompt({window:{title:tr('COMBAT_FLOW.ALLOCATE')},modal:true,rejectClose:false,
            content:state.targets.map((row,index)=>`<label>${escape(row.name||`${tr('COMBAT_FLOW.TARGET')} ${index+1}`)}<input type="number" name="hits-${index}" min="0" max="${state.attack.hits}" value="${row.hits}"></label>`).join(''),
            ok:{callback:(_event,button)=>Object.fromEntries(state.targets.map((row,index)=>[row.tokenUuid,Number(button.form.elements[`hits-${index}`].value)]))}});
        if(result) return request('allocate',id,null,{targetHits:result});
    }

    async function activate(root,html) {
        if(flag(root,'combatWorkflowRequest')) {const element=html?.[0]??html;
            const container=element?.closest?.('li.message')??element;if(container) container.hidden=true;return;}
        const state=flag(root,'combatWorkflow');if(!state) return;
        const element=html?.[0]??html;if(!element?.querySelector) return;
        const user=host().user,ownership=new Map();
        for(const row of state.targets) {
            try {const token=await resolve(row.tokenUuid);ownership.set(row.tokenUuid,owns(token.actor,user));} catch {ownership.set(row.tokenUuid,false);}
        }
        const attacker=await sourceActor(state,root);
        const rendered=await render(state,{userId:user.id,isGM:user.isGM,ownsAttacker:owns(attacker,user),
            ownsTarget:row=>ownership.get(row.tokenUuid),canSeeTarget:row=>!row.hidden});
        if(stateFor(root.id)?.revision!==state.revision) return;
        const current=element.querySelector('.dh-attack-workflow');if(current) current.outerHTML=rendered;
        for(const old of element.querySelectorAll('.invoke-test,.invoke-damage,.invoke-suppression')) old.hidden=true;
        for(const button of element.querySelectorAll('[data-workflow-action]')) button.addEventListener('click',async event=>{
            event.preventDefault();event.stopPropagation();button.disabled=true;
            const action=button.dataset.workflowAction,tokenUuid=button.closest('[data-target-token-uuid]')?.dataset.targetTokenUuid;
            try {
                if(action==='allocate') await allocate(root.id);
                else if(['dodge','parry','suppression'].includes(action)) {
                    const row=stateFor(root.id)?.targets.find(row=>row.tokenUuid===tokenUuid);
                    await startReaction(root.id,tokenUuid,action==='dodge'&&row?.defenseType==='agility'?'agility':action);
                } else await request(action,root.id,tokenUuid);
            } catch(error) {notify(error);button.disabled=false;}
        });
    }

    return Object.freeze({enabled,create,submitRoll,activate,onRequestMessage,processRequest,cancelRoll,canReroll,
        // Host-facing entry points also make authenticated bridge behavior testable.
        request,startReaction,controller});
}
