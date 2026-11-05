/** Remove only the tagged fixtures recorded by the live audit. Never delete Combats. */
export async function cleanupAudit(state,{restoreScriptPolicy=true}={}) {
 if(!game.user.isGM||!state?.runId)throw Error('GM and explicit audit state required');
 const tagged=d=>d?.flags?.['apex-heresy-ru']?.stabilityAudit===state.runId&&d.name?.startsWith('[QA]');
 const report={deleted:{messages:[],scenes:[],items:[],actors:[],users:[]},errors:[]};
 const actorIds=new Set(state.actors),userIds=new Set(state.users),messageIds=new Set(state.messages);
 const roots=new Set([...messageIds,state.currentCombatCard,state.lastAttack,state.partyRequestId,state.finalPartyRequest].filter(Boolean));
 // A stale prompt must not outlive its disposable target.
 for(const app of foundry.applications.instances.values())if(app.rendered&&app.title===game.i18n.localize('COMBAT_FLOW.CONFIRM_DAMAGE')){
  const targetText=app.element?.textContent??'';
  if(targetText.includes('[QA] Target'))await app.close();
 }
 if(game.__apexStabilityAudit?.pendingFinalApply)await game.__apexStabilityAudit.pendingFinalApply;
 for(const message of game.messages){
  const system=message.flags?.['dark-heresy'],party=message.flags?.['riftan-charbar'];
  const uuid=system?.rollData?.actorUuid??party?.partyResponse?.actorUuid;
  if(actorIds.has(message.speaker?.actor)||userIds.has(message.author?.id)||roots.has(message.id)
   ||roots.has(system?.combatWorkflowRequest?.workflowId)||roots.has(party?.partyResponse?.requestId)
   ||[...actorIds].some(id=>uuid===`Actor.${id}`)||message.whisper?.some(id=>userIds.has(id)))messageIds.add(message.id);
 }
 const beforeScene=game.scenes.get(state.sceneBefore);
 if(beforeScene&&state.scenes.includes(canvas.scene?.id))await beforeScene.view();
 for(const id of messageIds){const d=game.messages.get(id);if(d){await d.delete();report.deleted.messages.push(id);}}
 for(const id of state.scenes){const d=game.scenes.get(id);if(!d)continue;if(!tagged(d)||d.active)throw Error('QA scene cleanup guard');await d.delete();report.deleted.scenes.push(id);}
 for(const id of state.items){const d=game.items.get(id);if(!d)continue;if(!tagged(d))throw Error('QA Item cleanup guard');await d.delete();report.deleted.items.push(id);}
 for(const id of state.actors){const d=game.actors.get(id);if(!d)continue;if(!tagged(d))throw Error('QA Actor cleanup guard');if(game.scenes.some(sc=>sc.tokens.some(t=>t.actorId===id)))throw Error('QA Actor still has tokens');await d.delete();report.deleted.actors.push(id);}
 for(const id of state.users){const d=game.users.get(id);if(!d)continue;if(!tagged(d)||d.role!==1)throw Error('QA User cleanup guard');await d.delete();report.deleted.users.push(id);}
 if(beforeScene&&canvas.scene?.id===beforeScene.id){
  canvas.tokens.releaseAll();for(const id of state.controlledBefore??[])canvas.tokens.get(id)?.control({releaseOthers:false});
  for(const token of [...game.user.targets])token.setTarget(false,{releaseOthers:false});
  for(const id of state.targetsBefore??[])canvas.tokens.get(id)?.setTarget(true,{releaseOthers:false});
 }
 report.remaining={actors:state.actors.filter(id=>game.actors.has(id)),scenes:state.scenes.filter(id=>game.scenes.has(id)),items:state.items.filter(id=>game.items.has(id)),users:state.users.filter(id=>game.users.has(id))};
 report.worldTime={before:state.worldTimeBefore,after:game.time.worldTime};
 report.viewedScene=canvas.scene?.id;
 delete game.__apexStabilityAudit;
 if(restoreScriptPolicy){
  await game.settings.set('foundry-mcp-gateway-companion','runMacroScriptMode','confirm');
  await game.settings.set('foundry-mcp-gateway-companion','runScriptMode','off');
  report.scriptPolicy={runMacroScriptMode:'confirm',runScriptMode:'off'};
 }
 return report;
}
