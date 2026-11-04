import {test} from "node:test";
import assert from "node:assert/strict";
import {migratePackageReferences} from "../script/package-reference-migration.mjs";

function doc(source, embedded = {}) {
    const children = Object.values(embedded).flat();
    return new class {
        static hierarchy = Object.fromEntries(Object.keys(embedded).map(key => [key, {}]));
        source = structuredClone(source);
        updates = [];
        toObject() { return structuredClone(this.source); }
        *traverseEmbeddedDocuments() {
            for (const child of children) {
                yield ["embedded", child];
                yield* child.traverseEmbeddedDocuments();
            }
        }
        async update(patch) {
            this.updates.push(structuredClone(patch));
            merge(this.source, patch);
            return this;
        }
    }();
}

function merge(target, patch) {
    for (const [key, value] of Object.entries(patch)) {
        if (value && typeof value === "object" && !Array.isArray(value)) merge(target[key] ??= {}, value);
        else target[key] = structuredClone(value);
    }
}

function gameFixture(collections = {}) {
    const gm = {id: "gm", isGM: true};
    const settings = new Map([["packageReferenceMigrationVersion", 0]]);
    const writes = [];
    return {system: {id: "apex-heresy-ru"}, user: gm, users: {activeGM: gm}, ...collections,
        settings: {get: (_scope, key) => settings.get(key), set: async (scope, key, value) => {
            writes.push([scope, key, value]); settings.set(key, value);
        }}, writes};
}

test("only the active GM in the independent package can migrate", async () => {
    const document = doc({img: "systems/dark-heresy/a.svg"});
    const game = gameFixture({actors: [document]});
    game.user = {id: "other", isGM: true};
    assert.equal((await migratePackageReferences(game)).status, "skipped");
    game.user = game.users.activeGM;
    game.system.id = "dark-heresy";
    assert.equal((await migratePackageReferences(game)).status, "skipped");
    assert.deepEqual(document.updates, []);
    assert.deepEqual(game.writes, []);
});

test("migration updates nested token deltas, effects and journal pages with targeted patches", async () => {
    const effect = doc({_id: "effect", img: "systems/dark-heresy/effect.svg", disabled: false});
    const item = doc({_id: "item", img: "systems/dark-heresy/item.svg", effects: [effect.source], system: {quantity: 3}}, {effects: [effect]});
    const delta = doc({_id: "delta", items: [item.source], system: {wounds: {value: 7}}}, {items: [item]});
    const token = doc({_id: "token", texture: {src: "systems/dark-heresy/token.webp"}, delta: delta.source, actorLink: false}, {delta});
    const scene = doc({_id: "scene", tokens: [token.source], name: "keep"}, {tokens: [token]});
    const page = doc({_id: "page", text: {content: "@UUID[Compendium.dark-heresy.only-war.Item.test]", format: 1}});
    const journal = doc({_id: "journal", pages: [page.source]}, {pages: [page]});
    const game = gameFixture({scenes: [scene], journal: [journal]});
    const report = await migratePackageReferences(game);
    assert.equal(report.updated, 4);
    assert.deepEqual(scene.updates, []);
    assert.deepEqual(delta.updates, []);
    assert.deepEqual(journal.updates, []);
    assert.deepEqual(token.updates, [{texture: {src: "systems/apex-heresy-ru/token.webp"}}]);
    assert.deepEqual(item.updates, [{img: "systems/apex-heresy-ru/item.svg"}]);
    assert.deepEqual(effect.updates, [{img: "systems/apex-heresy-ru/effect.svg"}]);
    assert.deepEqual(page.updates, [{text: {content: "@UUID[Compendium.apex-heresy-ru.only-war.Item.test]"}}]);
    assert.deepEqual(game.writes, [["dark-heresy", "packageReferenceMigrationVersion", 1]]);
    assert.equal((await migratePackageReferences(game)).status, "current");
    assert.equal(item.updates.length, 1);
});

test("world packs restore their lock, macros remain intact, system packs are untouched", async () => {
    const command = 'return fromUuid("Compendium.dark-heresy.only-war.Item.a");';
    const macro = doc({_id: "macro", img: "systems/dark-heresy/macro.svg", command});
    const packMacro = doc({_id: "packMacro", command: 'return game.packs.get("dark-heresy.only-war");'});
    const result = doc({_id: "result", documentCollection: "dark-heresy.only-war", documentId: "same"});
    const table = doc({_id: "table", results: [result.source]}, {results: [result]});
    const locks = [];
    const pack = {metadata: {packageType: "world"}, locked: true, getDocuments: async () => [table],
        configure: async ({locked}) => { locks.push(locked); pack.locked = locked; }};
    const systemPack = {metadata: {packageType: "system"}, getDocuments() { throw new Error("must not read system pack"); }};
    const game = gameFixture({macros: [macro, packMacro], packs: new Map([["world.test", pack], ["system.test", systemPack]])});
    const warnings = [];
    const warn = console.warn;
    console.warn = message => warnings.push(message);
    try {
        const report = await migratePackageReferences(game);
        assert.equal(report.worldPacks, 1);
        assert.equal(report.macroCommandsSkipped, 2);
        assert.deepEqual(locks, [false, true]);
        assert.equal(pack.locked, true);
        assert.equal(macro.source.command, command);
        assert.deepEqual(packMacro.updates, []);
        assert.equal(result.source.documentCollection, "apex-heresy-ru.only-war");
        assert.equal(result.source.documentId, "same");
        assert.equal(warnings.length, 1);
        assert.ok(!warnings[0].includes(command));
    } finally {
        console.warn = warn;
    }
});

test("failed pack writes keep the completion marker unset and are retryable", async () => {
    const document = doc({_id: "a", img: "systems/dark-heresy/a.svg"});
    const update = document.update.bind(document);
    let failing = true;
    document.update = async patch => { if (failing) throw new Error("write failed"); return update(patch); };
    const locks = [];
    const pack = {metadata: {packageType: "world"}, locked: true, getDocuments: async () => [document],
        configure: async ({locked}) => { locks.push(locked); pack.locked = locked; }};
    const game = gameFixture({packs: [pack]});
    await assert.rejects(migratePackageReferences(game), /write failed/);
    assert.equal(pack.locked, true);
    assert.deepEqual(game.writes, []);
    failing = false;
    assert.equal((await migratePackageReferences(game)).status, "complete");
    assert.deepEqual(locks, [false, true, false, true]);
    assert.equal(game.writes.length, 1);
});

test("unchanged packs are never unlocked and concurrent calls share one migration", async () => {
    const document = doc({_id: "a", img: "systems/apex-heresy-ru/a.svg"});
    let reads = 0;
    const pack = {metadata: {packageType: "world"}, locked: true,
        getDocuments: async () => { reads++; return [document]; },
        configure() { throw new Error("must not change lock"); }};
    const game = gameFixture({packs: [pack]});
    const first = migratePackageReferences(game);
    const second = migratePackageReferences(game);
    assert.equal(first, second);
    assert.equal((await first).updated, 0);
    assert.equal(reads, 1);
    assert.equal(game.writes.length, 1);
});
