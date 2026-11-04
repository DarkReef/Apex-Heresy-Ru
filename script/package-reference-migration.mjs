import {SYSTEM_ID, LEGACY_DATA_SCOPE, rewriteLegacyReferences} from "./package-identity.mjs";

const VERSION = 1;
const MARKER = "packageReferenceMigrationVersion";
const COLLECTIONS = ["actors", "items", "scenes", "journal", "tables", "playlists", "cards", "messages", "macros",
    "combats", "folders"];
const pending = new WeakMap();

/**
 * Run after ready, on the active GM only. This changes resource references, not
 * world identity or rule data. The hidden world setting is registered at init.
 * Failed work remains retryable: patches are idempotent and the completion
 * marker is saved only after all world documents and world packs succeed.
 */
export function migratePackageReferences(game) {
    if (game.system?.id !== SYSTEM_ID || !game.user?.isGM || game.user !== game.users?.activeGM) {
        return Promise.resolve({status: "skipped"});
    }
    if (pending.has(game)) return pending.get(game);
    const operation = migrate(game).catch(error => {
        globalThis.ui?.notifications?.error?.(game.i18n?.localize?.("UI.WORLD_UPGRADE_FAILED")
            ?? "Apex Heresy RU: resource migration failed. Reopen the world to retry.");
        throw error;
    }).finally(() => pending.delete(game));
    pending.set(game, operation);
    return operation;
}

async function migrate(game) {
    if (Number(game.settings.get(LEGACY_DATA_SCOPE, MARKER)) >= VERSION) return {status: "current"};
    globalThis.ui?.notifications?.info?.(game.i18n?.localize?.("UI.UPGRADING_THE_WORLD_PLEASE_WAIT")
        ?? "Apex Heresy RU: updating resource references, please wait.");
    const report = {status: "complete", scanned: 0, updated: 0, worldPacks: 0, macroCommandsSkipped: 0};
    const seen = new Set();
    for (const key of COLLECTIONS) {
        for (const document of values(game[key])) await migrateTree(document, seen, report);
    }
    for (const pack of values(game.packs)) {
        if (pack.metadata?.packageType !== "world" && pack.metadata?.package !== "world") continue;
        report.worldPacks++;
        // Reading needs no lock change. Unlock only if actual changes exist.
        const documents = [...await pack.getDocuments(), ...values(pack.folders)];
        const changes = [];
        for (const root of documents) {
            for (const document of documentTree(root)) {
                if (seen.has(document)) continue;
                seen.add(document);
                const patch = documentPatch(document, report);
                if (Object.keys(patch).length) changes.push({document, patch});
            }
        }
        if (!changes.length) continue;
        const wasLocked = pack.locked;
        if (wasLocked) await pack.configure({locked: false});
        try {
            for (const {document, patch} of changes) {
                await document.update(patch);
                report.updated++;
            }
        } finally {
            if (wasLocked) await pack.configure({locked: true});
        }
    }
    if (report.macroCommandsSkipped) {
        // Do not log document names, command text or private game content.
        console.warn(`Apex Heresy RU | ${report.macroCommandsSkipped} macro command(s) still contain legacy package references; review their code manually.`);
    }
    await game.settings.set(LEGACY_DATA_SCOPE, MARKER, VERSION);
    globalThis.ui?.notifications?.info?.(game.i18n?.localize?.("UI.UPGRADE_COMPLETE")
        ?? "Apex Heresy RU: resource migration complete.");
    return report;
}

async function migrateTree(root, seen, report) {
    for (const document of documentTree(root)) {
        if (seen.has(document)) continue;
        seen.add(document);
        const patch = documentPatch(document, report);
        if (!Object.keys(patch).length) continue;
        await document.update(patch);
        report.updated++;
    }
}

function* documentTree(root) {
    yield root;
    // Core includes nested items/effects, journal pages and scene token deltas.
    // It omits inherited, unmanaged ActorDelta items to avoid changing a base
    // actor through a synthetic token.
    if (typeof root.traverseEmbeddedDocuments === "function") {
        for (const [, document] of root.traverseEmbeddedDocuments()) yield document;
    }
}

function documentPatch(document, report) {
    const source = document.toObject();
    report.scanned++;
    // Embedded Documents are updated through their own APIs; never replace an
    // entire embedded collection while changing one image or content link.
    if (typeof document.traverseEmbeddedDocuments === "function") {
        const embeddedFields = new Set([
            ...Object.keys(document.constructor.hierarchy ?? {}),
            ...Object.values(document.constructor.metadata?.embedded ?? {})
        ]);
        for (const key of embeddedFields) delete source[key];
    }
    report.macroCommandsSkipped += countLegacyCommands(source);
    return changedFields(source, rewriteLegacyReferences(source));
}

function values(collection) {
    if (!collection) return [];
    if (typeof collection.values === "function") return collection.values();
    return collection.contents ?? [];
}

// The rewrite preserves the shape of source data. A narrow recursive diff is
// sufficient and avoids submitting unrelated actor/system values to hooks.
function changedFields(before, after) {
    const patch = {};
    for (const [key, value] of Object.entries(after)) {
        if (Array.isArray(value)) {
            if (JSON.stringify(before[key]) !== JSON.stringify(value)) patch[key] = value;
        } else if (value && typeof value === "object") {
            const nested = changedFields(before[key], value);
            if (Object.keys(nested).length) patch[key] = nested;
        } else if (before[key] !== value) patch[key] = value;
    }
    return patch;
}

function countLegacyCommands(value) {
    if (!value || typeof value !== "object") return 0;
    let count = 0;
    for (const [key, entry] of Object.entries(value)) {
        if (key === "command") {
            if (typeof entry === "string" && /systems\/dark-heresy\/|Compendium\.dark-heresy\.|dark-heresy\.(?:black-crusade|dark-heresy|rogue-trader|only-war|deathwatch|origins|bc-tables)\b/.test(entry)) count++;
        } else count += countLegacyCommands(entry);
    }
    return count;
}
