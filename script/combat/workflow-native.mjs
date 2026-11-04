/** Adapters to the existing combat rules. No second damage or condition engine. */
import {damageReviewReasons} from './ow-damage.mjs';
export function createWorkflowNativeAdapters({util,computeRemainingHits,entriesFromRoll,queue,interceptField,readFlag,host=globalThis}) {
    const {game,foundry}=host;
    const clone=value=>foundry.utils.deepClone(value);
    const tokenFor=row=>{
        const match=/^Scene\.([^.]+)\.Token\.([^.]+)$/.exec(row.tokenUuid??'');
        const token=match&&game.scenes.get(match[1])?.tokens.get(match[2]);
        if(!token?.actor || token.actor.uuid!==row.actorUuid) throw Error(game.i18n.localize('COMBAT_FLOW.TARGET_CHANGED'));
        return token;
    };
    const defenseState=actor=>JSON.stringify({wounds:actor._source?.system?.wounds??actor.system.wounds,
        defense:actor._owDamageDefense?.(),effects:[...actor.allApplicableEffects()].map(e=>e.toObject()),
        fields:actor.items.filter(i=>i.type==='forceField').map(i=>i.toObject())});
    return {
        buildReaction(root,row,type) {
            const token=tokenFor(row),actor=token.actor;
            if(!actor.isOwner&&!game.user.isGM) throw Error(game.i18n.localize('COMBAT_FLOW.NO_PERMISSION'));
            const pinning=type==='suppression',agility=type==='agility'||root.attackArea?.kind==='spray';
            const selected=agility?'agility':type;
            let data;
            if(pinning||agility) {
                data=util.createCharacteristicRollData(actor,pinning?'willpower':'agility');
                data.name=game.i18n.localize(pinning?'SUPPRESSION.HEADER':'CHARACTERISTIC.AGILITY');
                data.target.modifier=pinning?(root.suppressionLength==='full'?-20:-10):0;
                data.flags={...data.flags,isSuppressionTest:pinning,isAttack:false,isEvasion:false,isDamageRoll:false,isCombatRoll:false};
            } else {
                data=clone(root);
                data.name=game.i18n.localize(agility?'CHARACTERISTIC.AGILITY':selected==='parry'?'SKILL.PARRY':'SKILL.DODGE');
                data.evasions={selected,
                    dodge:util.createSkillRollData(actor,'dodge'),parry:util.createSkillRollData(actor,'parry'),
                    agility:util.createCharacteristicRollData(actor,'agility')};
                data.workflowEvasionOptions=[{value:selected,label:data.name}];
                data.target={...data.evasions[selected].target,modifier:Number(root.evasionModifier)||0};
                data.flags={...data.flags,isEvasion:true,isAttack:false,isDamageRoll:false,isCombatRoll:false};
                data.evasionActor=actor.name;
                data.evasionActorTokenId=token.id;data.evasionActorSceneId=token.parent.id;
            }
            data.actorUuid=actor.uuid;data.ownerId=actor.id;data.tokenId=token.id;
            data.targets=[{tokenUuid:token.uuid,sceneId:token.parent.id,tokenId:token.id,actorUuid:actor.uuid,name:token.name}];
            data.numberOfHits=row.hits;data.difficulty=0;
            delete data.rollObject;delete data.render;delete data.damages;
            return data;
        },
        computeRemaining(root,row,result) {
            if(!result.flags?.isSuccess) return row.hits;
            if(root.attackArea?.kind==='spray'||root.weapon?.traits?.skipAttackRoll) return 0;
            if(!root.attackType) return Math.max(0,row.hits-(Number(result.dos)||0));
            const all=computeRemainingHits(Number(root.attackDos)||0,Number(result.dos)||0,
                root.attackType,root.shotsFired,root.weapon?.traits??{});
            const cancelled=Math.max(0,(Number(root.numberOfHits)||0)-all);
            return Math.max(0,row.hits-cancelled);
        },
        async applyDamage(message,row,operationId) {
            if(!game.user.isGM||game.user.id!==game.users.activeGM?.id) throw Error(game.i18n.localize('COMBAT_FLOW.GM_REQUIRED'));
            const token=tokenFor(row),actor=token.actor;
            const data=row.damage?.rollData,damages=entriesFromRoll(data??{});
            if(!damages.length||damages.some(d=>!Number.isFinite(d.amount)||d.amount<0||!Number.isFinite(d.penetration)||d.penetration<0))
                throw Error(game.i18n.localize('COMBAT_FLOW.INVALID_RESULT'));
            const receiptKey=`${message.id}_${row.index}_${readFlag(message,'combatWorkflow')?.generation??0}`;
            const old=readFlag(actor,'combatWorkflowReceipts')?.[receiptKey];
            if(old) throw Error(game.i18n.localize('COMBAT_FLOW.NEEDS_REVIEW'));
            const before=defenseState(actor),plan=actor.previewDamage(damages);
            const woundsBefore=Number(actor.system.wounds.value),criticalBefore=Number(actor.system.wounds.critical);
            const review=[...damageReviewReasons(actor._owDamageDefense?.()??{},damages),
                ...(data.weapon?.unresolvedTraits??[]).map(name=>String(name))];
            const content=await foundry.applications.handlebars.renderTemplate(
                'systems/apex-heresy-ru/template/dialog/workflow-damage-review.hbs',{
                    name:token.name,damages:damages.map((d,index)=>({...d,location:game.i18n.localize(d.location),
                        protection:plan.rows?.[index]})),
                    woundsBefore:actor.system.wounds.value,woundsAfter:plan.wounds,
                    criticalBefore:actor.system.wounds.critical,criticalAfter:plan.criticalWounds,
                    hasField:actor.items.some(i=>i.type==='forceField'&&i.system.equipped),review
                });
            const confirmed=await foundry.applications.api.DialogV2.prompt({window:{title:game.i18n.localize('COMBAT_FLOW.CONFIRM_DAMAGE')},
                content,rejectClose:false,ok:{label:game.i18n.localize('COMBAT_FLOW.APPLY'),
                    callback:(_event,button)=>({confirmed:!review.length||button.form.elements.reviewAcknowledged?.checked===true})}});
            if(!confirmed?.confirmed) return {cancelled:true};
            return queue(actor.uuid,async()=>{
                if(!game.user.isGM||game.user.id!==game.users.activeGM?.id) throw Error(game.i18n.localize('COMBAT_FLOW.GM_REQUIRED'));
                tokenFor(row);
                if(defenseState(actor)!==before) throw Error(game.i18n.localize('COMBAT_FLOW.DEFENSE_CHANGED'));
                if(readFlag(actor,'combatWorkflowReceipts')?.[receiptKey]) throw Error(game.i18n.localize('COMBAT_FLOW.NEEDS_REVIEW'));
                const path=`flags.dark-heresy.combatWorkflowReceipts.${receiptKey}`;
                await actor.update({[path]:{operationId,status:'processing'}});
                try {
                    const field=await interceptField(actor,data,token.object);
                    if(!field?.blocked) {
                        actor._damageSourceMessageId=message.id;
                        actor._workflowApplying=true;actor._workflowDamageVeto=false;
                        await actor.applyDamage(damages);
                        if(actor._workflowDamageVeto) throw Error(game.i18n.localize('COMBAT_FLOW.APPLICATION_VETO'));
                    }
                    const summary=field?.blocked ? game.i18n.format('COMBAT_FLOW.FIELD_BLOCKED',{name:field.name,roll:field.roll})
                        : game.i18n.format('COMBAT_FLOW.DAMAGE_SUMMARY',{
                            wounds:Number(actor.system.wounds.value)-woundsBefore,
                            critical:Number(actor.system.wounds.critical)-criticalBefore});
                    await actor.update({[path]:{operationId,status:'applied',summary}});
                    return {receiptId:receiptKey,summary,field:{blocked:!!field?.blocked}};
                } catch(error) {
                    try {await actor.update({[path]:{operationId,status:'needsReview'}});} catch {}
                    throw error;
                } finally {delete actor._damageSourceMessageId;delete actor._workflowApplying;delete actor._workflowDamageVeto;}
            });
        }
    };
}
