import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';

const flag=(document,key)=>document.flags?.['dark-heresy']?.[key];
function put(object,path,value) {
    const keys=path.split('.'),last=keys.pop();let target=object;
    for(const key of keys)target=target[key]??={};target[last]=value;
}

/** Actual legacy entry module + actual workflow bridge/native adapters. Only the
 * external Foundry document store, templates, area UI and dice entropy are fake.
 */
function fixture() {
    let serial=0;const created=[],renders=[],dice=[],weaponWrites=[],warnings=[];
    const gm={id:'gm',isGM:true,active:true,targets:new Set()};
    const users=new Map([[gm.id,gm]]);users.activeGM=gm;
    const characteristics={agility:{label:'CHARACTERISTIC.AGILITY',short:'Ag',total:40,displayTotal:40,bonus:4,unnatural:0},
        weaponSkill:{label:'CHARACTERISTIC.WEAPON_SKILL',short:'WS',total:40,displayTotal:40,bonus:4,unnatural:0},
        willpower:{label:'CHARACTERISTIC.WILLPOWER',short:'WP',total:40,displayTotal:40,bonus:4,unnatural:0}};
    const actor=(id,name)=>({id,uuid:`Actor.${id}`,documentName:'Actor',name,type:'acolyte',isOwner:true,horde:0,
        flags:{},system:{ruleset:'ow',fatigue:{value:0},bio:{},characteristics:structuredClone(characteristics)},
        characteristics:structuredClone(characteristics),
        skills:{dodge:{label:'SKILL.DODGE',characteristics:['Ag'],total:50,advance:10},
            parry:{label:'SKILL.PARRY',characteristics:['WS'],total:40,advance:0}},
        items:[],hasCondition:()=>false,getActiveTokens:()=>[],allApplicableEffects:()=>[],
        testUserPermission:user=>user.isGM===true});
    const attacker=actor('attacker','Shooter'),defender=actor('defender','Target');
    let applications=0;defender.applyDamage=async()=>{applications++;};
    const weapon={id:'gun',type:'weapon',name:'Autogun',system:{clip:{value:20,max:30}},
        update:async patch=>{weaponWrites.push(structuredClone(patch));for(const [path,value]of Object.entries(patch))put(weapon,path,value);return weapon;}};
    attacker.items.push(weapon);attacker.items.get=id=>attacker.items.find(item=>item.id===id);
    defender.items.get=()=>null;
    const scene={id:'scene',uuid:'Scene.scene',tokens:new Map()};
    const token={id:'target',uuid:'Scene.scene.Token.target',documentName:'Token',parent:scene,
        actor:defender,name:'Target token',hidden:false,object:{visible:true}};scene.tokens.set(token.id,token);
    const documents=new Map([attacker,defender,token].map(doc=>[doc.uuid,doc]));
    const messages=new Map();
    const ChatMessage={getSpeaker:()=>({actor:attacker.id,alias:attacker.name}),applyRollMode(){},getWhisperRecipients:()=>[gm],
        create:async(data,options={})=>{
            // Core Documents discard caller IDs unless keepId is explicitly true.
            const document={id:options.keepId===true&&data._id?data._id:`message${++serial}`,author:users.get(data.user),flags:{},content:data.content??'',
                whisper:data.whisper??[],blind:!!data.blind,rolls:data.rolls??[],updates:[],speaker:data.speaker,createOptions:options};
            for(const [path,value]of Object.entries(data.flags??{}))put(document.flags,path,value);
            document.update=async patch=>{document.updates.push(structuredClone(patch));for(const [path,value]of Object.entries(patch))put(document,path,value);return document;};
            messages.set(document.id,document);created.push(document);return document;
        }};
    class Roll {
        constructor(formula){this.formula=formula;this.terms=[];this.total=0;}
        async evaluate(){
            dice.push(this.formula);
            if(this.formula==='1d100'){this.total=20;this.terms=[{faces:100,results:[{result:20,active:true}]}];}
            else if(this.formula.includes('d10')){
                this.terms=[{faces:10,results:[{result:7,active:true}]}];
                this.total=this.formula.replace(/\d+d10/g,'7').split('+').reduce((sum,value)=>sum+Number(value),0);
            } else this.total=Number(this.formula);
            return this;
        }
        async render(){return `<p>Dice ${this.total}</p>`;}
    }
    const system=loadSystem({ChatMessage,Roll,fromUuid:async uuid=>documents.get(uuid),fromUuidSync:uuid=>documents.get(uuid)});
    Object.assign(system.context.game,{user:gm,users,messages,modules:new Map(),scenes:new Map([[scene.id,scene]]),
        actors:new Map([[attacker.id,attacker],[defender.id,defender]])});
    system.context.game.settings.get=(scope,key)=>key==='combatWorkflow'?true:key==='rollMode'?'publicroll':false;
    Object.assign(system.context.foundry.utils,{randomID:()=>`attack${++serial}`});
    system.context.foundry.applications={handlebars:{renderTemplate:async(path,data)=>{
        renders.push({path,data});
        return path.endsWith('attack-workflow.hbs')?`<section class="dh-attack-workflow">${data.targets.map(row=>row.status).join('|')}</section>`
            :`<article>Native ${data.name??'roll'} ${data.result??''}${data.render??''}</article>`;
    }}};
    system.context.ui.notifications.warn=text=>warnings.push(text);
    system.context.canvas={ready:false,scene,tokens:{get:id=>scene.tokens.get(id),controlled:[],placeables:[]}};
    const attack=()=>({name:'Autogun',itemName:'Autogun',actorName:attacker.name,actorUuid:attacker.uuid,ownerId:attacker.id,itemId:weapon.id,
        flags:{isAttack:true,isCombatRoll:true,isSuccess:true},target:{base:40,modifier:0,final:40},difficulty:{value:0},
        result:20,unmodifiedResult:20,dos:3,dof:0,attackDos:3,attackResult:20,numberOfHits:1,shotsFired:1,
        weapon:{name:'Autogun',isRange:true,weaponClass:'basic',range:100,traits:{},clip:{value:20,max:30},
            damageFormula:'1d10+3',damageBonus:0,penetrationFormula:'2',damageType:'impact',rateOfFire:{single:1,burst:3,full:10}},
        attackType:{name:'standard',maxHits:1,hitMargin:1},targets:[{sceneId:scene.id,tokenId:token.id,name:token.name}],attributeBoni:[]});
    return {system,attacker,defender,weapon,token,scene,created,messages,renders,dice,weaponWrites,warnings,attack,
        bridge:()=>system.get('_combatWorkflow')(),applications:()=>applications,
        visible:()=>created.filter(doc=>!flag(doc,'combatWorkflowRequest'))};
}

