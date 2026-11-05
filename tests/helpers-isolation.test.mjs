import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';

test('cached entry compilation preserves fresh globals, classes and workflow state for each fixture',()=>{
    const first=loadSystem(),second=loadSystem();
    first.context.game.actors.set('leaked',{name:'Fixture actor'});
    first.context.CONFIG.statusEffects.push({id:'fixture-only'});
    first.get('Dh').fixtureOnly=true;
    first.get('_attackWorkflowBridge = {fixtureOnly:true}');
    assert.equal(second.context.game.actors.has('leaked'),false);
    assert.equal(second.context.CONFIG.statusEffects.some(effect=>effect.id==='fixture-only'),false);
    assert.equal(second.get('Dh').fixtureOnly,undefined);
    assert.equal(second.get('_attackWorkflowBridge'),undefined);
    assert.notEqual(first.get('DarkHeresyActor'),second.get('DarkHeresyActor'));
});

test('cached compilation registers hooks into the current fixture without sharing a listener registry',()=>{
    const first=loadSystem(),second=loadSystem();
    const before=second.listeners.get('ready')?.length??0;
    first.context.Hooks.on('ready',()=>{});
    first.context.Hooks.on('fixture-only-event',()=>{});
    assert.equal(second.listeners.get('ready')?.length??0,before);
    assert.equal(second.listeners.has('fixture-only-event'),false);
    assert.ok(first.listeners.has('fixture-only-event'));
});
