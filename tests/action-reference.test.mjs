import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {ACTION_COSTS, OW_ACTIONS, filterActions} from "../script/combat/action-reference-data.mjs";

class ApplicationStub {
    rendered = false;
    async render() { this.rendered = true; return this; }
    async close() { this.rendered = false; return this; }
    _onRender() {}
}
globalThis.foundry = {applications: {api: {ApplicationV2: ApplicationStub, HandlebarsApplicationMixin: base => base}}};
globalThis.CONST = {KEYBINDING_PRECEDENCE: {PRIORITY: 0, NORMAL: 1, DEFERRED: 2}};
const {createReferenceController, registerCombatActionReference, matchesReferenceBinding, CombatActionReference} = await import("../script/combat/action-reference.mjs");
const byId = id => OW_ACTIONS.find(row => row.id === id);

test("OW covers every table 8-1 entry plus three sourced free actions", () => {
    assert.equal(OW_ACTIONS.length, 34);
    assert.equal(new Set(OW_ACTIONS.map(row => row.id)).size, 34);
    for (const row of OW_ACTIONS) {
        assert.equal(row.book, "ow");
        assert.ok(row.page >= 238 && row.page <= 244);
        assert.ok(row.effect && row.conditions && row.tags);
        assert.ok(row.costs.every(cost => cost in ACTION_COSTS));
    }
    assert.deepEqual(filterActions({cost: "free"}).map(row => row.id), ["speak", "drop", "release"]);
    assert.deepEqual(filterActions({cost: "reaction"}).map(row => row.id), ["evasion"]);
});

test("critical OW action costs and prerequisites do not inherit earlier editions", () => {
    for (const id of ["standard", "semi-auto", "full-auto", "swift", "lightning", "guarded", "ready", "brace"])
        assert.deepEqual(byId(id).costs, ["half"], id);
    for (const id of ["charge", "all-out", "suppress", "overwatch", "called-shot", "disengage"])
        assert.deepEqual(byId(id).costs, ["full"], id);
    assert.ok(!byId("guarded").tags.includes("Атака"));
    assert.match(byId("swift").effect, /2 дополнительные/);
    assert.match(byId("semi-auto").effect, /2 дополнительные/);
    assert.match(byId("lightning").conditions, /Несбалансированное.*Громоздкое/);
    assert.match(byId("feint").conditions, /той же цели в том же ходу/);
    assert.deepEqual(byId("focus-power").costs, ["varies"]);
    assert.ok(byId("reload").costs.includes("extended"));
});

test("source contradictions are visible and included in both duration filters", () => {
    assert.deepEqual(OW_ACTIONS.filter(row => row.dispute).map(row => row.id), ["delay", "jump"]);
    for (const id of ["delay", "jump"]) {
        assert.match(byId(id).dispute, /Таблица.*описание.*ведущий/);
        for (const cost of ["half", "full"]) assert.ok(filterActions({cost}).some(row => row.id === id));
    }
});

test("book filtering never silently supplies OW rules for an unverified book", () => {
    for (const book of ["dh2", "bc", "rt", "dw", "unknown"]) assert.deepEqual(filterActions({book}), []);
});

test("search supports Russian, English aliases, ё/е, whitespace, effects, and combined filters", () => {
    assert.equal(filterActions({query: "  МАНЕВР "})[0].id, "manoeuvre");
    assert.equal(filterActions({query: "Semi-Auto"})[0].id, "semi-auto");
    assert.equal(filterActions({query: "финт той же"})[0].id, "feint");
    assert.equal(filterActions({query: "парирование", cost: "reaction"})[0].id, "evasion");
    assert.deepEqual(filterActions({query: "<script>alert(1)</script>"}), []);
});

test("rapid toggle operations are serialized and reuse one window after closing", async () => {
    let count = 0;
    const calls = [];
    const app = {rendered: false, async render() { await Promise.resolve(); calls.push("open"); this.rendered = true; }, async close() { calls.push("close"); this.rendered = false; }};
    const toggle = createReferenceController(() => { count++; return app; });
    await Promise.all([toggle(), toggle(), toggle(), toggle()]);
    assert.equal(count, 1);
    assert.deepEqual(calls, ["open", "close", "open", "close"]);
    assert.equal(app.rendered, false);
    await toggle();
    await app.close(); // window X or Escape
    await toggle();
    assert.equal(count, 1);
    assert.equal(app.rendered, true);
});

test("render failure does not poison subsequent toggle requests", async () => {
    let attempts = 0;
    const toggle = createReferenceController(() => ({rendered: false, async render() { if (++attempts === 1) throw Error("template"); }}));
    await assert.rejects(toggle(), /template/);
    await toggle();
    assert.equal(attempts, 2);
});

test("editable F1 is unrestricted, consumes repeats without toggling, and consumes key-up", () => {
    let config;
    globalThis.game = {keybindings: {register(namespace, action, data) {
        assert.equal(namespace, "dark-heresy");
        assert.equal(action, "combatActionReference");
        config = data;
    }}};
    registerCombatActionReference();
    assert.deepEqual(config.editable, [{key: "F1"}]);
    assert.equal(config.uneditable, undefined);
    assert.equal(config.restricted, false);
    assert.equal(config.precedence, 0);
    assert.equal(config.onDown({repeat: true}), true);
    assert.equal(config.onUp({}), true);
});

