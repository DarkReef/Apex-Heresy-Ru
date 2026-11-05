/** Explicit combat boundaries layered on Foundry 14's native ActiveEffect timers.
 * Native seconds/rounds/turns and periodic harm remain owned by Foundry/the system.
 * This module only expires effects carrying its own schedule, never deals damage.
 */
export const EFFECT_CLOCK_KEY = 'effectClock';
export const EFFECT_CLOCK_EXPIRY = 'darkHeresyBoundary';
export const EFFECT_CLOCK_MODES = Object.freeze(['native', 'targetStart', 'targetEnd', 'sourceStart', 'sourceEnd', 'roundStart', 'roundEnd']);
const queues = new Map();
const registered = new WeakMap();
const copy = value => value == null ? value : structuredClone(value);
const entries = collection => collection?.contents ?? (typeof collection?.values === 'function' ? [...collection.values()] : collection ?? []);
const id = document => document?.id ?? document?._id;
const uuid = document => document?.uuid ?? (id(document) ? `Actor.${id(document)}` : null);
const policyOf = effect => effect?.flags?.['dark-heresy']?.[EFFECT_CLOCK_KEY];
const actorOf = effect => effect?.actor ?? (effect?.parent?.documentName === 'Actor' ? effect.parent : effect?.parent?.actor ?? effect?.parent?.parent);
const modeKey = mode => `COMBAT_EFFECTS.MODE.${mode}`;
const activeGM = game => game?.user?.isGM && game.user === game.users?.activeGM;

function validateCombat(combat) {
    if (!combat?.started || !(Number(combat.round) > 0) || !Number.isInteger(combat.turn) || !combat.turns?.length)
        throw new Error('COMBAT_EFFECTS.REQUIRES_COMBAT');
}

function originalDuration(effect) {
    const old = policyOf(effect);
    if (old?.nativeDuration) return {duration:copy(old.nativeDuration), start:copy(old.nativeStart)};
    const duration = effect?._source?.duration ?? effect?.duration ?? {};
    return {duration:{value:Number.isFinite(duration.value) ? duration.value : null,
        units:duration.units ?? 'seconds', expiry:duration.expiry ?? null, expired:!!duration.expired},
    start:copy(effect?._source?.start ?? effect?.start ?? null)};
}

function referenceFor(effect, mode, combat, {sourceActorUuid, referenceCombatantId} = {}) {
    const target = actorOf(effect);
    let actorUuid = uuid(target);
    if (mode.startsWith('source')) {
        actorUuid = sourceActorUuid ?? policyOf(effect)?.sourceActorUuid;
        if (!actorUuid && typeof effect?.origin === 'string') {
            actorUuid = effect.origin.replace(/\.(?:Item|ActiveEffect)\..*$/, '');
        }
    }
    const candidates = combat.turns.filter(combatant => uuid(combatant.actor) === actorUuid);
    if (referenceCombatantId) {
        const combatant = candidates.find(combatant => id(combatant) === referenceCombatantId);
        if (!combatant) throw new Error('COMBAT_EFFECTS.REFERENCE_MISSING');
        return {combatant, actorUuid};
    }
    if (candidates.length !== 1) throw new Error(candidates.length ? 'COMBAT_EFFECTS.REFERENCE_AMBIGUOUS' : 'COMBAT_EFFECTS.REFERENCE_MISSING');
    return {combatant:candidates[0], actorUuid};
}

/** A patch only: callers retain normal Document permission and persistence handling. */
export function buildEffectClockUpdate(effect, {mode = 'native', cycles = 1, combat, sourceActorUuid,
    referenceCombatantId, worldTime = 0} = {}) {
    if (!EFFECT_CLOCK_MODES.includes(mode)) throw new Error('COMBAT_EFFECTS.INVALID_MODE');
    if (mode === 'native') {
        const old = policyOf(effect);
        return old ? {'flags.dark-heresy.-=effectClock':null, duration:copy(old.nativeDuration), start:copy(old.nativeStart)} : {};
    }
    validateCombat(combat);
    cycles = Number(cycles);
    if (!Number.isInteger(cycles) || cycles < 1 || cycles > 999) throw new Error('COMBAT_EFFECTS.INVALID_CYCLES');
    const original = originalDuration(effect);
    const phase = mode.endsWith('End') ? 'end' : 'start';
    let reference = null, dueRound;
    if (mode.startsWith('round')) dueRound = Number(combat.round) + cycles - (phase === 'end' ? 1 : 0);
    else {
        reference = referenceFor(effect, mode, combat, {sourceActorUuid, referenceCombatantId});
        const turn = combat.turns.indexOf(reference.combatant);
        const upcomingThisRound = phase === 'end' ? turn >= combat.turn : turn > combat.turn;
        dueRound = Number(combat.round) + cycles - (upcomingThisRound ? 1 : 0);
    }
    const policy = {version:1, mode, cycles, combatId:id(combat), referenceCombatantId:id(reference?.combatant) ?? null,
        sourceActorUuid:mode.startsWith('source') ? reference.actorUuid : null,
        dueRound, anchor:{round:Number(combat.round), turn:combat.turn, combatantId:id(combat.combatant)},
        nativeDuration:original.duration, nativeStart:original.start};
    return {'flags.dark-heresy.effectClock':policy, disabled:false,
        duration:{value:null, units:'seconds', expiry:EFFECT_CLOCK_EXPIRY, expired:false},
        start:{time:Math.trunc(Number(worldTime) || 0), combat:id(combat), combatant:id(reference?.combatant ?? combat.combatant),
            initiative:Number(reference?.combatant?.initiative ?? combat.combatant?.initiative) || 0,
            round:Number(combat.round), turn:combat.turn}};
}

