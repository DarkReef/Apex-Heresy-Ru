import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildAttackArea,attackAreaDefaults,areaIntersectsRectangle,collectAreaTargets,captureAreaReview,finalizeAreaReview,
    createAttackArea,openAttackAreaReview} from '../script/combat/attack-areas.mjs';

const gm={id:'gm',isGM:true,color:{css:'#bb5533'}};
const player={id:'player',isGM:false};
function fixture() {
    const scene={id:'arena',uuid:'Scene.arena',grid:{size:100,distance:5,units:'m',type:1},tokens:new Map()};
    const add=(id,x,y,{hidden=false,visible=true,width=1,height=1,actorId=id}={})=>{
        const actor={uuid:`Scene.arena.Token.${id}.Actor.${actorId}`,isOwner:true,testUserPermission:()=>true};
        const document={id,uuid:`Scene.arena.Token.${id}`,parent:scene,name:`Token ${id}`,x,y,width,height,hidden,elevation:0,actor};
        const object={document,actor,name:document.name,visible};document.object=object;
        scene.tokens.set(id,document);return object;
    };
    const source=add('source',0,0);
    return {scene,add,source};
}
const circle=(origin={x:0,y:0},distance=5)=>buildAttackArea({kind:'blast',origin,distance,grid:{size:100,distance:5}});
const cone=(rotation=0,angle=90)=>buildAttackArea({kind:'spray',origin:{x:0,y:0},distance:5,rotation,angle,grid:{size:100,distance:5}});

test('scene units become native Foundry14 circle and round cone shape dimensions',()=>{
    const area=circle({x:10,y:20},3);
    assert.deepEqual(area.shape,{type:'circle',x:10,y:20,radius:60,gridBased:false});
    const sector=cone(-90,45);
    assert.equal(sector.shape.rotation,270);assert.equal(sector.shape.radius,100);
    assert.equal(sector.shape.curvature,'round');assert.equal(sector.shape.angle,45);
    assert.throws(()=>circle({x:0,y:0},0),/distance/);
    assert.throws(()=>cone(0,361),/angle/);
    assert.throws(()=>buildAttackArea({kind:'line'}),/Unsupported/);
});

test('native attack/traits suggest a reviewable area without inventing a radius for regular weapons',()=>{
    assert.deepEqual(attackAreaDefaults({attackType:{name:'suppression'},weapon:{range:100}}),{kind:'suppression',distance:100,angle:45});
    assert.deepEqual(attackAreaDefaults({weapon:{traits:{blast:3},range:100}}),{kind:'blast',distance:3});
    assert.deepEqual(attackAreaDefaults({weapon:{traits:{skipAttackRoll:true},range:20}}),{kind:'spray',distance:20,angle:30});
    assert.deepEqual(attackAreaDefaults({weapon:{traits:{spray:true},range:20}},{sprayAngle:40}),{kind:'spray',distance:20,angle:40});
    assert.equal(attackAreaDefaults({weapon:{traits:{},range:100}}),null);
    assert.equal(attackAreaDefaults({weapon:{traits:{blast:0},range:100}}),null);
});

test('circle includes footprint tangencies even when token centre and every corner are outside',()=>{
    const area=circle();
    assert.equal(areaIntersectsRectangle(area,{x:100,y:-50,width:100,height:100}),true);
    assert.equal(areaIntersectsRectangle(area,{x:100.01,y:-50,width:100,height:100}),false);
    assert.equal(areaIntersectsRectangle(area,{x:-200,y:-200,width:400,height:400}),true);
    assert.equal(areaIntersectsRectangle(area,{x:90,y:90,width:100,height:100}),false);
});

test('cone footprint intersection handles radial edges, arc-only overlap, wraparound and rear exclusions',()=>{
    assert.equal(areaIntersectsRectangle(cone(),{x:30,y:-5,width:10,height:10}),true);
    assert.equal(areaIntersectsRectangle(cone(),{x:-80,y:-5,width:10,height:10}),false);
    // A thin rectangle crosses the curved rim while all four corners lie outside the circle.
    assert.equal(areaIntersectsRectangle(cone(),{x:99,y:-40,width:2,height:80}),true);
    // No corner inside sector: only one radial boundary passes through this large footprint.
    assert.equal(areaIntersectsRectangle(cone(0,10),{x:20,y:-20,width:20,height:40}),true);
    assert.equal(areaIntersectsRectangle(cone(355,20),{x:50,y:-10,width:5,height:5}),true);
    assert.equal(areaIntersectsRectangle(cone(180,270),{x:90,y:-1,width:2,height:2}),false);
    assert.equal(areaIntersectsRectangle(cone(180,360),{x:90,y:-1,width:2,height:2}),true);
});

