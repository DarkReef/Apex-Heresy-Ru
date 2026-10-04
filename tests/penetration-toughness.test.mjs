import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadSystem} from './helpers/system.mjs';

/**
 * Penetration works on armour, not on the body under it.
 *
 * Dark Heresy Second Edition, p. 227: damage is reduced by the target's
 * Toughness bonus and by the Armour points on the location hit, and penetration
 * is taken from the Armour points alone. The sheet stores one figure per
 * location, armour and Toughness bonus added together, and penetration used to
 * be taken from that sum, so a high-penetration hit ate the Toughness bonus too.
 */
function target({worn = 3, toughnessBonus = 4, tempModifier = 0, total = 40, bonus} = {}) {
    const system = loadSystem();
    const actor = Object.create(system.get('DarkHeresyActor.prototype'));
    const part = () => ({value: worn, toughnessBonus, tempModifier, total: worn + toughnessBonus + tempModifier});
    Object.defineProperty(actor, 'system', {value: {
        armour: {head: part(), body: part(), leftArm: part(), rightArm: part(), leftLeg: part(), rightLeg: part()},
        characteristics: {toughness: {total, bonus: bonus ?? toughnessBonus}}
    }});
    return actor;
}

const hit = extra => ({location: 'ARMOUR.BODY', penetration: 0, weaponTraits: {}, ...extra});

test('penetration beyond the armour leaves the Toughness bonus standing', () => {
    assert.equal(target()._getEffectiveArmour(hit({penetration: 6})), 4);
});

test('penetration below the armour removes only that much armour', () => {
    assert.equal(target()._getEffectiveArmour(hit({penetration: 2})), 5);
});

test('an unpenetrating hit meets armour and Toughness bonus together', () => {
    assert.equal(target()._getEffectiveArmour(hit()), 7);
});

test('every location is protected from penetration the same way', () => {
    for (const location of ['ARMOUR.HEAD', 'ARMOUR.LEFT_ARM', 'ARMOUR.RIGHT_ARM', 'ARMOUR.BODY', 'ARMOUR.LEFT_LEG', 'ARMOUR.RIGHT_LEG'])
        assert.equal(target()._getEffectiveArmour(hit({location, penetration: 9})), 4, location);
});

test('a warp weapon ignores worn armour and still meets the Toughness bonus', () => {
    assert.equal(target()._getEffectiveArmour(hit({penetration: 6, weaponTraits: {warpWeapon: true}})), 4);
});

test('Felling still cuts the unnatural part of Toughness after penetration', () => {
    // Toughness 40 with a bonus of 8: four natural, four unnatural.
    const actor = target({toughnessBonus: 8, total: 40, bonus: 8});
    assert.equal(actor._getEffectiveArmour(hit({penetration: 6, weaponTraits: {felling: 2}})), 6);
});