/** Re-arm the same chosen policy when an expired effect is explicitly restarted. */
export function restartEffectClockUpdate(effect, options = {}) {
    const policy = policyOf(effect);
    return policy ? buildEffectClockUpdate(effect, {...policy, ...options}) : {};
}

function forward(previous, current) {
    if (!previous || !current) return false;
    return Number(current.round) > Number(previous.round)
        || Number(current.round) === Number(previous.round) && Number(current.turn) > Number(previous.turn);
}

/** Core uses the same forward-only traversal; reordering initiative is not elapsed time. */
export function combatBoundaryEvents(combat, previous, current) {
    if (!forward(previous, current) || !combat.turns?.length) return [];
    const events = [], turns = combat.turns;
    let round = Number(previous.round), turn = Number(previous.turn);
    if (!Number.isInteger(turn)) turn = -1;
    while (round < Number(current.round) || round === Number(current.round) && turn < Number(current.turn)) {
        if (round > 0 && turn >= 0 && turns[turn]) events.push({phase:'end', combatant:turns[turn], round, turn});
        turn++;
        if (turn >= turns.length || round < 1) {round++; turn=0;}
        if (round > Number(current.round) || round === Number(current.round) && turn > Number(current.turn)) break;
        if (turns[turn]) events.push({phase:'start', combatant:turns[turn], round, turn});
    }
    return events;
}

function effectsInCombat(combat, game) {
    // A source-timed effect can belong to another Actor, including an unlinked
    // token which is not a combatant. Its source is the ticking combatant.
    const sceneActors = entries(game?.scenes).flatMap(scene => entries(scene.tokens).map(token => token.actor));
    const actors = [...entries(game?.actors), ...entries(combat.combatants).map(combatant => combatant.actor), ...sceneActors];
    const seenActors = new Set(), seenEffects = new Set(), effects = [];
    for (const actor of actors) {
        if (!actor || seenActors.has(uuid(actor) ?? actor)) continue;
        seenActors.add(uuid(actor) ?? actor);
        for (const effect of [...entries(actor.effects), ...entries(actor.items).flatMap(item => entries(item.effects))]) {
            if (seenEffects.has(effect.uuid ?? effect)) continue;
            seenEffects.add(effect.uuid ?? effect); effects.push(effect);
        }
    }
    return effects;
}

function isDue(effect, combat, combatant, phase, context) {
    const policy = policyOf(effect);
    if (!policy || policy.version !== 1 || policy.combatId !== id(combat) || effect.duration?.expired) return false;
    if (!EFFECT_CLOCK_MODES.includes(policy.mode) || policy.mode === 'native') return false;
    if (!Number.isInteger(policy.dueRound) || Number(context.round) < policy.dueRound) return false;
    if (Number(context.round) < policy.anchor.round || Number(context.round) === policy.anchor.round && Number(context.turn) < policy.anchor.turn) return false;
    if (policy.mode.endsWith('End') !== (phase === 'end')) return false;
    if (policy.mode === 'roundStart') return context.turn === 0;
    if (policy.mode === 'roundEnd') return context.turn === combat.turns.length - 1;
    return id(combatant) === policy.referenceCombatantId;
}

/** Call before start-of-turn harm, and after end-of-turn harm. No native timer ticking. */
export function processEffectBoundary(combat, combatant, phase, context = {}, {game = globalThis.game,
    previous = combat?.previous, current = combat?.current} = {}) {
    if (!activeGM(game) || !['start','end'].includes(phase)) return Promise.resolve([]);
    // Combat._onStartTurn also runs for initiative reorder; do not expire on it.
    if (!forward(previous, current)) return Promise.resolve([]);
    const key = id(combat) ?? combat;
    const prior = queues.get(key) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(async () => {
        const expired = [];
        for (const effect of effectsInCombat(combat, game)) {
            if (!activeGM(game)) break;
            if (!isDue(effect, combat, combatant, phase, context)) continue;
            await effect.update({disabled:true, 'duration.expired':true,
                'flags.dark-heresy.effectClock.expiredAt':{round:context.round, turn:context.turn, phase}});
            expired.push(effect.uuid ?? id(effect));
        }
        return expired;
    });
    queues.set(key, task);
    return task.finally(() => {if (queues.get(key) === task) queues.delete(key);});
}

