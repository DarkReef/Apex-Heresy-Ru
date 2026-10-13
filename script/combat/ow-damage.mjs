/** Only War damage arithmetic. Prepared data in, explanation out; no dice/documents. */
export const OW_DAMAGE_VERSION = 1;
export const OW_LOCATIONS = Object.freeze({
    'ARMOUR.HEAD':'head', 'ARMOUR.BODY':'body', 'ARMOUR.LEFT_ARM':'leftArm',
    'ARMOUR.RIGHT_ARM':'rightArm', 'ARMOUR.LEFT_LEG':'leftLeg', 'ARMOUR.RIGHT_LEG':'rightLeg'
});
const number = (value, label) => {
    const result = Number(value);
    if (!Number.isFinite(result) || result < 0) throw Error(`Invalid ${label}`);
    return result;
};

/** Multipliers belong to other books. OW's +X is used exactly once. */
export function owCharacteristicBonus(effective, unnatural = 0) {
    return Math.floor(Math.max(Number(effective) || 0, 0) / 10) + Math.max(Number(unnatural) || 0, 0);
}

export function owHitProtection(defense, hit) {
    const raw = number(hit.amount, 'damage');
    const penetration = number(hit.penetration ?? 0, 'penetration');
    const felling = number(hit.weaponTraits?.felling || 0, 'Felling');
    const part = OW_LOCATIONS[hit.location];
    if (!part) throw Error('Unsupported location');
    const armour = number(defense.armour[part], 'armour');
    const natural = Math.floor(number(defense.effectiveToughness, 'Toughness') / 10);
    const unnatural = number(defense.unnaturalToughness, 'Unnatural Toughness');
    const unnaturalAfterFelling = Math.max(unnatural - felling, 0);
    const warp = hit.weaponTraits?.warpWeapon === true;
    const armourAfterPen = warp ? 0 : Math.max(armour - penetration, 0);
    const exceptions = hit.bypassDaemonic ?? false;
    const daemonic = exceptions ? 0 : number(defense.daemonic ?? 0, 'Daemonic');
    const toughnessForHit = natural + unnaturalAfterFelling;
    return {rawDamage: raw, armour, penetration, armourAfterPen, naturalToughness: natural,
        unnaturalToughness: unnatural, felling, unnaturalAfterFelling, toughnessForHit, daemonic,
        warpWeapon: warp, damageAfterSoak: Math.max(raw - armourAfterPen - toughnessForHit - daemonic, 0)};
}

/** Shared by Actor.previewDamage and Actor.applyDamage for OW. */
export function planOWDamage(defense, damages, {blocked = [], manual = null} = {}) {
    const before = {...defense.wounds};
    let wounds = number(before.value, 'wounds'), critical = number(before.critical, 'critical');
    const max = number(before.max, 'max wounds');
    if (wounds > max) throw Error('Wounds exceed maximum');
    const rows = [], damageTaken = [];
    for (const [index, hit] of damages.entries()) {
        const id = hit.id ?? `hit-${index}`;
        const protection = owHitProtection(defense, hit);
        const intercept = blocked.includes(id);
        let damage = intercept ? 0 : protection.damageAfterSoak;
        const rf = number(hit.righteousFury || 0, 'Righteous Fury');
        let rfEffect = 0;
        if (!intercept && rf > 0) {
            if (damage === 0) damage = 1;
            else rfEffect = rf; // Independent critical effect; never accumulated wounds.
        }
        if (manual) damage = number(manual[id], `manual damage for ${id}`);
        const normalAdded = Math.min(damage, Math.max(max - wounds, 0));
        const newCriticalRaw = damage - normalAdded;
        // Manual values are the FINAL wounds after all defenses/True Grit, not another raw hit.
        const criticalAdded = !manual && newCriticalRaw > 0 && defense.trueGrit
            ? Math.max(newCriticalRaw - protection.toughnessForHit, 1) : newCriticalRaw;
        wounds += normalAdded;
        critical += criticalAdded;
        rows.push({id, location: hit.location, ...protection, blocked: intercept, damage,
            normalAdded, newCriticalRaw, criticalAdded, rfEffect,
            remaining: max - wounds - critical, trueGrit: Boolean(defense.trueGrit), manual:Boolean(manual)});
        const record = (amount, source) => damageTaken.push({damage: amount, source,
            location: hit.location, type: hit.type, penetration: hit.penetration,
            toughnessForHit: protection.toughnessForHit, hitId: id});
        if (normalAdded) record(normalAdded, 'Wounds');
        if (criticalAdded) record(criticalAdded, 'Critical');
        if (rfEffect) record(rfEffect, 'Critical Effect (RF)');
    }
    return {version: OW_DAMAGE_VERSION, before, rows, damageTaken, wounds, criticalWounds: critical,
        after: {value: wounds, critical, max}, remainingBefore: max - before.value - before.critical,
        remainingAfter: max - wounds - critical};
}

/** Properties already resolved in damage dice are not applied a second time. */
const FINAL_PROFILE = new Set(['accurate','razorSharp','tearing','proven','primitive','rfFace',
    'storm','twinLinked','twinLinkedBonus','reliable','unreliable','unbalanced','unwieldy','balanced',
    'defensive','flexible','inaccurate','felling','powerField','sanctified','gyroStabilised',
    'melta','scatter','maximal','lasSetting','recharge','overheating']);
export function damageReviewReasons(defense, hits) {
    const reasons = [...(defense.review ?? [])];
    if (defense.unnaturalMultiplier > 1) reasons.push('OW: old Unnatural multiplier needs conversion');
    for (const hit of hits) {
        for (const [key, value] of Object.entries(hit.weaponTraits ?? {})) {
            if (value !== false && value != null && value !== 0 && !FINAL_PROFILE.has(key)) reasons.push(`Property requires review: ${key}`);
        }
        if (hit.weaponTraits?.warpWeapon && !defense.warpArmourConfirmed) reasons.push('Warp Weapon: confirm armour exceptions');
        if (defense.daemonic > 0 && hit.bypassDaemonic == null) reasons.push('Daemonic: attack exceptions require GM decision');
        if (defense.daemonic > 0 && defense.trueGrit && hit.bypassDaemonic !== true) reasons.push('Daemonic/True Grit interaction requires manual resolution');
    }
    return [...new Set(reasons)];
}
