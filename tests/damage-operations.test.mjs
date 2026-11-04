import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';

function fixture() {
    const system=loadSystem();
    const gm={id:'gm',isGM:true}, other={id:'other',isGM:true};
    let writes=0;
    const actor={id:'npc',uuid:'Scene.scene.Token.token.Actor.npc',wounds:{value:0,critical:0},
        previewDamage:()=>({details:[]}),applyDamage:async damages=>{writes++;actor.wounds.value+=damages[0].amount;}};
    const flags={rollData:{flags:{isDamageRoll:true},targets:[{sceneId:'scene',tokenId:'token'}],damages:[{total:3,penetration:0,location:'body'}]}};
    const message={id:'message',flags:{'dark-heresy':flags},getRollData:()=>flags.rollData,
        async update(patch){
            for(const [path,value]of Object.entries(patch)){
                const parts=path.split('.'),key=parts.pop();let target=this;
                for(const part of parts)target=target[part]??={};
                target[key]=structuredClone(value);
            }
            return this;
        }};
    system.context.game.system={id:'apex-heresy-ru'};
    system.context.game.user=gm;system.context.game.users.activeGM=gm;
    system.context.game.messages=new Map([['message',message]]);
    system.context.game.scenes.set('scene',{tokens:new Map([['token',{actor}]])});
    system.context.game.i18n={localize:v=>v};
    system.context.foundry.applications={handlebars:{renderTemplate:async()=>''}};
    const payload={sceneId:'scene',tokenId:'token',messageId:'message',damages:[{amount:3}]};
    return {system,actor,flags,other,payload,writes:()=>writes};
}
test('only the elected GM executes damage requests',async()=>{
    const f=fixture();f.system.context.game.user=f.other;
    await f.system.get('applyAutoDamageFromSocket')(f.payload);
    assert.equal(f.writes(),0);
});
test('missing chat evidence cannot cause actor damage',async()=>{
    const f=fixture();f.payload.messageId='missing';
    await f.system.get('applyAutoDamageFromSocket')(f.payload);
    assert.equal(f.writes(),0);
});
test('concurrent duplicate requests apply recorded damage exactly once',async()=>{
    const f=fixture();const apply=f.system.get('applyAutoDamageFromSocket');
    await Promise.all([apply(f.payload),apply(f.payload)]);
    assert.equal(f.actor.wounds.value,3);
    assert.equal(f.writes(),1);
    assert.equal(f.flags.damageOperation.status,'applied');
    assert.equal(f.flags.appliedDamage.woundsDelta,3);
});
test('socket damage amounts come from the saved roll, not caller payload',async()=>{
    const f=fixture();f.payload.damages=[{amount:999}];
    await f.system.get('applyAutoDamageFromSocket')(f.payload);
    assert.equal(f.actor.wounds.value,3);
});
