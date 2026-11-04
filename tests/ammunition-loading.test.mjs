import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSystem} from './helpers/system.mjs';
import {resolveTypeTemplate} from '../script/data/models.mjs';

const template = JSON.parse(readFileSync(new URL('../template.json', import.meta.url), 'utf8'));

/** An owner with a weapon and whatever ammunition is handed in. */
function armed({clip = 0, ammo = '', rounds = []} = {}) {
    const system = loadSystem();
    const apply = (doc, change) => {
        for (const [path, value] of Object.entries(change)) {
            if (path === '_id') continue;
            const keys = path.split('.');
            const last = keys.pop();
            keys.reduce((node, key) => node[key] ??= {}, doc)[last] = structuredClone(value);
        }
    };
    const stored = doc => { doc.update = async change => { apply(doc, change); return doc; }; return doc; };
    const weapon = stored({id: 'gun', type: 'weapon', name: 'Autogun',
        system: {ammo, type: 'solidProjectile', class: 'basic', clip: {value: clip, max: 30},
            damage:'1d10',damageType:'impact',special:'',penetration:'3',attack:0,range:100,
            rateOfFire:{single:1,burst:3,full:10}}});
    for (const key of ['class','clip','damage','damageType','special','penetration','attack','range','rateOfFire']) {
        Object.defineProperty(weapon,key,{get:()=>weapon.system[key]});
    }
    const items = [weapon, ...rounds.map(round => stored({type: 'ammunition', isAmmunition: true,
        system: {quantity: 2, weaponTypes: [], weaponClasses: []}, ...round}))];
    const actor = {id: 'owner', uuid:'Actor.owner',documentName:'Actor',name: 'Acolyte', isToken: false, isOwner:true,type: 'acolyte',
        psy:{rating:0},characteristics:{ballisticSkill:{total:40,displayTotal:40}},system:{ruleset:'ow'},batches:[],
        items: {get: id => items.find(item => item.id === id), find: fn => items.find(fn),
            filter:fn=>items.filter(fn),[Symbol.iterator]:()=>items[Symbol.iterator]()},
        async updateEmbeddedDocuments(type,patches){
            assert.equal(type,'Item');this.batches.push(structuredClone(patches));
            return Promise.all(patches.map(patch=>this.items.get(patch._id).update(patch)));
        }};
    for(const item of items){item.parent=actor;item.uuid=`${actor.uuid}.Item.${item.id}`;}
    system.context.game.actors.set('owner', actor);
    system.context.fromUuid=async uuid=>uuid===actor.uuid?actor:null;
    system.context.fromUuidSync=uuid=>uuid===actor.uuid?actor:null;
    return {system, actor, weapon, items};
}

