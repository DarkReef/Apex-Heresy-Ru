import {createDamageService} from './damage-service.mjs';
import {createDamageVault} from './damage-vault.mjs';
import {planOWDamage, damageReviewReasons} from './ow-damage.mjs';
import {fieldProtects} from './force-field.mjs';
import {ruleName} from '../localization/rule-name.mjs';

const SCOPE='dark-heresy', MODULE='riftan-smart-assessment';
const clone=value=>foundry.utils.deepClone(value);
const authority=()=>Boolean(game.user?.isGM && game.user.id===game.users.activeGM?.id);
const visible=(message,user)=>Boolean(user?.isGM || (!message.blind &&
    (!message.whisper.length || message.whisper.includes(user.id) || message.author?.id===user.id)));
export function registerDamageSettings() {
    game.settings.register(SCOPE,'damageJournalKey',{scope:'client',config:false,type:String,default:''});
}
export function damageConfirmationEnabled(host = globalThis.game) {
    return host?.modules?.get?.(MODULE)?.active===true && host.darkHeresy?.api?.damage?.version===1;
}
export function createFoundryDamageAPI({queue, rulesetFor, attackerFromRoll}) {
    const key=()=>{
        const value=game.settings.get(SCOPE,'damageJournalKey');
        if(!/^[0-9a-f]{64}$/.test(value)) throw Error('Private GM journal key unavailable');
        return value;
    };
    const vault=createDamageVault({key});
    const ensureKey=async()=>{
        if(!authority()) throw Error('Only the active GM may create journals');
        if(!game.settings.get(SCOPE,'damageJournalKey')) {
            const value=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
            await game.settings.set(SCOPE,'damageJournalKey',value);
        }
    };
    const journal=async(id)=>{
        const message=game.messages.get(id);
        if(!message || !game.user.isGM) throw Error('Journal unavailable');
        const data=await vault.decrypt(message.getFlag(SCOPE,'damageJournal'));
        return {...data,id};
    };
    const chain=message=>{
        const result=[],seen=new Set();let current=message;
        while(current && !seen.has(current.id) && result.length<12) {
            seen.add(current.id);result.push(current);
            const currentData=current.getFlag(SCOPE,'rollData');
            if(currentData?.flags?.isAttack && !currentData.flags.isDamageRoll && !currentData.flags.isEvasion) return result;
            const id=current.getFlag(SCOPE,'rollData')?.sourceMessageId;
            if(!id) return result;
            current=game.messages.get(id);
            if(!current) throw Error('Missing original attack card');
        }
        throw Error('Invalid attack ancestry');
    };
    const evidence=async(input)=>{
        const request=input.requestId ? game.messages.get(input.requestId) : null;
        const spec=request?.getFlag(SCOPE,'damageRequest')??input;
        const initiator=request ? request.author : game.user;
        if(!initiator) throw Error('Request author missing');
        const message=game.messages.get(spec.messageId);
        if(!message || !visible(message,initiator)) throw Error('Original card is not visible to the initiator');
        const data=message.getFlag(SCOPE,'rollData');
        if(!data?.flags?.isDamageRoll || !data.damages?.length || data.multiDamages?.length || data.flags.isMassEvasion)
            throw Error('unsupported: requires a single native damage result');
        const ancestry=chain(message),root=ancestry.at(-1);
        if(ancestry.some(m=>{const r=m.getFlag(SCOPE,'rollData');return r?.flags?.isAttack && r.flags.isSuccess===false && !r.weapon?.traits?.skipAttackRoll;}))
            throw Error('unsupported: original attack failed');
        for(const parent of ancestry) {
            const replaced=parent.getFlag(MODULE,'fate')?.sourceId;
            const original=replaced ? game.messages.get(replaced) : null;
            if(original && chain(original).some(m=>m.getFlag(SCOPE,'damageClaim') || m.getFlag(SCOPE,'appliedDamage')))
                throw Error('needs-review: original Fate result already has a damage operation');
        }
        const attacker=attackerFromRoll(data);
        if(!attacker || (!initiator.isGM && !attacker.testUserPermission(initiator,'OWNER'))) throw Error('Initiator does not own the attacking actor');
        if(rulesetFor(attacker).id!=='ow') throw Error('unsupported: attacker ruleset is not Only War');
        if(ancestry.some(m=>!visible(m,initiator))) throw Error('Original attack is not visible');
        if(ancestry.some(m=>m.getFlag(MODULE,'replacement')) || game.messages.contents.some(m=>
            ancestry.some(parent=>m.getFlag(MODULE,'fate')?.sourceId===parent.id))) {
            throw Error('stale: attack replaced by Fate reroll');
        }
        if(!spec.tokenUuid) throw Error('Choose exactly one recorded target Token UUID');
        const token=await fromUuid(spec.tokenUuid);
        if(token?.documentName!=='Token' || !token.actor) throw Error('Target Token no longer exists');
        const actor=token.actor;
        if(spec.actorUuid && actor.uuid!==spec.actorUuid) throw Error('stale: actual target Actor changed');
        const recorded=(data.targets??[]).some(t=>t.tokenId===token.id && t.sceneId===token.parent?.id);
        if(!recorded && !(initiator.isGM && spec.targetReason?.trim())) throw Error('Target is not recorded in this attack');
        if(rulesetFor(actor).id!=='ow' || !['acolyte','heretic','npc'].includes(actor.type) || Number(actor.horde)>0)
            throw Error('unsupported: only ordinary OW characters/NPCs are supported');
        if(data.psy?.useModifier || data.weapon?.weaponClass==='psychic') throw Error('unsupported: psychic attack cycle');
        const hits=data.damages.map((d,i)=>({id:`${root.id}:hit-${i}`,amount:Number(d.total),
            location:d.location,penetration:Number(d.penetration??0),type:data.weapon?.damageType,
            righteousFury:Number(d.righteousFury||0),weaponTraits:clone(d.weaponTraits??data.weapon?.traits??{}),
            bypassDaemonic:d.bypassDaemonic ?? ((data.weapon?.traits?.sanctified || data.weapon?.traits?.force) ? true : null),
            dice:clone(d.damageRoll?.toJSON?.()??d.damageRoll??null),attackDos:Number(data.attackDos??data.dos??0)}));
        if(hits.some(h=>!Number.isFinite(h.amount)||h.amount<0||!Number.isFinite(h.penetration)||h.penetration<0)) throw Error('Invalid stored damage result');
        const reactionResolved=ancestry.some(m=>{
            const r=m.getFlag(SCOPE,'rollData');
            const defender=r?.evasions?.[r.evasions?.selected]?.actorUuid;
            const authorized=m.author?.isGM || actor.testUserPermission?.(m.author,'OWNER');
            return authorized && r?.flags?.isEvasion && (!defender || defender===actor.uuid) &&
                r.evasionActorTokenId===token.id && r.evasionActorSceneId===token.parent?.id;
        });
        const attack={version:1,messageId:message.id,rootId:root.id,sourceIds:ancestry.map(m=>m.id),
            attackerUuid:attacker.uuid,itemId:data.itemId,weapon:clone(data.weapon??{}),hits,
            review:[...(data.weapon?.damageProfileVersion===1?[]:['Legacy weapon result lacks verified trait metadata']),
                ...(data.weapon?.unresolvedTraits??[]).map(t=>`Unresolved weapon property: ${t}`),
                ...(attacker.items?.some(i=>/^(Crack Shot|Crippling Strike)$/i.test(ruleName(i)))?['Attacker critical damage talent needs review']:[])]};
        return {message,root,ancestry,actor,token,attack,attackerName:attacker.name,targetName:token.name??actor.name,
            target:{tokenUuid:token.uuid,actorUuid:actor.uuid},reactionResolved,
            sourceState:ancestry.map(m=>({id:m.id,replacement:m.getFlag(MODULE,'replacement')??null,
                result:m.getFlag(SCOPE,'rollData')?.result,dos:m.getFlag(SCOPE,'rollData')?.dos}))};
    };
    const wornField=actor=>{
        const items=actor.items.filter(i=>i.type==='forceField' && i.system.equipped && !i.getFlag(SCOPE,'overloaded'));
        if(!items.length) return null;
        const item=items[0],name=ruleName(item);
        const rating=Number(item.system.protectionRating);
        const valid=Number.isFinite(rating) && rating>=1 && rating<=100 && ['poor','common','good','best'].includes(item.system.craftsmanship??'common');
        const review=!valid ? 'Invalid/unverified field data; resolve manually' : items.length>1 ? 'Choose one active field manually' :
            !/^(Refractor Field|Отражающее поле)$/i.test(name) ? 'This field has unverified exceptions/secondary effects; resolve manually' : null;
        return {uuid:item.uuid,name,protectionRating:Number(item.system.protectionRating),
            overloadChance:item.system.overloadChance,craftsmanship:item.system.craftsmanship,
            overloaded:false,review};
    };
    const readWounds=actor=>clone(actor.system.wounds);
    const service=createDamageService({
        isAuthority:authority,userId:()=>game.user.id,queue,evidence,
        defense:actor=>actor._owDamageDefense(), plan:planOWDamage,
        review:(defense,hits,attack)=>[...damageReviewReasons(defense,hits),...attack.review],
        field:wornField,effects:actor=>Array.from(actor.allApplicableEffects()).map(e=>e.toObject()),
        fingerprint:async state=>{
            if(!globalThis.crypto?.subtle) throw Error('unsupported: damage journals require HTTPS or localhost (WebCrypto)');
            const bytes=new TextEncoder().encode(JSON.stringify(state));
            return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
        },
        claim:e=>e.actor.getFlag(SCOPE,'damageMessageReceipts')?.[e.message.id] ??
            e.actor.getFlag(SCOPE,'damageAttackReceipts')?.[e.root.id] ?? e.root.getFlag(SCOPE,'damageClaim') ??
            (e.ancestry.some(m=>m.getFlag(SCOPE,'damageOperation') || m.getFlag(SCOPE,'appliedDamage')) ? {legacy:true} : null),
        claimAttack:async(e,id)=>{
            await e.root.setFlag(SCOPE,'damageClaim',{id});
            await e.actor.update({[`flags.${SCOPE}.damageAttackReceipts.${e.root.id}`]:{id,status:'processing'},
                [`flags.${SCOPE}.damageMessageReceipts.${e.message.id}`]:{id,status:'processing'}});
            if(e.actor.getFlag(SCOPE,'damageAttackReceipts')?.[e.root.id]?.id!==id || e.root.getFlag(SCOPE,'damageClaim')?.id!==id)
                throw Error('Operation intent was not persisted');
        },
        readJournal:journal,
        createJournal:async op=>{
            await ensureKey();
            const message=await ChatMessage.create({content:'<p>Расчёт урона для ведущего</p>',
                whisper:game.users.filter(u=>u.isGM).map(u=>u.id),blind:true,
                flags:{[SCOPE]:{damageJournal:await vault.encrypt(op)}}});return message.id;
        },
        saveJournal:async op=>{
            if(!authority()) throw Error('Active GM changed during operation');
            const message=game.messages.get(op.id),encrypted=await vault.encrypt(op);
            await message.setFlag(SCOPE,'damageJournal',encrypted);
            if(message.getFlag(SCOPE,'damageJournal')?.ciphertext!==encrypted.ciphertext)
                throw Error('Journal write was not confirmed');
        },
        wounds:readWounds,actorMarker:(actor,id)=>actor.getFlag(SCOPE,'damageReceipts')?.[id],
        apply:async(actor,plan,id,rootId,sourceId)=>{
            actor._suppressWoundsFloat=true;
            const source=actor._source?.system?.wounds??actor.system.wounds;
            try {await actor.update({'system.wounds.value':Number(source.value)+plan.wounds-plan.before.value,
                'system.wounds.critical':Number(source.critical)+plan.criticalWounds-plan.before.critical,
                [`flags.${SCOPE}.damageReceipts.${id}`]:{status:'applied'},
                [`flags.${SCOPE}.damageMessageReceipts.${sourceId}`]:{id,status:'applied'},
                [`flags.${SCOPE}.damageAttackReceipts.${rootId}`]:{id,status:'applied'}});}
            finally {delete actor._suppressWoundsFloat;}
            if(actor.getFlag(SCOPE,'damageReceipts')?.[id]?.status!=='applied') throw Error('Actor receipt marker was not persisted');
        },
        validateEffects:effects=>{
            if(!Array.isArray(effects) || effects.some(e=>!CONFIG.statusEffects.some(s=>s.id===e.condition) ||
                !Number.isInteger(e.rounds)||e.rounds<1)) throw Error('Invalid manual condition');
        },
        addEffect:async(actor,e,id)=>{
            const before=actor.hasCondition?.(e.condition);
            const effect=await actor.addCondition(e.condition,{rounds:e.rounds}, {flags:{[SCOPE]:{damageReceipt:id}}});
            return {id:effect?.id,created:!before};
        },
        rollField:async(field,e)=>{
            const roll=await new Roll('1d100').evaluate();
            const outcome=fieldProtects({field,roll:roll.total});return {...outcome,roll:roll.total};
        },
        overload:async(actor,field)=>{
            const item=actor.items.find(i=>i.uuid===field.uuid);if(!item) throw Error('Field removed');
            await item.setFlag(SCOPE,'overloaded',true);
        },
        announce:async(e,op)=>{
            // No defense, remaining wounds, hidden identity or numeric receipt in public flags/content.
            await e.message.setFlag(SCOPE,'damageConfirmation',{status:'applied',receiptId:op.id});
            await ChatMessage.create({content:'<p>Урон подтверждён ведущим.</p>',whisper:[...e.message.whisper],blind:e.message.blind,
                flags:{[SCOPE]:{damageSummary:{sourceId:e.message.id,status:'applied'}}}});
        }
    });
    const request=async(input)=>{
        if(!game.users.activeGM) throw Error('No active GM');
        const e=await evidence(input);
        const existing=game.messages.contents.find(m=>m.author?.id===game.user.id &&
            m.getFlag(SCOPE,'damageRequest')?.messageId===e.message.id &&
            m.getFlag(SCOPE,'damageRequest')?.tokenUuid===e.target.tokenUuid);
        if(existing) return existing;
        return ChatMessage.create({content:'<p>Запрос подтверждения урона.</p>',whisper:game.users.filter(u=>u.isGM).map(u=>u.id),
            flags:{[SCOPE]:{damageRequest:{version:1,messageId:e.message.id,...e.target,targetReason:input.targetReason??''}}}});
    };
    return Object.freeze({...service,request});
}
