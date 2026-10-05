export const SCOPE='riftan-smart-assessment';
export function rollData(message) {return message?.getFlag?.('dark-heresy','rollData');}
export function fateActor(data, resolve, actors) {
    const evasion=data?.flags?.isEvasion ? data.evasions?.[data.evasions.selected] : null;
    if (evasion?.actorUuid) return resolve(evasion.actorUuid);
    if (evasion?.ownerId && evasion.ownerId!==data.ownerId) return actors.get(evasion.ownerId);
    if (data?.actorUuid) return resolve(data.actorUuid);
    if (data?.tokenId && data?.sceneId) return resolve(`Scene.${data.sceneId}.Token.${data.tokenId}.Actor`);
    return actors.get(data?.ownerId);
}
export function visibleTo(message,user) {
    if (user.isGM) return true;
    if (message.blind) return false;
    const recipients=(message.whisper??[]).map(value=>typeof value==='string'?value:value.id);
    return !recipients.length || recipients.includes(user.id) || message.author?.id===user.id;
}
export function validateReroll(message,actor,user,messages,config={}) {
    const data=rollData(message);
    if (!data || !message.isRoll || data.flags?.isDamageRoll || data.flags?.isRegeneration || !Number.isFinite(Number(data.target?.final)) || !Number.isFinite(Number(data.result))) throw new Error('UNSUPPORTED');
    if (!actor || !visibleTo(message,user) || (!user.isGM && !actor.testUserPermission(user,'OWNER'))) throw new Error('NO_PERMISSION');
    if (data.flags?.isSuccess !== false) throw new Error('NOT_FAILED');
    if (data.flags?.isReRoll || message.getFlag(SCOPE,'replacement') || [...messages].some(m=>m.getFlag(SCOPE,'fate')?.sourceId===message.id)) throw new Error('USED');
    if (actor.type==='heretic') {
        const rules=config.infamyPatronRules?.[actor.system.patron]??{};
        if (rules.deny?.includes('reroll') || (config.getInfamyLevel?.(actor.corruption)??0)<2) throw new Error('UNSUPPORTED');
    }
    const points=Number(actor.system.fate?.value);
    if (!Number.isFinite(points) || points<1) throw new Error('NO_FATE');
    return data;
}
export function copyReroll(data,actor,requestId,clone) {
    const next=clone(data);
    for (const key of ['damages','rollObject','render','dos','dof','weaponJammed','massEvasionResults']) delete next[key];
    next.flags={...next.flags,isReRoll:true,rsaRequestId:requestId};
    next.actorUuid=actor.uuid;next.ownerId=actor.id;
    if (actor.token) next.tokenId=actor.token.id;else delete next.tokenId;
    if (next.flags.isCombatRoll) next.attributeBoni=actor.attributeBoni;
    return next;
}
/** One authority queues all requests for a shared Actor. The adapter supplies the native roll engine. */
export function createFateService(adapter) {
    const queues=new Map();
    return request => {
        const actor=adapter.actor(request),key=actor?.uuid??'missing';
        const previous=queues.get(key)??Promise.resolve();
        const operation=previous.catch(()=>{}).then(async()=>{
            const source=adapter.source(request),user=adapter.user(request);
            if (adapter.done(request)) return;
            const data=validateReroll(source,actor,user,adapter.messages(),adapter.config());
            const before=Number(actor.system.fate.value);
            let result;
            await actor.update({'system.fate.value':before-1});
            try {
                result=await adapter.execute(copyReroll(data,actor,request.id,adapter.clone),source,{sourceId:source.id,before:Number(data.result),fateBefore:before,fateAfter:before-1});
            } catch(error) {
                // Serialized spending: refund this point without discarding unrelated changes.
                await actor.update({'system.fate.value':Number(actor.system.fate.value)+1});
                throw error;
            }
            // Once a result exists, failures updating history must never refund or allow another reroll.
            await adapter.finish(request,source,result);
            return result;
        });
        queues.set(key,operation);
        operation.finally(()=>{if(queues.get(key)===operation)queues.delete(key);}).catch(()=>{});
        return operation;
    };
}