/** Combat-only schedules end with their combat; retain all effect documents. */
export function expireEffectClocksForCombat(combat, {game = globalThis.game} = {}) {
    if (!combat || !activeGM(game)) return Promise.resolve([]);
    const key = id(combat) ?? combat;
    const prior = queues.get(key) ?? Promise.resolve();
    const task = prior.catch(() => {}).then(async () => {
        const expired = [];
        for (const effect of effectsInCombat(combat, game)) {
            if (!activeGM(game)) break;
            const policy = policyOf(effect);
            if (!policy || policy.version !== 1 || policy.combatId !== id(combat) || effect.duration?.expired) continue;
            await effect.update({disabled:true, 'duration.expired':true,
                'flags.dark-heresy.effectClock.expiredAt':{round:combat.round, turn:combat.turn, phase:'combatEnd'}});
            expired.push(effect.uuid ?? id(effect));
        }
        return expired;
    });
    queues.set(key, task);
    return task.finally(() => {if (queues.get(key) === task) queues.delete(key);});
}

/** Optional standalone hook binding. Native Combat subclass callers use boundaries:false. */
export function registerEffectClockHooks({Hooks = globalThis.Hooks, game = globalThis.game,
    CONFIG = globalThis.CONFIG, boundaries = true, onError = error => console.error('Apex Heresy | Effect clock', error)} = {}) {
    // The model accepts arbitrary expiry events; registration keeps the native
    // effect editor from losing this selected value when it renders its select.
    if (CONFIG?.ActiveEffect) (CONFIG.ActiveEffect.expiryEvents ??= {})[EFFECT_CLOCK_EXPIRY] = 'COMBAT_EFFECTS.BOUNDARY';
    if (!Hooks || registered.has(Hooks)) return registered.get(Hooks);
    const hooks = [];
    if (boundaries) hooks.push(['combatTurnChange', Hooks.on('combatTurnChange', (combat, previous, current) => {
        const events = combatBoundaryEvents(combat, previous, current);
        void (async () => {for (const event of events) await processEffectBoundary(combat, event.combatant, event.phase, event,
            {game, previous, current});})().catch(onError);
    })]);
    const dispose = () => {for (const [name, hook] of hooks) Hooks.off(name, hook); registered.delete(Hooks);};
    registered.set(Hooks, dispose);
    return dispose;
}

/** Merge into the sheet's presentation, not the persisted ActiveEffect. */
export function effectClockView(effect, {combat, localize = key => key} = {}) {
    const policy = policyOf(effect);
    if (!policy || policy.version !== 1) return null;
    const reference = combat?.turns?.find(combatant => id(combatant) === policy.referenceCombatantId);
    const sameCombat = id(combat) === policy.combatId;
    const remaining = sameCombat ? Math.max(0, policy.dueRound - Number(combat.round)) : null;
    return {mode:policy.mode, cycles:policy.cycles, dueRound:policy.dueRound, remainingRounds:remaining,
        referenceName:reference?.name ?? reference?.actor?.name ?? '', combatMissing:!sameCombat,
        label:`${localize(modeKey(policy.mode))}${reference?.name ? ` · ${reference.name}` : ''} · ${localize('COMBAT_EFFECTS.ROUND')} ${policy.dueRound}`};
}

export function decorateEffectClockView(view, effect, options = {}) {
    const clock = effectClockView(effect, options);
    return clock ? {...view, temporary:true, durationLabel:clock.label, effectClock:clock} : view;
}

export function effectClockDialogData(effect, combat, localize = key => key) {
    const policy = policyOf(effect);
    const targetUuid = uuid(actorOf(effect));
    return {mode:policy?.mode ?? 'native', cycles:policy?.cycles ?? 1,
        modes:EFFECT_CLOCK_MODES.map(mode => ({value:mode, label:localize(modeKey(mode)), selected:mode === (policy?.mode ?? 'native')})),
        targets:(combat?.turns ?? []).filter(combatant => uuid(combatant.actor) === targetUuid).map(combatant => ({
            id:id(combatant), name:combatant.name ?? combatant.actor?.name ?? '',
            selected:policy?.mode?.startsWith('target') && id(combatant) === policy.referenceCombatantId})),
        references:(combat?.turns ?? []).map(combatant => ({id:id(combatant), actorUuid:uuid(combatant.actor),
            name:combatant.name ?? combatant.actor?.name ?? '', selected:policy?.mode?.startsWith('source') && id(combatant) === policy.referenceCombatantId}))};
}
