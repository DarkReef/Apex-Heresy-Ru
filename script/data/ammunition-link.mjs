/** Inventory ammunition is always an embedded Item of the weapon's actual Actor.
 * Backpack nesting changes its display path, never its owner or quantity source.
 * Legacy quantities count magazines/cells; individual rounds require an explicit unit.
 */
const actorQueues = new Map();
const anonymousQueues = new WeakMap();
const clone = value => structuredClone(value);
const itemId = item => item?.id ?? item?._id;

function actorItems(actor) {
    const collection = actor?.items;
    if (!collection) return [];
    if (typeof collection.values === "function") return [...collection.values()];
    if (collection.contents) return collection.contents;
    if (typeof collection[Symbol.iterator] === "function") return [...collection];
    if (typeof collection.filter === "function") return collection.filter(() => true);
    return [];
}

function getItem(actor, id) {
    return actor?.items?.get?.(id) ?? actorItems(actor).find(item => itemId(item) === id) ?? null;
}

function actorUuid(actor) {
    return actor?.uuid ?? (actor?.id ? `Actor.${actor.id}` : null);
}

/** Resolve only the current Actor's embedded item. No name or foreign-UUID fallback. */
export function resolveOwnedAmmunition(actor, reference) {
    if (!actor || typeof reference !== "string" || !reference) return null;
    let id = reference;
    if (reference.includes(".")) {
        const match = /^(.*)\.Item\.([^.]+)$/.exec(reference);
        if (!match) return null;
        const allowedOwners = new Set([actorUuid(actor)]);
        // An inherited token item keeps its embedded ID. Resolve the matching
        // token-local document, never the base Actor itself or a same-name item.
        if (actor.isToken) {
            const token = actor.token ?? actor.parent;
            const base = token?.baseActor;
            if (base) allowedOwners.add(actorUuid(base));
        }
        if (!allowedOwners.has(match[1])) return null;
        id = match[2];
    }
    const found = getItem(actor, id);
    return found?.type === "ammunition" ? found : null;
}

export function ammunitionQuantityUnit(ammunition) {
    return ammunition?.system?.quantityUnit === "rounds" ? "rounds" : "magazines";
}

/** Freeze only the ammunition's profile; later reserve edits cannot alter a loaded magazine. */
export function ammunitionSnapshot(ammunition) {
    return {
        itemId: itemId(ammunition) ?? null,
        uuid: ammunition?.uuid ?? null,
        name: ammunition?.name ?? "",
        effect: clone(ammunition?.system?.effect ?? {})
    };
}

function snapshotAsItem(snapshot) {
    return {
        id: snapshot.itemId ?? null,
        uuid: snapshot.uuid ?? null,
        name: snapshot.name ?? "",
        type: "ammunition",
        system: {effect: clone(snapshot.effect ?? {})}
    };
}

/** Item-shaped profile for the existing attack builder, including exhausted/deleted reserves. */
export function getAmmunitionProfile(actor, weapon) {
    const snapshot = weapon?.system?.loadedAmmo;
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) return snapshotAsItem(snapshot);
    return resolveOwnedAmmunition(actor, weapon?.system?.ammo);
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort()
        .map(key => [key, canonical(value[key])]));
    return value;
}

/** Stable identity for loaded effects. Names and Actor UUID spelling do not change ballistics. */
export function ammunitionProfileFingerprint(profile) {
    const snapshot = profile?.system ? ammunitionSnapshot(profile) : profile ?? ammunitionSnapshot(null);
    return JSON.stringify(canonical({itemId: snapshot.itemId ?? null, effect: snapshot.effect ?? {}}));
}

/** Container breadcrumb, guarded against malformed cycles and foreign references. */
export function ammunitionContainerPath(actor, ammunition) {
    const path = [];
    const visited = new Set([itemId(ammunition)]);
    let parentId = ammunition?.system?.inventory?.containerId;
    while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = getItem(actor, parentId);
        if (!parent?.system?.inventory?.isContainer) break;
        path.unshift(parent.name ?? "");
        parentId = parent.system.inventory.containerId;
    }
    return path.filter(Boolean).join(" › ");
}

export function ammunitionOptions(actor, weapon, {fits = () => true} = {}) {
    const selected = resolveOwnedAmmunition(actor, weapon?.system?.ammo);
    return actorItems(actor).filter(item => item.type === "ammunition").map(item => ({
        id: itemId(item), item, name: item.name ?? "", quantity: Number(item.system?.quantity) || 0,
        quantityUnit: ammunitionQuantityUnit(item), containerPath: ammunitionContainerPath(actor, item),
        selected: item === selected, compatible: !!fits(item, weapon)
    }));
}