test('candidate identity is token-specific, excludes attacker and another scene, and includes friendly tokens',()=>{
    const {scene,add,source}=fixture();
    const first=add('one',90,0,{actorId:'same'}),second=add('two',100,0,{actorId:'same'});
    const outsider=add('foreign',90,0);outsider.document.parent={id:'elsewhere',uuid:'Scene.elsewhere'};
    const area=circle({x:100,y:50},10);
    const targets=collectAreaTargets({area,scene,sourceToken:source,user:gm,includeSource:false});
    assert.deepEqual(targets.map(target=>target.tokenUuid),[first.document.uuid,second.document.uuid]);
    assert.notEqual(targets[0].actorUuid,targets[1].actorUuid);
});

test('player candidates never disclose hidden, fog-hidden or unrendered tokens',()=>{
    const {scene,add,source}=fixture();
    add('seen',90,0);add('hidden',90,0,{hidden:true});add('fog',90,0,{visible:false});
    const unrendered=add('unrendered',90,0);delete unrendered.document.object;
    const options={area:circle({x:100,y:50},10),scene,sourceToken:source,includeSource:false};
    assert.deepEqual(collectAreaTargets({...options,user:player}).map(target=>target.tokenId),['seen']);
    assert.equal(collectAreaTargets({...options,user:gm}).length,4);
});

test('review rejects changed positions, new tokens, hidden state and source movement without applying anything',()=>{
    const {scene,add,source}=fixture();const target=add('one',90,0);
    const options={area:circle({x:100,y:50},10),scene,sourceToken:source,user:gm};
    let review=captureAreaReview(options);
    target.document.x+=1;
    assert.equal(finalizeAreaReview(review,[target.document.uuid],options).status,'stale');
    review=captureAreaReview(options);add('new',95,0);
    assert.equal(finalizeAreaReview(review,[target.document.uuid],options).status,'stale');
    review=captureAreaReview(options);target.document.hidden=true;
    assert.equal(finalizeAreaReview(review,[target.document.uuid],options).status,'stale');
    review=captureAreaReview(options);source.document.x+=1;
    assert.equal(finalizeAreaReview(review,[target.document.uuid],options).status,'stale');
});

test('review confirms only displayed UUIDs and permission is checked again at confirmation',()=>{
    const {scene,add,source}=fixture();const target=add('one',90,0);add('two',90,0);
    const options={area:circle({x:100,y:50},10),scene,sourceToken:source,user:player};
    const review=captureAreaReview(options);
    const result=finalizeAreaReview(review,[target.document.uuid],options);
    assert.equal(result.status,'confirmed');assert.deepEqual(result.targets.map(t=>t.tokenId),['one']);
    assert.equal(result.review.walls,false);
    assert.equal(finalizeAreaReview(review,['Scene.other.Token.one'],options).status,'invalid-target');
    source.actor.testUserPermission=()=>false;source.actor.isOwner=false;
    assert.throws(()=>finalizeAreaReview(review,[target.document.uuid],options),/permission/);
});

test('Region marker uses official shapes, no behaviors and token source metadata; failed permission never writes',async()=>{
    const {scene,source}=fixture();const writes=[];
    scene.createEmbeddedDocuments=async(type,data)=>{writes.push({type,data});return [{uuid:'Scene.arena.Region.marker'}];};
    const area=cone(0,45);
    const refusal=await createAttackArea({area,scene,sourceToken:source,user:player,regionClass:{canUserCreate:()=>false}});
    assert.equal(refusal.status,'no-permission');assert.equal(writes.length,0);
    const result=await createAttackArea({area,scene,sourceToken:source,user:gm,regionClass:{canUserCreate:()=>true},itemId:'gun'});
    assert.equal(result.status,'created');assert.equal(writes[0].type,'Region');
    const data=writes[0].data[0];assert.deepEqual(data.shapes,[area.shape]);assert.deepEqual(data.behaviors,[]);
    assert.equal(data.flags['dark-heresy'].attackArea.sourceTokenUuid,source.document.uuid);
    assert.equal(data.flags['dark-heresy'].attackArea.itemId,'gun');
    scene.createEmbeddedDocuments=async()=>{throw Error('backend denied');};
    assert.equal((await createAttackArea({area,scene,sourceToken:source,user:gm,regionClass:{canUserCreate:()=>true}})).status,'failed');
});

