import {ruleName, matchesRuleName} from "../localization/rule-name.mjs";
// ════════════════════════════════════════════════════════════════════════
//  Мастер создания персонажа.
//
//  Работает поверх УЖЕ созданного актора и закрепляет каждый шаг по «Далее», а
//  не одним патчем в конце. Поэтому недоделанный персонаж — всё равно годный
//  документ: окно можно закрыть и открыть на нём заново.
//
//  Ветвлений по книге здесь нет. Мастер идёт по списку шагов из
//  ruleset-data.mjs, а `kind` шага решает, какая панель рисуется.
// ════════════════════════════════════════════════════════════════════════

import {RULESET_DEFS, stepsFor, auditedRulesets, contentPacksFor, characteristicKeysFor, fateFromTable}
    from "./ruleset-data.mjs";
import {resolveGrantPlan, emptyPlan} from "./grant-data.mjs";
import {planToActorUpdate, planToItemData, revertUpdate, ownedAptitudes,
        GRANT_FLAG_SCOPE, GRANT_FLAG_KEY} from "./origin-apply.mjs";
import {choiceBlocksHtml, readChoicePicks, restoreChoicePicks} from "./choice-blocks.mjs";
import {CHARACTERISTIC_KEYS, normaliseOrigin, grantSummaryLines} from "./origin-data.mjs";
import {findContent, GRANT_ITEM_TYPES} from "./content-lookup.mjs";
import {characteristicOffers, skillOffers, talentOffers, spentOn, purchaseCharacteristic,
        purchaseSkill, purchaseNewSpeciality, refundUpdate, CHARACTERISTIC_ABBREVIATIONS,
        checkPrerequisites} from "./shop-data.mjs";
import {specialityKeyFor} from "./origin-apply.mjs";
import {CHARACTERISTIC_COSTS, SKILL_COSTS, TALENT_COSTS, matchingAptitudes}
    from "./advancement-data.mjs";
import {pointBuyRules, pointBuyProblems, rollExpression, woundsExpression, fateExpression}
    from "./creation-roll-data.mjs";
import {eliteKeysIn, eliteText, eliteTextWithout, eliteOffers, elitePlan} from "./elite-data.mjs";
import {psychicOffersFor, psyRatingOffer, purchasePsyRating, powerPrice} from "./psychic-data.mjs";
import {PATRONS, UNDIVIDED, patronRelation, alignmentLeader} from "./patron-data.mjs";
import {gatherAdvances, cheapestOfEach, advanceOffers, rankForExperience} from "./advance-list.mjs";
import {skillFromAdvance, isTalentAdvance, talentLookupName} from "./dw-skill-map.mjs";
import {owedAptitudes, replacementOptions} from "./aptitude-debt.mjs";
import {ARMOURY_TYPES, acquisitionAllowance, equipmentOffers} from "./equipment-data.mjs";
import {demeanourFor} from "./life-data.mjs";
import {PERSONAL_DEMEANOURS, PERSONAL_DEMEANOUR_FORMULA, PAST_EVENT_FORMULA, ARMOUR_HISTORY_TABLE, rowForRoll, lifeLine} from "./dw-life-data.mjs";
import {REGIMENT_BUDGET, regimentCost, regimentProblems, composeRegiment} from "./regiment-data.mjs";
import {ADDITIONAL_KIT} from "./kit-data.mjs";

const {HandlebarsApplicationMixin, ApplicationV2} = foundry.applications.api;