test('the weapon sheet stores its ammunition in a field the weapon has', () => {
    // The select was named system.ammunitionId, which the weapon model does not
    // define: a strict schema drops the write, so the choice never survived and
    // the rules that read the loaded round found nothing.
    const sheet = readFileSync(new URL('../template/sheet/weapon.hbs', import.meta.url), 'utf8');
    const model = resolveTypeTemplate(template, 'Item', 'weapon');
    const [, field] = sheet.match(/<select name="system\.([\w.]+)">\s*{{#each ammunitionOptions}}/) ?? [];
    assert.ok(field, 'the weapon sheet offers a choice of ammunition');
    assert.notEqual(model[field], undefined,
        `the choice is written to system.${field}, which the weapon model does not define`);
});

test('reloading without a chosen round loads the one found and remembers it', async () => {
    const f = armed({rounds: [{id: 'dumdum', name: 'Dumdum Bullets'}]});
    const got = await f.system.get('_reloadWeapon')(f.weapon, 'owner', null, false);
    assert.equal(got.success, true);
    assert.equal(f.weapon.system.clip.value, 30);
    assert.equal(f.weapon.system.ammo, 'dumdum', 'the round now in the weapon is recorded');
    assert.equal(f.actor.batches.length,1);
    assert.equal(f.actor.batches[0].length,2,'quantity and loaded magazine use one Item batch');
    assert.equal(f.system.get('DarkHeresyUtil').getLoadedAmmunition(f.actor, f.weapon)?.id, 'dumdum',
        'so its effects reach the next attack');
});

test('AP rounds load from backpack once, modify the native profile and spend only the clip on shots/rerolls',async()=>{
    const f=armed({ammo:'ap',rounds:[{id:'ap',name:'Armour-piercing rounds',
        system:{quantity:40,quantityUnit:'rounds',weaponTypes:['solidProjectile'],weaponClasses:[],
            inventory:{containerId:'backpack'},effect:{penetrationModifier:2}}}]});
    const ammunition=f.items.find(item=>item.id==='ap');
    f.items.push({id:'backpack',type:'gear',name:'Backpack',system:{inventory:{isContainer:true}}});
    assert.equal((await f.system.get('_reloadWeapon')(f.weapon,'owner',null,false)).success,true);
    assert.equal(ammunition.system.quantity,10);assert.equal(f.weapon.system.clip.value,30);
    const util=f.system.get('DarkHeresyUtil');
    const attack=util.createWeaponRollData(f.actor,f.weapon);
    assert.equal(attack.weapon.penetrationFormula,'3+2');
    assert.equal(attack.weapon.ammoPenetrationBonus,2);
    await f.system.get('_consumeAmmo')(attack);
    assert.equal(f.weapon.system.clip.value,29);assert.equal(ammunition.system.quantity,10,'not spent from reserve twice');
    attack.flags.isReRoll=true;await f.system.get('_consumeAmmo')(attack);
    assert.equal(f.weapon.system.clip.value,29);assert.equal(ammunition.system.quantity,10);
    ammunition.system.effect.penetrationModifier=20;f.items.splice(f.items.indexOf(ammunition),1);
    assert.equal(util.createWeaponRollData(f.actor,f.weapon).weapon.penetrationFormula,'3+2','loaded profile survives reserve edit/deletion');
});

test('additive AP remains compatible with native Razor Sharp penetration multiplication',async()=>{
    const f=armed({rounds:[{id:'ap',name:'AP',system:{quantity:1,effect:{penetrationModifier:2}}}]});
    await f.system.get('_reloadWeapon')(f.weapon,'owner',null,false);
    f.weapon.system.special='Razor Sharp';
    const attack=f.system.get('DarkHeresyUtil').createWeaponRollData(f.actor,f.weapon);attack.attackDos=3;
    f.system.context.Roll=class {
        constructor(formula){this.formula=formula;}
        async evaluate(){assert.match(this.formula,/^[-+\d]+$/);this.total=this.formula.match(/[+-]?\d+/g).reduce((sum,n)=>sum+Number(n),0);return this;}
    };
    assert.equal(await f.system.get('_rollPenetration')(attack),10);
});

test('synthetic actor reload and shot never change its base inventory',async()=>{
    const f=armed({ammo:'Actor.owner.Item.ap',rounds:[{id:'ap',name:'AP',system:{quantity:2,effect:{penetrationModifier:2}}}]});
    const baseAmmo={id:'ap',type:'ammunition',name:'AP',system:{quantity:50}};
    const baseWeapon={id:'gun',type:'weapon',name:'Autogun',system:{clip:{value:20,max:30}}};
    const base={id:'owner',uuid:'Actor.owner',documentName:'Actor',items:new Map([['ap',baseAmmo],['gun',baseWeapon]])};
    f.actor.isToken=true;f.actor.uuid='Scene.scene.Token.token.Actor.owner';f.actor.token={id:'token',baseActor:base};
    f.system.context.game.actors.set('owner',base);
    for(const item of f.items)item.uuid=`${f.actor.uuid}.Item.${item.id}`;
    assert.equal((await f.system.get('_reloadWeapon')(f.weapon,f.actor.uuid,null,false)).success,true);
    const attack=f.system.get('DarkHeresyUtil').createWeaponRollData(f.actor,f.weapon);
    await f.system.get('_consumeAmmo')(attack);
    assert.equal(f.weapon.system.clip.value,29);assert.equal(f.items.find(item=>item.id==='ap').system.quantity,1);
    assert.equal(baseWeapon.system.clip.value,20);assert.equal(baseAmmo.system.quantity,50);
    attack.itemId='missing';await assert.rejects(f.system.get('_consumeAmmo')(attack),/no longer belongs/);
});

test('reloading uses the round chosen on the weapon, not the first one found', async () => {
    const f = armed({ammo: 'manstopper', rounds: [
        {id: 'dumdum', name: 'Dumdum Bullets'}, {id: 'manstopper', name: 'Man-Stopper Bullets'}]});
    await f.system.get('_reloadWeapon')(f.weapon, 'owner', null, false);
    assert.equal(f.items.find(item => item.id === 'manstopper').system.quantity, 1);
    assert.equal(f.items.find(item => item.id === 'dumdum').system.quantity, 2);
});

test('reloading with nothing to load fails and leaves the weapon empty', async () => {
    const f = armed();
    const got = await f.system.get('_reloadWeapon')(f.weapon, 'owner', null, false);
    assert.equal(got.success, false);
    assert.equal(f.weapon.system.clip.value, 0);
});

const burst = clipSeenByDialog => ({
    ownerId: 'owner', itemId: 'gun', flags: {},
    weapon: {isRange: true, name: 'Autogun', clip: {value: clipSeenByDialog, max: 30},
        rateOfFire: {single: 1, burst: 3, full: 10}, traits: {}},
    attackType: {name: 'full_auto'}
});

test('a shot is paid for out of what the weapon holds now, not what a dialog remembered', async () => {
    // Two attack dialogs opened together both remember a full magazine. The
    // second used to write "30 - 10" over the first one's "30 - 10".
    const f = armed({clip: 30});
    const consume = f.system.get('_consumeAmmo');
    const first = burst(30), second = burst(30);
    await consume(first);
    await consume(second);
    assert.equal(f.weapon.system.clip.value, 10);
    assert.equal(second.weapon.clip.value, 10, 'and the roll is told what is really left');
});

test('the reload prompt speaks of the magazine, not of ammunition being unavailable', () => {
    // "available: 0" read as "you own no ammunition", and then the reload worked.
    const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
    assert.match(lang['DIALOG.RELOAD_MESSAGE'], /in the weapon/i);
    assert.doesNotMatch(lang['DIALOG.RELOAD_MESSAGE'].replace(/{\w+}/g, ''), /available/i);
});
