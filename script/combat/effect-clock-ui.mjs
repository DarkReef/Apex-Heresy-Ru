import {buildEffectClockUpdate, effectClockDialogData} from './effect-clock.mjs';

/** Edit only this effect's timer, using the owning Document's existing permission. */
export async function openEffectClockDialog(effect, {game = globalThis.game, combat = game?.combat,
    localize = key => game?.i18n?.localize(key) ?? key,
    DialogV2 = globalThis.foundry?.applications?.api?.DialogV2,
    renderTemplate = globalThis.foundry?.applications?.handlebars?.renderTemplate,
    notifications = globalThis.ui?.notifications} = {}) {
    if (!effect || effect.isOwner === false && !game?.user?.isGM) {
        notifications?.warn(localize('COMBAT_EFFECTS.NO_PERMISSION')); return null;
    }
    const data=effectClockDialogData(effect,combat,localize);
    const content=await renderTemplate('systems/apex-heresy-ru/template/dialog/effect-clock.hbs',data);
    const result=await DialogV2.prompt({
        window:{title:localize('COMBAT_EFFECTS.CONFIGURE')}, content, modal:true, rejectClose:false,
        ok:{label:localize('COMBAT_EFFECTS.SAVE'), callback:(_event,button)=>{
            const elements=button.form.elements;
            return {mode:elements.mode.value,cycles:elements.cycles.value,
                sourceCombatantId:elements.sourceCombatantId.value,targetCombatantId:elements.targetCombatantId.value};
        }}
    });
    if (!result) return null;
    if (effect.isOwner === false && !game?.user?.isGM) {
        notifications?.warn(localize('COMBAT_EFFECTS.NO_PERMISSION')); return null;
    }
    try {
        let sourceActorUuid,referenceCombatantId;
        if (result.mode.startsWith('source') && result.sourceCombatantId) {
            const source=combat?.turns?.find(combatant=>(combatant.id??combatant._id)===result.sourceCombatantId);
            if (!source?.actor?.uuid) throw new Error('COMBAT_EFFECTS.REFERENCE_MISSING');
            sourceActorUuid=source.actor.uuid;referenceCombatantId=source.id??source._id;
        } else if (result.mode.startsWith('target') && result.targetCombatantId) referenceCombatantId=result.targetCombatantId;
        const patch=buildEffectClockUpdate(effect,{...result,combat,sourceActorUuid,referenceCombatantId,
            worldTime:game?.time?.worldTime??0});
        if (!Object.keys(patch).length) return effect;
        return await effect.update(patch);
    } catch(error) {
        notifications?.error(localize(error.message?.startsWith('COMBAT_EFFECTS.') ? error.message : 'COMBAT_EFFECTS.SAVE_FAILED'));
        if (!error.message?.startsWith('COMBAT_EFFECTS.')) console.error('Apex Heresy | Effect clock configuration',error);
        return null;
    }
}