export class CharacterWizard extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: "dh-character-wizard-{id}",
        classes: ["dark-heresy", "character-wizard"],
        // Высота по содержимому: шаги очень разной длины, и при фиксированной под
        // коротким шагом остаётся пустое поле в пол-экрана.
        position: {width: 640, height: "auto"},
        window: {resizable: true}
    };

    static PARTS = {
        body: {
            template: "systems/dark-heresy/template/apps/character-wizard.hbs",
            root: true,
            scrollable: [".wizard-step-body"]
        }
    };

    constructor(actor, options = {}) {
        super({id: `dh-character-wizard-${actor.id}`, ...options});
        this.actorId = actor.id;
        this.stepIndex = 0;
        // Ответы на строки выбора. Форма перерисовывается чаще, чем на неё отвечают,
        // а свежая разметка всегда пустая — без снимка ответ терялся бы от любого
        // соседнего клика.
        this.answers = {};
    }

    get actor() { return game.actors.get(this.actorId); }

    /** Книга, по которой ведётся персонаж: поле листа, а не флаг окна. */
    get ruleset() { return this.actor?.system?.ruleset ?? ""; }

    get steps() { return this.ruleset ? stepsFor(this.ruleset) : []; }
    get step() { return this.steps[this.stepIndex] ?? null; }

    get title() {
        return game.i18n.format("WIZARD.TITLE", {name: this.actor?.name ?? ""});
    }

    /** @override */
    async _prepareContext(options) {
        const actor = this.actor;
        if (!actor) return {missing: true};

        // Предлагаем только сверенные книги: по остальным Мастер вести не умеет,
        // и молча выдать по ним неверного персонажа хуже, чем не предложить вовсе.
        const audited = auditedRulesets();

        return {
            missing: false,
            name: actor.name,
            rulesetChosen: !!this.ruleset,
            rulesets: audited.map(key => ({
                key,
                label: game.i18n.localize(RULESET_DEFS[key].label),
                selected: key === this.ruleset
            })),
            unaudited: Object.keys(RULESET_DEFS)
                .filter(key => !audited.includes(key))
                .map(key => game.i18n.localize(RULESET_DEFS[key].label))
                .join(", "),
            steps: this.steps.map((step, index) => ({
                id: step.id,
                label: game.i18n.localize(step.label),
                active: index === this.stepIndex,
                done: index < this.stepIndex
            })),
            step: this.step ? {...this.step, label: game.i18n.localize(this.step.label)} : null,
            ...(this.step?.kind === "origin" ? await this._originStepContext(this.step) : {}),
            ...(this.step?.kind === "regiment" ? await this._regimentStepContext(this.step) : {}),
            ...(this.step?.kind === "characteristics" ? this._characteristicsStepContext() : {}),
            ...(this.step?.kind === "experience" ? await this._experienceContextLoaded() : {}),
            ...(this.step?.kind === "equipment" ? await this._equipmentStepContext() : {}),
            ...(this.step?.kind === "comrade" ? this._comradeStepContext() : {}),
            ...(this.step?.kind === "passions" ? await this._passionsStepContext(this.step) : {}),
            ...(this.step?.kind === "darkGods" ? this._darkGodsStepContext() : {}),
            ...(this.step?.kind === "divination" ? this._divinationStepContext() : {}),
            ...(this.step?.kind === "life" ? this._lifeStepContext() : {}),
            isLastStep: this.stepIndex === this.steps.length - 1,
            backDisabled: this.stepIndex === 0 || this._busy,
            nextDisabled: !this.ruleset || this._busy,
            busy: !!this._busy
        };
    }

    /**
     * Контекст шага происхождения: список вариантов, строки выбора выбранного и —
     * если шаг уже закреплён — сводка того, что он дал.
     */
    async _originStepContext(step) {
        const carrier = this._carrierFor(step);
        const chosen = this._selectedOrigin?.[step.id] ?? carrier?.uuid ?? "";
        const source = carrier?.toObject()?.system ?? this._selectedSource?.[step.id] ?? null;

        return {
            originStep: true,
            originOptions: (await this._originsFor(step.stage)).map(entry => ({
                uuid: entry.uuid, name: entry.name, selected: entry.uuid === chosen
            })),
            // Закреплённый шаг больше не спрашивает: чтобы переспросить, нужно «Назад».
            originLocked: !!carrier,
            originName: carrier?.name ?? "",
            choiceRows: (!carrier && source)
                ? choiceBlocksHtml(source, {intelligenceBonus: this._intelligenceBonus})
                : "",
            // Текст книги показывается и до выбора (по наведённому в списке), и после
            // закрепления: игрок должен читать, что берёт, а не угадывать по названию.
            originBook: source ? {
                description: source.description ?? "",
                bonuses: source.bonuses ?? [],
                summary: grantSummaryLines(source),
                source: source.source ?? ""
            } : null
        };
    }

    /** @override */
    _onRender(context, options) {
        super._onRender?.(context, options);
        const root = this.element;
        if (!root) return;

        // Панель страстей держит три списка сразу, поэтому слушаем каждый.
        for (const originSelect of root.querySelectorAll("select[data-origin-step]")) {
            originSelect.addEventListener("change", async ev => {
                const stepId = ev.currentTarget.dataset.originStep;
                const uuid = ev.currentTarget.value;
                (this._selectedOrigin ??= {})[stepId] = uuid;
                (this._selectedSource ??= {})[stepId] = uuid
                    ? (await fromUuid(uuid))?.toObject()?.system ?? null
                    : null;
                // Смена варианта делает прежние ответы бессмысленными.
                delete this.answers[stepId];
                this.render(false);
            });
            // Ответы читаются заново при каждом рендере, а свежая разметка пуста.
            restoreChoicePicks(root.querySelector(".wizard-choice-rows"), this.answers[this.step?.id]);
            this._wireOptionTargets(root);
        }

        root.querySelector(".wizard-ruleset")?.addEventListener("change", async ev => {
            const chosen = ev.currentTarget.value;
            if (!chosen) return;
            // Книга больше ничего не требует от типа листа: поля у обоих типов одни,
            // а лист под книгу подберётся сам.
            await this.actor.update({"system.ruleset": chosen});
            this.stepIndex = 0;
            this.answers = {};
            this.render(false);
        });

        this._wireCharacteristics(root);
        this._wireShop(root);
        this._wireEquipment(root);
        this._wireRegiment(root);
        this._wireComrade(root);
        this._wirePassions(root);
        this._wireDarkGods(root);
        this._wireLife(root);
        root.querySelector(".wizard-roll-divination")?.addEventListener("click", async () => {
            if (this._busy) return;
            this._busy = true;
            this.render(false);
            try { await this._commitDivinationStep(); }
            finally { this._busy = false; if (this.rendered) this.render(false); }
        });

        root.querySelector(".wizard-reroll-divination")?.addEventListener("click", async () => {
            if (this._busy) return;
            this._busy = true;
            this.render(false);
            try {
                await this._revertDivination();
                await this._commitDivinationStep();
            } finally {
                this._busy = false;
                if (this.rendered) this.render(false);
            }
        });


        root.querySelector("[data-action='wizard-back']")?.addEventListener("click", () => this._onBack());
        root.querySelector("[data-action='wizard-next']")?.addEventListener("click", () => this._onNext());
    }

    /**
     * Магазин опыта. Каждое действие идёт через _busy: покупка — это несколько записей
     * подряд, и второй клик посреди них купил бы то же дважды по устаревшему остатку.
     */
    _wireShop(root) {
        const guarded = action => async event => {
            event.preventDefault();
            if (this._busy) return;
            this._busy = true;
            try { await action(event.currentTarget); }
            finally { this._busy = false; if (this.rendered) this.render(false); }
        };

        for (const tab of root.querySelectorAll("[data-shop-tab]"))
            tab.addEventListener("click", event => {
                this._shopTab = event.currentTarget.dataset.shopTab;
                this.render(false);
            });

        for (const button of root.querySelectorAll("[data-buy-characteristic]"))
            button.addEventListener("click", guarded(el => this._buyCharacteristic(el.dataset.buyCharacteristic)));
        for (const button of root.querySelectorAll("[data-buy-skill]"))
            button.addEventListener("click", guarded(el => this._buySkill(el.dataset.buySkill, el.dataset.spec)));
        for (const button of root.querySelectorAll("[data-buy-talent]"))
            button.addEventListener("click", guarded(el => {
                const spec = root.querySelector(`input[data-talent-spec="${el.dataset.buyTalent}"]`)?.value;
                return this._buyTalent(el.dataset.buyTalent, spec);
            }));
        for (const button of root.querySelectorAll("[data-refund]"))
            button.addEventListener("click", guarded(el => this._refund(Number(el.dataset.refund))));
        for (const button of root.querySelectorAll("[data-buy-elite]"))
            button.addEventListener("click", guarded(el => this._buyElite(el.dataset.buyElite)));
        root.querySelector("[data-buy-psy-rating]")?.addEventListener("click", guarded(() => this._buyPsyRating()));
        for (const button of root.querySelectorAll("[data-buy-power]"))
            button.addEventListener("click", guarded(el => this._buyPower(el.dataset.buyPower)));
        for (const button of root.querySelectorAll("[data-buy-advance]"))
            button.addEventListener("click", guarded(el => this._buyAdvance(el.dataset.buyAdvance)));
        for (const button of root.querySelectorAll("[data-replace-aptitude]"))
            button.addEventListener("click", guarded(el => {
                const slot = this._owedSlots?.[Number(el.dataset.replaceAptitude)];
                const chosen = root.querySelector(`select[data-owed-choice="${el.dataset.replaceAptitude}"]`)?.value;
                if (slot && chosen) return this._replaceAptitude(slot.source, slot.duplicate, chosen);
            }));
        for (const button of root.querySelectorAll("[data-undo-replacement]"))
            button.addEventListener("click", guarded(el => {
                const slot = this._replacementSlots?.[Number(el.dataset.undoReplacement)];
                if (slot) return this._undoReplacement(slot.source, slot.itemId);
            }));

        // Имя таланта раскрывает под строкой текст книги: игрок читает, что покупает,
        // а не угадывает по названию. Открыт один — иначе список расползается.
        for (const button of root.querySelectorAll("[data-read-talent]"))
            button.addEventListener("click", async event => {
                event.preventDefault();
                const uuid = event.currentTarget.dataset.readTalent;
                this._openTalent = this._openTalent === uuid ? null : uuid;
                if (this._openTalent) await this._talentBook(uuid);
                await this.render(false);
                this.element?.querySelector(`[data-read-talent="${uuid}"]`)
                    ?.closest(".shop-talent")?.scrollIntoView({block: "nearest"});
            });
        for (const button of root.querySelectorAll("[data-open-talent]"))
            button.addEventListener("click", async event => {
                event.preventDefault();
                (await fromUuid(event.currentTarget.dataset.openTalent))?.sheet?.render(true);
            });
        for (const button of root.querySelectorAll("[data-open-item]"))
            button.addEventListener("click", event => {
                event.preventDefault();
                this.actor.items.get(event.currentTarget.dataset.openItem)?.sheet?.render(true);
            });

        root.querySelector("[data-buy-speciality]")?.addEventListener("click", guarded(() => {
            const key = root.querySelector(".shop-new-spec-skill")?.value;
            const name = root.querySelector(".shop-new-spec-name")?.value;
            if (!key || !String(name ?? "").trim()) return;
            return this._buyNewSpeciality(key, name);
        }));

        // Поиск и уровень талантов перерисовывают список, но фокус остаётся в поле.
        const search = root.querySelector(".shop-talent-search");
        if (search) search.addEventListener("input", event => {
            this._talentFilter = event.currentTarget.value;
            clearTimeout(this._searchTimer);
            this._searchTimer = setTimeout(async () => {
                await this.render(false);
                const again = this.element?.querySelector(".shop-talent-search");
                if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
            }, 180);
        });
        root.querySelector(".shop-talent-tier")?.addEventListener("change", event => {
            this._talentTier = Number(event.currentTarget.value) || 0;
            this.render(false);
        });
    }

    /** Выбор стартового снаряжения. Текст книги открывается теми же кнопками, что в магазине. */
    _wireEquipment(root) {
        const guarded = action => async event => {
            event.preventDefault();
            if (this._busy) return;
            this._busy = true;
            try { await action(event.currentTarget); }
            finally { this._busy = false; if (this.rendered) this.render(false); }
        };
        for (const button of root.querySelectorAll("[data-take-equipment]"))
            button.addEventListener("click", guarded(el => this._takeEquipment(el.dataset.takeEquipment)));
        for (const button of root.querySelectorAll("[data-drop-equipment]"))
            button.addEventListener("click", guarded(el => this._dropEquipment(Number(el.dataset.dropEquipment))));

        const search = root.querySelector(".equipment-search");
        if (search) search.addEventListener("input", event => {
            this._equipmentFilter = event.currentTarget.value;
            clearTimeout(this._searchTimer);
            this._searchTimer = setTimeout(async () => {
                await this.render(false);
                const again = this.element?.querySelector(".equipment-search");
                if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
            }, 180);
        });
        root.querySelector(".equipment-type")?.addEventListener("change", event => {
            this._equipmentType = event.currentTarget.value;
            this.render(false);
        });
    }

    /** Кости и счётчик очков на шаге характеристик. */
    _wireCharacteristics(root) {
        const method = root.querySelector(".wizard-char-method");
        if (method) method.addEventListener("change", ev => {
            this._charMethod = ev.currentTarget.value;
            this._charValues = null;   // способ сменился — прежние значения уже не те
            this.render(false);
        });

        const inputs = [...root.querySelectorAll("input[data-characteristic]")];
        const remember = () => {
            this._charValues = Object.fromEntries(inputs.map(i => [i.dataset.characteristic, Number(i.value) || 0]));
        };
        const budget = root.querySelector("[data-spent]");
        const recount = () => {
            if (!budget) return;
            const spent = inputs.reduce((sum, i) => sum + (Number(i.value) || 0) - Number(i.dataset.start), 0);
            budget.textContent = String(spent);
            budget.classList.toggle("over", spent > POINT_BUY.points);
        };
        for (const input of inputs) input.addEventListener("input", () => { remember(); recount(); });
        recount();

        const rollOne = async button => {
            const roll = await new Roll(button.dataset.formula).evaluate();
            const input = root.querySelector(`input[data-characteristic="${button.dataset.roll}"]`);
            if (input) input.value = String(roll.total);
            remember();
        };
        for (const button of root.querySelectorAll(".wizard-roll"))
            button.addEventListener("click", () => rollOne(button));
        // Переброс тратится: книга даёт ровно один и велит оставить новый результат.
        for (const button of root.querySelectorAll("[data-reroll]"))
            button.addEventListener("click", async () => {
                const allowed = RULESET_DEFS[this.ruleset]?.characteristicRerolls ?? 0;
                if ((this._charRerollsUsed ?? 0) >= allowed) return;
                const input = root.querySelector(`input[data-characteristic="${button.dataset.reroll}"]`);
                if (!input?.value) { ui.notifications?.warn(game.i18n.localize("WIZARD.REROLL_FIRST")); return; }
                const roll = await new Roll(button.dataset.formula).evaluate();
                input.value = String(roll.total);
                this._charRerollsUsed = (this._charRerollsUsed ?? 0) + 1;
                remember();
                this.render(false);
            });
        root.querySelector(".wizard-roll-all")?.addEventListener("click", async () => {
            for (const button of root.querySelectorAll(".wizard-roll")) await rollOne(button);
        });
    }

    /**
     * Поле уточнения показывается, только когда выбран вариант, который его требует
     * («Resistance (Pick One)»), и прячется обратно при смене варианта — иначе игрок
     * заполняет поле, которое ни на что не влияет.
     */
    _wireOptionTargets(root) {
        for (const select of root.querySelectorAll("select[data-choice]")) {
            const target = root.querySelector(`input[data-option-target="${select.dataset.choice}"]`);
            if (!target) continue;
            const source = this._selectedSource?.[this.step?.id];
            const choice = (source?.choices ?? []).find(entry => entry.key === select.dataset.choice);
            const sync = () => {
                const option = choice?.options?.[Number(select.value)];
                target.hidden = !(select.value !== "" && option?.talentTemplate);
                if (target.hidden) target.value = "";
            };
            select.addEventListener("change", sync);
            sync();
        }
    }

    /**
     * «Далее». Шаги закрепляют свою работу сами; каркас только идёт по списку.
     * `_busy` защищает от второго клика, пока первый ещё внутри своего await:
     * иначе шаг применился бы дважды.
     */
    async _onNext() {
        if (this._busy) return;
        this._busy = true;
        this.render(false);
        try {
            if (!(await this._commitStep(this.step))) return;
            if (this.stepIndex >= this.steps.length - 1) { await this._finish(); return; }
            this.stepIndex += 1;
        } finally {
            this._busy = false;
            if (this.rendered) this.render(false);
        }
    }

    /** «Назад». Откат закреплённого шага делают сами шаги. */
    async _onBack() {
        if (this._busy || this.stepIndex === 0) return;
        this._busy = true;
        this.render(false);
        try {
            await this._revertStep(this.steps[this.stepIndex - 1]);
            this.stepIndex -= 1;
        } finally {
            this._busy = false;
            if (this.rendered) this.render(false);
        }
    }

    /**
     * Закрепить шаг.
     * @returns {Promise<boolean>} false — шаг не закрыт, дальше не идём
     */
    async _commitStep(step) {
        if (!step) return false;
        // Полк закрепляется тем же путём, что происхождение: это такой же носитель.
        if (step.kind === "origin" || step.kind === "regiment") return this._commitOriginStep(step);
        if (step.kind === "passions") return this._commitPassionsStep(step);
        if (step.kind === "characteristics") return this._commitCharacteristicsStep();
        if (step.kind === "experience") return this._commitExperienceStep();
        if (step.kind === "divination") return this._commitDivinationStep();
        return true;
    }

    /** Откатить ранее закреплённый шаг. */
    async _revertStep(step) {
        if (step?.kind === "origin" || step?.kind === "regiment") await this._revertOriginStep(step);
        // Вернувшись к характеристикам, шаг снова можно закрепить — другим способом
        // или другими значениями. Само закрепление ставит значения, а не прибавляет,
        // так что повторное не наслаивается.
        if (step?.kind === "characteristics") {
            await this.actor.unsetFlag(GRANT_FLAG_SCOPE, "creationRolls");
            if (RULESET_DEFS[this.ruleset].vitalsStage === "characteristics")
                await this.actor.unsetFlag(GRANT_FLAG_SCOPE, "creationVitals");
        }
        if (step?.kind === "divination") await this._revertDivination();
    }

    // ── Шаг происхождения ────────────────────────────────────────────────

    /** Метка, которой помечено всё выданное этим шагом. */
    _tagFor(step) { return `${this.ruleset}:${step.stage}`; }

    /** Предмет-носитель шага, если игрок уже был здесь. */
    _carrierFor(step) {
        const tag = this._tagFor(step);
        return this.actor.items.find(item =>
            item.type === "origin" && item.getFlag(GRANT_FLAG_SCOPE, GRANT_FLAG_KEY) === tag);
    }

    /** Бонус Интеллекта — от него зависит, сколько знаний просит выбор «any N». */
    get _intelligenceBonus() {
        return Math.floor((this.actor?.system?.characteristics?.intelligence?.total ?? 0) / 10);
    }

    /**
     * Что персонаж уже взял на прошлых шагах — по ключам происхождений.
     *
     * Архетипы Black Crusade делятся на человеческие и легионерские (стр. 54), и
     * список должен спрашивать только то, что этому персонажу доступно.
     */
    _originKeys() {
        return new Set(this.actor.items
            .filter(item => item.type === "origin" && item.system.key)
            .map(item => item.system.key));
    }

    /**
     * Какие специальности закрыл уже выбранный орден.
     *
     * Таблица 1-1 (стр. 27): Space Wolves не берут Апотекария, Black Templars —
     * ни Девастатора, ни Библиария. Запрет лежит на самом ордене, а не на
     * специальности: закрывает орден, и знает об этом он.
     */
    _forbiddenSpecialities() {
        const out = new Set();
        for (const item of this.actor.items)
            if (item.type === "origin")
                for (const key of item.system.rules?.forbidsSpecialities ?? []) out.add(key);
        return out;
    }

    /** Происхождения пака для одной стадии текущей книги, в книжном порядке. */
    async _originsFor(stage) {
        const pack = game.packs.get("dark-heresy.origins");
        const index = pack ? await pack.getIndex({fields: ["system.ruleset", "system.stage", "system.order",
                                                          "system.requires", "system.key"]}) : {contents: []};
        const fromPack = index.contents
            .filter(entry => entry.system?.ruleset === this.ruleset && entry.system?.stage === stage);
        // Полк собирается один на отряд и живёт предметом мира — его тоже предлагаем.
        const fromWorld = game.items.filter(item => item.type === "origin"
            && item.system.ruleset === this.ruleset && item.system.stage === stage)
            .map(item => ({uuid: item.uuid, name: item.name, system: item.system}));
        const taken = this._originKeys();
        const forbidden = this._forbiddenSpecialities();
        return [...fromPack, ...fromWorld]
            // Требование к прошлому шагу: архетип десантника Хаоса человеку не предлагается.
            .filter(entry => {
                const needs = entry.system?.requires?.originKey;
                return !needs || taken.has(needs);
            })
            // И запрет уже выбранного ордена: закрытую специальность не предлагают вовсе.
            .filter(entry => !forbidden.has(entry.system?.key))
            .sort((a, b) => (a.system.order ?? 0) - (b.system.order ?? 0) || a.name.localeCompare(b.name));
    }

    /**
     * Копия предмета из паков по виду и имени.
     * @returns {Promise<object|null>} null — такого имени нет ни в одном паке
     */
    async _lookupContent(kind, name) {
        // Свой пак книги первым: одно имя в разных книгах — разные правила.
        for (const packId of contentPacksFor(this.ruleset)) {
            const pack = game.packs.get(packId);
            if (!pack) continue;
            const index = await pack.getIndex();
            const hit = findContent(index.contents, GRANT_ITEM_TYPES[kind], name);
            if (!hit) continue;
            const data = (await pack.getDocument(hit._id)).toObject();
            // Имя с уточнением остаётся за копией: специалистский талант лежит в паке
            // одной записью «Weapon Training*», а на листе он «Weapon Training (Las)».
            if (ruleName(data) !== name) data.name = name;
            return data;
        }
        return null;
    }

    /**
     * Закрепить выбранное происхождение.
     *
     * На актора не уходит НИЧЕГО, пока план не сойдётся: неотвеченный выбор
     * оставляет персонажа ровно таким, каким он был.
     */
    async _commitOriginStep(step, scope = this.element) {
        const actor = this.actor;
        if (this._carrierFor(step)) return true;   // уже закреплено в прошлый заход

        const uuid = scope?.querySelector(`select[data-origin-step="${step.id}"]`)?.value;
        if (!uuid) { ui.notifications?.warn(game.i18n.localize("WIZARD.PICK_ORIGIN")); return false; }

        const source = (await fromUuid(uuid))?.toObject();
        if (!source) { ui.notifications?.warn(game.i18n.localize("WIZARD.PICK_ORIGIN")); return false; }

        const picks = readChoicePicks(scope.querySelector(".wizard-choice-rows"), source.system);
        this.answers[step.id] = picks;

        const {plan, problems} = resolveGrantPlan(source.system, picks,
                                                  {intelligenceBonus: this._intelligenceBonus});
        if (problems.length) { ui.notifications?.warn(problems.join("; ")); return false; }

        const tag = this._tagFor(step);
        // Носитель кладётся на актора как есть, поэтому его system сначала приводится
        // к схеме: пак, собранный более старым шаблоном, может нести пустые поля
        // значением null, а модель данных их не принимает и валит создание целиком.
        source.system = normaliseOrigin(source.system);
        source.flags = foundry.utils.mergeObject(source.flags ?? {},
            {[GRANT_FLAG_SCOPE]: {[GRANT_FLAG_KEY]: tag, picks}});
        const [carrier] = await actor.createEmbeddedDocuments("Item", [source]);

        const copies = new Map();
        const unresolved = [];
        for (const [kind, list] of [["talent", plan.talents], ["trait", plan.traits],
                                    ["ability", plan.abilities], ["equipment", plan.equipment]])
            for (const entry of list) {
                const copy = await this._lookupContent(kind, entry.name);
                copies.set(`${kind}:${entry.name}`, copy);
                if (!copy) unresolved.push(entry.name);
            }
        // Имя, которого нет ни в одном паке, становится пустой заглушкой. Молчать об
        // этом нельзя: на листе она выглядит настоящим предметом, только без правил.
        if (unresolved.length)
            ui.notifications?.warn(game.i18n.format("WIZARD.UNRESOLVED_GRANTS",
                                                    {names: unresolved.join(", ")}));
        // Сначала поля: план решает, какие склонности у актора ещё нет. Уже имеющуюся
        // повторно не выдаём — она записывается долгом (стр. 79).
        const {update, applied} = planToActorUpdate(actor, plan,
            {characteristicMode: RULESET_DEFS[this.ruleset].characteristicModifiers,
             duplicates: RULESET_DEFS[this.ruleset].duplicates});
        const granted = planToItemData(plan, tag, carrier.id, (kind, name) => copies.get(`${kind}:${name}`),
                                       {aptitudes: applied.aptitudes, skipTalents: applied.duplicateTalents});
        if (granted.length) await actor.createEmbeddedDocuments("Item", granted);

        // Стандартный комплект полка — тоже выдача, только лежит слотами (Only War, стр. 68).
        const kit = await this._kitItemData(source.system.rules?.kit, tag, carrier.id);
        if (kit.length) await actor.createEmbeddedDocuments("Item", kit);
        // Название выбранного попадает в анкету ЗДЕСЬ, а не в конце: игрок видит, как
        // лист собирается под его руками. Поле остаётся обычным, редактируемым —
        // переименовать «Мир-улей» в «Десолеум» это игра, а не поломка.
        if (step.bioField) update[step.bioField] = carrier.name;
        // Нрав ордена печатается на книжном листе своей строкой (стр. 397), и приходит
        // он вместе с орденом, а не выбирается: «Сыны Русса» — это про весь орден.
        if (source.system.rules?.demeanour) update["system.bio.chapterDemeanour"] = source.system.rules.demeanour;
        if (Object.keys(update).length) await actor.update(update);
        // Добавки к элиткам запоминаются на носителе: элитку могут взять и позже, в
        // магазине, а санкция фона к ней всё равно относится.
        applied.eliteRiders = plan.eliteRiders ?? [];
        await carrier.setFlag(GRANT_FLAG_SCOPE, "applied", applied);

        // Элитка даром (Mystic начинает псайкером, стр. 70). Фон закреплён раньше
        // роли, так что его санкция к этому моменту уже лежит на своём носителе.
        const elite = [];
        for (const key of plan.eliteAdvances ?? []) {
            if (eliteKeysIn(actor.system.bio?.elite).has(key)) continue;
            const record = await this._applyElite(key, {free: true, carrier});
            if (record) elite.push(record);
        }
        if (elite.length) await carrier.setFlag(GRANT_FLAG_SCOPE, "elite", elite);

        // Десантник Хаоса помечается флагом системы: от него зависят и Чёрный Панцирь
        // (стрелку не достаётся бонус за громадную цель), и пороги Даров богов —
        // легионер получает их реже ученика (Black Crusade, стр. 291).
        if (source.system.rules?.spaceMarine) await actor.setFlag(GRANT_FLAG_SCOPE, "spaceMarine", true);

        // Особая способность происхождения: санкционированный псайкер Only War начинает
        // с рейтингом пси и Порчей (стр. 95).
        const psyker = source.system.rules?.psyker;
        if (psyker) await this._applyPsykerRules(psyker, carrier);

        // Книга может задавать Раны и Судьбу шагом, который только что закрепили.
        if (RULESET_DEFS[this.ruleset].vitalsStage === step.stage) await this._rollVitals();
        return true;
    }

    /**
     * Предметы стандартного комплекта: основное оружие, броня и прочее.
     *
     * Мастерство пишется на копию: в паке лежит обычная вещь, а книга выдаёт
     * «Good Craftsmanship M36 lasgun». Строки «на отряд» предметами не становятся —
     * танк выдаётся отряду, а не листу.
     */
    async _kitItemData(kit, tag, carrierId) {
        if (!kit) return [];
        const flags = {[GRANT_FLAG_SCOPE]: {[GRANT_FLAG_KEY]: tag, grantedBy: carrierId}};
        const out = [];
        const unresolved = [];
        for (const entry of [...(kit.mainWeapon ?? []), ...(kit.armour ?? []), ...(kit.items ?? [])]) {
            const found = await this._lookupContent("equipment", entry.name);
            if (!found) { unresolved.push(entry.name); continue; }
            delete found._id;
            found.system = {...found.system};
            const count = Math.max(1, Number(entry.quantity) || 1);
            if (count > 1 && found.system.quantity !== undefined) found.system.quantity = count;
            if (entry.craftsmanship) found.system.craftsmanship = entry.craftsmanship;
            // Комплект носят, а не несут в мешке: броня надета сразу.
            if (found.type === "armour") found.system.equipped = true;
            // Счётчик есть только у боеприпасов; остальное множится предметами.
            for (let copy = 0; copy < (found.system.quantity !== undefined ? 1 : count); copy++)
                out.push({...found, system: {...found.system}, flags});
        }
        if (unresolved.length)
            ui.notifications?.warn(game.i18n.format("WIZARD.UNRESOLVED_GRANTS", {names: unresolved.join(", ")}));
        return out;
    }

    /**
     * Рейтинг пси и Порча от происхождения-псайкера.
     *
     * Записывается на носитель, чтобы «Назад» вернул и рейтинг, и Порчу: бросок
     * повторять не станем, но и оставлять его после отката нельзя.
     */
    async _applyPsykerRules(psyker, carrier) {
        const actor = this.actor;
        if (carrier.getFlag(GRANT_FLAG_SCOPE, "psyker")) return;
        const record = {rating: Number(actor.system.psy?.rating) || 0, corruption: 0};
        const update = {};
        if (psyker.psyRating) update["system.psy.rating"] = Math.max(record.rating, psyker.psyRating);
        // Насколько крепко псайкер привязан: колдун Black Crusade считается Bound,
        // а несанкционированный витч — Unbound, и от этого зависят Феномены (стр. 206).
        if (psyker.psychicStrength) update["system.psy.class"] = psyker.psychicStrength;
        if (psyker.corruption) {
            const roll = await new Roll(psyker.corruption).evaluate();
            record.corruption = roll.total;
            update["system.corruption"] = (Number(actor.system.corruption) || 0) + roll.total;
            ui.notifications?.info(game.i18n.format("WIZARD.ELITE_CORRUPTION",
                {name: carrier.name, total: roll.total}));
        }
        if (Object.keys(update).length) await actor.update(update);
        await carrier.setFlag(GRANT_FLAG_SCOPE, "psyker", record);
    }

    /** Снять закреплённый шаг, чтобы игрок мог выбрать иначе. */
    async _revertOriginStep(step) {
        const actor = this.actor;
        const carrier = this._carrierFor(step);
        if (!carrier) return;
        // Покупки опыта оплачены по склонностям, а откат происхождения их меняет.
        await this._refundAll();
        // Бонус Влияния мог измениться вместе с происхождением — выбор снаряжения тоже заново.
        await this._clearEquipment();
        // Выданная даром элитка правила не только предметами: рейтинг, Порча, анкета.
        for (const record of [...(carrier.getFlag(GRANT_FLAG_SCOPE, "elite") ?? [])].reverse())
            await this._revertElite(record);

        const update = revertUpdate(actor, carrier.getFlag(GRANT_FLAG_SCOPE, "applied") ?? {});
        if (Object.keys(update).length) await actor.update(update);

        // Подпись в анкете снимается только если она всё ещё та, что мы вписали.
        // Переписанное игроком — его текст, и откат шага его не трогает, той же
        // логикой, по которой откат не опускает навык, поднятый другим источником.
        if (step.bioField && foundry.utils.getProperty(actor, step.bioField) === carrier.name)
            await actor.update({[step.bioField]: ""});

        // Рейтинг пси и Порча, выданные этим шагом, тоже снимаются.
        const psyker = carrier.getFlag(GRANT_FLAG_SCOPE, "psyker");
        if (psyker) {
            const back = {"system.psy.rating": psyker.rating};
            if (psyker.corruption)
                back["system.corruption"] = Math.max(0, (Number(actor.system.corruption) || 0) - psyker.corruption);
            await actor.update(back);
        }

        // Раны и Судьба, брошенные на этом шаге, снимаются вместе с ним.
        if (RULESET_DEFS[this.ruleset].vitalsStage === step.stage)
            await actor.unsetFlag(GRANT_FLAG_SCOPE, "creationVitals");

        const granted = actor.items
            .filter(item => item.getFlag(GRANT_FLAG_SCOPE, "grantedBy") === carrier.id)
            .map(item => item.id);
        await actor.deleteEmbeddedDocuments("Item", [carrier.id, ...granted]);
    }

    // ── Элитные продвижения ──────────────────────────────────────────────

    /** Добавки к элиткам со всех закреплённых происхождений. */
    _eliteRiders() {
        return this.actor.items.filter(item => item.type === "origin")
            .flatMap(item => item.getFlag(GRANT_FLAG_SCOPE, "applied")?.eliteRiders ?? []);
    }

    /**
     * Применить элитку: предметы, рейтинг пси, Порча, имя в анкете.
     *
     * Выданное даром помечается носителем шага и уходит вместе с ним; купленное —
     * флагом покупки и уходит возвратом.
     *
     * @returns {Promise<object|null>} запись для отката
     */
    async _applyElite(key, {free = false, carrier = null} = {}) {
        const actor = this.actor;
        const plan = elitePlan(key, {free, riders: this._eliteRiders(),
            traits: actor.items.filter(item => item.type === "trait").map(item => ruleName(item))});
        if (!plan) return null;
        const flags = carrier
            ? {[GRANT_FLAG_SCOPE]: {[GRANT_FLAG_KEY]: carrier.getFlag(GRANT_FLAG_SCOPE, GRANT_FLAG_KEY),
                                    grantedBy: carrier.id, elite: key}}
            : {[GRANT_FLAG_SCOPE]: {creationPurchase: true, elite: key}};

        const items = [];
        const fromPack = async (kind, name, system) => {
            const data = await this._lookupContent(kind, name) ?? {name, type: kind, system: {}};
            delete data._id;
            data.system = {...(data.system ?? {}), ...system};
            return {...data, flags};
        };
        // Цена продвижения лежит на его черте или способности: движок опыта листа
        // суммирует cost у черт и особых способностей.
        for (const trait of plan.traits) items.push(await fromPack("trait", trait.name, {cost: trait.cost}));
        for (const name of plan.talents)
            if (!actor.items.some(item => item.type === "talent" && matchesRuleName(item, name)))
                items.push(await fromPack("talent", name, {starter: true, cost: 0}));
        for (const ability of plan.specialAbilities)
            items.push({name: ability.name, type: "specialAbility", img: "icons/svg/aura.svg", flags,
                        system: {cost: ability.cost,
                                 benefit: game.i18n.localize(`WIZARD.ELITE_${key.toUpperCase()}_RULES`)}});
        // Склонность, которая уже есть, второй раз не даётся — она уходит в долг (стр. 79).
        const owned = ownedAptitudes(actor);
        const duplicateAptitudes = [];
        for (const name of plan.aptitudes) {
            if (owned.has(name)) { duplicateAptitudes.push(name); continue; }
            items.push({name, type: "aptitude", img: "icons/svg/book.svg", system: {}, flags});
        }
        const created = items.length ? await actor.createEmbeddedDocuments("Item", items) : [];

        const record = {kind: "elite", key, name: plan.name, label: plan.name, cost: plan.cost, free,
                        itemIds: created.map(item => item.id), duplicateAptitudes, replacedAptitudes: [],
                        psy: null, corruption: 0};
        const update = {"system.bio.elite": eliteText(actor.system.bio?.elite, plan.name)};
        if (plan.psyRating != null) {
            const from = Number(actor.system.psy?.rating) || 0;
            record.psy = {rating: from, cost: Number(actor.system.psy?.cost) || 0};
            update["system.psy.rating"] = Math.max(from, plan.psyRating);
        }
        if (plan.corruption) {
            const roll = await new Roll(plan.corruption).evaluate();
            record.corruption = roll.total;
            update["system.corruption"] = (Number(actor.system.corruption) || 0) + roll.total;
            ui.notifications?.info(game.i18n.format("WIZARD.ELITE_CORRUPTION", {name: plan.name, total: roll.total}));
        }
        await actor.update(update);
        return record;
    }

    /** Снять элитку по её записи. Предметы замен склонностей уходят вместе с ней. */
    async _revertElite(record) {
        const actor = this.actor;
        const ids = [...(record.itemIds ?? []), ...(record.replacedAptitudes ?? []).map(entry => entry.itemId)]
            .filter(id => id && actor.items.get(id));
        if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
        const update = {"system.bio.elite": eliteTextWithout(actor.system.bio?.elite, record.name)};
        if (record.psy) {
            update["system.psy.rating"] = record.psy.rating;
            update["system.psy.cost"] = record.psy.cost;
        }
        if (record.corruption)
            update["system.corruption"] = Math.max(0, (Number(actor.system.corruption) || 0) - record.corruption);
        await actor.update(update);
    }

    async _buyElite(key) {
        if (this._owedAptitudes().length) {
            ui.notifications?.warn(game.i18n.localize("WIZARD.RESOLVE_APTITUDES_FIRST"));
            return;
        }
        const offer = eliteOffers(this._shopSnapshot(), CharacterWizard.CHARACTERISTIC_NAMES)
            .find(entry => entry.key === key);
        if (!offer || offer.blocked) { ui.notifications?.warn(game.i18n.localize("WIZARD.SHOP_PREREQUISITES")); return; }
        if (offer.cost > this._remaining()) {
            ui.notifications?.warn(game.i18n.format("WIZARD.SHOP_NOT_ENOUGH", {cost: offer.cost, remaining: this._remaining()}));
            return;
        }
        await this._ensureStartingExperience();
        const record = await this._applyElite(key);
        if (record) await this.actor.setFlag(GRANT_FLAG_SCOPE, "creationPurchases", [...this._purchases, record]);
    }

    // ── Повторные склонности ─────────────────────────────────────────────

    /**
     * Всё, что записывает повторы склонностей: закреплённые шаги, выданные ими элитки и
     * купленные элитки. `source` — адрес записи для _replaceAptitude.
     */
    _aptitudeRecords() {
        const records = [];
        for (const item of this.actor.items) {
            if (item.type !== "origin") continue;
            const applied = item.getFlag(GRANT_FLAG_SCOPE, "applied") ?? {};
            records.push({source: `origin:${item.id}`, label: item.name,
                          duplicateAptitudes: applied.duplicateAptitudes, replacedAptitudes: applied.replacedAptitudes});
            (item.getFlag(GRANT_FLAG_SCOPE, "elite") ?? []).forEach((record, index) =>
                records.push({source: `elite:${item.id}:${index}`, label: record.name,
                              duplicateAptitudes: record.duplicateAptitudes, replacedAptitudes: record.replacedAptitudes}));
        }
        this._purchases.forEach((record, index) => {
            if (record.kind !== "elite") return;
            records.push({source: `purchase:${index}`, label: record.name,
                          duplicateAptitudes: record.duplicateAptitudes, replacedAptitudes: record.replacedAptitudes});
        });
        return records;
    }

    _owedAptitudes() { return owedAptitudes(this._aptitudeRecords()); }

    /** Прочитать и переписать список замен у записи по её адресу. */
    async _editReplacements(source, edit) {
        const actor = this.actor;
        const [kind, id, index] = source.split(":");
        if (kind === "purchase") {
            const purchases = foundry.utils.deepClone(this._purchases);
            const record = purchases[Number(id)];
            if (!record) return;
            record.replacedAptitudes = edit(record.replacedAptitudes ?? []);
            await actor.setFlag(GRANT_FLAG_SCOPE, "creationPurchases", purchases);
            return;
        }
        const carrier = actor.items.get(id);
        if (!carrier) return;
        if (kind === "origin") {
            const applied = foundry.utils.deepClone(carrier.getFlag(GRANT_FLAG_SCOPE, "applied") ?? {});
            applied.replacedAptitudes = edit(applied.replacedAptitudes ?? []);
            await carrier.setFlag(GRANT_FLAG_SCOPE, "applied", applied);
        } else if (kind === "elite") {
            const list = foundry.utils.deepClone(carrier.getFlag(GRANT_FLAG_SCOPE, "elite") ?? []);
            if (!list[Number(index)]) return;
            list[Number(index)].replacedAptitudes = edit(list[Number(index)].replacedAptitudes ?? []);
            await carrier.setFlag(GRANT_FLAG_SCOPE, "elite", list);
        }
    }

    /** Возместить повтор склонностью характеристики, которой ещё нет (стр. 79). */
    async _replaceAptitude(source, duplicate, chosen) {
        const actor = this.actor;
        if (!replacementOptions(ownedAptitudes(actor)).includes(chosen)) return;
        const [kind, id] = source.split(":");
        const carrier = kind === "purchase" ? null : actor.items.get(id);
        const flags = carrier
            ? {[GRANT_FLAG_SCOPE]: {[GRANT_FLAG_KEY]: carrier.getFlag(GRANT_FLAG_SCOPE, GRANT_FLAG_KEY), grantedBy: carrier.id}}
            : {[GRANT_FLAG_SCOPE]: {creationPurchase: true}};
        const [item] = await actor.createEmbeddedDocuments("Item",
            [{name: chosen, type: "aptitude", img: "icons/svg/book.svg", system: {}, flags}]);
        await this._editReplacements(source, list => [...list, {duplicate, chosen, itemId: item.id}]);
    }

    async _undoReplacement(source, itemId) {
        if (this.actor.items.get(itemId)) await this.actor.deleteEmbeddedDocuments("Item", [itemId]);
        await this._editReplacements(source, list => list.filter(entry => entry.itemId !== itemId));
    }

    // ── Психосилы ────────────────────────────────────────────────────────

    /**
     * Силы из пака книги: имя, предпосылка, цена и дисциплина.
     *
     * У Dark Heresy цена и дерево лежат в psychic-data.mjs (в паке их нет), у Only War —
     * в самой записи пака, поэтому берём и то и другое.
     */
    async _powerCatalogue() {
        if (this._powers) return this._powers;
        const pack = game.packs.get(contentPacksFor(this.ruleset)[0]);
        if (!pack) return (this._powers = []);
        const index = await pack.getIndex({fields: ["system.prerequisite", "system.cost", "system.patron"]});
        this._powers = index.contents.filter(entry => entry.type === "psychicPower").map(entry => ({
            name: entry.name, uuid: entry.uuid, prerequisite: entry.system?.prerequisite ?? "",
            cost: entry.system?.cost ?? 0,
            // Бог силы: у Black Crusade он решает, кому она вообще продаётся (стр. 79).
            patron: entry.system?.patron ?? "undivided",
            // Дисциплина — папка пака: «Psychic Powers/Biomancy».
            discipline: (pack.folders?.get(entry.folder)?.name ?? "").split("/").pop()
        }));
        return this._powers;
    }

    async _buyPsyRating() { await this._commitPurchase(purchasePsyRating(this._shopSnapshot())); }

    /** Сколько ещё осталось от дарёного опыта на силы (Only War, стр. 95). */
    _freePowerExperience() {
        let budget = 0;
        for (const item of this.actor.items)
            if (item.type === "origin") budget += item.system.rules?.psyker?.freePowerExperience ?? 0;
        const used = this._purchases.reduce((total, record) => total + (record.free ?? 0), 0);
        return Math.max(0, budget - used);
    }

    /**
     * Списки продвижений Deathwatch: орден, общий десантский и специальность (стр. 58).
     *
     * Орденский и специальностный лежат на самом персонаже — он их выбрал; общий
     * один на всех и живёт отдельным предметом в паке происхождений.
     */
    async _advanceLists() {
        const lists = [];
        for (const item of this.actor.items) {
            if (item.type !== "origin") continue;
            const advances = item.system.rules?.advances;
            if (!advances?.length) continue;
            const source = item.system.stage === "chapter" ? "chapter" : "speciality";
            lists.push({source, rank: 1, advances, from: item.name});
        }
        // Общий десантский список лежит в компендиуме отдельным предметом. Искать его
        // по system.rules нельзя: индекс пака отдаёт только запрошенные поля, rules
        // среди них нет, и раньше список молча терялся целиком — из четырёх колонок
        // магазина оставались две.
        for (const entry of await this._originsFor("advanceList")) {
            const source = (await fromUuid(entry.uuid))?.toObject()?.system;
            if (source?.rules?.advanceList !== "general") continue;
            if (!source.rules.advances?.length) continue;
            lists.push({source: "general", rank: source.rules.rank ?? 1,
                        advances: source.rules.advances, from: entry.name});
        }
        return lists;
    }

    /**
     * Переписать цену покупки на напечатанную.
     *
     * Поле cost накопительное: в нём лежит сумма всех купленных ступеней. Своей
     * ступени у строки списка нет, поэтому к уже оплаченному прибавляется её
     * собственная цена — та, что стоит в книге рядом со строкой.
     */
    _retainListedCost(purchase, advance) {
        const cost = Number(advance.cost) || 0;
        const already = Number(purchase.record?.fromCost) || 0;
        for (const key of Object.keys(purchase.update ?? {}))
            if (key.endsWith(".cost")) purchase.update[key] = already + cost;
    }

    /** Продвижения специальности: Comrade-приказы и прочее, что она даёт за опыт. */
    _specialityAdvances() {
        const out = [];
        for (const item of this.actor.items) {
            if (item.type !== "origin") continue;
            for (const advance of item.system.rules?.advances ?? [])
                out.push({...advance, source: item.name});
        }
        return out;
    }

    /**
     * Купить строку из списка продвижений Deathwatch (стр. 58).
     *
     * Строка может оказаться тремя разными вещами: рангом умения, талантом или
     * тем, чему в этой системе соответствия нет вовсе — Carouse, Gamble, Performer.
     * Последнее записывается особой способностью: потерять оплаченное нельзя, а
     * подгонять его к чужому ключу — значит соврать.
     */
    async _buyListedAdvance(name) {
        const lists = await this._advanceLists();
        const snapshot = this._shopSnapshot();
        const offers = advanceOffers(cheapestOfEach(gatherAdvances(lists, {rank: this._rank()})), {
            owned: this._advanceNames(),
            remaining: this._remaining(),
            check: text => checkPrerequisites(text, snapshot, CharacterWizard.CHARACTERISTIC_NAMES)
        });
        const advance = offers.find(entry => matchesRuleName(entry, name));
        if (!advance || advance.blocked) {
            if (advance?.lockedAtCreation)
                ui.notifications?.warn(game.i18n.localize("WIZARD.ADVANCE_DEATHWATCH_CLOSED"));
            else if (advance?.unmet)
                ui.notifications?.warn(game.i18n.format("WIZARD.ADVANCE_NEEDS", {needs: advance.prerequisites
                    .filter(entry => entry.status === "unmet").map(entry => entry.text).join(", ")}));
            return;
        }

        const skill = isTalentAdvance(advance) ? null : skillFromAdvance(advance.name);
        if (skill && !skill.any) {
            const purchase = skill.name
                ? purchaseNewSpeciality(this._shopSnapshot(), skill.key, skill.name,
                                        specialityKeyFor({specialities: {}}, skill.name).specKey)
                : purchaseSkill(this._shopSnapshot(), skill.key);
            if (purchase) {
                purchase.record.cost = advance.cost;
                purchase.record.label = advance.name;
                // Цена в поле умения — накопительная, и собрал её покупатель Dark
                // Heresy по лестнице склонностей. Здесь лестницы нет: книга печатает
                // цену каждой ступени, и на лист должна лечь сумма напечатанных, иначе
                // движок опыта листа насчитает трату, которой не было.
                this._retainListedCost(purchase, advance);
                await this._commitPurchase(purchase);
                return;
            }
        }

        if (isTalentAdvance(advance)) {
            const copy = await this._lookupContent("talent", talentLookupName(advance.name));
            if (copy) {
                const data = {...copy, system: {...copy.system, starter: false, cost: advance.cost},
                              flags: foundry.utils.mergeObject(copy.flags ?? {},
                                  {[GRANT_FLAG_SCOPE]: {creationPurchase: true}})};
                delete data._id;
                await this._commitPurchase({update: {}, record: {kind: "talent", name: advance.name,
                    cost: advance.cost, label: advance.name}}, {itemData: data});
                return;
            }
        }

        // Ни умения, ни таланта под этим именем нет — записываем как есть.
        const data = {name: advance.name, type: "specialAbility", img: "icons/svg/aura.svg",
                      system: {cost: advance.cost, benefit: advance.prerequisites ?? ""},
                      flags: {[GRANT_FLAG_SCOPE]: {creationPurchase: true}}};
        await this._commitPurchase({update: {}, record: {kind: "advance", name: advance.name,
            cost: advance.cost, label: advance.name}}, {itemData: data});
    }

    /** Ранг по общему опыту: фоновые 12 000 плюс потраченное (стр. 58). */
    _rank() {
        const background = RULESET_DEFS[this.ruleset]?.backgroundExperience ?? 0;
        return rankForExperience(background + spentOn(this._purchases));
    }

    /** Что уже куплено — по именам, чтобы кратные продвижения считались. */
    _advanceNames() {
        return this._purchases.filter(record => ["advance", "talent"].includes(record.kind))
            .map(record => record.name);
    }

    async _buyAdvance(name) {
        // У Deathwatch продвижения приходят списками и стоят каждое своё (стр. 58).
        if (RULESET_DEFS[this.ruleset]?.advanceLists) return this._buyListedAdvance(name);
        const advance = this._specialityAdvances().find(entry => matchesRuleName(entry, name));
        if (!advance) return;
        if (this.actor.items.some(item => item.type === "specialAbility" && matchesRuleName(item, advance.name))) return;
        const data = {name: advance.name, type: "specialAbility", img: "icons/svg/aura.svg",
                      system: {cost: advance.cost, benefit: advance.effect},
                      flags: {[GRANT_FLAG_SCOPE]: {creationPurchase: true}}};
        await this._commitPurchase({update: {}, record: {kind: "advance", name: advance.name, cost: advance.cost,
                                                        label: advance.name}}, {itemData: data});
    }

    async _buyPower(uuid) {
        const offer = psychicOffersFor(this.ruleset, await this._powerCatalogue(), this._shopSnapshot(),
                                       CharacterWizard.CHARACTERISTIC_NAMES)
            .flatMap(discipline => discipline.powers).find(entry => entry.uuid === uuid);
        if (!offer || offer.owned) return;
        if (offer.blocked) { ui.notifications?.warn(game.i18n.localize("WIZARD.SHOP_PREREQUISITES")); return; }
        // Санкционированный псайкер Only War получает силы на 400 опыта даром (стр. 95).
        const {free, due} = powerPrice(offer.cost, this._freePowerExperience());
        const data = (await fromUuid(uuid)).toObject();
        delete data._id;
        // Цена силы — из её статьи; в паке она не записана, а лист считает по полю.
        data.system = {...data.system, cost: offer.cost};
        data.flags = foundry.utils.mergeObject(data.flags ?? {}, {[GRANT_FLAG_SCOPE]: {creationPurchase: true}});
        await this._commitPurchase({update: {}, record: {kind: "power", name: offer.name, cost: due,
                                                        free, label: offer.name}},
                                   {itemData: data});
    }

    // ── Шаг полка ────────────────────────────────────────────────────────

    /** Компоненты сборки из пака происхождений. */
    async _regimentComponents() {
        if (this._components) return this._components;
        const pack = game.packs.get("dark-heresy.origins");
        if (!pack) return (this._components = []);
        const stages = ["regimentOrigin", "regimentCommander", "regimentType", "doctrine", "equipmentDoctrine"];
        const documents = await pack.getDocuments();
        this._components = documents
            .filter(doc => doc.type === "origin" && doc.system.ruleset === this.ruleset && stages.includes(doc.system.stage))
            .map(doc => doc.toObject().system)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        return this._components;
    }

    get _builder() {
        return (this._builderState ??= {homeWorld: "", commander: "", regimentType: "", doctrines: [],
                                        picks: {homeWorldCharacteristics: [], targets: {}}, kit: [], name: ""});
    }

    /** Собранный по текущему выбору полк — он же предпросмотр. */
    async _composedRegiment() {
        const catalogue = await this._regimentComponents();
        const kit = this._builder.kit.map(key => ADDITIONAL_KIT.find(row => row.key === key)).filter(Boolean);
        return composeRegiment(this._builder, catalogue, {name: this._builder.name || "New Regiment", kit});
    }

    async _regimentStepContext(step) {
        const base = await this._originStepContext(step);
        if (!this._building) return {...base, regimentBuilding: false};

        const catalogue = await this._regimentComponents();
        const of = stage => catalogue.filter(part => part.stage === stage)
            .map(part => ({key: part.key, name: part.name ?? part.key, cost: part.cost,
                           selected: part.key === this._builder[stage === "regimentOrigin" ? "homeWorld"
                               : stage === "regimentCommander" ? "commander" : "regimentType"]}));
        const home = catalogue.find(part => part.key === this._builder.homeWorld);
        const choice = home?.characteristicChoices?.[0] ?? null;
        const {system, problems} = await this._composedRegiment();
        const spent = regimentCost(this._builder, catalogue);
        const label = key => game.i18n.localize(`CHARACTERISTIC.${key.replace(/([A-Z])/g, "_$1").toUpperCase()}`);

        return {
            ...base,
            regimentBuilding: true,
            regimentBudget: REGIMENT_BUDGET,
            regimentSpent: spent,
            regimentLeft: REGIMENT_BUDGET - spent,
            regimentName: this._builder.name,
            regimentHomeWorlds: of("regimentOrigin"),
            regimentCommanders: of("regimentCommander"),
            regimentTypes: of("regimentType"),
            regimentDoctrines: catalogue.filter(part => ["doctrine", "equipmentDoctrine"].includes(part.stage))
                .map(part => ({key: part.key, name: part.name ?? part.key, cost: part.cost,
                               taken: this._builder.doctrines.includes(part.key)})),
            regimentCharacteristicChoice: choice
                ? {label: choice.label, pick: choice.pick,
                   options: choice.from.map(key => ({key, label: label(key),
                       taken: this._builder.picks.homeWorldCharacteristics.includes(key)}))}
                : null,
            regimentTargets: catalogue.filter(part => this._builderKeys().includes(part.key))
                .flatMap(part => (part.choices ?? []).filter(entry => entry.regimentLevel)
                    .map(entry => ({key: entry.key, label: entry.label, value: this._builder.picks.targets[entry.key] ?? ""}))),
            regimentKit: ADDITIONAL_KIT.map(row => ({...row, taken: this._builder.kit.filter(key => key === row.key).length})),
            regimentKitPoints: system.rules.kitPoints,
            regimentKitSpent: system.rules.kitSpent,
            regimentProblems: problems,
            regimentReady: problems.length === 0 && !!this._builder.name.trim()
        };
    }

    _builderKeys() {
        return [this._builder.homeWorld, this._builder.commander, this._builder.regimentType, ...this._builder.doctrines];
    }

    /** Сохранить собранный полк предметом мира: полк один на весь отряд. */
    async _saveRegiment() {
        const {system, problems} = await this._composedRegiment();
        if (problems.length) { ui.notifications?.warn(problems.join("; ")); return; }
        const name = this._builder.name.trim();
        if (!name) { ui.notifications?.warn(game.i18n.localize("WIZARD.REGIMENT_NAME_NEEDED")); return; }
        try {
            const item = await Item.create({name, type: "origin", img: "systems/dark-heresy/assets/icons/misc/inquisition.webp",
                                            system: {...system, key: name.toLowerCase().replace(/[^a-z0-9]+/g, "")}});
            (this._selectedOrigin ??= {})[this.step.id] = item.uuid;
            (this._selectedSource ??= {})[this.step.id] = item.toObject().system;
            this._building = false;
            ui.notifications?.info(game.i18n.format("WIZARD.REGIMENT_SAVED", {name}));
        } catch (err) {
            ui.notifications?.error(game.i18n.localize("WIZARD.REGIMENT_NOT_SAVED"));
            console.error(err);
        }
    }

    _wireRegiment(root) {
        const rerender = () => this.render(false);
        root.querySelector("[data-action=\"regiment-build\"]")?.addEventListener("click", () => {
            this._building = !this._building;
            rerender();
        });
        for (const select of root.querySelectorAll("[data-regiment-part]"))
            select.addEventListener("change", event => {
                this._builder[event.currentTarget.dataset.regimentPart] = event.currentTarget.value;
                if (event.currentTarget.dataset.regimentPart === "homeWorld") this._builder.picks.homeWorldCharacteristics = [];
                rerender();
            });
        for (const box of root.querySelectorAll("[data-regiment-doctrine]"))
            box.addEventListener("change", event => {
                const key = event.currentTarget.dataset.regimentDoctrine;
                const taken = this._builder.doctrines.includes(key);
                this._builder.doctrines = taken ? this._builder.doctrines.filter(entry => entry !== key)
                                                : [...this._builder.doctrines, key];
                rerender();
            });
        for (const box of root.querySelectorAll("[data-regiment-characteristic]"))
            box.addEventListener("change", event => {
                const key = event.currentTarget.dataset.regimentCharacteristic;
                const picked = this._builder.picks.homeWorldCharacteristics;
                this._builder.picks.homeWorldCharacteristics = picked.includes(key)
                    ? picked.filter(entry => entry !== key) : [...picked, key];
                rerender();
            });
        for (const input of root.querySelectorAll("[data-regiment-target]"))
            input.addEventListener("change", event => {
                this._builder.picks.targets[event.currentTarget.dataset.regimentTarget] = event.currentTarget.value;
                rerender();
            });
        for (const button of root.querySelectorAll("[data-regiment-kit]"))
            button.addEventListener("click", event => {
                const key = event.currentTarget.dataset.regimentKit;
                const row = ADDITIONAL_KIT.find(entry => entry.key === key);
                const taken = this._builder.kit.filter(entry => entry === key).length;
                if (row?.limit && taken >= row.limit) {
                    this._builder.kit = this._builder.kit.filter(entry => entry !== key);
                } else this._builder.kit = [...this._builder.kit, key];
                rerender();
            });
        const nameInput = root.querySelector(".regiment-name");
        if (nameInput) nameInput.addEventListener("change", event => { this._builder.name = event.currentTarget.value; rerender(); });
        root.querySelector("[data-action=\"regiment-save\"]")?.addEventListener("click", async () => {
            if (this._busy) return;
            this._busy = true;
            try { await this._saveRegiment(); }
            finally { this._busy = false; if (this.rendered) this.render(false); }
        });
    }

    // ── Шаг характеристик ────────────────────────────────────────────────

    /**
     * Сумма модификаторов происхождений для одной характеристики.
     *
     * Читается с носителей шагов. У книги с «generation» это НЕ прибавка к
     * результату, а указание, чем его катать: модификатор уже окажется внутри
     * значения. Складывать его сверху нельзя (DH2, стр. 31).
     */
    _originModifier(key) {
        let total = 0;
        for (const item of this.actor.items) {
            if (item.type !== "origin") continue;
            const applied = item.getFlag(GRANT_FLAG_SCOPE, "applied") ?? {};
            total += applied.generationModifiers?.[key] ?? applied.characteristics?.[key] ?? 0;
        }
        return total;
    }

    /**
     * С какого числа начинается характеристика.
     *
     * У Black Crusade это не свойство книги, а свойство расы: человек прибавляет к
     * 2d10 двадцать пять, десантник Хаоса — тридцать (стр. 53). Раса выбирается до
     * характеристик, поэтому к этому шагу ответ уже есть.
     */
    _characteristicBase() {
        for (const item of this.actor.items) {
            if (item.type !== "origin") continue;
            const own = item.system.rules?.characteristicBase;
            if (Number.isFinite(own)) return own;
        }
        return RULESET_DEFS[this.ruleset]?.characteristicBase ?? 20;
    }

    /**
     * Характеристика, которая бросается по своей формуле.
     *
     * Тёмная слава идёт не с остальными: 1d5+19, и катается даже при закупке очков
     * (стр. 53). Поэтому в бюджет закупки она не входит вовсе.
     */
    _infamyRule() {
        return RULESET_DEFS[this.ruleset]?.infamy ?? null;
    }

    /** Характеристики, которые игрок распределяет очками. */
    _pointBuyKeys() {
        const infamy = this._infamyRule();
        return characteristicKeysFor(this.ruleset).filter(key => key !== infamy?.key);
    }

    /** Контекст шага характеристик: способ, формулы и уже брошенные значения. */
    _characteristicsStepContext() {
        const rolled = this.actor.getFlag(GRANT_FLAG_SCOPE, "creationRolls");
        const profile = RULESET_DEFS[this.ruleset];
        const method = this._charMethod ?? rolled?.method ?? profile.characteristicMethods[0];
        const base = this._characteristicBase();
        const rules = pointBuyRules(this.ruleset, base);
        const infamy = this._infamyRule();
        // Книга с плоскими модификаторами прибавляет их ПОСЛЕ генерации (Only War, стр. 41),
        // поэтому в формулу они не входят и показываются отдельной колонкой.
        const inFormula = profile.characteristicModifiers === "generation";
        const rerolls = profile.characteristicRerolls ?? 0;
        // Благословение Императора бросается вместе с Судьбой, а её книга может отложить
        // до другого шага — поэтому оно лежит в своём флаге.
        const blessing = this.actor.getFlag(GRANT_FLAG_SCOPE, "creationVitals")?.blessing ?? null;
        return {
            charRerolls: rerolls,
            charRerollsLeft: rolled ? 0 : rerolls - (this._charRerollsUsed ?? 0),
            charMethods: profile.characteristicMethods.map(key => ({
                key, label: game.i18n.localize(`WIZARD.METHOD.${key.toUpperCase()}`), selected: key === method
            })),
            charMethod: method,
            charPointBuy: method === "pointBuy",
            charBase: rules.base,
            charBudget: rules.points,
            charRows: characteristicKeysFor(this.ruleset).map(key => {
                const modifier = this._originModifier(key);
                // Тёмная слава катается всегда и по своей формуле, даже когда остальное
                // покупается за очки.
                const ownFormula = key === infamy?.key ? infamy.formula : null;
                return {
                    key,
                    // Black Crusade зовёт Влияние Тёмной славой, как и лист еретика.
                    label: game.i18n.localize(ownFormula
                        ? "CHARACTERISTIC.INFAMY"
                        : `CHARACTERISTIC.${key.replace(/([A-Z])/g, "_$1").toUpperCase()}`),
                    modifier,
                    rolledOnly: !!ownFormula,
                    // Кости у строки есть, когда книга их требует: при закупке очков
                    // они остаются только у Тёмной славы.
                    rollable: !!ownFormula || method !== "pointBuy",
                    formula: ownFormula
                        ?? rollExpression(profile.characteristicModifiers, inFormula ? modifier : 0, base),
                    // При закупке модификатор сдвигает СТАРТ, а не результат: «+» начинает
                    // с 30, «−» с 20 вместо 25. Плоский же прибавляется в конце, к готовому.
                    start: ownFormula ? "" : rules.base + (inFormula ? modifier : 0),
                    value: rolled?.values?.[key] ?? this._charValues?.[key] ?? ""
                };
            }),
            charLocked: !!rolled,
            charBlessing: blessing
                ? game.i18n.format(blessing.granted ? "WIZARD.BLESSING_GRANTED" : "WIZARD.BLESSING_MISSED",
                                   {rolled: blessing.rolled, threshold: blessing.threshold})
                : ""
        };
    }

    /**
     * Закрепить характеристики: записать значения, бросить Раны и Судьбу.
     *
     * Броски запоминаются флагом — вернувшись на шаг, персонаж не перекатывается.
     */
    async _commitCharacteristicsStep() {
        const actor = this.actor;
        if (actor.getFlag(GRANT_FLAG_SCOPE, "creationRolls")) return true;

        const root = this.element;
        const method = root?.querySelector(".wizard-char-method")?.value
            ?? RULESET_DEFS[this.ruleset].characteristicMethods[0];

        const keys = characteristicKeysFor(this.ruleset);
        const values = {};
        for (const key of keys)
            values[key] = Number(root?.querySelector(`input[data-characteristic="${key}"]`)?.value ?? 0);

        if (method === "pointBuy") {
            const bought = this._pointBuyKeys();
            const problems = pointBuyProblems(values, pointBuyRules(this.ruleset, this._characteristicBase()),
                                              bought);
            // Слава не покупается, но и пустой остаться не может: её бросают в любом случае.
            if (!problems.length && keys.some(key => !bought.includes(key) && !values[key]))
                problems.push(game.i18n.localize("WIZARD.ROLL_ALL"));
            if (problems.length) { ui.notifications?.warn(problems.join("; ")); return false; }
        } else if (keys.some(key => !values[key])) {
            ui.notifications?.warn(game.i18n.localize("WIZARD.ROLL_ALL"));
            return false;
        }

        const update = {};
        // При «generation» модификатор уже внутри значения; при «flat» он прибавляется здесь,
        // после генерации, как и велит книга.
        const flat = RULESET_DEFS[this.ruleset].characteristicModifiers === "flat";
        for (const key of keys)
            update[`system.characteristics.${key}.base`] = values[key] + (flat ? this._originModifier(key) : 0);

        await actor.update(update);
        await actor.setFlag(GRANT_FLAG_SCOPE, "creationRolls", {method, values});
        // Раны и Судьба этой книги могут идти от происхождения, которое ещё не выбрано:
        // в Only War их задаёт специальность, а она после характеристик (стр. 100).
        if (RULESET_DEFS[this.ruleset].vitalsStage === "characteristics") await this._rollVitals();
        return true;
    }

    /**
     * Стартовые Раны и Судьба.
     *
     * Раны: формула происхождения, которое их задаёт, плюс всё, что выдали другие шаги.
     * Судьба: значение происхождения либо бросок по таблице книги (Only War, стр. 100).
     */
    async _rollVitals() {
        const actor = this.actor;
        if (actor.getFlag(GRANT_FLAG_SCOPE, "creationVitals")) return;
        const profile = RULESET_DEFS[this.ruleset];
        // Откуда книга берёт Раны: родной мир Dark Heresy, специальность Only War,
        // архетип Black Crusade. Несверенная книга идёт за Dark Heresy.
        const stage = profile.vitalsStage ?? "homeWorld";
        const source = actor.items.find(item => item.type === "origin" && item.system.stage === stage);
        const values = actor.getFlag(GRANT_FLAG_SCOPE, "creationRolls")?.values ?? {};
        const toughnessBonus = Math.floor((values.toughness ?? actor.system.characteristics?.toughness?.total ?? 0) / 10);
        const update = {};
        const wounds = await new Roll(woundsExpression(source?.system.wounds ?? {}, toughnessBonus)).evaluate();
        const fate = await new Roll(fateExpression(profile.fate ?? source?.system.fate ?? {})).evaluate();
        // Благословение Императора (стр. 30): кидается 1d10, и при результате не ниже
        // порога родного мира порог Судьбы поднимается на 1. Без этого броска персонаж
        // просто недополучает очко, о котором нигде не сказано.
        const blessingThreshold = source?.system.fate?.blessing ?? 0;
        let blessing = null;
        if (blessingThreshold > 0) {
            const roll = await new Roll("1d10").evaluate();
            blessing = {threshold: blessingThreshold, rolled: roll.total, granted: roll.total >= blessingThreshold};
        }
        // У книги с таблицей Судьбы бросок — это строка таблицы, а не само число (стр. 100).
        const fateValue = profile.fate?.table ? fateFromTable(fate.total, profile.fate.table) : fate.total;
        const fateTotal = fateValue + (blessing?.granted ? 1 : 0);
        // Раны, выданные другими шагами, добавляются поверх книжного броска: он
        // ставится, а не прибавляется, и без этого их бы стёрло.
        let granted = 0;
        for (const item of actor.items)
            if (item.type === "origin") granted += item.getFlag(GRANT_FLAG_SCOPE, "applied")?.wounds ?? 0;
        update["system.wounds.max"] = update["system.wounds.value"] = wounds.total + granted;
        update["system.fate.max"] = update["system.fate.value"] = fateTotal;

        await actor.update(update);
        await actor.setFlag(GRANT_FLAG_SCOPE, "creationVitals",
                            {wounds: wounds.total + granted, fate: fateTotal, blessing});
    }

    // ── Шаг опыта ────────────────────────────────────────────────────────

    /**
     * Стартовый опыт: книга задаёт основу, происхождение может её переопределить
     * (у Support-специалиста Only War 300 вместо 600, стр. 100), а повторные таланты
     * добавляют по 100 (стр. 41).
     */
    get _startingExperience() {
        let pool = RULESET_DEFS[this.ruleset]?.startingExperience ?? 0;
        let credit = 0;
        for (const item of this.actor.items) {
            if (item.type !== "origin") continue;
            const own = item.system.rules?.startingExperience;
            if (Number.isFinite(own)) pool = own;
            credit += item.getFlag(GRANT_FLAG_SCOPE, "applied")?.duplicateExperience ?? 0;
        }
        return pool + credit;
    }

    /** Контекст шага опыта: пул, склонности и долг по повторным склонностям. */
    // ── Магазин опыта ────────────────────────────────────────────────────

    /** Запись покупок этого прохода Мастера. */
    get _purchases() { return this.actor.getFlag(GRANT_FLAG_SCOPE, "creationPurchases") ?? []; }

    /** «Weapon Skill» → weaponSkill: предпосылки в книге пишутся английскими именами. */
    static CHARACTERISTIC_NAMES = {
        ...Object.fromEntries(CHARACTERISTIC_KEYS.map(key =>
            [key.replace(/([A-Z])/g, " $1").toLowerCase().trim(), key])),
        ...CHARACTERISTIC_ABBREVIATIONS
    };

    /** Снимок актора в том виде, какого ждёт shop-data.mjs. */
    _shopSnapshot() {
        const system = this.actor.system;
        const characteristics = {}, characteristicValues = {};
        for (const [key, entry] of Object.entries(system.characteristics ?? {})) {
            characteristics[key] = {advance: entry.advance, cost: entry.cost, aptitudes: entry.aptitudes ?? []};
            characteristicValues[key] = Number(entry.total ?? entry.base ?? 0);
        }
        return {
            ruleset: this.ruleset,
            aptitudes: ownedAptitudes(this.actor),
            // Цены характеристик Deathwatch печатает специальность, а не таблица книги.
            characteristicCosts: this._printedCharacteristicCosts(),
            // Покровитель решает цену КАЖДОЙ покупки Black Crusade (стр. 76).
            patron: system.patron || "undivided",
            characteristics, characteristicValues,
            skills: foundry.utils.deepClone(system.skills ?? {}),
            talents: this.actor.items.filter(item => item.type === "talent")
                .map(item => ({name: ruleName(item), starter: !!item.system.starter})),
            traits: this.actor.items.filter(item => item.type === "trait").map(item => ({name: ruleName(item)})),
            elite: eliteKeysIn(system.bio?.elite),
            psyRating: Number(system.psy?.rating) || 0,
            psyCost: Number(system.psy?.cost) || 0,
            powers: this.actor.items.filter(item => item.type === "psychicPower").map(item => ruleName(item))
        };
    }

    /**
     * Напечатанные цены характеристик — из специальности, если книга их знает.
     * У Dark Heresy, Only War и Black Crusade их нет: там цена выводится.
     */
    _printedCharacteristicCosts() {
        if (!RULESET_DEFS[this.ruleset]?.advanceLists) return null;
        for (const item of this.actor.items)
            if (item.type === "origin" && item.system.rules?.characteristicCosts)
                return item.system.rules.characteristicCosts;
        return null;
    }

    /** Таланты книги — индекс пака с уровнем, склонностями и предпосылками. */
    async _talentCatalogue() {
        if (this._catalogue) return this._catalogue;
        const pack = game.packs.get(contentPacksFor(this.ruleset)[0]);
        if (!pack) return (this._catalogue = []);
        const index = await pack.getIndex({fields: ["system.tier", "system.aptitudes", "system.prerequisites", "system.benefit"]});
        this._catalogue = index.contents.filter(entry => entry.type === "talent").map(entry => ({
            name: entry.name, originalName: ruleName(entry), uuid: entry.uuid, tier: entry.system?.tier,
            aptitudes: entry.system?.aptitudes ?? "", prerequisites: entry.system?.prerequisites ?? "",
            benefit: entry.system?.benefit ?? ""
        }));
        return this._catalogue;
    }

    /** Остаток пула: книжный пул минус записанные покупки. */
    _remaining() {
        return (this._startingExperience) - spentOn(this._purchases);
    }

    /**
     * Стартовый опыт на лист — при первой покупке или по «Далее», что раньше.
     * Признак — свой флаг, а не «опыт не ноль»: возврат за совпавшую выдачу
     * законно делает его ненулевым заранее.
     */
    async _ensureStartingExperience() {
        const actor = this.actor;
        if (actor.getFlag(GRANT_FLAG_SCOPE, "startingExperienceApplied")) return;
        const pool = this._startingExperience;
        await actor.update({"system.experience.value": (actor.system.experience?.value ?? 0) + pool});
        await actor.setFlag(GRANT_FLAG_SCOPE, "startingExperienceApplied", pool);
    }

    /** Провести покупку: проверить остаток, записать на лист и в журнал покупок. */
    async _commitPurchase(result, {itemData = null} = {}) {
        if (!result) return;
        // Повтор склонности меняет цены. Пока он не возмещён, любая цена — не та.
        if (this._owedAptitudes().length) {
            ui.notifications?.warn(game.i18n.localize("WIZARD.RESOLVE_APTITUDES_FIRST"));
            return;
        }
        if (result.record.cost > this._remaining()) {
            ui.notifications?.warn(game.i18n.format("WIZARD.SHOP_NOT_ENOUGH",
                {cost: result.record.cost, remaining: this._remaining()}));
            return;
        }
        await this._ensureStartingExperience();
        if (Object.keys(result.update ?? {}).length) await this.actor.update(result.update);
        const record = {...result.record};
        if (itemData) {
            const [item] = await this.actor.createEmbeddedDocuments("Item", [itemData]);
            record.itemId = item.id;
        }
        await this.actor.setFlag(GRANT_FLAG_SCOPE, "creationPurchases", [...this._purchases, record]);
    }

    async _buyCharacteristic(key) { await this._commitPurchase(purchaseCharacteristic(this._shopSnapshot(), key)); }

    async _buySkill(key, specKey) { await this._commitPurchase(purchaseSkill(this._shopSnapshot(), key, specKey || null)); }

    async _buyNewSpeciality(key, name) {
        const snapshot = this._shopSnapshot();
        const {specKey, created} = specialityKeyFor(snapshot.skills[key], name);
        // Такая специализация уже есть на листе — поднимаем её, а не заводим вторую.
        if (!created) return this._buySkill(key, specKey);
        await this._commitPurchase(purchaseNewSpeciality(snapshot, key, name, specKey));
    }

    async _buyTalent(uuid, specialisation) {
        const snapshot = this._shopSnapshot();
        const offer = talentOffers(await this._talentCatalogue(), snapshot, CharacterWizard.CHARACTERISTIC_NAMES)
            .find(entry => entry.uuid === uuid);
        if (!offer) return;
        if (offer.blocked) { ui.notifications?.warn(game.i18n.localize("WIZARD.SHOP_PREREQUISITES")); return; }
        // Специалистский талант берут по имени специализации: «Weapon Training (Las)».
        const spec = String(specialisation ?? "").trim();
        if (offer.specialist && !spec) { ui.notifications?.warn(game.i18n.localize("WIZARD.SHOP_NAME_SPECIALISATION")); return; }
        const name = offer.specialist ? `${ruleName(offer).replace(/\*$/, "")} (${spec})` : ruleName(offer);
        if (this.actor.items.some(item => item.type === "talent" && matchesRuleName(item, name))) return;

        const data = (await fromUuid(uuid)).toObject();
        delete data._id;
        if (ruleName(data) !== name) data.name = name;
        data.system = {...data.system, starter: false, cost: offer.cost};
        data.flags = foundry.utils.mergeObject(data.flags ?? {}, {[GRANT_FLAG_SCOPE]: {creationPurchase: true}});
        await this._commitPurchase({update: {}, record: {kind: "talent", name, cost: offer.cost, label: name}},
                                   {itemData: data});
    }

    /** Вернуть покупку. Ступень возвращается только верхняя — иначе в лестнице дыра. */
    async _refund(index) {
        const purchases = [...this._purchases];
        const record = purchases[index];
        if (!record) return;
        if (["talent", "power", "advance"].includes(record.kind)) {
            if (record.itemId && this.actor.items.get(record.itemId))
                await this.actor.deleteEmbeddedDocuments("Item", [record.itemId]);
        } else if (record.kind === "elite") {
            // Силы и рейтинг держатся на самом продвижении: сперва возвращаются они.
            if (record.psy && purchases.some(entry => entry.kind === "power" || entry.kind === "psyRating")) {
                ui.notifications?.warn(game.i18n.localize("WIZARD.SHOP_REFUND_PSYCHIC_FIRST"));
                return;
            }
            await this._revertElite(record);
        } else {
            const update = refundUpdate(this._shopSnapshot(), record);
            if (!update) { ui.notifications?.warn(game.i18n.localize("WIZARD.SHOP_REFUND_TOP_FIRST")); return; }
            await this.actor.update(update);
        }
        purchases.splice(index, 1);
        await this.actor.setFlag(GRANT_FLAG_SCOPE, "creationPurchases", purchases);
    }

    /**
     * Вернуть все покупки — перед откатом происхождения. Цены считались по склонностям,
     * а откат их меняет: оставить покупки значит оставить их по чужой цене.
     * Возврат идёт с конца, чтобы каждая ступень снималась, пока она верхняя.
     */
    async _refundAll() {
        for (let index = this._purchases.length - 1; index >= 0; index--) await this._refund(index);
    }

    /** Текст книги для таланта: читается один раз и держится, пока открыт мастер. */
    async _talentBook(uuid) {
        this._talentBooks ??= new Map();
        if (this._talentBooks.has(uuid)) return this._talentBooks.get(uuid);
        const doc = await fromUuid(uuid);
        const system = doc?.system ?? {};
        const book = {
            benefit: system.benefit ?? "",
            description: await foundry.applications.ux.TextEditor.implementation
                .enrichHTML(system.description ?? "", {relativeTo: doc}),
            // У силы правила лежат в effect, а description — вступительный абзац.
            effect: system.effect ? await foundry.applications.ux.TextEditor.implementation
                .enrichHTML(system.effect, {relativeTo: doc}) : "",
            source: system.source ?? ""
        };
        this._talentBooks.set(uuid, book);
        return book;
    }

    /** Контекст шага опыта, когда каталог талантов уже прочитан. */
    async _experienceContextLoaded() {
        await this._talentCatalogue();
        await this._powerCatalogue();
        // Списки продвижений Deathwatch лежат в компендиуме, а сборка контекста
        // синхронна: читаем их здесь и кладём рядом с каталогами.
        this._advanceListCache = RULESET_DEFS[this.ruleset]?.advanceLists
            ? await this._advanceLists() : null;
        this._catalogueReady = true;
        return this._experienceStepContext();
    }

    _experienceStepContext() {
        // Цены зависят от склонностей персонажа, а не от книги вообще: одна и та же
        // покупка стоит ему втрое дешевле соседа. Показываем ЕГО колонку, иначе
        // игроку придётся листать книгу с карандашом.
        const owned = ownedAptitudes(this.actor);
        const priceRow = (table, label) => ({
            label,
            two: Object.values(table[2]).join(" / "),
            one: Object.values(table[1]).join(" / "),
            none: Object.values(table[0]).join(" / ")
        });

        const snapshot = this._shopSnapshot();
        const label = key => game.i18n.localize(`CHARACTERISTIC.${key.replace(/([A-Z])/g, "_$1").toUpperCase()}`);
        const levelLabel = level => level ? game.i18n.localize(`WIZARD.LEVEL.${level.toUpperCase()}`) : "";
        // «Свой», «союзный», «враждебный» — то, чем Black Crusade заменяет склонности.
        const relationLabel = relation => relation
            ? game.i18n.localize(`RELATION.${relation.toUpperCase()}`) : "";
        const remaining = this._remaining();
        const freePowers = this._freePowerExperience();
        const filter = String(this._talentFilter ?? "").toLowerCase().trim();
        const tierFilter = Number(this._talentTier ?? 0);
        const names = CharacterWizard.CHARACTERISTIC_NAMES;

        // Вкладка психосил есть только у псайкера: остальным там нечего купить.
        const psyker = snapshot.psyRating >= 1;
        // У Deathwatch продвижения приходят списками: орден, общий и специальность.
        const listed = RULESET_DEFS[this.ruleset]?.advanceLists
            ? advanceOffers(cheapestOfEach(gatherAdvances(this._advanceListCache ?? [], {rank: this._rank()})),
                            {owned: this._advanceNames(), remaining: this._remaining(),
                             check: text => checkPrerequisites(text, snapshot, names)})
            : null;
        const advances = listed ?? this._specialityAdvances();
        const elite = RULESET_DEFS[this.ruleset]?.eliteAdvances ? ["elite"] : [];
        // У Deathwatch навыки и таланты покупаются не лестницей, а строками списков:
        // отдельные вкладки под них показывали бы чужие цены Dark Heresy рядом с
        // книжными. Остаются характеристики (у них своя таблица в специальности),
        // психика и сами списки.
        const ladderTabs = listed ? ["characteristics"] : ["characteristics", "skills", "talents"];
        const tabs = [...ladderTabs, ...elite, ...(psyker ? ["psychic"] : []),
                      ...(advances.length ? ["advances"] : [])];
        const tab = tabs.includes(this._shopTab) ? this._shopTab : "characteristics";

        // Повторы склонностей и сделанные замены — адреса держим на окне: обработчик
        // кнопки получает только номер строки.
        const records = this._aptitudeRecords();
        const options = replacementOptions(owned);
        this._owedSlots = owedAptitudes(records).map(entry => ({
            ...entry, label: records.find(record => record.source === entry.source)?.label ?? "", options
        }));
        this._replacementSlots = records.flatMap(record => (record.replacedAptitudes ?? [])
            .map(entry => ({...entry, source: record.source, label: record.label})));
        const locked = this._owedSlots.length > 0;
        const book = uuid => uuid && uuid === this._openTalent ? (this._talentBooks?.get(uuid) ?? null) : null;

        return {
            shopTabs: tabs.map(key => ({key, active: key === tab,
                                        label: game.i18n.localize(`WIZARD.SHOP_TAB_${key.toUpperCase()}`)})),
            shopLocked: locked,
            owedSlots: this._owedSlots,
            replacementSlots: this._replacementSlots,
            shopElite: eliteOffers(snapshot, names).map(offer => ({...offer,
                rules: game.i18n.localize(`WIZARD.ELITE_${offer.key.toUpperCase()}_RULES`),
                affordable: !locked && !offer.blocked && offer.cost <= remaining})),
            shopFreePowerExperience: this._freePowerExperience(),
            // Строка списка сама знает, можно ли её купить; у книг попроще решает лист.
            shopAdvances: advances.map(entry => listed
                ? {...entry, owned: entry.maxed, affordable: !locked && entry.affordable,
                   sourceLabel: game.i18n.localize(`WIZARD.ADVANCE_FROM_${String(entry.source).toUpperCase()}`),
                   note: entry.lockedAtCreation ? game.i18n.localize("WIZARD.ADVANCE_DEATHWATCH_CLOSED")
                       : entry.lockedByRank ? game.i18n.format("WIZARD.ADVANCE_RANK", {rank: entry.rank})
                       : entry.unmet ? game.i18n.format("WIZARD.ADVANCE_NEEDS", {needs: entry.prerequisites
                           .filter(check => check.status === "unmet").map(check => check.text).join(", ")})
                       : ""}
                : {...entry,
                   owned: this.actor.items.some(item => item.type === "specialAbility" && matchesRuleName(item, entry.name)),
                   affordable: !locked && entry.cost <= remaining
                       && !this.actor.items.some(item => item.type === "specialAbility" && matchesRuleName(item, entry.name))}),
            shopRank: listed ? this._rank() : null,
            // Пси-рейтинг Black Crusade покупается талантом Psy Rating, а не лестницей,
            // поэтому отдельной строки у него там нет (стр. 79).
            shopPsy: psyker && this.ruleset !== "bc"
                ? (offer => ({...offer, affordable: !locked && !offer.maxed && offer.cost <= remaining}))(psyRatingOffer(snapshot))
                : null,
            shopDisciplines: psyker && this._catalogueReady
                ? psychicOffersFor(this.ruleset, this._powers, snapshot, names).map(discipline => ({...discipline,
                    powers: discipline.powers.map(offer => ({...offer,
                        parentsText: offer.parents.join(" / "),
                        showChecks: offer.prerequisites.length > 0 || !offer.accessible,
                        affordable: !locked && !offer.blocked && !offer.owned
                            && powerPrice(offer.cost, freePowers).due <= remaining,
                        gifted: !offer.owned && offer.cost > 0 && powerPrice(offer.cost, freePowers).due === 0,
                        open: !!offer.uuid && offer.uuid === this._openTalent, book: book(offer.uuid)}))}))
                : [],
            shopTab: tab,
            shopSpent: spentOn(this._purchases),
            shopRemaining: remaining,
            shopCharacteristics: characteristicOffers(snapshot).map(offer => ({
                ...offer,
                label: offer.infamy ? game.i18n.localize("CHARACTERISTIC.INFAMY") : label(offer.key),
                nextLabel: offer.infamy ? game.i18n.localize("WIZARD.LEVEL.INFAMY")
                    : offer.printedSteps ? "" : levelLabel(offer.nextLevel),
                relationLabel: relationLabel(offer.relation),
                // Средний столбец объясняет цену. У Dark Heresy это совпавшие склонности,
                // у Black Crusade — отношение к покровителю, у Deathwatch — которая это
                // из четырёх напечатанных ступеней.
                matchText: offer.relation ? relationLabel(offer.relation)
                    : offer.printedSteps ? `${Math.min(offer.steps + 1, offer.printedSteps)}/${offer.printedSteps}`
                    : `${offer.matched}/2`,
                affordable: !locked && !offer.maxed && offer.cost <= remaining
            })),
            shopSkills: skillOffers(snapshot).map(offer => ({
                ...offer,
                label: offer.specKey
                    ? `${game.i18n.localize(snapshot.skills[offer.key]?.label ?? offer.key)} (${offer.label})`
                    : game.i18n.localize(offer.label),
                currentLabel: levelLabel(offer.level) || game.i18n.localize("WIZARD.LEVEL.UNTRAINED"),
                nextLabel: levelLabel(offer.nextLevel),
                relationLabel: relationLabel(offer.relation),
                affordable: !locked && !offer.maxed && offer.cost <= remaining
            })),
            shopSpecialistSkills: Object.entries(snapshot.skills)
                .filter(([, skill]) => skill.isSpecialist)
                .map(([key, skill]) => ({key, label: game.i18n.localize(skill.label ?? key)})),
            shopTalents: (this._catalogueReady
                ? talentOffers(this._catalogue, snapshot, CharacterWizard.CHARACTERISTIC_NAMES) : [])
                .filter(offer => (!filter || offer.name.toLowerCase().includes(filter))
                              && (!tierFilter || offer.tier === tierFilter))
                .map(offer => ({...offer, aptitudeText: offer.aptitudes.join(", "),
                                relationLabel: relationLabel(offer.relation),
                                affordable: !locked && !offer.blocked && offer.cost <= remaining,
                                open: offer.uuid === this._openTalent,
                                book: offer.uuid === this._openTalent
                                    ? (this._talentBooks?.get(offer.uuid) ?? null) : null})),
            talentFilter: this._talentFilter ?? "",
            talentTier: tierFilter,
            shopPurchases: this._purchases.map((record, index) => ({...record, index,
                // Купленный талант уже лежит на листе — его карточку и открываем.
                readable: ["talent", "power", "advance"].includes(record.kind) && !!this.actor.items.get(record.itemId)})),
            aptitudeChips: [...owned].sort(),
            // У Black Crusade склонностей нет вовсе, а цену объясняет покровитель.
            showAptitudes: RULESET_DEFS[this.ruleset]?.aptitudes !== false,
            shopPatron: RULESET_DEFS[this.ruleset]?.patronPricing
                ? game.i18n.localize(`PATRON.${(this.actor.system.patron || "undivided").toUpperCase()}`)
                : "",
            priceRows: [
                priceRow(CHARACTERISTIC_COSTS, game.i18n.localize("WIZARD.PRICE_CHARACTERISTICS")),
                priceRow(SKILL_COSTS, game.i18n.localize("WIZARD.PRICE_SKILLS")),
                priceRow(TALENT_COSTS, game.i18n.localize("WIZARD.PRICE_TALENTS"))
            ],
            experiencePool: this._startingExperience,
            experienceApplied: !!this.actor.getFlag(GRANT_FLAG_SCOPE, "startingExperienceApplied"),
            aptitudeList: [...owned].sort().join(", ")
        };
    }

    /**
     * Выдать стартовый опыт.
     *
     * Признак — отдельный флаг, а не «опыт не ноль»: возврат за совпавшую выдачу
     * законно делает его ненулевым ДО этого шага, и проверка «> 0» пропустила бы
     * настоящую выдачу.
     */
    async _commitExperienceStep() {
        await this._ensureStartingExperience();
        return true;
    }

    // ── Шаг снаряжения ───────────────────────────────────────────────────

    get _equipmentPicks() { return this.actor.getFlag(GRANT_FLAG_SCOPE, "creationEquipment") ?? []; }

    get _equipmentAllowance() {
        return acquisitionAllowance(this.actor.system.characteristics?.influence?.total);
    }

    /** Предметы Арсенала из пака — имя, тип и доступность. */
    async _equipmentCatalogue() {
        if (this._armoury) return this._armoury;
        const pack = game.packs.get("dark-heresy.dark-heresy");
        if (!pack) return (this._armoury = []);
        const index = await pack.getIndex({fields: ["system.availability"]});
        this._armoury = index.contents.filter(entry => ARMOURY_TYPES.includes(entry.type)).map(entry => ({
            uuid: entry.uuid, name: entry.name, type: entry.type, availability: entry.system?.availability ?? ""
        }));
        return this._armoury;
    }

    async _equipmentStepContext() {
        const allowance = this._equipmentAllowance;
        const picks = this._equipmentPicks;
        const filter = String(this._equipmentFilter ?? "").toLowerCase().trim();
        const type = this._equipmentType ?? "";
        const availability = key => game.i18n.localize(`AVAILABILITY.${String(key).replace(/-/g, "_").toUpperCase()}`);
        const book = uuid => uuid && uuid === this._openTalent ? (this._talentBooks?.get(uuid) ?? null) : null;
        // Обе книги считают одинаково, но зовут это по-разному: Влияние у Dark Heresy,
        // Тёмная слава у Black Crusade — и порог доступности у них тоже свой.
        const suffix = this.ruleset === "bc" ? "_BC" : "";
        return {
            equipmentAllowanceLabel: game.i18n.localize(`WIZARD.EQUIPMENT_ALLOWANCE${suffix}`),
            equipmentRule: game.i18n.localize(`WIZARD.EQUIPMENT_RULE${suffix}`),
            equipmentAllowance: allowance,
            equipmentUsed: picks.length,
            equipmentLeft: Math.max(0, allowance - picks.length),
            equipmentPicks: picks.map((pick, index) => ({...pick, index, present: !!this.actor.items.get(pick.itemId)})),
            equipmentTypes: ARMOURY_TYPES.map(key => ({key, selected: key === type,
                                                       label: game.i18n.localize(`TYPES.Item.${key}`)})),
            equipmentFilter: this._equipmentFilter ?? "",
            equipmentOffers: equipmentOffers(await this._equipmentCatalogue(), picks,
                                             {allowance, ruleset: this.ruleset})
                .filter(offer => (!filter || offer.name.toLowerCase().includes(filter)) && (!type || offer.type === type))
                .map(offer => ({...offer, typeLabel: game.i18n.localize(`TYPES.Item.${offer.type}`),
                                availabilityLabel: availability(offer.availability),
                                open: offer.uuid === this._openTalent, book: book(offer.uuid)}))
        };
    }

    async _takeEquipment(uuid) {
        const picks = this._equipmentPicks;
        if (picks.length >= this._equipmentAllowance) {
            ui.notifications?.warn(game.i18n.format("WIZARD.EQUIPMENT_FULL", {allowance: this._equipmentAllowance}));
            return;
        }
        const offer = equipmentOffers(await this._equipmentCatalogue(), picks,
                                      {allowance: this._equipmentAllowance, ruleset: this.ruleset})
            .find(entry => entry.uuid === uuid);
        if (!offer?.allowed) return;
        const data = (await fromUuid(uuid)).toObject();
        delete data._id;
        data.flags = foundry.utils.mergeObject(data.flags ?? {}, {[GRANT_FLAG_SCOPE]: {creationEquipment: true}});
        const [item] = await this.actor.createEmbeddedDocuments("Item", [data]);
        await this.actor.setFlag(GRANT_FLAG_SCOPE, "creationEquipment", [...picks, {uuid, itemId: item.id, name: item.name}]);
    }

    async _dropEquipment(index) {
        const picks = [...this._equipmentPicks];
        const pick = picks[index];
        if (!pick) return;
        if (this.actor.items.get(pick.itemId)) await this.actor.deleteEmbeddedDocuments("Item", [pick.itemId]);
        picks.splice(index, 1);
        await this.actor.setFlag(GRANT_FLAG_SCOPE, "creationEquipment", picks);
    }

    async _clearEquipment() {
        const ids = this._equipmentPicks.map(pick => pick.itemId).filter(id => this.actor.items.get(id));
        if (ids.length) await this.actor.deleteEmbeddedDocuments("Item", ids);
        if (this.actor.getFlag(GRANT_FLAG_SCOPE, "creationEquipment")) await this.actor.unsetFlag(GRANT_FLAG_SCOPE, "creationEquipment");
    }

    // ── Шаг Тёмных богов ─────────────────────────────────────────────────

    /**
     * Стадия 7 книги: выбрать путь (стр. 84).
     *
     * Ни костей, ни трат: игрок объявляет, кому служит, и это меняет цены всего
     * дальнейшего. Пятый путь — остаться неприкаянным: он не хуже прочих, просто
     * никому не свой.
     *
     * Рядом показывается счёт улучшений: книга сверяет принадлежность на порогах
     * Порчи, и первый такой раз приходится на конец создания (стр. 76).
     */
    _darkGodsStepContext() {
        const chosen = this.actor.system.patron || UNDIVIDED;
        const counts = this.actor.system.alignmentTotals ?? this.actor.system.alignmentCounts ?? {};
        const leader = alignmentLeader(counts);
        return {
            godOptions: [...PATRONS, UNDIVIDED].map(key => ({
                key,
                label: game.i18n.localize(`PATRON.${key.toUpperCase()}`),
                selected: key === chosen,
                count: Number(counts[key]) || 0,
                relation: key === chosen ? "" : game.i18n.localize(`RELATION.${patronRelation(chosen, key).toUpperCase()}`)
            })),
            godChosen: game.i18n.localize(`PATRON.${chosen.toUpperCase()}`),
            // Куда клонит сам счёт улучшений: пять сверху любого другого — и бог заявляет права.
            godLeaning: leader === UNDIVIDED ? "" : game.i18n.localize(`PATRON.${leader.toUpperCase()}`),
            godLeaningDiffers: leader !== UNDIVIDED && leader !== chosen
        };
    }

    async _chooseGod(key) {
        await this.actor.update({"system.patron": key});
    }

    _wireDarkGods(root) {
        for (const button of root.querySelectorAll("[data-choose-god]"))
            button.addEventListener("click", async event => {
                event.preventDefault();
                if (this._busy) return;
                this._busy = true;
                try { await this._chooseGod(event.currentTarget.dataset.chooseGod); }
                finally { this._busy = false; if (this.rendered) this.render(false); }
            });
    }

    // ── Шаг страстей ─────────────────────────────────────────────────────

    /**
     * Стадия 4 книги: Гордыня, Позор и Стремление (стр. 71-75).
     *
     * Три таблицы стоят на одной панели, потому что это один разговор о том, кто
     * этот еретик: выбирать их по одной, разнося по шагам, значило бы трижды
     * спросить одно и то же другими словами. Внутри каждая — обычное происхождение,
     * со своими модификаторами и своим носителем.
     */
    async _passionsStepContext(step) {
        const groups = [];
        for (const sub of step.stages ?? []) {
            const context = await this._originStepContext(sub);
            groups.push({...context, id: sub.id, label: game.i18n.localize(sub.label)});
        }
        return {passionGroups: groups};
    }

    async _commitPassionsStep(step) {
        for (const sub of step.stages ?? []) {
            const scope = this.element?.querySelector(`[data-passion="${sub.id}"]`) ?? this.element;
            if (!await this._commitOriginStep(sub, scope)) return false;
        }
        return true;
    }

    /**
     * Бросок по таблице страсти (стр. 75). Книга разрешает и выбрать, и бросить —
     * кость здесь просто ставит выбор в списке, а закрепляет его общий «Далее».
     */
    async _rollPassion(stepId, stage) {
        const roll = await new Roll("1d10").evaluate();
        const options = await this._originsFor(stage);
        const hit = options.find(entry => (entry.system?.order ?? 0) === roll.total) ?? options[roll.total - 1];
        if (!hit) return;
        (this._selectedOrigin ??= {})[stepId] = hit.uuid;
        (this._selectedSource ??= {})[stepId] = (await fromUuid(hit.uuid))?.toObject()?.system ?? null;
        delete this.answers[stepId];
        ui.notifications?.info(game.i18n.format("WIZARD.PASSION_ROLLED", {roll: roll.total, name: hit.name}));
    }

    _wirePassions(root) {
        for (const button of root.querySelectorAll("[data-roll-passion]"))
            button.addEventListener("click", async event => {
                event.preventDefault();
                if (this._busy) return;
                this._busy = true;
                try {
                    const {rollPassion, passionStage} = event.currentTarget.dataset;
                    await this._rollPassion(rollPassion, passionStage);
                } finally { this._busy = false; if (this.rendered) this.render(false); }
            });
    }

    // ── Шаг Comrade и характера ──────────────────────────────────────────

    /**
     * Стадии 4 и 5 книги: характер персонажа и его Comrade (стр. 104-110).
     *
     * Имя Comrade игрок пишет сам: книжные таблицы имён — списки для вдохновения,
     * и своё имя всегда лучше случайного.
     */
    _comradeStepContext() {
        const bio = this.actor.system.bio ?? {};
        const speciality = this.actor.items.find(item => item.type === "origin" && item.system.stage === "speciality");
        const comrade = speciality?.system.rules?.comrade ?? true;
        return {
            comradeAllowed: comrade !== false,
            comradeIsServitor: comrade === "servitor",
            comradeNone: comrade === false,
            comradeSpeciality: speciality?.name ?? "",
            comradeName: bio.comrade ?? "",
            comradeDemeanour: bio.comradeDemeanour ?? "",
            characterDemeanour: bio.demeanour ?? ""
        };
    }

    /** Бросок по таблице 3-21 в поле анкеты. */
    async _rollDemeanour(field) {
        const roll = await new Roll("1d100").evaluate();
        const demeanour = demeanourFor(roll.total);
        if (!demeanour) return;
        await this.actor.update({[`system.bio.${field}`]: demeanour});
        ui.notifications?.info(game.i18n.format("WIZARD.DEMEANOUR_ROLLED", {roll: roll.total, demeanour}));
    }

    _wireComrade(root) {
        for (const button of root.querySelectorAll("[data-roll-demeanour]"))
            button.addEventListener("click", async event => {
                event.preventDefault();
                if (this._busy) return;
                this._busy = true;
                try { await this._rollDemeanour(event.currentTarget.dataset.rollDemeanour); }
                finally { this._busy = false; if (this.rendered) this.render(false); }
            });
        for (const input of root.querySelectorAll("[data-bio-field]"))
            input.addEventListener("change", async event => {
                await this.actor.update({[`system.bio.${event.currentTarget.dataset.bioField}`]: event.currentTarget.value});
            });
    }

    // ── Шаг дивинации ────────────────────────────────────────────────────

    /** Таблица дивинаций: из мира, иначе из пака таблиц. */
    // ── Жизнь до Караула (Deathwatch, стр. 25) ──────────────────────────────
    //
    //  Три строки, которые книга просит дописать последними: что брат совершил
    //  в своём ордене, какой нрав носит лично и что помнит его броня. Механики в
    //  них нет — это текст на листе, — поэтому шаг ничего не откатывает: строку
    //  просто переписывают, как и любое другое поле анкеты.

    /** Таблица прошлого его ордена; орден без таблицы — не ошибка. */
    _pastEventsForChapter() {
        for (const item of this.actor.items)
            if (item.type === "origin" && item.system.rules?.pastEvents?.length)
                return item.system.rules.pastEvents;
        return [];
    }

    _lifeStepContext() {
        const bio = this.actor.system.bio ?? {};
        const line = row => ({value: lifeLine(row), roll: row.roll, name: row.name, text: row.text});
        const pastEvents = this._pastEventsForChapter().map(line);
        const chosenPast = bio.pastEvent ?? "";
        const chosenDemeanour = bio.demeanour ?? "";
        return {
            lifeStep: true,
            // Орденский нрав пришёл с орденом и не меняется (стр. 32) — он здесь
            // только показан, чтобы личный выбирали не вслепую.
            lifeChapterDemeanour: bio.chapterDemeanour ?? "",
            lifePastEvents: pastEvents.map(row => ({...row, selected: row.value === chosenPast})),
            lifePastEvent: chosenPast,
            lifeNoPastTable: pastEvents.length === 0,
            lifeDemeanours: PERSONAL_DEMEANOURS.map(row => ({
                ...line(row), selected: lifeLine(row) === chosenDemeanour
            })),
            lifeDemeanour: chosenDemeanour,
            lifeArmourHistory: bio.armourHistory ?? ""
        };
    }

    /** Строка таблицы по броску формулы; пустая таблица бросок не переживает. */
    async _rollLifeRow(rows, formula) {
        if (!rows?.length) return null;
        const roll = new Roll(formula);
        await roll.evaluate();
        return rowForRoll(rows, roll.total);
    }

    async _rollPastEvent() {
        const rows = this._pastEventsForChapter();
        if (!rows.length) { ui.notifications?.warn(game.i18n.localize("WIZARD.NO_PAST_TABLE")); return; }
        const row = await this._rollLifeRow(rows, PAST_EVENT_FORMULA);
        if (row) await this.actor.update({"system.bio.pastEvent": lifeLine(row)});
    }

    async _rollPersonalDemeanour() {
        const row = await this._rollLifeRow(PERSONAL_DEMEANOURS, PERSONAL_DEMEANOUR_FORMULA);
        if (row) await this.actor.update({"system.bio.demeanour": lifeLine(row)});
    }

    /**
     * История брони бросается по таблице компендиума, а не по списку в коде:
     * таблица 5-12 длинная, её текст уже лежит предметом мира и его правят столы.
     */
    async _rollArmourHistory() {
        const table = await this._lifeTable(ARMOUR_HISTORY_TABLE);
        if (!table) { ui.notifications?.warn(game.i18n.localize("WIZARD.NO_ARMOUR_TABLE")); return; }
        const draw = await table.draw({displayChat: false});
        const result = draw.results?.[0];
        const name = result?.name ?? "";
        const text = result?.description ?? result?.text ?? "";
        const line = name && text ? `${name}: ${text}` : name || text;
        if (line) await this.actor.update({"system.bio.armourHistory": line});
    }

    /** Таблица по имени: сперва мира, потом компендиума — как у дивинации. */
    async _lifeTable(name) {
        const inWorld = game.tables?.find(table => matchesRuleName(table, name));
        if (inWorld) return inWorld;
        const pack = game.packs.get("dark-heresy.bc-tables");
        if (!pack) return null;
        const index = await pack.getIndex();
        const hit = index.contents.find(entry => matchesRuleName(entry, name));
        return hit ? pack.getDocument(hit._id) : null;
    }

    /** Списки и кнопки шага жизни. Поля обычные: выбрали — записалось. */
    _wireLife(root) {
        const guarded = action => async event => {
            event.preventDefault();
            if (this._busy) return;
            this._busy = true;
            this.render(false);
            try { await action(event.currentTarget); }
            finally { this._busy = false; if (this.rendered) this.render(false); }
        };
        for (const select of root.querySelectorAll("select[data-life-field]"))
            select.addEventListener("change", guarded(async element => {
                await this.actor.update({[`system.bio.${element.dataset.lifeField}`]: element.value});
            }));
        for (const input of root.querySelectorAll("textarea[data-life-field], input[data-life-field]"))
            input.addEventListener("change", guarded(async element => {
                await this.actor.update({[`system.bio.${element.dataset.lifeField}`]: element.value});
            }));
        root.querySelector(".wizard-roll-past")?.addEventListener("click", guarded(() => this._rollPastEvent()));
        root.querySelector(".wizard-roll-demeanour-personal")
            ?.addEventListener("click", guarded(() => this._rollPersonalDemeanour()));
        root.querySelector(".wizard-roll-armour")?.addEventListener("click", guarded(() => this._rollArmourHistory()));
    }

    async _divinationTable() {
        const inWorld = game.tables?.find(table => matchesRuleName(table, "Divinations"));
        if (inWorld) return inWorld;
        const pack = game.packs.get("dark-heresy.bc-tables");
        if (!pack) return null;
        const index = await pack.getIndex();
        const hit = index.contents.find(entry => matchesRuleName(entry, "Divinations"));
        return hit ? pack.getDocument(hit._id) : null;
    }

    _divinationStepContext() {
        const record = this.actor.getFlag(GRANT_FLAG_SCOPE, "divination");
        const applied = record?.applied ?? {};
        const signed = value => `${value > 0 ? "+" : ""}${value}`;
        const effect = [
            ...Object.entries(applied.characteristics ?? {}).map(([key, value]) => `${key} ${signed(value)}`),
            ...(record?.fate ? [`Fate ${signed(record.fate)}`] : []),
            ...["wounds", "corruption", "insanity"]
                .filter(key => applied[key]).map(key => `${key} ${signed(applied[key])}`)
        ];
        return {
            divinationDrawn: !!record,
            divinationName: record?.name ?? "",
            divinationText: this.actor.system.bio?.divination ?? "",
            divinationEffect: effect
        };
    }

    /**
     * Бросить дивинацию. Механическая часть строки идёт через тот же учёт отката,
     * что и выдачи происхождения, — иначе переброс наслаивался бы.
     */
    async _commitDivinationStep() {
        const actor = this.actor;
        if (actor.getFlag(GRANT_FLAG_SCOPE, "divination")) return true;

        const table = await this._divinationTable();
        if (!table) { ui.notifications?.warn(game.i18n.localize("WIZARD.NO_DIVINATION_TABLE")); return false; }

        const draw = await table.draw({displayChat: false});
        const result = draw.results?.[0];
        const effect = result?.flags?.[GRANT_FLAG_SCOPE]?.divinationEffect ?? {};

        const plan = {...emptyPlan(), characteristics: effect.characteristics ?? {},
                      wounds: effect.wounds ?? 0, corruption: effect.corruption ?? 0,
                      insanity: effect.insanity ?? 0};
        // Дивинация меняет готовое значение, а не способ генерации: она приходит
        // ПОСЛЕ броска характеристик.
        const {update, applied} = planToActorUpdate(actor, plan, {characteristicMode: "flat"});
        update["system.bio.divination"] = result?.description ?? result?.name ?? "";
        if (effect.fate) {
            update["system.fate.max"] = (actor.system.fate?.max ?? 0) + effect.fate;
            update["system.fate.value"] = (actor.system.fate?.value ?? 0) + effect.fate;
        }
        await actor.update(update);
        await actor.setFlag(GRANT_FLAG_SCOPE, "divination",
                            {applied, fate: effect.fate ?? 0, name: result?.name ?? ""});
        return true;
    }

    /** Снять брошенную дивинацию — для переброса или для «Назад». */
    async _revertDivination() {
        const actor = this.actor;
        const record = actor.getFlag(GRANT_FLAG_SCOPE, "divination");
        if (!record) return;

        const update = revertUpdate(actor, record.applied ?? {});
        if (record.fate) {
            update["system.fate.max"] = Math.max(0, (actor.system.fate?.max ?? 0) - record.fate);
            update["system.fate.value"] = Math.max(0, (actor.system.fate?.value ?? 0) - record.fate);
        }
        update["system.bio.divination"] = "";
        await actor.update(update);
        await actor.unsetFlag(GRANT_FLAG_SCOPE, "divination");
    }

    /** Хвост: анкета заполнена по шагам, остаётся закрыть окно и поднять лист. */
    async _finish() {
        const actor = this.actor;
        await this.close();
        actor.sheet?.render(true, {focus: true});
    }
}

/** Открыть Мастера на акторе. */
export function openCharacterWizard(actor) {
    if (!actor) return null;
    const app = new CharacterWizard(actor);
    app.render(true);
    return app;
}