test("local search-field shortcut respects current rebind, modifiers, removal and composition", () => {
    const custom = [{key: "KeyH", modifiers: ["Control", "Shift"]}];
    assert.equal(matchesReferenceBinding({code: "F1"}, custom), false);
    assert.equal(matchesReferenceBinding({code: "KeyH", ctrlKey: true, shiftKey: true}, custom), true);
    assert.equal(matchesReferenceBinding({code: "KeyH", metaKey: true, shiftKey: true}, custom), true);
    assert.equal(matchesReferenceBinding({code: "KeyH", ctrlKey: true}, custom), false);
    assert.equal(matchesReferenceBinding({code: "F1", altKey: true}, [{key: "F1"}]), false);
    assert.equal(matchesReferenceBinding({code: "F1", isComposing: true}, [{key: "F1"}]), false);
    assert.equal(matchesReferenceBinding({code: "F1"}, []), false);
    assert.equal(matchesReferenceBinding({code: "KeyY", key: "z", ctrlKey: true}, [{key: "KeyZ", modifiers: ["Control"]}], true), true);
    assert.equal(matchesReferenceBinding({code: "KeyY", key: "z", ctrlKey: true}, [{key: "KeyZ", modifiers: ["Control"]}], false), false);
});

test("window context labels OW explicitly, reflects rebindings and hides unverified rules", async () => {
    globalThis.game = {keybindings: {get: () => [{key: "F2", modifiers: ["Shift"]}]}};
    const app = new CombatActionReference();
    const context = await app._prepareContext();
    assert.equal(context.shortcut, "Shift + F2");
    assert.equal(context.rows.length, 34);
    app.filters.book = "dw";
    const other = await app._prepareContext();
    assert.equal(other.supported, false);
    assert.deepEqual(other.rows, []);
});

// Optional real-engine keyboard integration. The licensed Foundry source stays local,
// is never checked in, and is only read when this explicit environment variable is set.
test("Foundry v14 keyboard dispatcher: core F1, priority, repeats, rebind and input focus", {skip: !process.env.FOUNDRY_CLIENT_PATH}, async () => {
    const source = readFileSync(process.env.FOUNDRY_CLIENT_PATH, "utf8");
    const extract = name => {
        const start = source.indexOf(`class ${name} {`);
        assert.ok(start >= 0, `${name} not found`);
        return source.slice(start, source.indexOf("\n}", start) + 2);
    };
    const settings = {};
    const sandbox = {
        navigator: {appVersion: "Windows"}, document: {activeElement: null},
        foundry: {applications: {detached: {}}, utils: {getType: value => value ? "HTMLElement" : "null"}},
        game: {settings: {get: () => settings}, user: {isGM: false}, webrtc: {_onPTTStart() {}, _onPTTEnd() {}}},
        CONFIG: {debug: {}}, CONST, console, _loc: key => key
    };
    vm.createContext(sandbox);
    vm.runInContext("Array.fromRange = (n, min=0) => Array.from({length:n}, (_, i) => i + min);", sandbox);
    vm.runInContext(`${extract("KeyboardManager")}\n${extract("ClientKeybindings")}\ngame.keybindings = new ClientKeybindings(); game.keyboard = new KeyboardManager();`, sandbox);
    const {game} = sandbox;
    game.keybindings._registerCoreKeybindings("game");
    game.keybindings.initialize();
    assert.equal(game.keybindings.activeKeys.has("F1"), false, "Recheck the core F1 conflict on this Foundry build");
    game.keybindings.bindings = undefined; // new init registration phase in this fixture
    globalThis.game = game;
    registerCombatActionReference();
    let lowerPriorityCalls = 0;
    game.keybindings.register("test", "help", {name: "Help", editable: [{key: "F1"}], onDown: () => { lowerPriorityCalls++; return true; }});
    game.keybindings.initialize();
    let cancelled = 0;
    const context = {key: "F1", logicalKey: "F1", modifiers: [], hasModifier: false, up: false, repeat: true, event: {preventDefault() { cancelled++; }, stopPropagation() {}}};
    game.keyboard._processKeyboardContext(context);
    assert.equal(lowerPriorityCalls, 0);
    assert.equal(cancelled, 1);
    sandbox.document.activeElement = {tagName: "INPUT", dataset: {}};
    game.keyboard._processKeyboardContext(context);
    assert.equal(cancelled, 1, "Foundry ignores keys in text fields");
    settings["dark-heresy.combatActionReference"] = [{key: "F2", modifiers: []}];
    game.keybindings.initialize();
    sandbox.document.activeElement = null;
    game.keyboard._processKeyboardContext({...context, repeat: false});
    assert.equal(lowerPriorityCalls, 1, "F1 returns to the other action after rebind");
    game.keyboard._processKeyboardContext({...context, key: "F2", logicalKey: "F2"});
    assert.equal(cancelled, 3);
});
