/** Run on the authorised GM Companion. Only audit-tagged temporary documents. */
export async function inventoryAudit({runId,existingActorId}) {
 const tag={'apex-heresy-ru':{stabilityAudit:runId}}, results=[];
 const check=(name,pass,detail)=>{const row={name,pass:!!pass,detail};results.push(row);game.__apexStabilityAudit?.results.push(row);};
 const a=game.actors.get(existingActorId);
 if(a?.flags?.['apex-heresy-ru']?.stabilityAudit!==runId)throw Error('Audit actor guard');
 const audit=game.__apexStabilityAudit??={runId,sceneBefore:canvas.scene?.id,worldTimeBefore:game.time.worldTime,
  controlledBefore:canvas.tokens.controlled.map(t=>t.id),targetsBefore:[...game.user.targets].map(t=>t.id),actors:[a.id],items:[],scenes:[],combats:[],users:[],messages:[],results:[]};
 const peer=await Actor.create({name:'[QA] Recipient '+runId,type:'acolyte',flags:tag,
  system:{ruleset:'ow',wounds:{max:12,value:0,critical:0}}});audit.actors.push(peer.id);
 check('native Actor.create with ItemPileFFG economy',peer.system.economy?.credits===0,{credits:peer.system.economy?.credits});
 const [bag,ammo,gun,armour]=await a.createEmbeddedDocuments('Item',[
  {name:'[QA] Backpack',type:'gear',system:{quantity:1,inventory:{isContainer:true,containerKey:foundry.utils.randomID(),capacity:50}}},
  {name:'[QA] AP rounds',type:'ammunition',system:{quantity:80,quantityUnit:'rounds',weaponTypes:['solidprojectile'],weaponClasses:['basic'],effect:{penetrationModifier:2}}},
  {name:'[QA] Autogun',type:'weapon',system:{quantity:1,equipped:true,class:'basic',type:'solidprojectile',range:100,damage:'1d10+3',damageType:'impact',penetration:'3',rateOfFire:{single:1,burst:3,full:10},clip:{value:0,max:30},reload:'Full'}},
  {name:'[QA] Avenger armour',type:'armour',system:{quantity:1,equipped:true},effects:[{name:'[QA] Powered assistance',transfer:true,changes:[{key:'system.characteristics.strength.tempModifier',mode:2,value:'10',priority:20}]}]}
 ]);
 audit.inventory={actor:a.id,peer:peer.id,bag:bag.id,ammo:ammo.id,gun:gun.id,armour:armour.id};
 check('equipped item effect applies once',a.system.characteristics.strength.displayTotal===40,{strength:a.system.characteristics.strength.displayTotal});
 await armour.update({'system.equipped':false});
 check('unequipping suspends transferred effect',a.system.characteristics.strength.displayTotal===30,{strength:a.system.characteristics.strength.displayTotal});
 await game.itempileffg.moveItem({actorUuid:a.uuid,itemId:ammo.id,containerId:bag.id});
 check('ammunition stored in backpack',ammo.system.inventory.containerId===bag.id);
 const ammunition=await import('/systems/apex-heresy-ru/script/data/ammunition-link.mjs');
 await gun.update(ammunition.ammunitionSelectionUpdate(a,gun,ammo.id).update);
 const reload=await ammunition.reloadAmmunition(a,gun);
 check('reload consumes backpack reserve atomically',reload.success&&gun.system.clip.value===30&&ammo.system.quantity===50,{clip:gun.system.clip.value,reserve:ammo.system.quantity});
 check('loaded ammunition retains AP bonus',ammunition.getAmmunitionProfile(a,gun).system.effect.penetrationModifier===2);
 const again=await ammunition.reloadAmmunition(a,gun);
 check('full magazine consumes no reserve',again.reason==='clip_full'&&ammo.system.quantity===50);
 await game.itempileffg.moveItem({actorUuid:a.uuid,itemId:gun.id,containerId:bag.id});
 const kit=await game.itempileffg.saveContainerKit(a,bag.id);await kit.update({flags:tag});audit.items.push(kit.id);
 const copies=await game.itempileffg.grantKit(kit,peer);
 const copiedGun=copies.find(i=>i.type==='weapon'),copiedAmmo=copies.find(i=>i.type==='ammunition'),copiedBag=copies.find(i=>i.system.inventory.isContainer);
 check('kit creates complete tree',copies.length===3&&copiedAmmo.system.inventory.containerId===copiedBag.id&&copiedGun.system.inventory.containerId===copiedBag.id);
 check('kit remaps ammunition references',copiedGun.system.ammo===copiedAmmo.id&&copiedGun.system.loadedAmmo?.itemId===copiedAmmo.id,{reference:copiedGun.system.ammo,expected:copiedAmmo.id,loaded:copiedGun.system.loadedAmmo?.itemId});
 const service=await import('/modules/itempileffg/scripts/container-service.mjs');
 await service.transferTree(bag,peer);
 const movedGun=peer.items.find(i=>i.name===gun.name&&i.id!==copiedGun.id),movedAmmo=peer.items.find(i=>i.name===ammo.name&&i.id!==copiedAmmo.id);
 check('Item Piles transfer preserves full backpack',!a.items.has(bag.id)&&!a.items.has(gun.id)&&!a.items.has(ammo.id)&&!!movedGun&&!!movedAmmo);
 check('transfer keeps loaded clip and remaps reserve',movedGun?.system.clip.value===30&&movedGun?.system.ammo===movedAmmo?.id&&movedAmmo?.system.quantity===50);
 await a.modifyTokenAttribute('system.wounds',-5,false,true);
 check('OW wounds can display negative remaining',a.system.wounds.value===12&&a.system.wounds.critical===5,{wounds:a.system.wounds.toObject?.()??a.system.wounds});
 await a.update({'system.wounds.value':0,'system.wounds.critical':0});
 return {results,fixtures:{actor:a.id,peer:peer.id,kit:kit.id},sceneBefore:audit.sceneBefore,worldTimeBefore:audit.worldTimeBefore};
}