/** Link a reserve without magically changing ammunition already inside the weapon. */
export function ammunitionSelectionUpdate(actor, weapon, reference, {fits = () => true} = {}) {
    if (!actor || getItem(actor, itemId(weapon)) !== weapon) return {success: false, reason: "wrong_owner"};
    if (actor.isOwner === false) return {success: false, reason: "no_permission"};
    const ammunition = reference ? resolveOwnedAmmunition(actor, reference) : null;
    if (reference && !ammunition) return {success: false, reason: "no_ammunition"};
    if (ammunition && !fits(ammunition, weapon)) return {success: false, reason: "wrong_ammunition"};
    const update = {"system.ammo": itemId(ammunition) ?? ""};
    if ((Number(weapon.system?.clip?.value) || 0) > 0 && !weapon.system?.loadedAmmo) {
        update["system.loadedAmmo"] = ammunitionSnapshot(getAmmunitionProfile(actor, weapon));
    }
    return {success: true, reference: update["system.ammo"], ammunition, update};
}

/** Pure reload plan. Quantities are whole magazines/cells unless explicitly marked rounds. */
export function planAmmunitionReload(weapon, ammunition) {
    const clipMax = Number(weapon?.system?.clip?.max);
    const clipValue = Number(weapon?.system?.clip?.value) || 0;
    const quantity = Number(ammunition?.system?.quantity);
    if (!Number.isInteger(clipMax) || clipMax <= 0 || !Number.isInteger(clipValue) || clipValue < 0) {
        return {success: false, reason: "invalid_clip"};
    }
    if (clipValue >= clipMax) return {success: false, reason: "clip_full"};
    if (!Number.isInteger(quantity) || quantity < 0) return {success: false, reason: "invalid_quantity"};
    if (quantity === 0) return {success: false, reason: "out_of_ammo"};
    const snapshot = ammunitionSnapshot(ammunition);
    const loaded = weapon?.system?.loadedAmmo;
    if (clipValue > 0 && loaded && ammunitionProfileFingerprint(loaded) !== ammunitionProfileFingerprint(snapshot)) {
        return {success: false, reason: "different_ammunition_loaded"};
    }
    const rounds = ammunitionQuantityUnit(ammunition) === "rounds";
    const spent = rounds ? Math.min(quantity, clipMax - clipValue) : 1;
    const newClip = rounds ? clipValue + spent : clipMax;
    const newQuantity = quantity - spent;
    return {
        success: true, spent, loaded: newClip - clipValue, clipValue: newClip, quantity: newQuantity, snapshot,
        updates: [
            {_id: itemId(ammunition), "system.quantity": newQuantity},
            {_id: itemId(weapon), "system.clip.value": newClip, "system.ammo": itemId(ammunition), "system.loadedAmmo": snapshot}
        ]
    };
}

/** Serialize local operations for the same actual Actor (including synthetic actors). */
export function withAmmunitionLock(actor, operation) {
    const identity = actorUuid(actor);
    const queues = identity ? actorQueues : anonymousQueues;
    const key = identity ?? actor;
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(key, next);
    return next.finally(() => {if (queues.get(key) === next) queues.delete(key);});
}

/** Reload from the Actor's own inventory, including backpack children, in one batch. */
export function reloadAmmunition(actor, weapon, {fits = () => true} = {}) {
    if (!actor) return Promise.resolve({success: false, reason: "no_actor"});
    return withAmmunitionLock(actor, async () => {
        if (!actor || getItem(actor, itemId(weapon)) !== weapon) return {success: false, reason: "wrong_owner"};
        if (actor.isOwner === false) return {success: false, reason: "no_permission"};
        const reference = weapon.system?.ammo;
        const eligible = item => item.type === "ammunition" && Number(item.system?.quantity) > 0 && fits(item, weapon);
        const ammunition = reference ? resolveOwnedAmmunition(actor, reference)
            : actor.items?.find?.(eligible) ?? actorItems(actor).find(eligible);
        if (!ammunition) return {success: false, reason: reference ? "no_ammunition" : "no_compatible_ammunition"};
        if (!fits(ammunition, weapon)) return {success: false, reason: "wrong_ammunition"};
        const plan = planAmmunitionReload(weapon, ammunition);
        if (!plan.success) return plan;
        if (typeof actor.updateEmbeddedDocuments !== "function") throw new Error("Actor cannot update inventory documents");
        // One backend operation replaces the old independent Promise.all writes.
        // This is not a cross-client transaction; ambiguous persistence failures
        // propagate and are never retried or rolled back automatically.
        const written = await actor.updateEmbeddedDocuments("Item", plan.updates);
        if (!Array.isArray(written) || written.length !== 2) throw new Error("Incomplete ammunition reload; inspect inventory before retrying");
        return {...plan, ammunition};
    });
}

/** Existing penetration is an override; an explicit modifier is added afterwards. */
export function ammunitionPenetration(base, effect = {}) {
    const override = effect.penetration;
    const selected = override !== undefined && override !== null && String(override).trim() !== "" ? override : base;
    const formula = String(selected ?? "0").trim() || "0";
    const bonus = Number(effect.penetrationModifier) || 0;
    if (!bonus) return formula;
    // Addition needs no grouping. Parentheses have a historical special meaning
    // to the system's old Razor Sharp penetration parser, so do not introduce any.
    return `${formula}${bonus > 0 ? "+" : ""}${bonus}`;
}
