import {test} from "node:test";
import assert from "node:assert/strict";
import {getLegacyFlag, setLegacyFlag, unsetLegacyFlag, rewriteLegacyReferences} from "../script/package-identity.mjs";

function documentFixture(flags = {}) {
    return {
        flags: structuredClone(flags),
        updates: [],
        getFlag() { throw new Error("Legacy package scope is inactive"); },
        setFlag() { throw new Error("Legacy package scope is inactive"); },
        unsetFlag() { throw new Error("Legacy package scope is inactive"); },
        async update(patch) {
            this.updates.push(patch);
            for (const [path, value] of Object.entries(patch)) {
                const parts = path.split(".");
                const last = parts.pop();
                let target = this;
                for (const key of parts) target = target[key] ??= {};
                if (last.startsWith("-=")) delete target[last.slice(2)];
                else if (value?.constructor?.name === "ForcedDeletion") delete target[last];
                else target[last] = value;
            }
            return this;
        }
    };
}

test("independent package reads, edits and deletes nested legacy flags without scope helpers", async () => {
    const previous = globalThis.game;
    globalThis.game = {system: {id: "apex-heresy-ru"}};
    try {
        const document = documentFixture({"dark-heresy": {combat: {spent: 2, other: 7}, enabled: false}, module: {value: 9}});
        assert.equal(getLegacyFlag(document, "combat.spent"), 2);
        assert.equal(getLegacyFlag(document, "enabled"), false);
        assert.equal(await setLegacyFlag(document, "combat.spent", 0), document);
        assert.equal(getLegacyFlag(document, "combat.spent"), 0);
        assert.equal(await unsetLegacyFlag(document, "combat.spent"), document);
        assert.equal(getLegacyFlag(document, "combat.spent"), undefined);
        assert.deepEqual(document.flags, {"dark-heresy": {combat: {other: 7}, enabled: false}, module: {value: 9}});
        assert.deepEqual(document.updates[0], {"flags.dark-heresy.combat.spent": 0});
        assert.deepEqual(document.updates[1], {"flags.dark-heresy.combat.-=spent": null});
        assert.equal(getLegacyFlag({getFlag() { throw new Error("must not call"); }}, "missing"), undefined);
    } finally {
        globalThis.game = previous;
    }
});

test("Foundry 14 flag deletion uses its data operator and preserves other flags", async () => {
    const previous = globalThis.foundry;
    class ForcedDeletion {}
    globalThis.foundry = {data: {operators: {ForcedDeletion}}};
    try {
        const document = documentFixture({"dark-heresy": {state: {used: true, keep: 4}}});
        await unsetLegacyFlag(document, "state.used");
        assert.ok(document.updates[0]["flags.dark-heresy.state.used"] instanceof ForcedDeletion);
        assert.deepEqual(document.flags, {"dark-heresy": {state: {keep: 4}}});
    } finally {
        globalThis.foundry = previous;
    }
});

test("flag reads keep literal dotted keys, missing values and null distinct", () => {
    const document = documentFixture({"dark-heresy": {"a.b": 5, a: {b: 8}, empty: null}});
    assert.equal(getLegacyFlag(document, "a.b"), 5);
    assert.equal(getLegacyFlag(document, "empty"), null);
    assert.equal(getLegacyFlag(document, "empty.nested"), undefined);
    assert.equal(getLegacyFlag(document, "absent"), undefined);
});

test("legacy consumer documents can retain their original helpers", async () => {
    const previous = globalThis.game;
    globalThis.game = {system: {id: "dark-heresy"}};
    try {
        const calls = [];
        const document = Object.fromEntries(["getFlag", "setFlag", "unsetFlag"].map(method =>
            [method, (...args) => { calls.push([method, ...args]); return 3; }]));
        assert.equal(getLegacyFlag(document, "value"), 3);
        await setLegacyFlag(document, "value", 4);
        await unsetLegacyFlag(document, "value");
        assert.deepEqual(calls, [["getFlag", "dark-heresy", "value"], ["setFlag", "dark-heresy", "value", 4],
            ["unsetFlag", "dark-heresy", "value"]]);
    } finally {
        globalThis.game = previous;
    }
});

test("invalid flag paths cannot escape into object prototypes", async () => {
    const document = documentFixture();
    for (const key of ["", "a..b", "__proto__.polluted", "nested.constructor.prototype"]) {
        await assert.rejects(setLegacyFlag(document, key, true), TypeError);
        await assert.rejects(unsetLegacyFlag(document, key), TypeError);
    }
    assert.deepEqual(document.updates, []);
});

test("reference rewrite is pure, recursive and preserves code, namespaces and unrelated packages", () => {
    const source = {
        img: "systems/dark-heresy/icons/test.svg",
        flags: {"dark-heresy": {uuid: "Compendium.dark-heresy.only-war.Item.abc"}, core: {sheetClass: "dark-heresy.ItemSheet"}},
        pages: [{text: {content: '<img src="/systems/dark-heresy/a.webp"> @UUID[Compendium.dark-heresy.skills.Item.def]'}}],
        tokens: [{delta: {items: [{img: "systems/dark-heresy/assets/a.svg"}]}}],
        command: 'await fromUuid("Compendium.dark-heresy.skills.Item.def");',
        name: "dark-heresy", other: "systems/dark-heresy-2nd/a.svg Compendium.dark-heresy-2nd.skills.Item.a",
        empty: null, count: 3
    };
    const snapshot = structuredClone(source);
    const result = rewriteLegacyReferences(source);
    assert.deepEqual(source, snapshot);
    assert.equal(result.img, "systems/apex-heresy-ru/icons/test.svg");
    assert.equal(result.flags["dark-heresy"].uuid, "Compendium.apex-heresy-ru.only-war.Item.abc");
    assert.equal(result.flags.core.sheetClass, source.flags.core.sheetClass);
    assert.equal(result.pages[0].text.content, '<img src="/systems/apex-heresy-ru/a.webp"> @UUID[Compendium.apex-heresy-ru.skills.Item.def]');
    assert.equal(result.tokens[0].delta.items[0].img, "systems/apex-heresy-ru/assets/a.svg");
    assert.equal(result.command, source.command);
    assert.equal(result.name, source.name);
    assert.equal(result.other, source.other);
    assert.deepEqual(rewriteLegacyReferences(result), result);
});

test("bare pack IDs change only in known reference fields and for shipped packs", () => {
    const source = {documentCollection: "dark-heresy.only-war", nested: {pack: "dark-heresy.origins"},
        collection: "dark-heresy.dark-heresy", setting: "dark-heresy.only-war", unknown: {pack: "dark-heresy.homebrew"},
        flags: {"dark-heresy": {ruleset: "dark-heresy"}}};
    const result = rewriteLegacyReferences(source);
    assert.equal(result.documentCollection, "apex-heresy-ru.only-war");
    assert.equal(result.nested.pack, "apex-heresy-ru.origins");
    assert.equal(result.collection, "apex-heresy-ru.dark-heresy");
    assert.equal(result.setting, source.setting);
    assert.equal(result.unknown.pack, source.unknown.pack);
    assert.deepEqual(result.flags, source.flags);
});
