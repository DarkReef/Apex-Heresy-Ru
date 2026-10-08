import {ACTION_BOOKS, ACTION_COSTS, filterActions} from "./action-reference-data.mjs";

const NAMESPACE = "dark-heresy";
const ACTION = "combatActionReference";
const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/** Match editable bindings without calling Foundry's private keyboard dispatcher. */
export function matchesReferenceBinding(event, bindings, universalMode = false) {
    if (event.isComposing) return false;
    const keys = [event.code];
    // v14 can match logical characters across keyboard layouts. F-keys still use code.
    if (universalMode && event.key?.length === 1) {
        keys.unshift(/^\d$/.test(event.key) ? `Digit${event.key}` : `Key${event.key.toUpperCase()}`);
    }
    const held = {Control: event.ctrlKey || event.metaKey, Shift: event.shiftKey, Alt: event.altKey};
    return bindings.some(binding => keys.includes(binding.key) && Object.entries(held).every(
        ([modifier, down]) => Boolean(down) === (binding.modifiers ?? []).includes(modifier)
    ));
}

/** Serialize renders/closes: two quick presses still open then close one instance. */
export function createReferenceController(create) {
    let app;
    let pending = Promise.resolve();
    return () => {
        const operation = pending.catch(() => {}).then(async () => {
            app ??= create();
            if (app.rendered) await app.close();
            else await app.render({force: true});
            return app;
        });
        pending = operation;
        return operation;
    };
}

export class CombatActionReference extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "apex-combat-action-reference",
        classes: ["dark-heresy", "apex-action-reference"],
        window: {title: "Apex Heresy · Боевые действия", resizable: true},
        position: {width: 880, height: 620}
    };
    static PARTS = {body: {template: "systems/dark-heresy/template/apps/action-reference.hbs"}};

    constructor(...args) {
        super(...args);
        this.filters = {book: "ow", cost: "", query: ""};
    }

    async _prepareContext() {
        const bindings = game.keybindings.get(NAMESPACE, ACTION);
        return {
            ...this.filters,
            books: Object.entries(ACTION_BOOKS).map(([value, label]) => ({value, label, selected: value === this.filters.book})),
            costs: Object.entries(ACTION_COSTS).map(([value, label]) => ({value, label, selected: value === this.filters.cost})),
            shortcut: bindings.map(b => [...(b.modifiers ?? []), b.key].join(" + ")).join(" / ") || "не назначена",
            supported: this.filters.book === "ow",
            rows: filterActions({book: this.filters.book}).map(row => ({...row,
                costLabel: row.costs.map(cost => ACTION_COSTS[cost]).join(" / ")
            }))
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        // ApplicationV2 can retain the outer element across partial renders.
        this.listeners?.abort();
        this.listeners = new AbortController();
        const signal = this.listeners.signal;
        const root = this.element;
        root.querySelector("[name=book]").addEventListener("change", event => {
            this.filters.book = event.target.value;
            void this.render();
        }, {signal});
        for (const name of ["query", "cost"]) root.querySelector(`[name=${name}]`).addEventListener(
            name === "query" ? "input" : "change", event => {
                this.filters[name] = event.target.value;
                this.filterRows();
            }, {signal}
        );
        // Scoped to this window. Read the CURRENT binding so rebinding/removal works
        // here too. Never hijack a plain letter while the user is typing a query.
        root.addEventListener("keydown", event => {
            const editing = event.target.matches?.("input, select, textarea") || event.target.isContentEditable;
            const universalMode = foundry.helpers?.interaction?.KeyboardManager?.isUniversalMode ?? false;
            if (!editing || !matchesReferenceBinding(event, game.keybindings.get(NAMESPACE, ACTION), universalMode)) return;
            if (!/^F\d+$/.test(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey) return;
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) requestToggle();
        }, {signal});
        this.filterRows();
    }

    filterRows() {
        const visible = new Set(filterActions(this.filters).map(row => row.id));
        for (const row of this.element.querySelectorAll("[data-action-id]")) row.hidden = !visible.has(row.dataset.actionId);
        this.element.querySelector("[data-count]").textContent = `${visible.size} действий`;
        this.element.querySelector("[data-empty]").hidden = visible.size > 0 || this.filters.book !== "ow";
    }

    async close(options) {
        await super.close(options);
        this.listeners?.abort();
    }
}

export const toggleCombatActionReference = createReferenceController(() => new CombatActionReference());
function requestToggle() {
    void toggleCombatActionReference().catch(error => {
        console.error("dark-heresy | combat action reference", error);
        ui.notifications.error("Не удалось открыть справку боевых действий. Подробности в консоли.");
    });
}

export function registerCombatActionReference() {
    game.keybindings.register(NAMESPACE, ACTION, {
        name: "Боевые действия · справка Apex Heresy",
        hint: "Открыть/закрыть справку Only War. F1 имеет приоритет; при конфликте назначьте другую клавишу здесь. В полях других окон бинд не действует.",
        editable: [{key: "F1"}],
        restricted: false,
        // Consume repeats too, preventing browser help/other lower-priority actions
        // from firing while F1 is held, but only toggle on the initial keydown.
        repeat: true,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY,
        onDown: context => {
            if (!context.repeat && !context.event?.repeat) requestToggle();
            return true;
        },
        onUp: () => true
    });
}
