import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';
test('requested rolls attribute chat to the actual synthetic Actor rather than the selected token',async()=>{
    const actor={id:'actor',name:'Requested',token:{id:'requestedToken',parent:{id:'scene'}}};let message;
    const system=loadSystem({fromUuidSync:()=>actor,ChatMessage:{getSpeaker:()=>({actor:'wrong',token:'wrongToken'}),create:data=>{message=data;}}});
    system.context.game.user={id:'gm'};
    system.context.foundry.applications={handlebars:{renderTemplate:async()=>'<p>Roll</p>'}};
    const data={actorUuid:'Scene.scene.Token.requestedToken.Actor.actor',flags:{}};
    await system.get('_sendSingleRollToChat')(data);
    assert.equal(message.speaker.token,'requestedToken');assert.equal(message.speaker.actor,'actor');assert.equal(data.tokenId,'requestedToken');
});
test('world Actor rolls do not inherit another selected token',async()=>{
    const actor={id:'actor',name:'Requested'};let message;
    const system=loadSystem({fromUuidSync:()=>actor,ChatMessage:{getSpeaker:()=>({actor:'wrong',token:'wrongToken'}),create:data=>{message=data;}}});
    system.context.game.user={id:'gm'};system.context.foundry.applications={handlebars:{renderTemplate:async()=>'<p>Roll</p>'}};
    const data={actorUuid:'Actor.actor',flags:{}};await system.get('_sendSingleRollToChat')(data);
    assert.equal(message.speaker.token,null);assert.equal(data.tokenId,undefined);
});
test('requested blind rolls apply the core visibility contract instead of only whispering',async()=>{
    let message,mode;
    const system=loadSystem({fromUuidSync:()=>({id:'actor',name:'A'}),ChatMessage:{
        getWhisperRecipients:()=>['gm'],applyRollMode:(data,value)=>{mode=value;data.blind=value==='blindroll';},create:data=>{message=data;}
    }});
    system.context.game.user={id:'owner'};system.context.game.settings.get=()=> 'blindroll';
    system.context.foundry.applications={handlebars:{renderTemplate:async()=>'<p>Roll</p>'}};
    await system.get('_sendSingleRollToChat')({actorUuid:'Actor.actor',flags:{}});
    assert.equal(mode,'blindroll');assert.equal(message.blind,true);
});