test('native _sendSingleRollToChat creates one OW root with original evidence and a workflow card',async()=>{
    const f=fixture(),data=f.attack();
    const root=await f.system.get('_sendSingleRollToChat')(data);
    assert.equal(f.created.length,1);assert.equal(f.visible().length,1);
    assert.equal(root.createOptions.keepId,true);
    assert.equal(flag(root,'combatWorkflow').id,root.id);
    assert.equal(flag(root,'combatWorkflow').attackerUuid,f.attacker.uuid);
    assert.equal(flag(root,'combatWorkflow').targets[0].actorUuid,f.defender.uuid);
    assert.equal(flag(root,'combatWorkflow').targets[0].tokenUuid,f.token.uuid);
    assert.equal(flag(root,'rollData').workflowRootMessageId,root.id);
    assert.equal(flag(root,'rollData').result,20);assert.equal(flag(root,'rollData').flags.isAttack,true);
    assert.match(root.content,/Native Autogun 20/);assert.match(root.content,/dh-attack-workflow/);
});

test('actual commonRoll defender dice update the original workflow through the native chat intercept without a visible child card',async()=>{
    const f=fixture(),root=await f.system.get('_sendSingleRollToChat')(f.attack());
    const claim=await f.bridge().request('dodge',root.id,f.token.uuid);
    const util=f.system.get('DarkHeresyUtil'),data=structuredClone(flag(root,'rollData'));
    data.actorUuid=f.defender.uuid;data.ownerId=f.defender.id;data.tokenId=f.token.id;data.name='SKILL.DODGE';
    data.flags={isAttack:false,isEvasion:true,isCombatRoll:false,isDamageRoll:false};
    data.evasions={selected:'dodge',dodge:util.createSkillRollData(f.defender,'dodge'),
        parry:util.createSkillRollData(f.defender,'parry'),agility:util.createCharacteristicRollData(f.defender,'agility')};
    data.target={...data.evasions.dodge.target,modifier:0};data.difficulty={value:0};
    data.workflow={messageId:root.id,tokenUuid:f.token.uuid,generation:0,action:'dodge',operationId:claim.request.id};
    const result=await f.system.get('commonRoll')(data);
    assert.equal(result.status,'resolved');assert.deepEqual(f.dice,['1d100']);
    assert.equal(f.visible().length,1);assert.equal(f.created.length,3);
    const row=flag(root,'combatWorkflow').targets[0];
    assert.equal(row.phase,'resolved');assert.equal(row.remainingHits,0);
    assert.equal(row.reaction.result,20);assert.equal(row.reaction.target,50);
    assert.equal(flag(root,'rollData').actorUuid,f.attacker.uuid,'attack evidence keeps the attacker');
    assert.equal(flag(root,'rollData').flags.isAttack,true);assert.equal(f.weaponWrites.length,0);
});