test('dialog confirms chosen targets without marker permission or any targeting/damage side effects',async()=>{
    const {scene,add,source}=fixture();add('one',90,0);add('two',90,0);
    const prompts=[],warnings=[];
    const Dialog={prompt:async options=>{
        prompts.push(options);
        const fields=prompts.length===1?{kind:{value:'blast'},distance:{value:'10'},angle:{value:'45'},rotation:{value:'0'},x:{value:'100'},y:{value:'50'}}
            :{'target-0':{checked:true},'target-1':{checked:false},marker:{checked:false}};
        return options.ok.callback(null,{form:{elements:fields}});
    }};
    const result=await openAttackAreaReview({scene,sourceToken:source,user:player,includeSource:false,Dialog,notify:{warn:value=>warnings.push(value)}});
    assert.equal(result.status,'confirmed');assert.deepEqual(result.targets.map(target=>target.tokenId),['one']);
    assert.equal(prompts.length,2);assert.match(prompts[1].content,/walls, cover, elevation/);
    assert.equal(warnings.length,0);assert.equal(result.regionUuid,undefined);
});

test('denied marker permission retains reviewed targets, and target names are escaped in review HTML',async()=>{
    const {scene,add,source}=fixture();const target=add('one',90,0);target.name=target.document.name='<img src=x onerror=alert(1)>';
    let count=0;const warnings=[];
    const Dialog={prompt:async options=>{
        if (++count===1) return circle({x:100,y:50},10);
        assert.doesNotMatch(options.content,/<img/);assert.match(options.content,/&lt;img/);
        return {uuids:[target.document.uuid],marker:true};
    }};
    const result=await openAttackAreaReview({scene,sourceToken:source,user:player,Dialog,notify:{warn:text=>warnings.push(text)}});
    assert.equal(result.status,'confirmed');assert.equal(result.markerStatus,'no-permission');
    assert.equal(result.targets.length,1);assert.equal(result.regionUuid,null);assert.equal(warnings.length,1);
});

test('cancelled dialog and stale selection never create a Region',async()=>{
    const {scene,add,source}=fixture();const target=add('one',90,0);let writes=0;
    scene.createEmbeddedDocuments=async()=>{writes++;return [];};
    assert.equal((await openAttackAreaReview({scene,sourceToken:source,user:gm,Dialog:{prompt:async()=>null}})).status,'cancelled');
    let count=0;
    const Dialog={prompt:async()=>{
        if (++count===1) return circle({x:100,y:50},10);
        target.document.x+=1;return {uuids:[target.document.uuid],marker:true};
    }};
    const result=await openAttackAreaReview({scene,sourceToken:source,user:gm,Dialog});
    assert.equal(result.status,'stale');assert.deepEqual(result.targets,[]);assert.equal(writes,0);
});

test('a live token provider sees a replacement collection at confirmation',()=>{
    const {scene,add,source}=fixture();const target=add('one',90,0);let tokens=[source,target];
    const options={area:circle({x:100,y:50},10),scene,sourceToken:source,user:gm,tokens:()=>tokens};
    const review=captureAreaReview(options);tokens=[...tokens,add('new',90,0)];
    assert.equal(finalizeAreaReview(review,[target.document.uuid],options).status,'stale');
});

test('blast includes its attacker when the footprint intersects; cones exclude their source',()=>{
    const {scene,source}=fixture();
    assert.deepEqual(collectAreaTargets({area:circle({x:50,y:50},3),scene,sourceToken:source,user:gm}).map(target=>target.tokenId),['source']);
    assert.deepEqual(collectAreaTargets({area:cone(),scene,sourceToken:source,user:gm}),[]);
    assert.deepEqual(collectAreaTargets({area:circle({x:1000,y:1000},3),scene,sourceToken:source,user:gm}),[]);
});