test('actual damageRoll uses native dice but sendDamageToChat updates the root and never auto-applies or posts a child',async()=>{
    const f=fixture(),root=await f.system.get('_sendSingleRollToChat')(f.attack());
    await f.bridge().request('decline',root.id,f.token.uuid);
    await f.bridge().request('damage',root.id,f.token.uuid);
    assert.deepEqual(f.dice,['2','1d10+3+0']);assert.equal(f.visible().length,1);
    assert.equal(f.created.length,3);assert.equal(f.applications(),0);
    const row=flag(root,'combatWorkflow').targets[0];
    assert.equal(row.phase,'readyApply');assert.equal(row.damage.total,10);
    assert.equal(row.damage.rollData.damages[0].penetration,2);
    assert.equal(f.system.get('_shouldAutoApplyDamage')(row.damage.rollData),false);
    assert.equal(flag(root,'rollData').flags.isDamageRoll,undefined);
    assert.equal(f.weaponWrites.length,0,'damage does not fire the weapon a second time');
});

test('actual Spray combat resolution creates an attack workflow before any damage dice and consumes its magazine exactly once',async()=>{
    const f=fixture(),data=f.attack();data.weapon.traits.skipAttackRoll=true;
    let reviewed=0;
    f.system.context.openAttackAreaReview=async options=>{
        reviewed++;assert.equal(options.kind,'spray');
        return {status:'confirmed',targets:data.targets,area:{kind:'spray',distance:30,angle:30},regionUuid:'Scene.scene.Region.spray',review:[]};
    };
    await f.system.get('_resolveCombatRoll')(data);
    assert.equal(reviewed,1);assert.equal(f.visible().length,1);assert.equal(f.created.length,1);
    assert.deepEqual(f.dice,[],'Spray has no hit roll and waits to roll damage until targets respond');
    const root=f.visible()[0],state=flag(root,'combatWorkflow');
    assert.equal(state.areaKind,'spray');assert.equal(state.targets[0].defenseType,'agility');
    assert.equal(state.targets[0].phase,'reaction');assert.equal(state.targets[0].damage,null);
    assert.equal(flag(root,'rollData').flags.isAttack,true);assert.equal(flag(root,'rollData').flags.isDamageRoll,false);
    assert.equal(f.weapon.system.clip.value,19);assert.equal(f.weaponWrites.length,1);
});

test('native Fate submission keeps one card while updating stored dice, rendered dice and RSA request identity together',async()=>{
    const f=fixture(),data=f.attack(),initialRoll=new f.system.context.Roll('1d100');
    await initialRoll.evaluate();data.rollObject=initialRoll;data.flags.rsaRequestId='rsa-old-request';
    const root=await f.system.get('_sendSingleRollToChat')(data);
    assert.equal(root.rolls[0].total,20);assert.match(flag(root,'rollData').render,/Dice 20/);
    const reroll=structuredClone(flag(root,'rollData')),newRoll=new f.system.context.Roll('1d100');
    newRoll.total=40;newRoll.terms=[{faces:100,results:[{result:40,active:true}]}];
    Object.assign(reroll,{result:40,unmodifiedResult:40,dos:1,dof:0,attackDos:1,attackResult:40,rollObject:newRoll});
    reroll.flags={...reroll.flags,isReRoll:true,isSuccess:true,rsaRequestId:'rsa-new-request'};
    const before=root.updates.length,returned=await f.system.get('_sendSingleRollToChat')(reroll);
    assert.equal(returned,root);assert.equal(root.updates.length,before+1);
    assert.equal(f.visible().length,1);assert.equal(f.created.length,2);
    assert.equal(flag(root,'combatWorkflow').generation,1);
    assert.equal(flag(root,'rollData').result,40);assert.equal(root.rolls[0].total,40);
    assert.match(flag(root,'rollData').render,/Dice 40/);assert.match(root.content,/Native Autogun 40/);
    assert.match(root.content,/Dice 40/);assert.doesNotMatch(root.content,/Dice 20/);
    assert.equal(flag(root,'rollData').flags.rsaRequestId,'rsa-new-request');
    const update=root.updates.at(-1);
    assert.equal(update.rolls[0].total,40);assert.equal(update['flags.dark-heresy.rollData'].flags.rsaRequestId,'rsa-new-request');
    assert.equal(update['flags.dark-heresy.combatWorkflow'].generation,1);
    assert.equal(f.weaponWrites.length,0);
});
