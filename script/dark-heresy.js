import {isWoundsBar,tokenWoundsUpdate,woundsTokenDocument} from './combat/token-wounds.mjs';
import {characteristicTerm} from "./localization/field-terms.mjs";
import {registerSystemSettings, applyAtmosphereSetting} from "./settings.mjs";
import "./localization/babele.mjs";
import {ruleName, matchesRuleName} from "./localization/rule-name.mjs";
import {ruleText, ruleTerm} from "./localization/rule-text.mjs";
import { createDataModels } from "./data/models.mjs";
import { halfRoundedUp } from "./data/rounding.mjs";
import { carryingLimits, baseLeapAndJump } from "./data/carry.mjs";
import { effectiveMaxAgility } from "./data/max-agility.mjs";
import { traitArmour } from "./data/armour-traits.mjs";
import { resolveJamClear } from "./combat/jam.mjs";
import { collapseRepeatedText } from "./data/repeated-text.mjs";
import { OVERHEAT_THRESHOLD, overheatArm, overheatSelfDamage } from "./combat/overheat.mjs";
import { fieldProtects } from "./combat/force-field.mjs";
import { corrosiveBite } from "./combat/corrosive.mjs";
import { remainingWounds, remainingWoundsPatch, woundsAfterDamage, woundsAfterHealing } from "./combat/vitals.mjs";
import { applyMeleeEngagement } from "./combat/range-rules.mjs";
import { FATE_ABILITIES, FATE_INITIATIVE_ROLL, fateHealing, fateOwnerId } from "./combat/fate.mjs";
import { COUNTER_ATTACK_FLAG, canCounterAttack } from "./combat/counter-attack.mjs";
import { CONTROLLER_OPTIONS, TARGET_OPTIONS, UNARMED_DAMAGE, grappleOutcome, optionsFor } from "./combat/grapple.mjs";
import { resolveOpposed } from "./combat/opposed.mjs";
import { EXTRA_DAMAGE, MAX_CHAIN, confirmationHits, explodes, extraDamage, righteousFuryMode } from "./combat/righteous-fury.mjs";
import { RT_ABSENT_CHARACTERISTICS, RT_ABSENT_SKILLS, RT_ADVANCE_TIERS, RT_CHARACTERISTIC_COSTS, rtCharacteristicCost, rtSkillType, rtSkillBase } from "./data/rogue-trader.mjs";
import { grantSummaryLines, validateOrigin } from "./creation/origin-data.mjs";
import { CharacterWizard, openCharacterWizard } from "./creation/wizard.mjs";
import { startCharacterCreation, handleStartCharacterRequest, handleCharacterStarted } from "./creation/start.mjs";
import { stepsFor, backgroundExperienceFor } from "./creation/ruleset-data.mjs";
import { psyRatingCost, psyBase } from "./creation/psychic-data.mjs";
import { patronOf } from "./creation/bc-talents.mjs";
import { PATRON_RELATIONS, BC_CHARACTERISTIC_COSTS, BC_SKILL_COSTS, BC_TALENT_COSTS, BC_CHARACTERISTIC_PATRONS, BC_SKILL_PATRONS, BC_INFAMY_ADVANCE, alignmentLeader } from "./creation/patron-data.mjs";
import {applyTraitOverrides, editTraitOverrides, validateTraitOverrides, WEAPON_TRAIT_TYPES, traitOverridesFromRows, traitOverridePatch} from "./data/weapon-traits.mjs";
import {targetSizeModifier, sizeToHitModifier, armourSizeModifier, describeTargetSize} from "./data/size-rules.mjs";
import {renownRankFor, traumaModifier as dwTraumaModifier, insanityStep as dwInsanityStep, PURITY_THRESHOLD, purityBroken, cohesionPool, FOCUS_AUTO_FAIL} from "./data/deathwatch-rules.mjs";
import {rankForExperience} from "./creation/advance-list.mjs";
﻿// Окружающая среда сцены: погода, температура, гравитация, радиация.
// Перенесено из системы warhammer-dbc; хранится во флаге сцены.
import { openEnvironment, refreshEnvironment, refreshEnvWidget, isEnvWidgetHidden, setEnvWidgetHidden } from "./environment.mjs";

/**
 * Read an ActiveEffect's status ids as a plain array.
 *
 * ActiveEffect#statuses is a SetField, so it is a Set on the live document and an Array only on the
 * raw source. Callers used to test Array.isArray() against the Set, which is never true.
 *
 * @param {ActiveEffect|object} effect  The effect or raw effect data.
 * @returns {string[]}                  The status ids, empty when there are none.
 */
function _effectStatuses(effect) {
    const statuses = effect?.statuses ?? effect?.toObject?.()?.statuses;
    if (statuses instanceof Set) return Array.from(statuses);
    if (Array.isArray(statuses)) return statuses;
    return [];
}

/**
 * Read the dark-heresy condition key of an ActiveEffect.
 *
 * New effects store it in flags. Worlds created before the v14 migration may still carry it in a
 * top-level `key` or in `system.key`, neither of which survives the v14 ActiveEffect schema.
 *
 * @param {ActiveEffect|object} effect  The effect or raw effect data.
 * @returns {string|undefined}          The condition key, if any.
 */
function _effectConditionKey(effect) {
    return effect?.flags?.["dark-heresy"]?.key ?? effect?.key ?? effect?.system?.key;
}

/**
 * Build a DialogV2 from the AppV1 Dialog configuration shape this system was written against.
 *
 * The AppV1 Dialog global is removed in v15. Only the dialog shell changes here: button callbacks
 * still receive a jQuery-wrapped root element, so the existing `html.find(...)` bodies - which hold
 * the roll logic - are untouched.
 *
 * Content is passed as an element rather than a string so DialogV2 does not run it through
 * cleanHTML, which would rewrite the roll dialog markup.
 *
 * @param {object} config             Legacy dialog configuration.
 * @param {string} config.title       Window title.
 * @param {string} config.content     Rendered HTML for the dialog body.
 * @param {Record<string, {icon?: string, label: string, callback?: Function}>} [config.buttons]
 * @param {string} [config.default]   Action key of the default button.
 * @param {Function} [config.render]  Called with the jQuery root once rendered.
 * @param {Function} [config.close]   Called when the dialog closes.
 * @param {object} [options]          Legacy second argument.
 * @param {number} [options.width]    Dialog width in pixels.
 * @returns {DialogV2}                An unrendered dialog; callers still invoke render(true).
 */
function dhDialog({title, content, buttons = {}, default: defaultAction, render, close} = {}, {width} = {}) {
    // The legacy widths (200-280px) were measured against v12 metrics and clip labels and selects
    // under v14's larger control padding, so they act as a floor rather than a fixed size.
    const DIALOG_MIN_WIDTH = 340;
    // Legacy configs pass icons as markup ('<i class="fas fa-check"></i>'); DialogV2 wants classes.
    const iconClasses = icon => {
        if (!icon) return undefined;
        return /class=["']([^"']+)["']/.exec(icon)?.[1] ?? icon;
    };

    const body = document.createElement("div");
    body.innerHTML = content ?? "";

    const dialog = new foundry.applications.api.DialogV2({
        window: {title, resizable: true},
        classes: ["dark-heresy-dialog"],
        content: body,
        position: {width: Math.max(Number(width) || 0, DIALOG_MIN_WIDTH)},
        buttons: Object.entries(buttons).map(([action, button]) => ({
            action,
            label: button.label,
            icon: iconClasses(button.icon),
            default: action === defaultAction,
            callback: (event, element, instance) => button.callback?.($(instance.element))
        }))
    });

    if (typeof render === "function") {
        dialog.addEventListener("render", () => render($(dialog.element)), {once: true});
    }
    // Selecting a field's contents on focus used to be attempted with an inline
    // <script> inside each dialog template. DialogV2 cleans dialog content through
    // cleanHTML, which drops script tags, so none of those ever ran. Every dialog
    // gets the behaviour here instead.
    dialog.addEventListener("render", () => {
        for (const field of dialog.element.querySelectorAll(".dh-dialog input:not([type='checkbox']):not([type='range'])")) {
            field.addEventListener("focus", () => field.select());
        }
    }, {once: true});
    if (typeof close === "function") {
        dialog.addEventListener("close", event => close(event), {once: true});
    }
    return dialog;
}

const DH_DERIVED_EFFECT_KEYS = new Set([
    "system.fatigue.max", "system.movement.half", "system.movement.full", "system.movement.charge", "system.movement.run",
    "system.encumbrance.value", "system.encumbrance.max"
]);

class DarkHeresyActiveEffect extends ActiveEffect {
    get isSuppressed() {
        if (super.isSuppressed) return true;
        const item = this.parent?.documentName === "Item" ? this.parent : null;
        if (!item || !this.transfer) return false;
        const activation = this.flags?.["dark-heresy"]?.activation;
        if (activation === "always") return false;
        const equipment = ["weapon", "armour", "forceField"].includes(item.type);
        return (activation === "equipped" || equipment) && item.system.equipped !== true;
    }

    shouldApplyChange(change, {phase} = {}) {
        // Compatibility for derived keys offered by older system versions with no phase selector.
        const effectivePhase = change.phase === "initial" && DH_DERIVED_EFFECT_KEYS.has(change.key) ? "final" : change.phase;
        return super.shouldApplyChange({...change, phase: effectivePhase}, {phase});
    }
}

class DarkHeresyCombat extends Combat {
    async rollInitiative(ids, options = {}) {
            const combatantsToRoll = ids
                ? ids.map(id => this.combatants.get(id)).filter(c => c)
                : Array.from(this.combatants.values());

            const withLightningReflexes = [];
            const withoutLightningReflexes = [];

            for (const combatant of combatantsToRoll) {
                const actor = combatant?.actor;
                if (actor?.getFlag("dark-heresy", "lightningReflexes")) {
                    withLightningReflexes.push(combatant);
                } else {
                    withoutLightningReflexes.push(combatant);
                }
            }

            for (const combatant of withLightningReflexes) {
                const actor = combatant.actor;
                const formula = CONFIG.Combat.initiative.formula;
                const rollData = actor.getRollData();

                const roll1 = new Roll(formula, rollData);
                const roll2 = new Roll(formula, rollData);

                await roll1.evaluate();
                await roll2.evaluate();

                const betterResult = Math.max(roll1.total, roll2.total);
                const rollMode = options?.messageOptions?.rollMode
                    || game.settings.get("core", "rollMode");
                if (options?.messageOptions?.create !== false) {
                    const roll1Html = await roll1.render();
                    const roll2Html = await roll2.render();
                    const content = `
                        <div class="dh-lightning-reflexes">
                            <div><strong>Lightning Reflexes</strong></div>
                            ${roll1Html}
                            ${roll2Html}
                            <div class="dice-total">Best: ${betterResult}</div>
                        </div>
                    `;
                    const chatData = {
                        speaker: ChatMessage.getSpeaker({actor}),
                        flavor: game.i18n.localize("TALENT.LIGHTNING_REFLEXES"),
                        content,
                        rolls: [roll1, roll2]
                    };
                    ChatMessage.applyRollMode(chatData, rollMode);
                    await ChatMessage.create(chatData);
                }
                await combatant.update({initiative: betterResult});
            }

            if (withoutLightningReflexes.length > 0) {
                const idsWithoutLR = withoutLightningReflexes.map(c => c.id);
                // Подпись сообщения сокращается до одного слова. Ядро пишет «Имя
                // rolls for Initiative!», а имя уже стоит заголовком сообщения —
                // строка повторяла его и занимала всю ширину карточки.
                const opts = foundry.utils.mergeObject({
                    messageOptions: { flavor: game.i18n.localize("INITIATIVE") }
                }, options, { inplace: false });
                return super.rollInitiative(idsWithoutLR, opts);
            }

            return this;
    }

    async _runTurnEvent(phase, combatant, context, task) {
        const actor = combatant?.actor;
        if (!actor) return;
        return _queueDocumentOperation(actor.uuid, async () => {
            const key = phase + "-" + combatant.id;
            const eventId = context.round + ":" + context.turn;
            const events = {...this.getFlag("dark-heresy", "turnEvents")};
            if (events[key]?.eventId === eventId) return;
            events[key] = {eventId, status:"processing"};
            await this.setFlag("dark-heresy", "turnEvents", events);
            try {
                await task(actor);
                events[key].status = "complete";
            } catch (error) {
                events[key].status = "needsReview";
                events[key].error = String(error.message || error);
                throw error;
            } finally {
                await this.setFlag("dark-heresy", "turnEvents", events);
            }
        });
    }

    async _onStartTurn(combatant, context) {
        await super._onStartTurn(combatant, context);
        return this._runTurnEvent("start", combatant, context, async actor => {
            // Ответный удар даётся раз за ход (стр. 126). Право возвращается с
            // началом собственного хода — иначе одно парирование в первом раунде
            // израсходовало бы талант на весь бой.
            if (actor.getFlag?.("dark-heresy", COUNTER_ATTACK_FLAG)) {
                await actor.unsetFlag("dark-heresy", COUNTER_ATTACK_FLAG);
            }
            if (actor.hasCondition("dead")) return;
            for (const [condition, apply] of [["fire", _applyFireEffect], ["bleeding", _applyBleedingEffect],
                ["vacuum", _applyVacuumEffect], ["suffocating", _applySuffocationEffect], ["pinned", _offerPinningEscape]]) {
                if (actor.hasCondition("dead")) break;
                if (actor.hasCondition(condition)) await apply(actor, combatant);
            }
            if (actor.type === "voidship") await _onShipTurnStart(actor, combatant);
        });
    }

    async _onEndTurn(combatant, context) {
        await super._onEndTurn(combatant, context);
        return this._runTurnEvent("end", combatant, context, async actor => {
            if (!actor.hasCondition("dead") && actor.hasCondition("poisond")) await _applyToxicEffect(actor, combatant);
        });
    }

    async _onStartRound(context) {
        await super._onStartRound(context);
        if (context.round > 1) await onCombatRoundAdvanced(this);
    }
}

class DarkHeresyActor extends Actor {
    async modifyTokenAttribute(attribute,value,isDelta=false,isBar=true) {
        if (Dh.rulesetFor(this).id !== 'ow' || !isWoundsBar(attribute)) return super.modifyTokenAttribute(attribute,value,isDelta,isBar);
        const updates=tokenWoundsUpdate(this,value,isDelta);
        if(Hooks.call('modifyTokenAttribute',{attribute,value,isDelta,isBar},updates,this)===false)return this;
        return this.update(updates);
    }


    /**
     * Типы, которые предлагаются в окне создания Актёра.
     *
     * Лист игрока — один. Книгу персонаж называет полем system.ruleset уже на самом
     * листе, и выбирать её ещё и типом при создании незачем: это один и тот же вопрос,
     * заданный дважды, причём первый раз — необратимо.
     *
     * Тип heretic остаётся: у заведённых им персонажей свой лист (Бесчестье,
     * покровитель, принадлежность), и ломать их нельзя. Просто новых им больше не заводят.
     */
    static HIDDEN_CREATE_TYPES = ["heretic"];

    /** @override */
    static async createDialog(data = {}, createOptions = {}, options = {}) {
        const types = (options.types ?? game.documentTypes.Actor)
            .filter(type => type !== CONST.BASE_DOCUMENT_TYPE
                && !DarkHeresyActor.HIDDEN_CREATE_TYPES.includes(type));
        return super.createDialog(data, createOptions, { ...options, types });
    }

    async _preCreate(data, options, user) {

        let initData = {
            "prototypeToken.name": data.name
        };
        if (data.type === "acolyte" || data.type === "heretic") {
            initData["prototypeToken.actorLink"] = true;
            initData["prototypeToken.disposition"] = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
        }
        // Set default icon if not provided
        if (!data.img && CONFIG.Actor.defaultIcons && CONFIG.Actor.defaultIcons[data.type]) {
            initData.img = CONFIG.Actor.defaultIcons[data.type];
        }
        this.updateSource(initData);
    }

    prepareDerivedData() {
        super.prepareDerivedData();
        // У машины нет характеристик, навыков и ран: её ведут целостность,
        // броня по сторонам и состояние повреждений. Общий путь ей не подходит
        // ни одним шагом, поэтому она сворачивает в свой.
        if (this.type === "vehicle") return this._prepareVehicle();
        if (this.type === "voidship") return this._prepareVoidship();
        this._computeCharacteristics();
        this._computeInfamy();
        this._computeSkills();
        this._computeAlignment();
        this._computeItems();
        this._computeExperience();
        this._computeArmour();
        this._computeMovement();
        this._computeVitalMeters();
        this._prepareAttributesForModules();
    }

    /**
     * Prepare attributes.hp in standard Foundry VTT format for module compatibility (e.g., Health Estimate)
     * Health Estimate module expects hp.value to represent current damage/wounds, not remaining health
     * So we set value = currentWounds and max = maxWounds, and the module calculates health percentage correctly
     * 
     * This is safe - we only add/update hp, and only if wounds exist, without overwriting other attributes
     */
    /**
     * Подготовить машину: состояние по целостности, броня по сторонам, оружие.
     *
     * Правило состояний простое и целиком лежит здесь: потеряно меньше половины
     * целостности — Легко повреждена, половина и больше — Тяжело, ноль — груда
     * металла. Легко повреждённая сражается без штрафов, поэтому штраф считается
     * только со второй ступени.
     */
    /**
     * Пустотный корабль (Rogue Trader, глава VIII).
     *
     * Здесь считается всё, что выводится из записанного: сметы Места и
     * Мощности, заполнение шкал, разбивка орудий по позициям и состояние
     * корабля — обездвиженность при пустом корпусе плюс пороги Команды и
     * Боевого духа. Ничего не бросается: броски живут в листе, не в подготовке.
     */
    _prepareVoidship() {
        const sys = this.system;
        const num = v => Number(v) || 0;

        // Предметы собираются первыми: от них зависят обе сметы.
        this.shipWeapons = this.items.filter(i => i.type === "shipWeapon");
        this.shipComponents = this.items.filter(i => i.type === "shipComponent");
        const tracked = [...this.shipWeapons, ...this.shipComponents];

        // Сметы. Пока на корабле нет ни одного предмета, обе строки заполняются
        // руками — так лист вёл себя всегда, и уже заведённые корабли этого не
        // заметят. Как только появился первый компонент или ствол, расход
        // считается по ним, а ручное поле гаснет: два источника правды на одну
        // цифру рано или поздно расходятся.
        for (const track of ["space", "power"]) {
            const t = sys[track] ?? (sys[track] = {});
            t.auto = tracked.length > 0;
            if (t.auto) t.used = tracked.reduce((sum, i) => sum + num(i.system?.[track]), 0);

            // Мощность вдобавок вырабатывается: её даёт плазменный привод.
            // Записанное в поле — это то, что даёт корпус до компонентов;
            // выработка компонентов прибавляется к нему, а не заменяет его.
            t.generated = track === "power"
                ? this.shipComponents.reduce((sum, i) => sum + num(i.system?.powerGenerated), 0)
                : 0;
            t.total = num(t.available) + t.generated;

            t.remaining = t.total - num(t.used);
            t.over = t.remaining < 0;
            t.percent = t.total > 0
                ? Math.max(0, Math.min(100, Math.round(num(t.used) / t.total * 100)))
                : 0;
        }

        // Шкалы корпуса, экипажа и боевого духа заполняются одинаково: доля
        // текущего от предела. Handlebars арифметики не умеет, поэтому здесь.
        for (const track of ["hullIntegrity", "crew", "morale"]) {
            const t = sys[track] ?? (sys[track] = {});
            const max = num(t.max);
            t.percent = max > 0
                ? Math.max(0, Math.min(100, Math.round(num(t.value) / max * 100)))
                : 0;
        }

        // Орудия разбираются по расположениям, чтобы лист мог сверить их число
        // с ёмкостью каждой позиции.
        const capacity = sys.weaponCapacity ?? (sys.weaponCapacity = {});
        sys.weaponSlots = Object.keys(Dh.shipLocations).map(key => {
            const mounted = this.shipWeapons.filter(w => w.system.location === key).length;
            return {
                key, label: Dh.shipLocations[key],
                mounted, capacity: num(capacity[key]),
                over: mounted > num(capacity[key])
            };
        });

        // Компоненты по спискам книги, плюс счёт бедствий: горящий или
        // разгерметизированный компонент должен быть виден с первой вкладки,
        // а не находиться перелистыванием.
        sys.componentGroups = Object.keys(Dh.shipComponentCategories).map(key => ({
            key, label: Dh.shipComponentCategories[key],
            items: this.shipComponents.filter(c => (c.system?.category || "essential") === key)
        }));
        sys.componentAlarms = {
            onFire: this.shipComponents.filter(c => c.system?.onFire).length,
            depressurised: this.shipComponents.filter(c => c.system?.depressurised).length,
            damaged: this.shipComponents.filter(c =>
                ["damaged", "destroyed"].includes(c.system?.status)).length
        };
        sys.componentAlarms.total = sys.componentAlarms.onFire
            + sys.componentAlarms.depressurised + sys.componentAlarms.damaged;

        this._prepareVoidshipCondition();
        return this;
    }

    /**
     * Состояние корабля: обездвиженность и пороги команды.
     *
     * Три независимых источника штрафов складываются в одну сводку, из которой
     * потом читают и стрельба, и манёвры. Считать их на месте броска — значит
     * пересчитывать одно и то же в пяти местах и однажды разойтись.
     */
    _prepareVoidshipCondition() {
        const sys = this.system;
        const num = v => Number(v) || 0;

        // Книга говорит прямо (стр. 224): все эффекты складываются, в том числе
        // эффекты Команды с эффектами Боевого духа. Поэтому пороги проходятся
        // сверху вниз и каждый добавляет своё к предыдущим.
        const mods = {
            speed: 0, manoeuvrability: 0, detection: 0,
            command: 0, ballisticSkill: 0,
            // Отдельная графа: абордаж, отражение налёта, тушение пожаров и
            // аварийный ремонт. Это не Командование вообще — таблица Команды
            // бьёт именно по этой четвёрке, и валить её в общий штраф значит
            // раздать его тестам, которых правило не касается.
            shipboardActions: 0
        };
        const notes = [];
        const speedFactors = [];

        // Подспорья этого хода. «Помочь духу машины» (стр. 216) даёт прибавку до
        // конца хода — она живёт в отметке хода и снимается с его началом.
        const turnFlag = this.getFlag?.("dark-heresy", "shipTurn");
        if (turnFlag?.aid?.value && ["manoeuvrability", "detection"].includes(turnFlag.aid.stat)) {
            mods[turnFlag.aid.stat] += Number(turnFlag.aid.value) || 0;
        }
        // Бесшумный ход (стр. 218): Скорость вдвое, манёвры на ступень труднее.
        sys.silentRunning = !!this.getFlag?.("dark-heresy", "silentRunning");
        if (sys.silentRunning) {
            speedFactors.push(0.5);
            notes.push("SHIP.STATE.SILENT_RUNNING");
        }

        // Пороги Команды (табл. 8-13).
        const crew = num(sys.crew?.value);
        const crewNotes = [];
        if (crew < 80) crewNotes.push("SHIP.THRESHOLD.CREW_80");
        if (crew < 60) { mods.shipboardActions -= 5; crewNotes.push("SHIP.THRESHOLD.CREW_60"); }
        if (crew < 50) { mods.manoeuvrability -= 10; crewNotes.push("SHIP.THRESHOLD.CREW_50"); }
        if (crew < 40) crewNotes.push("SHIP.THRESHOLD.CREW_40");
        if (crew < 20) crewNotes.push("SHIP.THRESHOLD.CREW_20");
        if (crew < 10) { mods.shipboardActions -= 20; crewNotes.push("SHIP.THRESHOLD.CREW_10"); }
        if (crew <= 0) crewNotes.push("SHIP.THRESHOLD.CREW_0");

        // Обездвиженность приходит с двух сторон. Пустой корпус — очевидная
        // (стр. 221); поредевшая команда — вторая, её даёт порог 20 таблицы
        // 8-13 словами «в бою корабль считается Обездвиженным». Штрафы при этом
        // одни и те же, поэтому и флаг один.
        const hullCrippled = num(sys.hullIntegrity?.max) > 0 && num(sys.hullIntegrity?.value) <= 0;
        sys.hullCrippled = hullCrippled;
        sys.crippled = hullCrippled || crew < 20;
        // Ярлык зависит от причины: пустой корпус и выкошенная команда читаются
        // за столом по-разному, хотя штрафы дают одни и те же.
        const crippledLabel = hullCrippled ? "SHIP.STATE.CRIPPLED" : "SHIP.STATE.CRIPPLED_BY_CREW";
        if (sys.crippled) {
            mods.manoeuvrability -= 10;
            mods.detection -= 10;
            speedFactors.push(0.5);
            notes.push(crippledLabel);
        }
        // А вот это уже сложение двух бед: корпус пуст и команды почти нет.
        // Такой корабль ходит через раунд.
        sys.halfTurns = hullCrippled && crew < 20;
        if (sys.halfTurns) notes.push("SHIP.STATE.HALF_TURNS");

        // Пороги Боевого духа (табл. 8-14).
        const morale = num(sys.morale?.value);
        const moraleNotes = [];
        if (morale < 80) { mods.command -= 5; moraleNotes.push("SHIP.THRESHOLD.MORALE_80"); }
        if (morale < 60) { mods.ballisticSkill -= 5; moraleNotes.push("SHIP.THRESHOLD.MORALE_60"); }
        if (morale < 50) { mods.command -= 10; moraleNotes.push("SHIP.THRESHOLD.MORALE_50"); }
        if (morale < 40) {
            mods.manoeuvrability -= 10; mods.ballisticSkill -= 5;
            moraleNotes.push("SHIP.THRESHOLD.MORALE_40");
        }
        if (morale < 20) moraleNotes.push("SHIP.THRESHOLD.MORALE_20");
        if (morale < 10) {
            mods.command -= 15; mods.speed -= 10;
            mods.manoeuvrability -= 10; mods.detection -= 10;
            moraleNotes.push("SHIP.THRESHOLD.MORALE_10");
        }
        if (morale <= 0) moraleNotes.push("SHIP.THRESHOLD.MORALE_0");

        // Абордаж и налёты запрещены совсем: команды не хватает (Команда ниже
        // 10) или ей нельзя доверить оружие (Дух ниже 20). Это не штраф, а
        // запрет. Отбиваться от чужого абордажа корабль при этом может — книга
        // оговаривает это отдельно (стр. 224).
        sys.boardingDisabled = crew < 10 || morale < 20;

        sys.mods = mods;
        sys.crewNotes = crewNotes;
        sys.moraleNotes = moraleNotes;
        sys.stateNotes = notes;

        // Эффективные значения — то, чем корабль на самом деле действует.
        // Скорость сначала делится (обездвиженность), потом уменьшается на
        // плоский штраф: половина от уже урезанной вдвое — не то же самое.
        let speed = num(sys.speed);
        for (const f of speedFactors) speed = Math.ceil(speed * f);
        sys.speedEffective = Math.max(0, speed + mods.speed);
        sys.manoeuvrabilityEffective = num(sys.manoeuvrability) + mods.manoeuvrability;
        sys.detectionEffective = num(sys.detection) + mods.detection;

        // Десятки Обнаружения — бонус к инициативе в пустотном бою (стр. 212).
        // Считается от действующего значения, а не от записанного: порог Духа
        // в 10 срезает саму характеристику, а с ней и бонус.
        sys.detectionBonus = Math.floor(Math.max(0, sys.detectionEffective) / 10);
        // Формула инициативы у системы одна на всех — @initiative.base +
        // @initiative.bonus, — и читает она из system. Кораблю достаточно
        // отдать туда 1d10 и бонус Обнаружения (стр. 212), и общий бросок
        // инициативы сработает без отдельной ветки.
        sys.initiative = { base: "1d10", bonus: sys.detectionBonus };

        // Обездвиженный корабль стреляет вполсилы (стр. 221): Сила каждого
        // ствола делится надвое с округлением вверх.
        for (const w of (this.shipWeapons ?? [])) {
            const raw = num(w.system?.strength);
            w.system.strengthEffective = sys.crippled ? Math.ceil(raw / 2) : raw;
        }

        // Сводка для шапки листа. Собирается здесь, а не в шаблоне: Handlebars
        // не умеет ни складывать, ни отбирать ненулевое, а показать надо ровно
        // то, что сейчас действует.
        const tags = [];
        if (sys.crippled) tags.push({ kind: "crippled", label: crippledLabel });
        if (sys.halfTurns) tags.push({ kind: "crippled", label: "SHIP.STATE.HALF_TURNS" });
        if (sys.boardingDisabled) tags.push({ kind: "warn", label: "SHIP.STATE.NO_BOARDING" });
        if (sys.silentRunning) tags.push({ kind: "warn", label: "SHIP.STATE.SILENT_RUNNING" });
        for (const key of crewNotes) tags.push({ kind: "crew", label: key });
        for (const key of moraleNotes) tags.push({ kind: "morale", label: key });

        const modLabels = {
            speed: "SHIP.SPEED",
            manoeuvrability: "SHIP.MANOEUVRABILITY",
            detection: "SHIP.DETECTION",
            command: "SHIP.MOD.COMMAND",
            ballisticSkill: "SHIP.MOD.BALLISTIC_SKILL",
            shipboardActions: "SHIP.MOD.SHIPBOARD_ACTIONS"
        };
        const modList = Object.entries(mods)
            .filter(([, v]) => v !== 0)
            .map(([key, v]) => ({
                key, label: modLabels[key] ?? key,
                text: v > 0 ? `+${v}` : `${v}`
            }));

        sys.conditionSummary = { any: tags.length > 0, tags, mods: modList };
        return this;
    }

    _prepareVehicle() {
        const sys = this.system;
        const integrity = sys.integrity ?? (sys.integrity = { value: 0, max: 0 });
        const max = Number(integrity.max) || 0;
        const value = Math.min(Math.max(Number(integrity.value) || 0, 0), Math.max(max, 0));
        const critical = Math.max(Number(integrity.critical) || 0, 0);
        integrity.value = value;
        integrity.critical = critical;
        integrity.lost = Math.max(max - value, 0);
        integrity.percent = max > 0 ? Math.max(0, Math.min(100, Math.round(value / max * 100))) : 0;

        // Развалина — конец пути: машина больше не едет, не стреляет и не
        // виражит. Порога, за которым она наступает сама, в правилах нет:
        // состояние Машина Уничтожена ставит конкретная строка таблицы крита,
        // а её читает МИ. Поэтому галка только ручная.
        sys.conditions ??= {};

        // Ступени идут по книге: пока потеряно меньше половины целостности —
        // Легко повреждена и дерётся без штрафов; от половины — Тяжело; а стоит
        // накопиться хоть одному очку Критического Урона, машина Критически
        // повреждена независимо от того, сколько целостности ей ещё осталось.
        if (sys.conditions.wrecked) integrity.state = "wrecked";
        else if (critical > 0) integrity.state = "critical";
        else if (max <= 0) integrity.state = "intact";
        else if (integrity.lost > Math.ceil(max / 2)) integrity.state = "heavy";
        else if (integrity.lost > 0) integrity.state = "light";
        else integrity.state = "intact";
        integrity.stateLabel = Dh.vehicleDamageStates[integrity.state];

        // Штраф к Управлению копится: тяжёлое повреждение стоит −10, критическое
        // −20, и отдельно −10 висит на обгоревшей машине.
        let operatePenalty = 0;
        if (integrity.state === "critical") operatePenalty -= 20;
        else if (integrity.state === "heavy") operatePenalty -= 10;
        if (sys.conditions?.burnt) operatePenalty -= 10;
        integrity.operatePenalty = operatePenalty;

        // Оружие и черты машины разбираются по спискам, как снаряжение у людей.
        this.vehicleWeapons = this.items.filter(i => i.type === "vehicleWeapon");
        this.vehicleTraits = this.items.filter(i => i.type === "vehicleTrait");

        // Черты и тип шасси правят Маневренность, а особые состояния — то, что
        // машина ещё может делать. Система их только считает и показывает:
        // запрещать действия она не берётся, потому что стол вправе играть иначе.
        const named = new Set(this.vehicleTraits.map(t => ruleName(t).toLowerCase()));
        const has = (...names) => names.some(n => [...named].some(t => t.includes(n)));
        // Шасси правит Маневренность: гусеницы её съедают, колёса и гравипривод
        // добавляют. Шагоходам книга поправки не даёт.
        sys.manoeuvreModifier = 0;
        if (sys.vehicleType === "tracked" || has("гусенич", "tracked")) sys.manoeuvreModifier -= 10;
        if (sys.vehicleType === "wheeled" || has("колесн", "колёсн", "wheeled")) sys.manoeuvreModifier += 10;
        if (sys.vehicleType === "skimmer" || has("глиссер", "skimmer")) sys.manoeuvreModifier += 10;

        // Черты, которые называют, как машина устроена. Система их только
        // показывает: выцеливать седоков и нарушать герметичность — решения стола.
        sys.explosive = has("взрывоопас", "explosive");
        // Две разные черты, которые легко спутать: Герметичный — про среду и
        // жизнеобеспечение, Закрытый — про то, что экипаж укрыт и его нельзя
        // выцелить. Открытый прямо противоположен Закрытому.
        sys.sealed = has("герметич", "sealed");
        sys.openTopped = !!sys.conditions?.open || has("открыт", "open-topped");
        sys.enclosed = (has("закрыт", "enclosed", "closed") || sys.sealed) && !sys.openTopped;
        // Список для листа: что именно система про машину поняла.
        sys.traitChips = [
            sys.sealed && { key: "VEHICLE.TRAIT.SEALED" },
            sys.enclosed && { key: "VEHICLE.TRAIT.ENCLOSED" },
            sys.openTopped && { key: "VEHICLE.TRAIT.OPEN" },
            sys.explosive && { key: "VEHICLE.TRAIT.EXPLOSIVE", warn: true }
        ].filter(Boolean);

        const c = sys.conditions;

        // Что машина ещё способна сделать, посчитано одним местом: лист, кнопки
        // и броски должны отвечать одинаково, иначе на столе выйдет спор.
        sys.can = {
            move: !c.wrecked && !c.immobilised,
            cruise: !c.wrecked && !c.immobilised && !c.unpowered,
            fire: !c.wrecked,
            swerve: !c.wrecked && !c.immobilised
        };

        // Обездвиженная машина никуда не едет — скорость показывается нулевой,
        // но записанное значение не трогается: состояние снимут, и оно вернётся.
        sys.speed ??= {};
        const tactical = Number(sys.speed.tactical) || 0;
        const cruising = Number(sys.speed.cruising) || 0;
        sys.speed.effectiveTactical = sys.can.move ? tactical : 0;
        sys.speed.effectiveCruising = sys.can.cruise ? cruising : 0;

        // Тактическое маневрирование: полудействие везёт машину на Тактическую
        // Скорость, полное действие — на двойную. Крейсерская скорость сюда не
        // входит, она в км/ч и меряет марш, а не бой.
        const mode = sys.speed.mode ?? "tactical";
        const allowances = { halted: 0, half: tactical, tactical: tactical * 2 };
        sys.speed.allowance = sys.can.move ? (allowances[mode] ?? tactical) : 0;
        sys.speed.modeLabel = Dh.vehicleSpeedModes[mode] ?? Dh.vehicleSpeedModes.tactical;

        // Стрельба с машины на ходу: −10, если в прошлом раунде она прошла
        // Тактическую Скорость, и −20 за двойную. Правило смотрит именно на
        // прошлый раунд, поэтому берётся пройденное тогда — расстояние система
        // копит сама, молча, по перемещению фишки.
        const movedLastRound = Number(this.getFlag?.("dark-heresy", "movedLastRound")) || 0;
        sys.speed.movedLastRound = movedLastRound;
        sys.speed.firingPenalty = tactical > 0 && movedLastRound > tactical ? -20
            : (movedLastRound > 0 ? -10 : 0);

        // Объявленный манёвр держится до начала следующего хода оператора и
        // мешает и тем, кто целит в машину, и тем, кто стреляет с её борта.
        // Раунд записан, чтобы состояние не пережило бой.
        const manoeuvre = sys.manoeuvre ?? (sys.manoeuvre = {});
        // Вне боя раундов нет, и привязывать состояние не к чему: тогда оно
        // держится, пока его не снимут щелчком по метке на листе.
        const active = !!manoeuvre.action
            && (!game.combat?.round || Number(manoeuvre.round) === game.combat.round);
        manoeuvre.active = !!active;
        manoeuvre.effect = active ? (Number(manoeuvre.penalty) || 0) : 0;
        manoeuvre.label = Dh.vehicleManoeuvres[manoeuvre.action]?.label ?? "";
        if (manoeuvre.effect) sys.speed.firingPenalty += manoeuvre.effect;

        // Всё, что модифицирует проверки Управления, сводится в одно число:
        // сама Маневренность машины, поправка шасси и штраф за повреждения.
        // Без этого посчитанные цифры оставались украшением листа.
        sys.operateModifier = (Number(sys.manoeuvrability) || 0)
            + sys.manoeuvreModifier
            + (Number(integrity.operatePenalty) || 0);

        // Экипаж и пассажиры — настоящие актёры, а не строка с ролями: по ним
        // раскидывается урон от пробития, огня и детонации, и они же садятся в
        // очередь инициативы за командиром.
        sys.crew ??= {};
        const members = Array.isArray(sys.crew.members) ? sys.crew.members : [];
        const seen = new Set();
        this.crewMembers = members
            .filter(m => m?.actorId && !seen.has(m.actorId) && seen.add(m.actorId))
            .map(m => {
                const actor = game.actors?.get(m.actorId);
                if (!actor) return null;
                return {
                    actorId: m.actorId,
                    actor,
                    name: actor.name,
                    img: actor.img,
                    role: m.role ?? "",
                    // Пассажир едет как груз, экипаж работает: разница важна и
                    // для вместимости, и для того, кого достанет осколком.
                    passenger: !!m.passenger,
                    isOperator: m.actorId === sys.operatorId,
                    isGunner: this.vehicleWeapons.some(w => w.system.gunnerId === m.actorId)
                };
            })
            .filter(Boolean);
        sys.crew.aboard = this.crewMembers.filter(m => !m.passenger).length;
        sys.crew.passengers = this.crewMembers.filter(m => m.passenger).length;
        sys.crew.total = this.crewMembers.length;
        // Вместимость считается вместе с экипажем: у «Химеры» это двенадцать
        // человек всего, а не двенадцать сверх команды. Экипаж отдельно сверяется
        // со своей строкой — ролей в машине ровно столько, сколько записано.
        sys.crew.overCrewed = sys.crew.aboard > (Number(sys.crew.value) || 0);
        sys.crew.overloaded = sys.crew.total > (Number(sys.carryingCapacity) || 0);

        // Сектор обстрела: у крепления он свой, но записанный на оружии угол
        // главнее — «Страж» носит спонсоны с сектором в 180°, а не в 45°.
        for (const weapon of this.vehicleWeapons) {
            const mount = Dh.vehicleMounts[weapon.system.mount] ?? Dh.vehicleMounts.hull;
            weapon.arcTotal = Number(weapon.system.arc) || mount.arc;
            weapon.mountLabel = mount.label;
            // Почему орудие молчит. Заклинившая башня держит только то, что в
            // ней стоит; обесточенная машина глушит всё, чему нужен привод.
            // Заклинивание — общесистемный флаг, тот же, что у ручного оружия:
            // ставит его бросок, снимает кнопка в строке орудия.
            weapon.blockedBy = weapon.system.destroyed ? "VEHICLE.BLOCKED.DESTROYED"
                : weapon.jammed ? "VEHICLE.BLOCKED.JAMMED"
                : c.wrecked ? "VEHICLE.BLOCKED.WRECKED"
                : (c.turretJammed && weapon.system.mount === "turret") ? "VEHICLE.BLOCKED.TURRET"
                : (c.unpowered && weapon.system.powered) ? "VEHICLE.BLOCKED.UNPOWERED"
                : null;
        }
        // Общая галка «орудие уничтожено» больше не живёт своей жизнью: она
        // показывает то же, что и сами орудия.
        c.weaponDestroyed = this.vehicleWeapons.some(w => w.system.destroyed);
        return this;
    }

    /**
     * Derive the fill percentages the sheet meters read.
     *
     * Kept out of the templates because Handlebars has no arithmetic, and out of the
     * stylesheet because the value is data, not presentation.
     */
    _computeVitalMeters() {
        const pct = (value, max) => {
            const m = Number(max) || 0;
            if (m <= 0) return 0;
            return Math.max(0, Math.min(100, Math.round((Number(value) || 0) / m * 100)));
        };

        const wounds = this.system.wounds ?? {};
        // wounds.value counts damage taken, so the bar fills as the character is hurt.
        wounds.spentPercent = pct(wounds.value, wounds.max);
        wounds.showRemaining = Dh.rulesetFor(this).id === 'ow';
        wounds.remaining = remainingWounds(wounds);
        // Source value prevents repeatedly baking active effects into saved wounds.
        wounds.sourceRemaining = remainingWounds(this._source?.system?.wounds ?? wounds);
        wounds.criticalPercent = pct(wounds.critical, wounds.max);

        // How full the carry is, so the gear tab can show a load gauge.
        const enc = this.system.encumbrance;
        if (enc) enc.percent = pct(enc.value, enc.max);

        // Fate is a resource in hand and fatigue is strain piling up, but both read the
        // same way: how much of the track is filled.
        const fate = this.system.fate ?? {};
        fate.percent = pct(fate.value, fate.max);
        const fatigue = this.system.fatigue ?? {};
        fatigue.percent = pct(fatigue.value, fatigue.max);

        this.system.insanityPercent = pct(this.system.insanity, 100);
        this.system.corruptionPercent = pct(this.system.corruption, 100);
    }

    /**
     * Тёмная слава еретика (Black Crusade, стр. 308).
     *
     * Очков Тёмной славы у персонажа ровно столько, каков её бонус — полных
     * десятков в характеристике. Это не запас, который копят: он пересчитывается
     * из характеристики, поэтому `fate.max` здесь производное, а не хранимое.
     * Хранилищем остаётся `system.fate`: на него завязан токенбар системы,
     * и разводить два поля под один ресурс не за чем.
     *
     * Никого, кроме еретика, это не касается — у аколита судьба своя и считается
     * по книге Dark Heresy.
     */
    _computeInfamy() {
        if (this.type !== "heretic") return;
        const infamy = this.characteristics?.influence;
        if (!infamy) return;

        this.system.infamyBonus = Number(infamy.displayBonus) || 0;
        const fate = this.system.fate ?? (this.system.fate = {});
        fate.max = this.system.infamyBonus;
        // Уже накопленные очки при этом не срезаются. Характеристика проседает от
        // усталости и временных модификаторов, и подгонка запаса под потолок
        // означала бы, что усталость крадёт очко насовсем: списание пишет в базу
        // урезанное число, а обратно оно не вырастет.
    }

    _prepareAttributesForModules() {
        const wounds = this.system.wounds || {};
        const maxWounds = Number(wounds.max) || 0;
        const currentWounds = Number(wounds.value) || 0;
        
        // Always initialize attributes.hp for module compatibility
        // Initialize attributes if it doesn't exist (safe - won't overwrite existing data)
        if (!this.system.attributes) {
            this.system.attributes = {};
        }
        
        // Always set/update hp - preserve any other attributes that might exist from other modules
        // Set HP: value = current wounds (damage taken), max = max wounds
        // Module will calculate health as (max - value) / max, which gives correct percentage
        if (!this.system.attributes.hp) {
            this.system.attributes.hp = {};
        }
        this.system.attributes.hp.value = currentWounds;
        this.system.attributes.hp.max = maxWounds;
        if (this.system.attributes.hp.min === undefined) {
            this.system.attributes.hp.min = 0;
        }
    }

    _computeCharacteristics() {
        let middle = Object.values(this.characteristics).length / 2;
        // Какие характеристики книга вообще знает. Пустой список — знает все.
        const absentCharacteristics = Dh.rulesetFor(this).characteristics?.absent ?? [];
        let i = 0;
        // Тяжёлый доспех ограничивает Ловкость, которую персонаж вправе считать
        // (DH2, стр. 168). Предел берётся до цикла, потому что зажимать надо
        // сам total: бонус, навыки и передвижение выводятся из него ниже и
        // дальше по prepareDerivedData, и все они должны увидеть ограничение.
        const agilityCap = effectiveMaxAgility(this.items);
        for (let [characteristicKey, characteristic] of Object.entries(this.characteristics)) {
            const tempModifier = Number(characteristic.tempModifier) || 0;
            // Усталость не режет характеристики: правило говорит про проверки.
            // −10 за усталость навешивается в _getActorConditionModifier, поэтому
            // стойкость, бонусы и всё производное остаются нетронутыми.
            characteristic.total = Math.max(characteristic.base + characteristic.advance, 0);
            // «Если Ловкость персонажа выше этого числа, она считается равной ему».
            // Из нескольких надетых предметов действует наименьший предел.
            if (characteristicKey === "agility" && agilityCap !== null) {
                characteristic.total = Math.min(characteristic.total, agilityCap);
            }
            // Книги считают «неестественность» по-разному. Dark Heresy и Black Crusade
            // прибавляют число, Deathwatch УДВАИВАЕТ бонус — «Unnatural Strength (x2)»
            // (стр. 136). Множитель поэтому живёт отдельным полем: прибавку он не
            // отменяет, и при росте характеристики удвоение не отстаёт.
            const multiplier = Number(characteristic.unnaturalMultiplier) || 1;
            const unnatural = Number(characteristic.unnatural) || 0;
            characteristic.bonus = Math.floor(characteristic.total / 10) * multiplier + unnatural;
            characteristic.displayTotal = characteristic.total + tempModifier;
            characteristic.displayBonus = Math.floor(characteristic.displayTotal / 10) * multiplier + unnatural;
            // Характеристику, которой в книге нет, лист не показывает вовсе.
            // У Rogue Trader это Влиятельность: там её место занимает Profit
            // Factor, и он не характеристика, а ресурс династии (стр. 398).
            characteristic.absent = absentCharacteristics.includes(characteristicKey);
            if(Dh.rulesetFor(this).id === 'ow') characteristic.label = characteristicTerm(this,characteristicKey,{localize:key=>game.i18n.localize(key),language:game.i18n.lang,ruleset:'ow'}).label;
            characteristic.isLeft = false;
            characteristic.isRight = false;
            characteristic.advanceCharacteristic = this._getAdvanceCharacteristic(characteristic.advance);
            i++;
        }
        // Колонки делятся по видимым характеристикам, а не по всем: иначе у книги
        // с девятью характеристиками одна колонка осталась бы короче на пустое место.
        const shown = Object.values(this.characteristics).filter(c => !c.absent);
        const half = Math.ceil(shown.length / 2);
        shown.forEach((characteristic, index) => {
            characteristic.isLeft = index < half;
            characteristic.isRight = index >= half;
        });
        // Десятая характеристика — одно поле под двумя именами: у аколита это
        // Влиятельность Империума, у еретика — Дурная слава. Переименовываем здесь,
        // а не в шаблоне, чтобы подпись совпадала везде, где читается label:
        // на листе, в карточке броска и в выпадающем списке характеристик навыка.
        // Решает книга, а не тип листа: аколит, ушедший в Чёрный Крестовый Поход,
        // должен видеть Тёмную славу, а не Влияние.
        if (Dh.rulesetFor(this).id === "bc" && this.characteristics?.influence) {
            this.characteristics.influence.label = "CHARACTERISTIC.INFAMY";
        }
        this.system.insanityBonus = Math.floor(this.insanity / 10);
        this.system.corruptionBonus = Math.floor(this.corruption / 10);
        // Ступень Пути Порчи: на листе полезнее названия, чем голое число — оно
        // говорит, насколько тяжела следующая проверка на Рудименты. Это механика
        // Dark Heresy 2; у еретика Black Crusade ступеней нет, там Порча копится
        // до порогов Даров, поэтому подпись ему не выводится.
        const rules = Dh.rulesetFor(this);
        if (rules.corruption.track === "malignancy") {
            const corruptionStep = Dh.getCorruptionStep(this.corruption);
            this.system.corruptionDegree = corruptionStep.degree;
            this.system.corruptionModifier = corruptionStep.malignancyModifier;
        } else if (rules.corruption.track === "purity") {
            // Порог Чистоты (Deathwatch, стр. 282): до сотни Порча не значит ничего,
            // на сотне брат выбывает. Поэтому здесь не ступень, а два состояния.
            this.system.corruptionDegree = purityBroken(this.corruption)
                ? "CORRUPTION.DEGREE.DAMNED" : "CORRUPTION.DEGREE.PURE";
            this.system.corruptionModifier = 0;
            this.system.purityThreshold = rules.corruption.purityThreshold;
        } else {
            this.system.corruptionDegree = null;
            this.system.corruptionModifier = 0;
        }
        // Deathwatch считает брата по своим меркам: Известность решает, что ему
        // выдадут из арсенала, Проклятие примарха растёт с безумием, а запас
        // Единства отряда идёт от вожака (таблица 7-8). Ранг — от общего опыта,
        // в который входят и 12 000 «кем он уже был» (таблица 2-2).
        if (rules.id === "dw") {
            const watch = this.system.deathwatch ?? {};
            const rank = renownRankFor(watch.renown);
            this.system.renownRank = rank.key;
            this.system.renownLabel = rank.label;
            this.system.primarchsCurse = dwInsanityStep(this.insanity).curse;
            this.system.rank = rankForExperience(backgroundExperienceFor("dw") + (Number(this.experience?.totalSpent) || 0));
            this.system.cohesionSuggested = cohesionPool({
                fellowshipBonus: this.characteristics?.fellowship?.bonus,
                rank: this.system.rank,
                commandAdvance: this.skills?.command?.advance
            });
        }
        // Initialize psy structure if it doesn't exist (for backward compatibility)
        // Structure is: system.psy.rating (flat, as used in createPsychicRollData)
        if (!this.system.psy) {
            this.system.psy = {
                rating: 0,
                sustained: 0,
                class: "bound",
                cost: 0,
                sustainedPowers: {
                    power1: "",
                    power2: "",
                    power3: "",
                    power4: "",
                    power5: "",
                    power6: "",
                    power7: ""
                }
            };
        }
        // Initialize sustainedPowers if it doesn't exist (for backward compatibility)
        if (!this.psy.sustainedPowers) {
            this.psy.sustainedPowers = {
                power1: "",
                power2: "",
                power3: "",
                power4: "",
                power5: "",
                power6: "",
                power7: ""
            };
        }
        // Ensure rating is initialized
        if (this.psy.rating === undefined || this.psy.rating === null) {
            this.psy.rating = 0;
        }
        
        // Calculate sustained powers count (non-empty sustained power fields)
        let sustainedPowersCount = 0;
        for (let key in this.psy.sustainedPowers) {
            if (this.psy.sustainedPowers[key] && this.psy.sustainedPowers[key].trim() !== "") {
                sustainedPowersCount++;
            }
        }
        // Current rating = base rating - sustained (old system) - sustained powers count (new system)
        this.psy.currentRating = this.psy.rating - this.psy.sustained - sustainedPowersCount;
        // Use displayBonus from STATS (the "source of truth") which includes tempModifier
        this.initiative.bonus = this.characteristics[this.initiative.characteristic].displayBonus || this.characteristics[this.initiative.characteristic].bonus;
        // Both bonuses are read off the characteristics rather than recomputed,
        // because characteristic.bonus already folds in the Unnatural addend and
        // the Deathwatch multiplier (see the loop above). Deriving them again
        // from base plus advance silently dropped both, so a creature with
        // Unnatural Toughness tired as fast as a baseline human (DH2 p. 233).
        let tb = Number(this.characteristics.toughness.bonus) || 0;
        let wb = Number(this.characteristics.willpower.bonus) || 0;

        // Derived before the final phase; effects on the threshold are applied by Foundry.
        const fatigueBase = Dh.rulesetFor(this).fatigue.threshold === "tb" ? tb : tb + wb;
        this.fatigue.max = fatigueBase;
    }

    _computeSkills() {
        // Как книга считает необученность. Dark Heresy 2 даёт −20 и пускает
        // ко всему; Rogue Trader делит характеристику пополам и продвинутые
        // навыки запирает совсем.
        const skillModel = Dh.rulesetFor(this).skills?.model ?? "dh2";
        // Навык, которого в книге нет, лист не показывает. Хранится он всё
        // равно: персонажа можно перевести на другую книгу, не пересоздавая.
        const absentSkills = Dh.rulesetFor(this).skills?.absent ?? [];
        for (let [skillKey, skill] of Object.entries(this.skills)) {
            let short = skill.characteristics[0];
            let characteristic = this._findCharacteristic(short);
            const baseTotal = characteristic.displayTotal ?? characteristic.total;
            // Ensure advance is a number (handle undefined, null, string, etc.)
            const advanceValue = Number(skill.advance) || 0;
            skill.total = baseTotal + advanceValue;
            skill.absent = absentSkills.includes(skillKey);

            // Rogue Trader считает необученность иначе (Таблица 9-1, стр. 231):
            // базовый навык идёт на половине характеристики с округлением ВНИЗ —
            // книга оговаривает это прямо, вопреки общему правилу округления
            // вверх, — а продвинутым без обучения пользоваться нельзя вообще.
            if (skillModel === "basicAdvanced") {
                const type = rtSkillType(skillKey);
                const rt = rtSkillBase({characteristic: baseTotal, advance: advanceValue, type});
                skill.total = rt.base;
                skill.untrainedType = type;
                skill.unusable = !rt.usable;
            }
            
            // Парирование зависит от того, чем персонаж держит оборону:
            // Несбалансированное мешает (−10), Сбалансированное помогает (+10),
            // Защитное для того и сделано (+15). BC, стр. 149–153.
            //
            // Бонус Сбалансированного даётся один раз, даже если в руках два
            // таких клинка, — поэтому смотрим на первое надетое оружие, а не
            // складываем по всем.
            if (skillKey === "parry" && this.items) {
                const equippedMeleeWeapon = this.items.find(item => {
                    return item.type === "weapon"
                        && item.system?.equipped === true
                        && (item.system?.class === "melee" || item.class === "melee");
                });

                if (equippedMeleeWeapon) {
                    const weaponSpecial = equippedMeleeWeapon.system?.special || equippedMeleeWeapon.special || "";
                    if (weaponSpecial || equippedMeleeWeapon.system?.traitOverrides) {
                        const weaponTraits = DarkHeresyUtil.extractWeaponTraits(weaponSpecial, equippedMeleeWeapon.system?.traitOverrides);
                        if (weaponTraits.unbalanced) skill.total -= 10;
                        if (weaponTraits.balanced) skill.total += 10;
                        if (weaponTraits.defensive) skill.total += 15;
                    }
                }
            }
            
            skill.advanceSkill = this._getAdvanceSkill(advanceValue);
            Object.assign(skill, this._getAdvanceDescriptor(advanceValue));
            if (skill.isSpecialist) {
                // Get the skill key to find template data
                const skillKey = Object.keys(this.skills).find(key => this.skills[key] === skill);
                
                // Load template data to check for missing specialities
                const templateData = game.darkHeresy?.templateData || {};
                const templateSpecialities = templateData?.Actor?.templates?.skills?.skills?.[skillKey]?.specialities || {};
                
                // Add missing specialities from template and ensure label is preserved
                if (Object.keys(templateSpecialities).length > 0) {
                    for (let [specKey, specTemplate] of Object.entries(templateSpecialities)) {
                        if (!skill.specialities[specKey]) {
                            // Initialize missing speciality with template data
                            skill.specialities[specKey] = foundry.utils.deepClone(specTemplate);
                        } else {
                            // Ensure label exists (preserve existing or add from template)
                            if (!skill.specialities[specKey].label && specTemplate.label) {
                                skill.specialities[specKey].label = specTemplate.label;
                            }
                        }
                    }
                }
                
                // Fallback: Add new Common Lore specialities if template not loaded
                if (skillKey === "commonLore" && (!templateData || Object.keys(templateData).length === 0)) {
                    const newSpecialities = {
                        koronusExpanse: { label: "Koronus Expanse", advance: -20, starter: false, cost: 0 },
                        jerichoReach: { label: "Jericho Reach", advance: -20, starter: false, cost: 0 },
                        screamingVortex: { label: "Screaming Vortex", advance: -20, starter: false, cost: 0 },
                        calixisSector: { label: "Calixis Sector", advance: -20, starter: false, cost: 0 }
                    };
                    for (let [specKey, specData] of Object.entries(newSpecialities)) {
                        if (!skill.specialities[specKey]) {
                            skill.specialities[specKey] = foundry.utils.deepClone(specData);
                        } else {
                            // Ensure label exists
                            if (!skill.specialities[specKey].label) {
                                skill.specialities[specKey].label = specData.label;
                            }
                        }
                    }
                }
                
                for (let speciality of Object.values(skill.specialities)) {
                    // A speciality may name its own characteristic. Template groups do
                    // not - Common Lore is Intelligence throughout - but a skill somebody
                    // added by hand is its own thing, and every one of them used to be
                    // stuck with whatever characteristic the first one happened to set.
                    const specialityShort = speciality.characteristics?.[0];
                    const specialityCharacteristic = specialityShort
                        ? this._findCharacteristic(specialityShort)
                        : characteristic;
                    speciality.characteristicShort = specialityShort ?? short;
                    // Use displayTotal from STATS (the "source of truth") which includes tempModifier
                    const baseTotal = specialityCharacteristic.displayTotal ?? specialityCharacteristic.total;
                    // Ensure advance is a number (handle undefined, null, string, etc.)
                    const advanceValue = Number(speciality.advance) || 0;
                    speciality.total = baseTotal + advanceValue;
                    // Специализация наследует тип своей группы: Общие знания у
                    // Rogue Trader продвинутые, значит и «Общие знания (Империум)»
                    // без обучения не бросаются. Считать их по чужой модели значило
                    // бы обойти запрет через подпункт.
                    if (skillModel === "basicAdvanced") {
                        const type = rtSkillType(skillKey);
                        const rt = rtSkillBase({characteristic: baseTotal, advance: advanceValue, type});
                        speciality.total = rt.base;
                        speciality.untrainedType = type;
                        speciality.unusable = !rt.usable;
                    }
                    speciality.advanceSpec = this._getAdvanceSkill(advanceValue);
                    Object.assign(speciality, this._getAdvanceDescriptor(advanceValue));
                    
                    // Check if this speciality should be shown in the list
                    // Show if advance >= 0 (Known or higher), OR if advance = -20 (Untrained) and starter checkbox is checked
                    const isUntrained = advanceValue === -20;
                    const isKnownOrHigher = advanceValue >= 0;
                    const hasStarter = speciality.starter === true;
                    // The template groups ship dozens of specialities each, so hiding
                    // the untrained ones keeps those lists readable. A custom skill has
                    // no template behind it - somebody typed it in by hand - so hiding
                    // it means adding a skill appears to do nothing at all.
                    const isHandAdded = skillKey === "custom";

                    if (isKnownOrHigher || isHandAdded) {
                        // Known or higher - always show
                        speciality.isKnown = true;
                    } else if (isUntrained && hasStarter) {
                        // Untrained with starter checkbox checked - show it
                        speciality.isKnown = true;
                    } else {
                        // Not shown (Untrained without starter checkbox, or other negative values)
                        speciality.isKnown = false;
                    }
                }
                // Whether the group has anything to show. Handlebars cannot count a
                // filtered list, so without this every specialist group rendered its
                // heading regardless - eight empty panels on a fresh character.
                skill.hasKnownSpecialities = Object.values(skill.specialities)
                    .some(speciality => speciality.isKnown);
            }
        }
    }

    _computeItems() {
        let encumbrance = 0;
        for (let item of this.items) {

            if (item.weight) {
                encumbrance += Number(item.weight) * Number(item.system.quantity ?? 1);
            }
        }
        this._computeEncumbrance(encumbrance);
        this._applyWeaponModifications();
    }

    /**
     * Навесить установленные модификации на оружие (BC, стр. 169–172).
     *
     * Мод — отдельный предмет в инвентаре, привязанный к стволу через
     * `system.weaponId`. Вложить его внутрь оружия нельзя: Foundry не умеет
     * предметы в предметах, а Active Effect на встроенном документе не переживёт
     * передачу ствола другому персонажу.
     *
     * Каждый пересчёт начинается с исходных данных оружия (`_source`), а не с
     * того, что осталось от прошлого раза. В legacy-схеме `prepareData` не
     * восстанавливает `system` предмета из базы, поэтому наращивание «прибавим
     * ещё раз» превращало +2 к пробитию в +2+2 при втором же пересчёте — а он
     * случается при любом обновлении актёра.
     */
    _applyWeaponModifications() {
        const mods = this.items.filter(item =>
            item.type === "weaponModification" && item.system?.installed && item.system?.weaponId);
        if (!mods.length) return;

        // Сгруппируем по стволу: на одном оружии может висеть несколько модов,
        // и пересобрать его надо один раз, начав с профиля из книги.
        const byWeapon = new Map();
        for (const mod of mods) {
            const list = byWeapon.get(mod.system.weaponId) || [];
            list.push(mod);
            byWeapon.set(mod.system.weaponId, list);
        }

        for (const [weaponId, installed] of byWeapon) {
            const weapon = this.items.get(weaponId);
            if (!weapon || weapon.type !== "weapon") continue;

            const base = weapon._source?.system ?? {};
            const sys = weapon.system;

            let damage = String(base.damage ?? "");
            let penetration = String(base.penetration ?? "");
            let attack = Number(base.attack) || 0;
            let range = Number(base.range) || 0;
            let clipMax = Number(base.clip?.max) || 0;
            let special = base.special ?? "";
            let traitOverrides = {...base.traitOverrides};
            let availability = base.availability;

            for (const mod of installed) {
                const effect = mod.system.effect || {};

                // Урон и пробитие — слагаемые в конец формулы: она может быть
                // любой, от "1d10+5" до "2d10", и разбирать её ради сложения незачем.
                const damageBonus = Number(effect.damageBonus) || 0;
                if (damageBonus) damage = `${damage || 0}${damageBonus > 0 ? "+" : ""}${damageBonus}`;

                const penetrationBonus = Number(effect.penetrationBonus) || 0;
                if (penetrationBonus) penetration = `${penetration || 0}${penetrationBonus > 0 ? "+" : ""}${penetrationBonus}`;

                attack += Number(effect.attackBonus) || 0;

                // Множители: пистолетная рукоять режет дальность вдвое, удлинённый
                // магазин удваивает обойму. Единица — «мод сюда не лезет».
                const rangeMultiplier = Number(effect.rangeMultiplier);
                if (rangeMultiplier && rangeMultiplier !== 1) range = Math.round(range * rangeMultiplier);

                const clipMultiplier = Number(effect.clipMultiplier);
                if (clipMultiplier && clipMultiplier !== 1) clipMax = Math.round(clipMax * clipMultiplier);

                special = DarkHeresyUtil.applyTraitEdits(special, effect.addTraits, effect.removeTraits);
                traitOverrides = editTraitOverrides(traitOverrides, effect.addTraits, effect.removeTraits,
                    text => DarkHeresyUtil.extractWeaponTraits(text));

                // Улучшение делает ствол на ступень реже и дороже (стр. 170),
                // ухудшение — наоборот, на ступень доступнее (стр. 172).
                // Поэтому направление задаёт сам мод, а не константа.
                const shift = Number(effect.availabilityShift ?? 1) || 0;
                if (shift) availability = DarkHeresyUtil.shiftAvailability(availability, shift);
            }

            sys.damage = damage;
            sys.penetration = penetration;
            sys.attack = attack;
            sys.range = range;
            if (sys.clip) sys.clip.max = clipMax;
            sys.special = special;
            sys.traitOverrides = traitOverrides;
            sys.availability = availability;
        }
    }

    _computeExperience_auto() {
        let config = game.darkHeresy.config;
        let characterAptitudes = this.items.filter(it => it.isAptitude).map(it => ruleName(it).trim());
        if (!characterAptitudes.includes("General")) characterAptitudes.push("General");
        this.experience.spentCharacteristics = 0;
        this.experience.spentSkills = 0;
        this.experience.spentTalents = 0;
        if (this.experience.spentOther == null) this.experience.spentOther = 0;
        this.experience.spentPsychicPowers = 0;
        // Free starting rating is 1, or 2 for a Sanctioned psyker (DH2 p. 138); only the
        // steps above it are paid for, at 200 x the new rating.
        const traits = this.items.filter(item => item.type === "trait");
        this.psy.cost = this.experience.spentPsychicPowers = psyRatingCost(this.psy.rating, psyBase(traits, Dh.rulesetFor(this).id));
        // The ladder is the book's: Only War has four steps where Dark Heresy has five.
        const characteristicCosts = Dh.rulesetFor(this).characteristicCosts ?? config.characteristicCosts;
        // У Rogue Trader склонностей нет вовсе, а цена ступени зависит от самой
        // характеристики и напечатана построчно (стр. 46). Лестница там короче на
        // ступень: четыре вместо пяти.
        const byCharacteristic = Dh.rulesetFor(this).advances?.aptitudes === false;
        for (let [characteristicKey, characteristic] of Object.entries(this.characteristics)) {
            let cost = 0;
            if (byCharacteristic) {
                cost = rtCharacteristicCost(characteristicKey, Math.floor(characteristic.advance / 5));
            } else {
                let matchedAptitudes = characterAptitudes.filter(it => characteristic.aptitudes.includes(it)).length;
                for (let i = 0; i <= characteristic.advance / 5 && i < characteristicCosts.length; i++) {
                    cost += characteristicCosts[i][2 - matchedAptitudes];
                }
            }
            characteristic.cost = cost.toString();
            this.experience.spentCharacteristics += cost;
        }
        for (let skill of Object.values(this.skills)) {
            let matchedAptitudes = characterAptitudes.filter(it => skill.aptitudes.includes(it)).length;
            if (skill.isSpecialist) {
                for (let speciality of Object.values(skill.specialities)) {
                    let cost = 0;
                    for (let i = (speciality.starter ? 1 : 0); i <= speciality.advance / 10; i++) {
                        cost += (i + 1) * (3 - matchedAptitudes) * 100;
                    }
                    speciality.cost = cost;
                    this.experience.spentSkills += cost;
                }
            } else {
                let cost = 0;
                for (let i = (skill.starter ? 1 : 0); i <= skill.advance / 10; i++) {
                    cost += (i + 1) * (3 - matchedAptitudes) * 100;
                }
                skill.cost = cost;
                this.experience.spentSkills += cost;
            }
        }
        // Sum cost from items that have cost field (excluding equipment types)
        // Items with cost: aptitude, criticalInjury, malignancy, mentalDisorder, mutation, 
        // specialAbility, trait, talent, psychicPower
        // Items without cost: weapon, weaponModification, ammunition, armour, forceField, 
        // gear, drug, tool, cybernetic
        let itemsOtherCost = 0;
        for (let item of this.items) {
            if (item.isTalent) {
                let talentAptitudes = item.aptitudes.split(",").map(it => it.trim());
                let matchedAptitudes = characterAptitudes.filter(it => talentAptitudes.includes(it)).length;
                let cost = 0;
                let tier = parseInt(item.tier);
                if (!item.system.starter && tier >= 1 && tier <= 3) {
                    cost = config.talentCosts[tier - 1][2 - matchedAptitudes];
                }
                item.system.cost = cost.toString();
                this.experience.spentTalents += cost;
            } else if (item.isPsychicPower) {
                this.experience.spentPsychicPowers += parseInt(item.cost, 10);
            } else if (["aptitude", "criticalInjury", "malignancy", "mentalDisorder", 
                        "mutation", "specialAbility", "trait"].includes(item.type)) {
                // All other items with cost field go to "Spent on Other"
                const itemCost = parseInt(item.system?.cost || 0, 10);
                itemsOtherCost += itemCost;
            }
        }
        // Set minimum value: if itemsOtherCost > 0, use it; otherwise keep existing spentOther
        this.experience.spentOther = Math.max(itemsOtherCost, this.experience.spentOther || 0);
        this.experience.totalSpent = this.experience.spentCharacteristics
      + this.experience.spentSkills
      + this.experience.spentTalents
      + this.experience.spentPsychicPowers
      + this.experience.spentOther;
        this.experience.remaining = this.experience.value - this.experience.totalSpent;
    }

    _computeExperience_normal() {
        this.experience.spentCharacteristics = 0;
        this.experience.spentSkills = 0;
        this.experience.spentTalents = 0;
        if (this.experience.spentOther == null) this.experience.spentOther = 0;
        this.experience.spentPsychicPowers = this.psy.cost;
        for (let characteristic of Object.values(this.characteristics)) {
            this.experience.spentCharacteristics += parseInt(characteristic.cost, 10);
        }
        for (let skill of Object.values(this.skills)) {
            if (skill.isSpecialist) {
                for (let speciality of Object.values(skill.specialities)) {
                    this.experience.spentSkills += parseInt(speciality.cost, 10);
                }
            } else {
                this.experience.spentSkills += parseInt(skill.cost, 10);
            }
        }
        // Sum cost from items that have cost field (excluding equipment types)
        // Items with cost: aptitude, criticalInjury, malignancy, mentalDisorder, mutation, 
        // specialAbility, trait, talent, psychicPower
        // Items without cost: weapon, weaponModification, ammunition, armour, forceField, 
        // gear, drug, tool, cybernetic
        let itemsOtherCost = 0;
        for (let item of this.items) {
            if (item.isTalent) {
                this.experience.spentTalents += parseInt(item.cost, 10);
            } else if (item.isPsychicPower) {
                this.experience.spentPsychicPowers += parseInt(item.cost, 10);
            } else if (["aptitude", "criticalInjury", "malignancy", "mentalDisorder", 
                        "mutation", "specialAbility", "trait"].includes(item.type)) {
                // All other items with cost field go to "Spent on Other"
                const itemCost = parseInt(item.system?.cost || 0, 10);
                itemsOtherCost += itemCost;
            }
        }
        // Set minimum value: if itemsOtherCost > 0, use it; otherwise keep existing spentOther
        this.experience.spentOther = Math.max(itemsOtherCost, this.experience.spentOther || 0);
        this.experience.totalSpent = this.experience.spentCharacteristics
      + this.experience.spentSkills
      + this.experience.spentTalents
      + this.experience.spentPsychicPowers
      + this.experience.spentOther;
        this.experience.remaining = this.experience.value - this.experience.totalSpent;
    }

    _computeExperience() {
        if (!game.settings.get("dark-heresy", "autoCalcXPCosts")) return this._computeExperience_normal();
        // У еретика цену задаёт не аптитьюд, а бог: считать его по таблицам
        // Dark Heresy бессмысленно, там нет ни одного совпадающего числа.
        if (Dh.rulesetFor(this).id === "bc") return this._computeExperienceBlackCrusade();
        return this._computeExperience_auto();
    }

    /**
     * Сколько рангов умения выданы даром.
     *
     * Галочка `starter` в схеме одна на умение, а архетип иногда выдаёт умение
     * сразу с +10 — это два ранга, и оба бесплатны. Сколько именно выдано,
     * помнит флаг, поставленный при раздаче архетипа; без него галочка означает
     * привычный один ранг.
     * @param {string} key
     * @param {object} entry
     * @returns {number}
     */
    _starterRanks(key, entry) {
        if (!entry.starter) return 0;
        const granted = this.getFlag("dark-heresy", "starterRanks")?.[key];
        return Math.max(Number(granted) || 1, 1);
    }

    /**
     * Счёт улучшений по богам (Black Crusade, стр. 74–75).
     *
     * Каждая прибавка +5 к характеристике, каждый ранг умения и каждый талант
     * считаются одним очком принадлежности своему богу. Улучшения, доставшиеся
     * от расы и архетипа, не в счёт — их отмечает `starter`. Характеристикам
     * такой отметки в схеме нет, поэтому стартовые значения для них должны
     * лежать в `base`, а не в `advance`.
     *
     * Считается из листа, а не копится в поле: любая правка задним числом иначе
     * разошлась бы со счётчиком, и его пришлось бы сводить руками.
     */
    _computeAlignment() {
        if (this.type !== "heretic") return;
        const counts = { khorne: 0, nurgle: 0, slaanesh: 0, tzeentch: 0 };
        const add = (god, amount) => { if (god && god in counts) counts[god] += amount; };

        for (const [key, characteristic] of Object.entries(this.characteristics)) {
            if (key === "influence") continue;
            add(Dh.bcCharacteristicPatrons[key], Math.floor((Number(characteristic.advance) || 0) / 5));
        }

        for (const [key, skill] of Object.entries(this.skills)) {
            const god = Dh.bcSkillPatrons[key];
            if (!god) continue;
            // Ранги, доставшиеся от архетипа, принадлежности не дают.
            const bought = (entry, entryKey) => Math.max(_skillRanks(entry) - this._starterRanks(entryKey, entry), 0);
            if (skill.isSpecialist) {
                for (const [specialityKey, speciality] of Object.entries(skill.specialities)) {
                    add(god, bought(speciality, `${key}.${specialityKey}`));
                }
            } else {
                add(god, bought(skill, key));
            }
        }

        for (const item of this.items) {
            // Психосилы приобретаются как таланты и так же добавляют
            // принадлежность своему богу (стр. 78).
            if (!item.isTalent && !item.isPsychicPower) continue;
            if (item.system.starter) continue;
            add(patronOf(item), 1);
        }

        this.system.alignmentCounts = counts;
        // Поверх расчёта лежит ручная поправка. Она нужна, потому что счёт с
        // листа полон ровно настолько, насколько размечены карточки: у таланта
        // или психосилы из чужого компендиума покровителя может не быть вовсе,
        // и тогда улучшение молча уходит Хаосу Неделимому. Поправка переживает
        // любой пересчёт, поэтому исправленное однажды не приходится чинить снова.
        const manual = this.system.alignment ?? {};
        const totals = {};
        for (const god of Object.keys(counts)) {
            totals[god] = counts[god] + (Number(manual[god]) || 0);
        }
        this.system.alignmentTotals = totals;

        // Кому персонаж принадлежит по счёту: тот, кто оторвался от каждого
        // из остальных на пять улучшений. Пока такого нет — Хаос Неделимый.
        // Улучшения самого Неделимого принадлежности не дают, поэтому и счётчика
        // у него нет: непристроившимся становятся не по очкам, а по их отсутствию.
        this.system.alignmentLeader = alignmentLeader(totals);
    }

    /**
     * Цены улучшений Чёрного Крестового Похода (стр. 77–78).
     *
     * Каждое улучшение связано с богом, и цена зависит от того, свой он
     * покровителю персонажа, союзный или враждебный. Оплата накопительная:
     * четвёртый уровень стоит суммы всех четырёх, а не только своей строки.
     */
    _computeExperienceBlackCrusade() {
        const patron = this.system.patron || "undivided";
        const relations = Dh.patronRelations[patron] ?? Dh.patronRelations.undivided;
        const relationTo = god => relations[god] ?? "ally";

        this.experience.spentCharacteristics = 0;
        this.experience.spentSkills = 0;
        this.experience.spentTalents = 0;
        this.experience.spentPsychicPowers = 0;
        if (this.experience.spentOther == null) this.experience.spentOther = 0;
        // Пси-рейтинг здесь не считается лестницей, как в Dark Heresy: это талант,
        // который покупают повторно, и он уже посчитан среди талантов.
        this.psy.cost = 0;

        for (const [key, characteristic] of Object.entries(this.characteristics)) {
            const steps = Math.floor((Number(characteristic.advance) || 0) / 5);
            let cost = 0;
            if (key === "influence") {
                // Тёмная слава: ровная цена за каждый шаг, без лестницы уровней.
                cost = steps * Dh.bcInfamyAdvanceCost;
            } else {
                const ladder = Dh.bcCharacteristicCosts[relationTo(Dh.bcCharacteristicPatrons[key] ?? "undivided")];
                for (let i = 0; i < steps && i < ladder.length; i++) cost += ladder[i];
            }
            characteristic.cost = cost.toString();
            this.experience.spentCharacteristics += cost;
        }

        for (const [key, skill] of Object.entries(this.skills)) {
            const ladder = Dh.bcSkillCosts[relationTo(Dh.bcSkillPatrons[key] ?? "undivided")];
            // Умение идёт с −20 (нетренированное) и растёт четырьмя ступенями по +10.
            const priceOf = (entry, entryKey = key) => {
                let cost = 0;
                const from = this._starterRanks(entryKey, entry);
                for (let i = from; i < _skillRanks(entry) && i < ladder.length; i++) cost += ladder[i];
                return cost;
            };
            if (skill.isSpecialist) {
                for (const [specialityKey, speciality] of Object.entries(skill.specialities)) {
                    speciality.cost = priceOf(speciality, `${key}.${specialityKey}`);
                    this.experience.spentSkills += speciality.cost;
                }
            } else {
                skill.cost = priceOf(skill);
                this.experience.spentSkills += skill.cost;
            }
        }

        let itemsOtherCost = 0;
        for (const item of this.items) {
            if (item.isTalent) {
                const tier = parseInt(item.tier, 10);
                let cost = 0;
                if (!item.system.starter && tier >= 1 && tier <= 3) {
                    const ladder = Dh.bcTalentCosts[relationTo(patronOf(item))];
                    cost = ladder[tier - 1];
                }
                item.system.cost = cost.toString();
                this.experience.spentTalents += cost;
            } else if (item.isPsychicPower) {
                // Психосилы приобретаются как таланты, но цена у каждой своя и
                // записана в самой силе (стр. 78).
                this.experience.spentPsychicPowers += parseInt(item.cost, 10) || 0;
            } else if (["criticalInjury", "malignancy", "mentalDisorder",
                "mutation", "specialAbility", "trait"].includes(item.type)) {
                itemsOtherCost += parseInt(item.system?.cost || 0, 10);
            }
        }

        this.experience.spentOther = Math.max(itemsOtherCost, this.experience.spentOther || 0);
        this.experience.totalSpent = this.experience.spentCharacteristics
            + this.experience.spentSkills
            + this.experience.spentTalents
            + this.experience.spentPsychicPowers
            + this.experience.spentOther;
        this.experience.remaining = this.experience.value - this.experience.totalSpent;
    }

    _computeArmour() {
        let locations = Object.keys(game.darkHeresy.config.hitLocations);
        let toughness = this.characteristics.toughness;

        // Preserve tempModifier values from existing data
        let existingArmour = this.system.armour || {};
        
        // Use displayBonus from STATS (the "source of truth") which includes tempModifier
        // displayBonus = Math.floor((total + tempModifier) / 10) + unnatural
        // This ensures that changes to toughness tempModifier automatically affect armour
        const toughnessBonus = toughness.displayBonus || 0;
        
        this.system.armour = locations
            .reduce((accumulator, location) =>
                Object.assign(accumulator,
                    {
                        [location]: {
                            total: toughnessBonus,
                            toughnessBonus: toughnessBonus,
                            value: 0,
                            tempModifier: existingArmour[location]?.tempModifier ?? 0
                        }
                    }), {});

        // Object for storing the max armour
        let maxArmour = locations
            .reduce((acc, location) =>
                Object.assign(acc, { [location]: 0 }), {});

        // Броню даёт не только доспех. Синскин, силовой ранец и прочее
        // снаряжение книга описывает как «даёт N брони», и раньше эта цифра
        // жила только в описании предмета. Теперь любой надетый предмет с
        // включённым grantsArmour участвует в расчёте наравне с доспехом.
        //
        // Синскин («2 брони на все локации, ещё не защищённые») ложится на
        // правило максимума без единой оговорки: где доспех лучше — считается
        // доспех, где его нет — считается снаряжение.
        const armourSources = this.items
            .filter(item => item.isEquipped)
            .flatMap(item => {
                const sources = [];
                if (item.isArmour) {
                    sources.push({ part: item.part || {}, isAdditive: !!item.isAdditive });
                }
                const granted = item.system?.grantsArmour;
                if (granted?.enabled) {
                    sources.push({ part: granted.part || {}, isAdditive: !!granted.isAdditive });
                }
                return sources;
            });

        // Броню дают и черты существа: Machine (X) и Природная броня (X) добавляют
        // очки на все локации и складываются с надетым доспехом, но не друг с
        // другом — берётся большая из двух (DH2, стр. 136-137). Черта не носится,
        // поэтому в armourSources она попадает отдельно от фильтра надетого.
        const fromTraits = traitArmour(this.items);
        if (fromTraits.value > 0) {
            const part = locations.reduce((acc, location) =>
                Object.assign(acc, { [location]: fromTraits.value }), {});
            armourSources.push({ part, isAdditive: true });
        }

        // For each item, find the maximum armour val per location (only equipped items)
        armourSources
            .filter(source => !source.isAdditive)
            .reduce((acc, armour) => {
                locations.forEach(location => {
                    let armourVal = armour.part[location] || 0;
                    if (armourVal > acc[location]) {
                        acc[location] = armourVal;
                    }
                });
                return acc;
            }, maxArmour);

        armourSources
            .filter(source => source.isAdditive)
            .forEach(armour => {
                locations.forEach(location => {
                    let armourVal = armour.part[location] || 0;
                    maxArmour[location] += armourVal;
                });
            });

        this.armour.head.value = maxArmour.head;
        this.armour.leftArm.value = maxArmour.leftArm;
        this.armour.rightArm.value = maxArmour.rightArm;
        this.armour.body.value = maxArmour.body;
        this.armour.leftLeg.value = maxArmour.leftLeg;
        this.armour.rightLeg.value = maxArmour.rightLeg;

        // Calculate total including temporary modifiers
        this.armour.head.total = this.armour.head.toughnessBonus + this.armour.head.value + (this.armour.head.tempModifier || 0);
        this.armour.leftArm.total = this.armour.leftArm.toughnessBonus + this.armour.leftArm.value + (this.armour.leftArm.tempModifier || 0);
        this.armour.rightArm.total = this.armour.rightArm.toughnessBonus + this.armour.rightArm.value + (this.armour.rightArm.tempModifier || 0);
        this.armour.body.total = this.armour.body.toughnessBonus + this.armour.body.value + (this.armour.body.tempModifier || 0);
        this.armour.leftLeg.total = this.armour.leftLeg.toughnessBonus + this.armour.leftLeg.value + (this.armour.leftLeg.tempModifier || 0);
        this.armour.rightLeg.total = this.armour.rightLeg.toughnessBonus + this.armour.rightLeg.value + (this.armour.rightLeg.tempModifier || 0);
    }

    _computeMovement() {
        let agility = this.characteristics.agility;
        let size = this.size;
        const bonus = this.system.movementBonus || {};
        // Use displayBonus from STATS (the "source of truth") which includes tempModifier
        const base = (agility.displayBonus || agility.bonus) + size - 4;
        const halfBonus = Number(bonus.half) || 0;
        const fullBonus = Number(bonus.full) || 0;
        const chargeBonus = Number(bonus.charge) || 0;
        const runBonus = Number(bonus.run) || 0;
        // movement is not in template.json either, and this assignment replaced the
        // whole object, so all five advertised system.movement.* keys were dead. They
        // now land, alongside the movementBonus.* route that already worked.
        // Прыжки считаются от Силы, а не от Ловкости, и шага потому не имеют:
        // прыжок в длину с места равен бонусу Силы в метрах, вверх — 20 см на
        // бонус (Rogue Trader, стр. 268). Их печатает лист Rogue Trader; на эти
        // ключи никто, кроме него, не смотрит.
        const strengthBonus = this.characteristics.strength.displayBonus
            || this.characteristics.strength.bonus;
        const leaps = baseLeapAndJump(strengthBonus);
        this.system.movement = {
            half: base + halfBonus,
            full: (base * 2) + fullBonus,
            charge: (base * 3) + chargeBonus,
            run: (base * 6) + runBonus,
            leap: leaps.leap,
            jump: leaps.jump
        };
    }

    _findCharacteristic(short) {
        for (let characteristic of Object.values(this.characteristics)) {
            if (characteristic.short === short) {
                return characteristic;
            }
        }
        return { total: 0 };
    }

    _computeEncumbrance(encumbrance) {
        // Use displayBonus from STATS (the "source of truth") which includes tempModifier
        const attributeBonus = (this.characteristics.strength.displayBonus || this.characteristics.strength.bonus) + (this.characteristics.toughness.displayBonus || this.characteristics.toughness.bonus);
        // encumbrance is absent from template.json - it is built here on every prepare -
        // so effects had nothing to attach to at base time, and replacing the whole
        // object threw away anything applyActiveEffects had written.
        //
        // Лестница теперь живёт таблицей в отдельном модуле: там же стоят два столбца,
        // которых здесь не считалось вовсе — подъём и толкание (таблица 9-33). Предел
        // переноски остался тем же числом, что и был: другие книги ничего не заметят.
        const limits = carryingLimits(attributeBonus);
        this.system.encumbrance = {
            max: limits.carry,
            value: encumbrance,
            lift: limits.lift,
            push: limits.push
        };
    }


    _getAdvanceCharacteristic(characteristic) {
        switch (characteristic || 0) {
            case 0:
                return "N";
            case 5:
                return "S";
            case 10:
                return "I";
            case 15:
                return "T";
            case 20:
                return "P";
            case 25:
                return "E";
            default:
                return "N";
        }
    }

    _getAdvanceSkill(skill) {
        switch (skill || 0) {
            case -20:
                return "U";
            case 0:
                return "K";
            case 10:
                return "T";
            case 20:
                return "E";
            case 30:
                return "V";
            default:
                return "U";
        }
    }

    /**
     * Proficiency spelled out, plus the state a chip should wear.
     * A single letter - U, K, T - only reads to someone who already knows the scale,
     * and meaning is never allowed to rest on a colour alone, so the word travels
     * with the tint.
     * Keys are prefixed because these merge onto the skill, which already owns a
     * `label` of its own - the skill's name.
     * @param {number} advance
     * @returns {{advanceLabel: string, advanceState: string}}
     */
    _getAdvanceDescriptor(advance) {
        switch (Number(advance) || 0) {
            case 0:
                return { advanceLabel: "ADVANCE.KNOWN", advanceState: "known" };
            case 10:
                return { advanceLabel: "ADVANCE.TRAINED", advanceState: "trained" };
            case 20:
                return { advanceLabel: "ADVANCE.EXPERIENCED", advanceState: "experienced" };
            case 30:
                return { advanceLabel: "ADVANCE.VETERAN", advanceState: "veteran" };
            default:
                return { advanceLabel: "ADVANCE.UNTRAINED", advanceState: "untrained" };
        }
    }

    /**
     * Preview how damage would be applied without updating the actor.
     * @param {object[]} damages
     * @returns {{damageTaken: object[], wounds: number, criticalWounds: number}}
     */
    previewDamage(damages) {
        if (this.type === "vehicle") return this._previewVehicleDamage(damages);

        // У орды нет ни ран, ни критов — только величина, поэтому разбирать урон
        // по локациям здесь нечего: карточка покажет потери.
        const horde = Number(this.horde) || 0;
        if (horde > 0) {
            const kills = Math.min(this._computeHordeKills(damages), horde);
            return { damageTaken: [], hordeKills: kills, hordeBefore: horde, hordeAfter: horde - kills };
        }

        let wounds = this.wounds.value;
        let criticalWounds = this.wounds.critical;
        const damageTaken = [];
        const maxWounds = this.wounds.max;

        for (const damage of damages) {
            const weaponTraits = damage.weaponTraits || {};
            let armour = this._getEffectiveArmour(damage);
            const damageAmount = Number(damage.amount) || 0;
            let woundsToAdd = Math.max(damageAmount - armour, 0);

            if (damage.righteousFury && woundsToAdd === 0) {
                woundsToAdd = 1;
            } else if (damage.righteousFury) {
                this._recordDamage(damageTaken, damage.righteousFury, damage, "Critical Effect (RF)");
            }

            if (wounds === maxWounds) {
                criticalWounds += woundsToAdd;
                this._recordDamage(damageTaken, woundsToAdd, damage, "Critical");
            } else if (wounds + woundsToAdd > maxWounds) {
                this._recordDamage(damageTaken, maxWounds - wounds, damage, "Wounds");

                woundsToAdd = (wounds + woundsToAdd) - maxWounds;
                criticalWounds += woundsToAdd;
                wounds = maxWounds;
                this._recordDamage(damageTaken, woundsToAdd, damage, "Critical");
            } else {
                this._recordDamage(damageTaken, woundsToAdd, damage, "Wounds");
                wounds += woundsToAdd;
            }
        }

        return { damageTaken, wounds, criticalWounds };
    }

    /**
     * Броня той стороны, в которую пришлась атака.
     *
     * Правило простое и всего с двумя оговорками: сверху и снизу машину бьют
     * по корме, а попадание в турель считается попаданием в лоб — под ней та же
     * толстая плита. Всё остальное берётся по стороне как есть.
     * @param {string} facing
     * @param {string} [zone]
     * @returns {number}
     */
    _vehicleArmour(facing, zone) {
        const armour = this.system.armour ?? {};
        if (zone === "turret") return Number(armour.front) || 0;
        const key = (facing === "above" || facing === "below") ? "rear" : facing;
        return Number(armour[key in armour ? key : "front"]) || 0;
    }

    /**
     * Посчитать, как урон ляжет на машину, ничего не записывая.
     *
     * Целостность работает как раны: сначала уходит она, а всё, что осталось
     * после её обнуления, ложится Критическим Уроном. Праведная Ярость по
     * машинам Критическим Уроном не считается — она бросается по своей таблице
     * и в счёт не идёт, поэтому здесь только отмечается.
     * @param {object[]} damages
     * @returns {{damageTaken: object[], integrity: number, critical: number}}
     */
    _previewVehicleDamage(damages) {
        const sys = this.system;
        let integrity = Number(sys.integrity?.value) || 0;
        let critical = Number(sys.integrity?.critical) || 0;
        const damageTaken = [];

        for (const damage of damages) {
            const penetration = Number(damage.penetration) || 0;
            const facing = damage.facing || damage.location || "front";
            const zone = damage.zone || "hull";

            // Детонация внутри машины считается не уроном по броне и целостности,
            // а сразу Критическим Уроном (Табл. 8-32): «suffers 8 Critical Damage
            // (ignoring Armour)». Целостность при этом не трогается вовсе.
            if (damage.directCritical) {
                const straight = Number(damage.amount) || 0;
                if (straight > 0) {
                    critical += straight;
                    this._recordDamage(damageTaken, straight,
                        { ...damage, location: zone, facing }, "Vehicle Critical");
                }
                continue;
            }
            const armour = Math.max(this._vehicleArmour(facing, zone) - penetration, 0);
            const amount = Number(damage.amount) || 0;
            let left = Math.max(amount - armour, 0);

            const record = { ...damage, location: zone, facing };
            if (damage.righteousFury) {
                this._recordDamage(damageTaken, damage.righteousFury, record, "Vehicle Critical Effect (RF)");
            }
            if (left <= 0) continue;

            const toIntegrity = Math.min(integrity, left);
            if (toIntegrity > 0) {
                integrity -= toIntegrity;
                left -= toIntegrity;
                this._recordDamage(damageTaken, toIntegrity, record, "Integrity");
            }
            if (left > 0) {
                critical += left;
                this._recordDamage(damageTaken, left, record, "Vehicle Critical");
            }
        }

        return { damageTaken, integrity, critical };
    }

    /**
     * Записать урон машине: целостность, затем Критический Урон.
     * @param {object[]} damages
     * @returns {Promise<Actor>}
     */
    async _applyVehicleDamage(damages) {
        const before = (Number(this.system.integrity?.value) || 0);
        const { damageTaken, integrity, critical } = this._previewVehicleDamage(damages);
        const updates = {
            "system.integrity.value": integrity,
            "system.integrity.critical": critical
        };
        this._suppressWoundsFloat = true;
        let result;
        try {
            result = await this.update(updates);
        } finally {
            delete this._suppressWoundsFloat;
        }
        _showWoundsFloat(this, before - integrity, { invert: true });
        // Урон экипажу система не начисляет: по правилам люди внутри страдают
        // только по конкретным строкам таблицы крита, а её читает МИ. Считать
        // его здесь значило бы выдать экипажу двойную порцию.
        if (!this._suppressCritChat && damageTaken.length) {
            await _showVehicleDamageCard(this, damageTaken, integrity, critical);
        }
        return result;
    }

    /**
     * Apply wounds to the actor, takes into account the armour value
     * and the area of the hit.
     * @param {object[]} damages            Array of damage objects to apply to the Actor
     * @param {number} damages.amount       An amount of damage to sustain
     * @param {string} damages.location     Localised location of the body part taking damage
     * @param {number} damages.penetration  Amount of penetration from the attack
     * @param {string} damages.type         Type of damage
     * @param {number} damages.righteousFury Amount rolled on the righteous fury die, defaults to 0
     * @returns {Promise<Actor>}             A Promise which resolves once the damage has been applied
     */
    /**
     * Сколько бойцов орды выкашивает серия попаданий.
     *
     * Орда меряется величиной, а не ранами: каждое попадание, пробившее броню
     * хотя бы на единицу, снимает одного. Ближний бой с Психосиловым оружием
     * удваивает счёт, Опустошительное добавляет своё сверху. Счёт нужен и при
     * применении урона, и при сборке карточки, поэтому живёт отдельно.
     * @param {object[]} damages
     * @returns {number}
     */
    _computeHordeKills(damages) {
        let kills = 0;
        let anyDamage = false;

        for (const damage of damages) {
            const armour = this._getEffectiveArmour(damage);
            const damageAmount = Number(damage.amount) || 0;
            if (Math.max(damageAmount - armour, 0) > 0) {
                anyDamage = true;
                kills += 1; // Each successful damage penetration = 1 kill
            }
        }

        // Ближнее оружие с Силовым полем снимает на одну магнитуду больше
        // (BC, стр. 350). Раньше здесь удваивался счёт и по качеству Force —
        // ни величина, ни качество правилу не соответствовали.
        if (damages?.[0]?.weaponClass === "melee" && kills > 0
            && damages[0].weaponTraits?.powerField === true) {
            kills += 1;
        }

        // Apply devastating weapon trait: additional horde size reduction on successful hit
        if (anyDamage && damages?.[0]?.devastating) {
            kills += Number(damages[0].devastating) || 0;
        }

        return kills;
    }

    async applyDamage(damages) {
        if (this.type === "vehicle") return this._applyVehicleDamage(damages);
        // Use getter to get horde value from token if available
        const currentHorde = Number(this.horde) || 0;
        if (currentHorde > 0) {
            const beforeHorde = currentHorde;
            const kills = this._computeHordeKills(damages);

            if (kills <= 0) return this;
            const newHorde = Math.max(beforeHorde - kills, 0);
            this._suppressWoundsFloat = true;
            let result;
            try {
                result = await this.update({ "system.horde": newHorde });
            } finally {
                delete this._suppressWoundsFloat;
            }
            _showWoundsFloat(this, newHorde - beforeHorde, { invert: true });
            return result;
        }

        const beforeTotal = (Number(this.wounds.value) || 0) + (Number(this.wounds.critical) || 0);
        let wounds = this.wounds.value;
        let criticalWounds = this.wounds.critical;
        const damageTaken = [];
        const maxWounds = this.wounds.max;

        // Apply damage from multiple hits
        for (const damage of damages) {
            // Броня против этого попадания: пробитие, Оружие Варпа и Валящее
            // считаются в одном месте (см. _getEffectiveArmour).
            const weaponTraits = damage.weaponTraits || {};
            let armour = this._getEffectiveArmour(damage);
            // Total already includes toughnessBonus, so we just use damage amount directly
            const damageAmount = Number(damage.amount) || 0;

            // Calculate wounds to add, reducing damage by armour after pen
            let woundsToAdd = Math.max(damageAmount - armour, 0);

            // If no wounds inflicted and righteous fury was rolled, attack causes one wound
            if (damage.righteousFury && woundsToAdd === 0) {
                woundsToAdd = 1;
            } else if (damage.righteousFury) {
                // Roll on crit table but don't add critical wounds
                this._recordDamage(damageTaken, damage.righteousFury, damage, "Critical Effect (RF)");
            }

            // Check for critical wounds
            if (wounds === maxWounds) {
                // All new wounds are critical
                criticalWounds += woundsToAdd;
                this._recordDamage(damageTaken, woundsToAdd, damage, "Critical");

            } else if (wounds + woundsToAdd > maxWounds) {
                // Will bring wounds to max and add left overs as crits
                this._recordDamage(damageTaken, maxWounds - wounds, damage, "Wounds");

                woundsToAdd = (wounds + woundsToAdd) - maxWounds;
                criticalWounds += woundsToAdd;
                wounds = maxWounds;
                this._recordDamage(damageTaken, woundsToAdd, damage, "Critical");
            } else {
                this._recordDamage(damageTaken, woundsToAdd, damage, "Wounds");
                wounds += woundsToAdd;
            }
        }

        // Update the Actor
        const updates = {
            "system.wounds.value": wounds,
            "system.wounds.critical": criticalWounds
        };

        // Delegate damage application to a hook
        const allowed = Hooks.call("modifyTokenAttribute", {
            attribute: "wounds.value",
            value: this.wounds.value,
            isDelta: false,
            isBar: true
        }, updates);

        await this._showCritMessage(damageTaken, this.name, wounds, criticalWounds);
        if (allowed === false) return this;
        this._suppressWoundsFloat = true;
        let result;
        try {
            result = await this.update(updates);
        } finally {
            delete this._suppressWoundsFloat;
        }
        const afterTotal = (Number(wounds) || 0) + (Number(criticalWounds) || 0);
        _showWoundsFloat(this, afterTotal - beforeTotal);

        // Раны записаны — теперь по итоговому критическому урону разбираются его
        // эффекты: усталость, состояния и гибель при двойном бонусе стойкости.
        // Порядок важен: ряд таблицы выбирается по накопленному криту, а не по
        // последнему удару, поэтому правила идут после обновления актёра.
        const crit = await applyCriticalRules(this, damageTaken);
        if (crit) await _showCriticalEffectsCard(this, crit);
        
        // Свойства оружия, которые срабатывают после попадания: проверки цели,
        // состояния и добавочный урон. Раньше здесь разбиралось одно Шоковое.
        await _resolveOnHitWeaponEffects(this, damages);

        return result;
    }

    /**
     * Check if actor has a condition by key
     * @param {string} key - Condition key (id)
     * @returns {ActiveEffect|undefined} - The effect if found, undefined otherwise
     */
    hasCondition(key) {
        return Array.from(this.allApplicableEffects()).find(effect =>
            effect.active && (_effectConditionKey(effect) === key || _effectStatuses(effect).includes(key))
        );
    }

    /**
     * Add a condition to the actor
     * @param {string} key - Condition key (id)
     * @param {object} options - Options object with type (minor/major)
     * @param {object} mergeData - Additional data to merge into effect
     * @returns {Promise<ActiveEffect>} - The created or updated effect
     */
    async addCondition(key, options = {}, mergeData = {}) {
        const type = options.type || "minor";

        // Замок на время создания. hasCondition читает уже существующие эффекты, а
        // создание асинхронно: два вызова подряд — из таблицы критов и из проверки
        // усталости — успевали пройти проверку оба и навешивали состояние дважды.
        this.__dhConditionLocks ??= new Set();
        if (this.__dhConditionLocks.has(key)) return this.hasCondition(key);
        this.__dhConditionLocks.add(key);
        try {
            return await this._addConditionInner(key, options, type, mergeData);
        } finally {
            this.__dhConditionLocks.delete(key);
        }
    }

    /** @see addCondition */
    async _addConditionInner(key, options, type, mergeData = {}) {
        const existing = this.hasCondition(key);
        let effectData;

        if (existing) {
            // Тяжесть читается из флага: в system её нет и никогда не было.
            const existingType = existing.flags?.["dark-heresy"]?.type || "minor";
            if (existingType === "minor" && type === "major") {
                // Escalate to major
                effectData = DarkHeresyUtil.findEffect(key, "major");
            } else {
                // Already has condition at this level or higher
                return existing;
            }
        } else {
            // Create new condition
            effectData = DarkHeresyUtil.findEffect(key, type);
        }

        if (!effectData) {
            console.warn(`Dark Heresy: Effect not found for key "${key}"`);
            return null;
        }

        // Длительность: из вызова, иначе из умолчания состояния.
        const rounds = Number.isFinite(Number(options.rounds)) ? Number(options.rounds)
                                                               : effectData.rounds;
        if (rounds) effectData.rounds = rounds;

        const createData = DarkHeresyUtil.getCreateData(effectData, key);
        foundry.utils.mergeObject(createData, mergeData);

        const dormant = !existing && this.effects.find(effect =>
            _effectConditionKey(effect) === key || _effectStatuses(effect).includes(key));
        if (dormant) {
            return dormant.update({...createData, disabled: false,
                duration: {...createData.duration, expired: false},
                start: ActiveEffect.getEffectStart()});
        }

        // If existing, update it (escalate minor to major)
        if (existing && (existing.flags?.["dark-heresy"]?.type || "minor") === "minor" && type === "major") {
            return existing.update(createData);
        } else if (!existing) {
            // Постоянный _id: попытка создать то же состояние второй раз упирается в
            // занятый идентификатор и ничего не добавляет.
            createData._id = _conditionDocId(key);
            try {
                const effects = await this.createEmbeddedDocuments("ActiveEffect", [createData], { keepId: true });
                if (effects[0]) return effects[0];
            } catch (err) {
                if (!this.effects.get(createData._id)) throw err;
            }
            return this.effects.get(_conditionDocId(key)) || this.hasCondition(key);
        }

        return existing;
    }

    /**
     * Remove a condition from the actor
     * @param {string} key - Condition key (id)
     * @returns {Promise<ActiveEffect|undefined>} - The deleted or updated effect
     */
    async removeCondition(key) {
        const existing = this.hasCondition(key);
        if (!existing) {
            return;
        }
        // hasCondition умеет вернуть заглушку для состояния, найденного только на
        // токене; у неё нет delete, и вызов падал бы с TypeError.
        if (existing._fromToken) {
            const token = this.getActiveTokens(true)[0];
            if (token?.document) await token.document.toggleActiveEffect?.({ id: key }, { active: false });
            return;
        }

        if (existing.parent?.documentName === "Item") return existing.update({disabled:true});
        const existingType = existing.flags?.["dark-heresy"]?.type || "minor";

        if (existingType === "major") {
            // Downgrade major to minor
            const effectData = DarkHeresyUtil.findEffect(key, "minor");
            if (effectData) {
                const createData = DarkHeresyUtil.getCreateData(effectData, key);
                return existing.update(createData);
            }
        } else {
            // Delete minor condition
            return existing.delete();
        }
    }

    /**
     * Toggle status effect (for compatibility with Foundry VTT standard API)
     * This method is called when status effects are toggled via token or other means
     * It uses the same addCondition/removeCondition logic as the sheet
     * @param {string} statusId - Status effect ID
     * @param {object} [options] - Toggle options passed by core (Token HUD, macros)
     * @param {boolean} [options.active] - Force the status on or off instead of toggling
     * @param {boolean} [options.overlay] - Whether to apply the status as a token overlay
     * @returns {Promise<boolean>} - Whether the status is now active
     */
    async toggleStatusEffect(statusId, {active, overlay=false}={}) {
        // Check if it's a condition from CONFIG.statusEffects
        const statusEffect = CONFIG.statusEffects.find(s => s.id === statusId);
        if (!statusEffect) {
            // Not a condition, use default Foundry behavior
            return super.toggleStatusEffect?.(statusId, {active, overlay}) || false;
        }

        // Use our condition system. Honour an explicit `active` request, otherwise toggle.
        const existing = this.hasCondition(statusId);
        const shouldBeActive = active ?? !existing;
        if (shouldBeActive === !!existing) return shouldBeActive;

        if (shouldBeActive) await this.addCondition(statusId, { type: "minor" });
        else await this.removeCondition(statusId);
        return shouldBeActive;
    }

    /**
     * Records damage to be shown as in chat
     * @param {object[]} damageRolls array to record damages
     * @param {number} damageRolls.damage amount of damage dealt
     * @param {string} damageRolls.source source of the damage e.g. Critical
     * @param {string} damageRolls.location location taking the damage
     * @param {string} damageRolls.type type of the damage
     * @param {number} damage amount of damage dealt
     * @param {object} damageObject damage object containing location and type
     * @param {string} damageObject.location damage location
     * @param {string} damageObject.type damage type
     * @param {string} source source of the damage
     */
    _recordDamage(damageRolls, damage, damageObject, source) {
        damageRolls.push({
            damage,
            source,
            location: damageObject.location,
            type: damageObject.type,
            penetration: damageObject.penetration,
            // У машины сторона решает броню, поэтому запись о попадании без неё
            // неполна; для людей поля просто нет.
            ...(damageObject.facing ? { facing: damageObject.facing } : {})
        });
    }

    /**
     * Gets the armour value not including toughness bonus for a non-localized location string
     * @param {string} location
     * @returns {number} armour value for the location
     */
    _getArmour(location, ignoreWornArmour = false) {
        // Use total directly from character sheet - it already includes toughnessBonus + value + tempModifier
        // This ensures we use the exact value displayed in the UI
        // If ignoreWornArmour is true, only return natural bonus (toughnessBonus + tempModifier), ignoring worn armour (value)
        switch (location) {
            case "ARMOUR.HEAD":
                if (ignoreWornArmour) {
                    return Number((this.armour.head.toughnessBonus || 0) + (this.armour.head.tempModifier || 0));
                }
                return Number(this.armour.head.total || 0);
            case "ARMOUR.LEFT_ARM":
                if (ignoreWornArmour) {
                    return Number((this.armour.leftArm.toughnessBonus || 0) + (this.armour.leftArm.tempModifier || 0));
                }
                return Number(this.armour.leftArm.total || 0);
            case "ARMOUR.RIGHT_ARM":
                if (ignoreWornArmour) {
                    return Number((this.armour.rightArm.toughnessBonus || 0) + (this.armour.rightArm.tempModifier || 0));
                }
                return Number(this.armour.rightArm.total || 0);
            case "ARMOUR.BODY":
                if (ignoreWornArmour) {
                    return Number((this.armour.body.toughnessBonus || 0) + (this.armour.body.tempModifier || 0));
                }
                return Number(this.armour.body.total || 0);
            case "ARMOUR.LEFT_LEG":
                if (ignoreWornArmour) {
                    return Number((this.armour.leftLeg.toughnessBonus || 0) + (this.armour.leftLeg.tempModifier || 0));
                }
                return Number(this.armour.leftLeg.total || 0);
            case "ARMOUR.RIGHT_LEG":
                if (ignoreWornArmour) {
                    return Number((this.armour.rightLeg.toughnessBonus || 0) + (this.armour.rightLeg.tempModifier || 0));
                }
                return Number(this.armour.rightLeg.total || 0);
            default:
                return 0;
        }
    }

    /**
     * Сколько защиты реально осталось против конкретного попадания.
     *
     * Собирает в одном месте всё, что оружие делает с бронёй цели, — раньше эта
     * арифметика была скопирована в четырёх местах, и добавить туда новое
     * свойство означало не забыть ни одну копию:
     *
     * - Пробитие снимает броню обычным вычитанием;
     * - Оружие Варпа игнорирует надетое, оставляя лишь природную защиту;
     * - Валящее (X) срезает Противоестественную стойкость, и только её —
     *   обычный бонус Стойкости остаётся на месте (BC, стр. 150).
     *
     * Ниже нуля защита не уходит: отрицательная броня лечила бы цель.
     * @param {object} damage запись урона с `location`, `penetration`, `weaponTraits`
     * @returns {number}
     */
    _getEffectiveArmour(damage) {
        const traits = damage?.weaponTraits || {};
        const penetration = Number(damage?.penetration) || 0;
        // Пробитие снимает очки брони, но не тело под ней (DH2, стр. 227). На листе
        // у локации одно число — броня вместе с бонусом Стойкости, — и пробитие
        // вычиталось из суммы: выстрел с высоким пробитием съедал и Стойкость.
        const soak = this._getToughnessSoak(damage?.location);
        const protection = this._getArmour(damage?.location, traits.warpWeapon === true);
        let armour = Math.max(protection - soak - penetration, 0) + soak;

        const felling = Number(traits.felling) || 0;
        if (felling > 0) {
            // Валящее оружие снимает НЕЕСТЕСТВЕННУЮ часть стойкости — ту, что бонус
            // получил сверх обычного. У Deathwatch она приходит удвоением, а не
            // прибавкой, поэтому считаем разницу, а не читаем одно поле.
            const toughness = this.system?.characteristics?.toughness ?? {};
            const natural = Math.floor((Number(toughness.total) || 0) / 10);
            const unnatural = Math.max((Number(toughness.bonus) || 0) - natural, 0);
            armour = Math.max(armour - Math.min(felling, unnatural), 0);
        }
        return armour;
    }

    /**
     * Бонус Стойкости, уже сложенный в защиту локации: его пробитие не трогает.
     * @param {string} location ключ локации (`ARMOUR.BODY`)
     * @returns {number}
     */
    _getToughnessSoak(location) {
        const part = {
            "ARMOUR.HEAD": "head", "ARMOUR.LEFT_ARM": "leftArm", "ARMOUR.RIGHT_ARM": "rightArm",
            "ARMOUR.BODY": "body", "ARMOUR.LEFT_LEG": "leftLeg", "ARMOUR.RIGHT_LEG": "rightLeg"
        }[location];
        return Math.max(Number(this.armour?.[part]?.toughnessBonus) || 0, 0);
    }

    _getArmourTotal(location) {
        switch (location) {
            case "ARMOUR.HEAD":
                return this.armour.head.total;
            case "ARMOUR.LEFT_ARM":
                return this.armour.leftArm.total;
            case "ARMOUR.RIGHT_ARM":
                return this.armour.rightArm.total;
            case "ARMOUR.BODY":
                return this.armour.body.total;
            case "ARMOUR.LEFT_LEG":
                return this.armour.leftLeg.total;
            case "ARMOUR.RIGHT_LEG":
                return this.armour.rightLeg.total;
            default:
                return 0;
        }
    }

    /**
     * Helper to show that an effect from the critical table needs to be applied.
     * TODO: This needs styling, rewording and ideally would roll on the crit tables for you
     * @param {object[]} rolls Array of critical rolls
     * @param {number} rolls.damage Damage applied
     * @param {string} rolls.type Letter representing the damage type
     * @param {string} rolls.source What kind of damage represented
     * @param {string} rolls.location Where this damage applied against for armor and AP considerations
     * @param {number} target
     * @param {number} totalWounds
     * @param {number} totalCritWounds
     */
    async _showCritMessage(rolls, target, totalWounds, totalCritWounds) {
        if (rolls.length === 0) return;
        if (this._suppressCritChat) return;
        const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/critical.hbs", {
            rolls,
            target,
            totalWounds,
            totalCritWounds
        });
        const sourceMessageId = this._damageSourceMessageId;
        const flags = sourceMessageId ? { "dark-heresy": { sourceMessageId } } : undefined;
        ChatMessage.create({ content: html, flags });
    }

    get attributeBoni() {
        let boni = [];
        for (let characteristic of Object.values(this.characteristics)) {
            // Use displayBonus from STATS (the "source of truth") which includes tempModifier
            const bonusValue = characteristic.displayBonus || characteristic.bonus;
            boni.push({ regex: new RegExp(`${characteristic.short}B`, "gi"), value: bonusValue });
        }
        return boni;
    }

    get characteristics() {return this.system.characteristics;}

    get skills() { return this.system.skills; }

    get initiative() { return this.system.initiative; }

    get wounds() { return this.system.wounds; }

    /**
     * Provide standard Foundry VTT attributes.hp format for module compatibility (e.g., Health Estimate)
     * Health Estimate module expects hp.value to represent current damage/wounds, not remaining health
     */
    get attributes() {
        const wounds = this.system.wounds || {};
        const maxWounds = Number(wounds.max) || 0;
        const currentWounds = Number(wounds.value) || 0;
        return {
            hp: {
                value: currentWounds,
                max: maxWounds,
                min: 0
            }
        };
    }

    get fatigue() { return this.system.fatigue; }

    get fate() { return this.system.fate; }

    get psy() { return this.system.psy; }

    get bio() { return this.system.bio; }

    get experience() { return this.system.experience; }

    get insanity() { return this.system.insanity; }

    get corruption() { return this.system.corruption; }

    get aptitudes() { return this.system.aptitudes; }

    get size() { return this.system.size; }

    get faction() { return this.system.faction; }

    get subfaction() { return this.system.subfaction; }

    get subtype() { return this.system.type; }

    get threatLevel() { return this.system.threatLevel; }

    get horde() { 
        // Priority: Get horde value from token on canvas if available (token actor instance)
        // This ensures we get the actual horde value from the token, not the base actor
        if (canvas?.ready && this.id) {
            const tokens = canvas.tokens.placeables.filter(t => t.actor?.id === this.id);
            if (tokens.length > 0) {
                // Use token actor's horde value (actual instance on canvas)
                return tokens[0].actor?.system?.horde ?? this.system.horde;
            }
        }
        return this.system.horde; 
    }

    get armour() { return this.system.armour; }

    get encumbrance() { return this.system.encumbrance; }

    get movement() { return this.system.movement; }

}

class DarkHeresyItem extends Item {
    async _preCreate(data, options, user) {
        await super._preCreate(data, options, user);
        // Set default icon if not provided
        if (!data.img && CONFIG.Item.defaultIcons && CONFIG.Item.defaultIcons[data.type]) {
            this.updateSource({ img: CONFIG.Item.defaultIcons[data.type] });
        }
    }

    async sendToChat() {
        // Use the item itself instead of creating a new instance
        const item = this;
        const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/item.hbs", {item, data: item.system});
        const chatData = {
            user: game.user.id,
            rollMode: game.settings.get("core", "rollMode"),
            content: html
        };
        if (["gmroll", "blindroll"].includes(chatData.rollMode)) {
            chatData.whisper = ChatMessage.getWhisperRecipients("GM");
        } else if (chatData.rollMode === "selfroll") {
            chatData.whisper = [game.user];
        }
        await ChatMessage.create(chatData);
    }

    get Clip() { 
        const clip = this.clip || {};
        const value = Number(clip.value) || 0;
        const max = Number(clip.max) || 0;
        if (max === 0) return "-";
        return `${value}/${max}`;
    }

    get RateOfFire() {
        let rof = this.rateOfFire;
        let single = rof.single > 0 ? "S" : "-";
        let burst = rof.burst > 0 ? `${rof.burst}` : "-";
        let full = rof.full > 0 ? `${rof.full}` : "-";
        return `${single}/${burst}/${full}`;
    }

    get DamageTypeShort() {
        switch (this.damageType) {
            case "energy":
                return game.i18n.localize("DAMAGE_TYPE.ENERGY_SHORT");
            case "impact":
                return game.i18n.localize("DAMAGE_TYPE.IMPACT_SHORT");
            case "rending":
                return game.i18n.localize("DAMAGE_TYPE.RENDING_SHORT");
            case "explosive":
                return game.i18n.localize("DAMAGE_TYPE.EXPLOSIVE_SHORT");
            default:
                return game.i18n.localize("DAMAGE_TYPE.IMPACT_SHORT");
        }
    }

    get DamageType() {
        switch (this.damageType) {
            case "energy":
                return game.i18n.localize("DAMAGE_TYPE.ENERGY");
            case "impact":
                return game.i18n.localize("DAMAGE_TYPE.IMPACT");
            case "rending":
                return game.i18n.localize("DAMAGE_TYPE.RENDING");
            case "explosive":
                return game.i18n.localize("DAMAGE_TYPE.EXPLOSIVE");
            default:
                return game.i18n.localize("DAMAGE_TYPE.IMPACT");
        }
    }

    get WeaponClass() {

        switch (this.class) {
            case "melee":
                return game.i18n.localize("WEAPON.MELEE");
            case "thrown":
                return game.i18n.localize("WEAPON.THROWN");
            case "launched":
                return game.i18n.localize("WEAPON.LAUNCHED");
            case "placed":
                return game.i18n.localize("WEAPON.PLACED");
            case "pistol":
                return game.i18n.localize("WEAPON.PISTOL");
            case "basic":
                return game.i18n.localize("WEAPON.BASIC");
            case "heavy":
                return game.i18n.localize("WEAPON.HEAVY");
            case "vehicle":
                return game.i18n.localize("WEAPON.VEHICLE");
            default:
                return game.i18n.localize("WEAPON.MELEE");
        }
    }

    get WeaponType() {

        switch (this.subtype) {
            case "las":
                return game.i18n.localize("WEAPON.LAS");
            case "solidprojectile":
                return game.i18n.localize("WEAPON.SOLIDPROJECTILE");
            case "bolt":
                return game.i18n.localize("WEAPON.BOLT");
            case "melta":
                return game.i18n.localize("WEAPON.MELTA");
            case "plasma":
                return game.i18n.localize("WEAPON.PLASMA");
            case "flame":
                return game.i18n.localize("WEAPON.FLAME");
            case "lowtech":
                return game.i18n.localize("WEAPON.LOWTECH");
            case "launcher":
                return game.i18n.localize("WEAPON.LAUNCHER");
            case "explosive":
                return game.i18n.localize("WEAPON.EXPLOSIVE");
            case "exotic":
                return game.i18n.localize("WEAPON.EXOTIC");
            case "chain":
                return game.i18n.localize("WEAPON.CHAIN");
            case "power":
                return game.i18n.localize("WEAPON.POWER");
            case "shock":
                return game.i18n.localize("WEAPON.SHOCK");
            case "force":
                return game.i18n.localize("WEAPON.FORCE");
            default: return "";
        }
    }

    get Craftsmanship() {
        switch (this.craftsmanship) {
            case "poor":
                return game.i18n.localize("CRAFTSMANSHIP.POOR");
            case "common":
                return game.i18n.localize("CRAFTSMANSHIP.COMMON");
            case "good":
                return game.i18n.localize("CRAFTSMANSHIP.GOOD");
            case "best":
                return game.i18n.localize("CRAFTSMANSHIP.BEST");
            default:
                return game.i18n.localize("CRAFTSMANSHIP.COMMON");
        }
    }

    get Availability() {
        switch (this.availability) {
            case "ubiquitous":
                return game.i18n.localize("AVAILABILITY.UBIQUITOUS");
            case "abundant":
                return game.i18n.localize("AVAILABILITY.ABUNDANT");
            case "plentiful":
                return game.i18n.localize("AVAILABILITY.PLENTIFUL");
            case "common":
                return game.i18n.localize("AVAILABILITY.COMMON");
            case "average":
                return game.i18n.localize("AVAILABILITY.AVERAGE");
            case "scarce":
                return game.i18n.localize("AVAILABILITY.SCARCE");
            case "rare":
                return game.i18n.localize("AVAILABILITY.RARE");
            case "very-rare":
                return game.i18n.localize("AVAILABILITY.VERY_RARE");
            case "extremely-rare":
                return game.i18n.localize("AVAILABILITY.EXTREMELY_RARE");
            case "near-unique":
                return game.i18n.localize("AVAILABILITY.NEAR_UNIQUE");
            case "Unique":
                return game.i18n.localize("AVAILABILITY.UNIQUE");
            default:
                return game.i18n.localize("AVAILABILITY.COMMON");
        }
    }

    get ArmourType() {
        switch (this.subtype) {
            case "basic":
                return game.i18n.localize("ARMOUR_TYPE.BASIC");
            case "flak":
                return game.i18n.localize("ARMOUR_TYPE.FLAK");
            case "mesh":
                return game.i18n.localize("ARMOUR_TYPE.MESH");
            case "carapace":
                return game.i18n.localize("ARMOUR_TYPE.CARAPACE");
            case "power":
                return game.i18n.localize("ARMOUR_TYPE.POWER");
            default:
                return game.i18n.localize("ARMOUR_TYPE.COMMON");
        }
    }

    get Part() {
        let part = this.part;
        let parts = [];
        if (part.head > 0) parts.push(`${game.i18n.localize("ARMOUR.HEAD")} (${part.head})`);
        if (part.leftArm > 0) parts.push(`${game.i18n.localize("ARMOUR.LEFT_ARM")} (${part.leftArm})`);
        if (part.rightArm > 0) parts.push(`${game.i18n.localize("ARMOUR.RIGHT_ARM")} (${part.rightArm})`);
        if (part.body > 0) parts.push(`${game.i18n.localize("ARMOUR.BODY")} (${part.body})`);
        if (part.leftLeg > 0) parts.push(`${game.i18n.localize("ARMOUR.LEFT_LEG")} (${part.leftLeg})`);
        if (part.rightLeg > 0) parts.push(`${game.i18n.localize("ARMOUR.RIGHT_LEG")} (${part.rightLeg})`);
        return parts.join(" / ");
    }

    get PartLocation() {
        switch (this.part) {
            case "head":
                return game.i18n.localize("ARMOUR.HEAD");
            case "leftArm":
                return game.i18n.localize("ARMOUR.LEFT_ARM");
            case "rightArm":
                return game.i18n.localize("ARMOUR.RIGHT_ARM");
            case "body":
                return game.i18n.localize("ARMOUR.BODY");
            case "leftLeg":
                return game.i18n.localize("ARMOUR.LEFT_LEG");
            case "rightLeg":
                return game.i18n.localize("ARMOUR.RIGHT_LEG");
            default:
                return game.i18n.localize("ARMOUR.BODY");
        }
    }

    get PsychicPowerZone() {
        switch (this.damage.zone) {
            case "bolt":
                return game.i18n.localize("PSYCHIC_POWER.BOLT");
            case "barrage":
                return game.i18n.localize("PSYCHIC_POWER.BARRAGE");
            case "storm":
                return game.i18n.localize("PSYCHIC_POWER.STORM");
            default:
                return game.i18n.localize("PSYCHIC_POWER.BOLT");
        }
    }

    get isInstalled() { return this.installed
        ? game.i18n.localize("Yes")
        : game.i18n.localize("No");
    }


    get isMentalDisorder() { return this.type === "mentalDisorder"; }

    get isMalignancy() { return this.type === "malignancy"; }

    get isMutation() { return this.type === "mutation"; }

    get isTalent() { return this.type === "talent"; }

    get isTrait() { return this.type === "trait"; }

    get isAptitude() { return this.type === "aptitude"; }

    get isSpecialAbility() { return this.type === "specialAbility"; }

    get isPsychicPower() { return this.type === "psychicPower"; }

    get isCriticalInjury() { return this.type === "criticalInjury"; }

    get isWeapon() { return this.type === "weapon"; }

    get isArmour() { return this.type === "armour"; }

    get isGear() { return this.type === "gear"; }

    get isDrug() { return this.type === "drug"; }

    get isTool() { return this.type === "tool"; }

    get isCybernetic() { return this.type === "cybernetic"; }

    get isWeaponModification() { return this.type === "weaponModification"; }

    get isAmmunition() { return this.type === "ammunition"; }

    get isForceField() { return this.type === "forceField"; }

    get isEquipped() { return this.system.equipped === true; }

    get isAbilities() { return this.isTalent || this.isTrait || this.isSpecialAbility; }

    get isAdditive() { return this.system.isAdditive; }

    get craftsmanship() { return this.system.craftsmanship;}

    get description() { return this.system.description;}

    get availability() { return this.system.availability;}

    get weight() { return this.system.weight;}

    get quantity() { return this.system.quantity;}

    get weightSum() { return this.system.quantity * this.system.weight;}

    get effect() { return this.system.effect;}

    get weapon() { return this.system.weapon;}

    get source() { return this.system.source;}

    get subtype() { return this.system.type;}

    get part() { return this.system.part;}

    get maxAgility() { return this.system.maxAgility;}

    get installed() { return this.system.installed;}

    get shortDescription() { return this.system.shortDescription;}

    get protectionRating() { return this.system.protectionRating;}

    get overloadChance() { return this.system.overloadChance;}

    get cost() { return this.system.cost;}

    get prerequisite() { return this.system.prerequisite;}

    get action() { return this.system.action;}

    get focusPower() { return this.system.focusPower;}

    get range() { return this.system.range;}

    get sustained() { return this.system.sustained;}

    /**
     * What the focus test actually costs, on one line: the roll and the difficulty
     * it is made against. These were two of nine columns; as a subline under the
     * power's name they stay together, which is how they are read.
     * @returns {string}
     */
    get psychicFocusLine() {
        const parts = [];
        const formula = String(this.system.damage?.formula ?? "").trim();
        if (formula) parts.push(formula);
        const modifier = Number(this.system.focusPower?.difficulty) || 0;
        const key = Dh.difficulties[String(modifier)] ?? Dh.difficulties[modifier];
        if (key) {
            // A true minus sign, not a hyphen: this sits beside data, not in prose.
            const signed = modifier > 0 ? `+${modifier}` : String(modifier).replace("-", "−");
            parts.push(`${game.i18n.localize(key)} (${signed})`);
        }
        return parts.join(" · ");
    }

    get psychicType() { return this.system.subtype;}

    /**
     * Блок «этот предмет ещё и оружие».
     *
     * Кибернетика и снаряжение в книге сплошь и рядом бьют: клинковые шпицы,
     * шипы на доспехе, силовой кулак импланта. Заводить ради этого предмет-двойник
     * типа `weapon` — значит держать два предмета в синхроне руками. Вместо этого
     * профиль удара лежит внутри самого предмета, а геттеры оружия отдают его
     * там, где у настоящего ствола лежат собственные поля.
     * @returns {object|null}
     */
    get grantedAttack() {
        const granted = this.system?.grantsAttack;
        return (granted?.enabled && this.type !== "weapon") ? granted : null;
    }

    get damage() { return this.grantedAttack ? this.grantedAttack.damage : this.system.damage;}

    get benefit() { return this.system.benefit;}

    get prerequisites() { return this.system.prerequisites;}

    get aptitudes() { return this.system.aptitudes;}

    get starter() { return this.system.starter;}

    get tier() { return this.system.tier;}

    get class() { return this.grantedAttack ? this.grantedAttack.class : this.system.class;}

    get rateOfFire() { return this.system.rateOfFire;}

    get damageType() {
        return this.grantedAttack?.damageType
        || this.system.damageType
        || this.system?.damage?.type
        || this.system.effect?.damage?.type
        || this.system.type;
    }

    get penetration() { return this.grantedAttack ? this.grantedAttack.penetration : this.system.penetration;}

    get clip() { return this.system.clip;}

    get reload() { return this.system.reload;}

    get special() { return this.grantedAttack ? this.grantedAttack.special : this.system.special;}

    /**
     * Weapon traits as one line, separated the way the reference sets them.
     * They ride under the weapon's name instead of holding a column of their own,
     * which is what let the name column stay wide enough not to wrap.
     * @returns {string}
     */
    get traitLine() {
        return String(this.system.special || "")
            .split(",")
            .map(trait => trait.trim())
            .filter(trait => trait.length)
            .join(" · ");
    }

    /**
     * Whether the weapon is currently jammed. A jam used to live only on the roll
     * that caused it, so the sheet had no way to show it and no way to clear it.
     * @returns {boolean}
     */
    get jammed() { return !!this.getFlag("dark-heresy", "jammed"); }

    /** Melee weapons have no range or rate of fire to report. @returns {boolean} */
    get isMeleeWeapon() { return this.class === "melee"; }

    /**
     * Figures that do not apply read as an em dash rather than a zero, so a column
     * of numbers never claims a weapon has a range of 0 or fires -/-/- shots.
     * @param {*} value
     * @returns {string}
     */
    static _orDash(value) {
        const text = String(value ?? "").trim();
        if (!text || text === "-" || text === "0") return "—";
        return /[1-9]/.test(text) ? text : "—";
    }

    get rangeDisplay() {
        return this.isMeleeWeapon ? "—" : DarkHeresyItem._orDash(this.system.range);
    }

    get rateOfFireDisplay() {
        if (this.isMeleeWeapon) return "—";
        const rof = DarkHeresyItem._orDash(this.RateOfFire);
        // The absent settings inside a rate read as dashes, not hyphens: "–/3/–".
        return rof === "—" ? rof : rof.replace(/-/g, "–");
    }

    get clipDisplay() {
        if (this.isMeleeWeapon) return "—";
        const clip = this.system.clip || {};
        const max = Number(clip.max) || 0;
        if (!max) return "—";
        return `${Number(clip.value) || 0}/${max}`;
    }

    /**
     * One line describing whatever this item happens to be.
     * The gear tab used to run nine separate tables, one per item type, each with its
     * own header row and its own columns - so nine headers were on screen to read
     * three items. A single list needs a single description column, which means each
     * type has to say what matters about itself in one line.
     * @returns {string}
     */
    get gearSummary() {
        const parts = [];
        switch (this.type) {
            case "weapon":
                parts.push(this.WeaponClass);
                parts.push([this.system.damage, this.DamageTypeShort].filter(Boolean).join(" "));
                break;
            case "armour":
                parts.push(this.Part);
                break;
            case "ammunition":
                parts.push(this.system.type);
                if (Number(this.system.quantity)) parts.push(`×${this.system.quantity}`);
                break;
            case "weaponModification":
                parts.push(this.Craftsmanship);
                parts.push(this.system.upgrades);
                break;
            case "forceField":
                parts.push(this.Craftsmanship);
                if (Number(this.system.protectionRating)) parts.push(`PR ${this.system.protectionRating}`);
                break;
            case "cybernetic":
                parts.push(this.Craftsmanship);
                parts.push(this.shortDescription);
                break;
            default:
                parts.push(this.shortDescription);
                break;
        }
        return parts
            .map(part => String(part ?? "").trim())
            .filter(part => part.length && part !== "-")
            .join(" · ");
    }

    /** Weapons are held and armour is worn; the rest simply travels. @returns {boolean} */
    /**
     * Можно ли предмет надеть.
     *
     * Инвентарь рисует кнопку «надеть» только надеваемому, а расчёт брони
     * считает только надетое. Пока сюда входили лишь доспех и оружие, силовое
     * поле было нечем включить, и «даёт броню» у снаряжения не срабатывало
     * никогда — две разные жалобы из одной строки.
     */
    get isEquippable() {
        if (["armour", "weapon", "forceField"].includes(this.type)) return true;
        // Снаряжение, которое книга описывает как «даёт N брони» или собственную
        // атаку, носят наравне с доспехом. Синскин — как раз такой случай.
        return !!(this.system?.grantsArmour?.enabled || this.system?.grantsAttack?.enabled);
    }

    /**
     * How the item is being carried, as a word. Never colour alone.
     * @returns {{label: string, state: string}}
     */
    get carryState() {
        if (!this.system.equipped) return { label: "ITEM.STOWED", state: "stowed" };
        if (this.type === "weapon") return { label: "ITEM.IN_HANDS", state: "in-hands" };
        return { label: "ITEM.WORN", state: "worn" };
    }

    // У предмета, который бьёт «попутно» (кибернетика, снаряжение), своей
    // поправки к попаданию нет — ноль, а не undefined: иначе цель броска
    // складывается в NaN и атака молча ломается.
    get attack() { return Number(this.system.attack) || 0;}

    get upgrades() { return this.system.upgrades;}

}

/**
 * Place a suppression cone on the canvas as a Scene Region.
 *
 * Replaces the old PlaceableTemplate class, a MeasuredTemplate subclass adapted from dnd5e.
 * MeasuredTemplate is deprecated in v14 (merged into Region) and is removed in v16.
 *
 * The cone is purely a visual marker: suppression targets come from the user's targeting, never
 * from the shape. It is therefore aimed automatically at the first target instead of being
 * dragged into place by hand.
 *
 * @param {object} rollData             The combat roll being resolved.
 * @param {number} angle                The cone angle in degrees.
 * @param {number} lengthMeters         The cone length in scene distance units.
 * @returns {Promise<RegionDocument|null>}  The created Region, or null if it could not be placed.
 */
async function placeSuppressionCone(rollData, angle, lengthMeters) {
    if (!canvas?.ready || !canvas.scene) return null;

    const originToken = _getAttackerToken(rollData);
    if (!originToken) {
        ui.notifications.warn(game.i18n.localize("NOTIFICATION.NO_ATTACKER_TOKEN"));
        return null;
    }

    const origin = originToken.center;
    const grid = canvas.scene.grid;
    const radius = (Number(lengthMeters) || 0) * (grid.size / grid.distance);
    if (radius <= 0) return null;

    // Aim at the first target if there is one, otherwise follow the token's facing.
    let rotation = originToken.document.rotation ?? 0;
    const target = rollData?.targets?.[0];
    const targetToken = target ? canvas.tokens.get(target.tokenId) : null;
    if (targetToken) {
        rotation = Math.toDegrees(Math.atan2(targetToken.center.y - origin.y, targetToken.center.x - origin.x));
    }

    const [region] = await canvas.scene.createEmbeddedDocuments("Region", [{
        name: `${rollData?.name || game.i18n.localize("ATTACK_TYPE.SUPPRESSION")} (${originToken.name})`,
        color: game.user.color.css,
        visibility: CONST.REGION_VISIBILITY.ALWAYS,
        shapes: [{
            type: "cone",
            x: origin.x,
            y: origin.y,
            radius,
            angle,
            rotation,
            curvature: "round"
        }],
        flags: {
            "dark-heresy": {
                suppression: true,
                itemId: rollData?.itemId ?? null,
                actorId: rollData?.ownerId ?? null
            }
        }
    }]);

    return region ?? null;
}

/**
 * Resolve the Token on the current scene that is making an attack.
 * @param {object} rollData   The roll being resolved.
 * @returns {Token|null}
 */
function _getAttackerToken(rollData) {
    if (!canvas?.ready) return null;
    if (rollData?.tokenId) {
        const token = canvas.tokens.get(rollData.tokenId);
        if (token) return token;
    }
    if (rollData?.ownerId) {
        const owned = canvas.tokens.placeables.find(t => t.actor?.id === rollData.ownerId);
        if (owned) return owned;
    }
    return canvas.tokens.controlled[0] ?? null;
}

/**
 * Roll a generic roll, and post the result to chat.
 * @param {object} rollData
 */
function createDarkHeresyAPI() {
    async function actorFor(uuid) {
        if (game.darkHeresy?.ready) await game.darkHeresy.ready;
        const actor = await _getActorFromOwnerId(uuid);
        if (!actor) throw new Error("Actor not found: " + uuid);
        if (!actor.isOwner && !game.user?.isGM) throw new Error("No permission to operate this Actor");
        return actor;
    }
    return Object.freeze({
        version: 1,
        weaponTraitTypes: WEAPON_TRAIT_TYPES,
        supportsRollMessageFlags: true,
        async setItemTraits({actorUuid, itemId, traits = {}} = {}) {
            const actor = await actorFor(actorUuid);
            const item = actor.items.get(itemId);
            if (!item || !["weapon", "vehicleWeapon", "psychicPower"].includes(item.type)) throw new Error("Item does not support weapon traits");
            validateTraitOverrides(traits);
            const patch = {};
            for (const key of Object.keys(item._source?.system?.traitOverrides ?? item.system.traitOverrides ?? {})) {
                if (!Object.hasOwn(traits, key)) patch[`system.traitOverrides.-=${key}`] = null;
            }
            for (const [key,value] of Object.entries(traits)) patch[`system.traitOverrides.${key}`] = value;
            if (Object.keys(patch).length) await item.update(patch);
            return {actorUuid:actor.uuid, itemId, traits:{...traits}};
        },
        async rollTest({actorUuid, characteristic, skill, modifier = 0, dialog = false, messageFlags = {}} = {}) {
            const actor = await actorFor(actorUuid);
            if (!Number.isFinite(Number(modifier))) throw new Error("Modifier must be finite");
            if (characteristic ? !actor.characteristics?.[characteristic] : !actor.skills?.[skill]) throw new Error("Unknown test");
            const data = characteristic ? DarkHeresyUtil.createCharacteristicRollData(actor, characteristic)
                : DarkHeresyUtil.createSkillRollData(actor, skill);
            data.target.modifier += Number(modifier);
            data.messageFlags = foundry.utils.deepClone(messageFlags);
            if (dialog) { await prepareCommonRoll(data); return {status:"dialog", context:data}; }
            return commonRoll(data);
        },
        async useItem({actorUuid, itemId, dialog = true} = {}) {
            const actor = await actorFor(actorUuid);
            const item = actor.items.get(itemId);
            if (!item) throw new Error("Item not found: " + itemId);
            const psychic = item.type === "psychicPower";
            if (!psychic && !item.isWeapon && item.type !== "weapon") throw new Error("This item has no attack action");
            if (!psychic && !item.isEquipped) throw new Error("Weapon must be equipped");
            const data = psychic ? DarkHeresyUtil.createPsychicRollData(actor, item) : DarkHeresyUtil.createWeaponRollData(actor, item);
            if (dialog) {
                if (psychic) await preparePsychicPowerRoll(data);
                else await prepareCombatRoll(data, actor);
                return {status:"dialog", context:data};
            }
            return combatRoll(data);
        },
        async applyCondition({actorUuid, condition, active = true, rounds} = {}) {
            const actor = await actorFor(actorUuid);
            if (!CONFIG.statusEffects.some(effect => effect.id === condition)) throw new Error("Unknown condition: " + condition);
            if (active) await actor.addCondition(condition, {rounds});
            else await actor.removeCondition(condition);
            return {actorUuid:actor.uuid, condition, active:!!actor.hasCondition(condition)};
        },
        async applyDamage({messageId} = {}) {
            const message = game.messages.get(messageId);
            if (!message || (!message.isOwner && !game.user?.isGM)) throw new Error("No permission to apply this roll");
            return applyAutoDamageToTarget(message.getRollData(), message);
        }
    });
}

async function _runSystemRoll(rollData, execute) {
    if (Hooks.call("darkHeresy.preRoll", rollData) === false) return {status:"cancelled", context:rollData};
    const result = await execute(rollData);
    if (result?.status === "cancelled") return {...result, context:rollData};
    Hooks.callAll("darkHeresy.roll", rollData);
    return {status:"resolved", context:rollData};
}

async function commonRoll(rollData) { return _runSystemRoll(rollData, _resolveCommonRoll); }
async function combatRoll(rollData) {
    return _queueDocumentOperation(`attack:${rollData.actorUuid || rollData.ownerId}:${rollData.itemId}`, () =>
        _runSystemRoll(rollData, async data => {
            const attacker = _actorFromRollData(data);
            if (["stunned", "unconscious", "dead"].some(key => _hasCondition(attacker, key))) {
                return _resolveCombatRoll(data);
            }
            if (!_weaponSupportsAttackType(data)) return {status:"cancelled", reason:"attackType"};
            // A Fate reroll repeats the original shot; it does not fire the weapon again.
            if (!data.flags?.isReRoll) {
                const owner = await _getActorFromOwnerId(data.vehicle?.actorId || data.actorUuid || data.ownerId,
                    data.vehicle ? undefined : data.tokenId);
                const currentWeapon = owner?.items?.get(data.itemId);
                const clip = currentWeapon?.clip || currentWeapon?.system?.clip;
                if (data.weapon?.isRange && clip) data.weapon.clip = {value:Number(clip.value) || 0, max:Number(clip.max) || 0};
                const ammo = _checkAmmo(data);
                if (!ammo.enough) {
                    ui.notifications.warn(game.i18n.format("DIALOG.RELOAD_MESSAGE", ammo));
                    return {status:"cancelled", reason:"ammunition"};
                }
                if (!await _checkAndMarkRecharge(data)) return {status:"cancelled", reason:"recharge"};
            }
            return _resolveCombatRoll(data);
        }));
}

/**
 * Пометить карточку уклонения предложением ответного удара (DH2, стр. 126).
 *
 * Талант срабатывает после удачного Парирования и один раз за ход, поэтому
 * решается здесь, где исход реакции уже известен, а не в списке типов атаки.
 *
 * @param {object} rollData
 */
function _offerCounterAttack(rollData) {
    const actor = _fateActorFor(rollData);
    if (!actor) return;
    const talents = (actor.items ?? []).filter?.(item => item.type === "talent").map(item => ruleName(item)) ?? [];
    rollData.counterAttackOffered = canCounterAttack({
        selected: rollData.evasions?.selected,
        success: !!rollData.flags?.isSuccess,
        talents,
        usedThisTurn: !!actor.getFlag?.("dark-heresy", COUNTER_ATTACK_FLAG)
    });
    if (rollData.counterAttackOffered) {
        rollData.counterAttackActorId = actor.id;
        rollData.counterAttackTokenId = actor.getActiveTokens?.(true)?.[0]?.id ?? "";
    }
}

/**
 * Нанести ответный удар. Право на него тратится сразу, до самой атаки: иначе
 * отменённое окно атаки оставляло бы талант неизрасходованным весь ход.
 * @param {Event} event
 */
async function onCounterAttackClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const actor = await _getActorFromOwnerId(button.dataset.actorId, button.dataset.tokenId || null);
    if (!actor) return;
    if (actor.getFlag("dark-heresy", COUNTER_ATTACK_FLAG)) return;

    button.disabled = true;
    _resolvePendingCard(button);
    await actor.setFlag("dark-heresy", COUNTER_ATTACK_FLAG, true);

    const weapon = actor.items.find(item => item.type === "weapon"
        && item.system?.equipped === true && item.system?.class === "melee");
    if (!weapon) {
        ui.notifications.warn(game.i18n.localize("TALENT.COUNTER_ATTACK_NO_WEAPON"));
        return;
    }
    await prepareCombatRoll(DarkHeresyUtil.createWeaponRollData(actor, weapon), actor);
}

/**
 * Одна проверка в противоборстве: бросок в чат и всё, что нужно для сравнения
 * по правилам стр. 25 — успех, ступени, бонус характеристики и сама кость.
 *
 * @param {Actor} actor
 * @param {string} characteristicKey
 * @param {number} modifier
 * @returns {Promise<{success: boolean, degrees: number, bonus: number, roll: number}|null>}
 */
async function _contestRoll(actor, characteristicKey, modifier = 0) {
    const characteristic = actor?.characteristics?.[characteristicKey];
    if (!characteristic) return null;

    const rollData = DarkHeresyUtil.createCommonNormalRollData(actor, characteristic);
    rollData.name = game.i18n.localize("GRAPPLE.TITLE");
    rollData.target.modifier = modifier;
    await _computeCommonTarget(rollData);
    await _rollTarget(rollData);
    await _sendRollToChat(rollData);

    return {
        success: !!rollData.flags?.isSuccess,
        degrees: Number(rollData.dos) || 0,
        bonus: Number(characteristic.bonus) || 0,
        roll: Number(rollData.result) || 0
    };
}

/**
 * Разрешить выбранную опцию захвата и применить последствия.
 *
 * Выскальзывание — единственная опция, которая ни с кем не состязается: это
 * Обычная (+0) проверка Акробатики против самой себя (стр. 223).
 *
 * @param {Actor} actor
 * @param {Actor} opponent
 * @param {string} option
 */
async function _resolveGrapple(actor, opponent, option) {
    const chosen = [...CONTROLLER_OPTIONS, ...TARGET_OPTIONS].find(o => o.id === option);
    if (!chosen) return;

    let won = false;
    let degrees = 0;

    if (chosen.test === "acrobatics") {
        const skill = actor.system?.skills?.acrobatics;
        const base = Number(skill?.total) || 0;
        const roll = await new Roll("1d100").evaluate();
        won = roll.total <= base;
        degrees = won ? 1 + Math.floor((base - roll.total) / 10) : 0;
        await ChatMessage.create({
            content: `<div class="dark-heresy chat roll"><div class="dh-card ${won ? "is-success" : "is-fail"}">
                <div class="dh-card-h"><span class="who">${actor.name}</span>
                <span class="verdict">${game.i18n.localize(chosen.label)}</span></div>
                <div class="dh-card-b"><dl class="dh-kv">
                    <dt>${game.i18n.localize("CHAT.ROLL")}</dt><dd>${roll.total} / ${base}</dd>
                </dl></div></div></div>`
        });
    } else {
        const mine = await _contestRoll(actor, "strength");
        const theirs = await _contestRoll(opponent, "strength");
        if (!mine || !theirs) return;
        const contest = resolveOpposed(mine, theirs);
        won = contest.winner === "a";
        degrees = mine.degrees;
    }

    const outcome = grappleOutcome({
        option,
        won,
        degrees,
        halfMove: Number(actor.system?.movement?.half) || 0
    });

    const notes = [];
    if (outcome.damage) {
        const strengthBonus = Number(actor.characteristics?.strength?.displayBonus
            ?? actor.characteristics?.strength?.bonus) || 0;
        const damage = await new Roll(`${UNARMED_DAMAGE}+${strengthBonus}`).evaluate();
        const dealt = Math.max(damage.total, 0);
        await opponent.applyDamage([{
            amount: dealt, penetration: 0, location: "ARMOUR.BODY",
            type: "impact", weaponTraits: {}, source: game.i18n.localize("GRAPPLE.DAMAGE")
        }]);
        notes.push(game.i18n.format("GRAPPLE.DEALT", { damage: dealt }));
    }
    if (outcome.fatigue > 0) {
        const current = Number(opponent.system?.fatigue?.value) || 0;
        await opponent.update({ "system.fatigue.value": current + outcome.fatigue });
    }
    if (outcome.prone && !opponent.hasCondition("prone")) {
        await opponent.addCondition("prone", { type: "minor" });
    }
    if (outcome.metres > 0) notes.push(game.i18n.format("GRAPPLE.PUSHED", { metres: outcome.metres }));
    if (outcome.endsGrapple) {
        await actor.removeCondition?.("grappled");
        await opponent.removeCondition?.("grappled");
    }
    if (outcome.controlSwapped) notes.push(game.i18n.localize("GRAPPLE.CONTROL_TAKEN"));
    if (outcome.proneBonus > 0) notes.push(game.i18n.format("GRAPPLE.PRONE_BONUS", { bonus: outcome.proneBonus }));
    if (!won) notes.push(game.i18n.localize("GRAPPLE.HELD"));

    if (notes.length) {
        await ChatMessage.create({
            content: `<div class="dark-heresy chat roll"><div class="dh-card">
                <div class="dh-card-h"><span class="who">${actor.name}</span>
                <span class="verdict">${game.i18n.localize(chosen.label)}</span></div>
                <div class="dh-card-b"><p>${notes.join(" ")}</p></div></div></div>`
        });
    }
}

async function _resolveCommonRoll(rollData) {
    await _computeCommonTarget(rollData);
    await _rollTarget(rollData);
    if (rollData.flags.isEvasion) {
        if (rollData.attackType && rollData.weapon?.traits) {
            _computeRateOfFire(rollData);
            rollData.numberOfHits = _computeNumberOfHits(
                rollData.attackDos,
                rollData.dos,
                rollData.attackType,
                rollData.shotsFired,
                rollData.weapon.traits);
        }
        _offerCounterAttack(rollData);
    }
    await _sendRollToChat(rollData);
    await _applyRegeneration(rollData);
}

async function _applyRegeneration(rollData) {
    if (!rollData?.flags?.isRegeneration) return;
    let actor = null;
    if (rollData.tokenUuid) {
        const resolved = await fromUuid(rollData.tokenUuid);
        actor = resolved?.actor || null;
    }
    if (!actor && rollData.actorUuid) {
        const resolved = await fromUuid(rollData.actorUuid);
        actor = resolved?.actor || resolved || null;
    }
    if (!actor && rollData.tokenId) {
        const scene = rollData.sceneId ? game.scenes?.get(rollData.sceneId) : canvas?.scene;
        const tokenDoc = scene?.tokens?.get(rollData.tokenId);
        actor = tokenDoc?.actor || null;
    }
    if (!actor && rollData.ownerId) {
        actor = _actorFromRollData(rollData) || null;
    }
    if (!actor) return;
    if (!rollData.flags.isSuccess) return;
    const amount = Number(rollData.regeneration) || 0;
    if (amount <= 0) return;
    const currentWounds = Number(actor.system?.wounds?.value) || 0;
    const currentCritical = Number(actor.system?.wounds?.critical) || 0;
    if (currentWounds <= 0 && currentCritical <= 0) return;
    let remaining = amount;
    const newCritical = Math.max(currentCritical - remaining, 0);
    remaining = Math.max(remaining - currentCritical, 0);
    const newWounds = Math.max(currentWounds - remaining, 0);
    const delta = (newWounds + newCritical) - (currentWounds + currentCritical);
    actor._suppressWoundsFloat = true;
    try {
        await actor.update({
            "system.wounds.value": newWounds,
            "system.wounds.critical": newCritical
        });
    } finally {
        delete actor._suppressWoundsFloat;
    }
    _showWoundsFloat(actor, delta, { effect: "regen" });
}

/**
 * Roll a combat roll, and post the result to chat.
 * @param {object} rollData
 */
async function _resolveCombatRoll(rollData) {
    if (rollData.attackType?.name === "suppression") {
        await placeSuppressionCone(rollData, 45, rollData.weapon.range);
    }

    // Оглушённый и бессознательный действий не совершают вовсе. Бросок не
    // отменяется молча, а проваливается — как уже сделано для стрельбы вслепую:
    // в журнале остаётся запись, и ведущему видно, почему хода не было.
    {
        const a = _actorFromRollData(rollData);
        const tok = a?.getActiveTokens?.(true)?.[0];
        let blocking = ["stunned", "unconscious", "dead"].find(k => _hasCondition(a, k));
        // Слепой автоматически проваливает любую проверку Меткости — правило
        // одинаково в обеих книгах (BC, стр. 256; DH2, стр. 243). Владение
        // оружием при этом не блокируется, а идёт со штрафом −30.
        if (!blocking && _hasCondition(a, "blinded")) {
            const melee = rollData?.weapon?.weaponClass === "melee" || rollData?.weapon?.class === "melee";
            if (!melee) blocking = "blinded";
        }
        if (blocking) {
            await _computeCombatTarget(rollData);
            rollData.result = 100;
            rollData.flags.isSuccess = false;
            rollData.dof = Math.max(rollData.target.final - 100, 0);
            rollData.dos = 0;
            rollData.numberOfHits = 0;
            rollData.attackDos = 0;
            rollData.attackResult = rollData.result;
            // У «мёртв» нет своей строки CONDITION.*: система берёт для него ключ
            // ядра, как и при создании самого эффекта. Шаблон по имени состояния
            // тут промахивался, и в карточке оставался сырой CONDITION.DEAD.
            rollData.blockedByCondition = blocking === "dead"
                ? "EFFECT.StatusDead"
                : `CONDITION.${blocking.toUpperCase()}`;
            await _sendRollToChat(rollData);
            return;
        }
    }

    // Check if actor is blinded and weapon is ranged - auto-fail ranged attacks
    const actor = _actorFromRollData(rollData);
    if (actor && rollData.weapon?.isRange) {
        const tokens = actor.getActiveTokens(true);
        if (tokens.length > 0) {
            const token = tokens[0];
            const isBlinded = _hasCondition(token, "blinded");
            
            if (isBlinded) {
                // Auto-fail ranged attacks for blinded characters
                await _computeCombatTarget(rollData);
                rollData.result = 100; // Set result to 100 (guaranteed failure)
                rollData.flags.isSuccess = false;
                rollData.dof = Math.max(rollData.target.final - 100, 0);
                rollData.dos = 0;
                rollData.numberOfHits = 0;
                rollData.attackDos = 0;
                rollData.attackResult = rollData.result;
                await _sendRollToChat(rollData);
                // Consume ammo even on failed attack
                await _consumeAmmo(rollData);
                return;
            }
        }
    }
    
    if (rollData.weapon.traits.skipAttackRoll) {
        rollData.attackResult = 5; // Attacks that skip the hit roll always hit body; 05 reversed 50 = body
        rollData.flags.isDamageRoll = true;
        await _rollDamage(rollData);
        await sendDamageToChat(rollData);
        // Consume ammo for skip attack roll
        await _consumeAmmo(rollData);
    } else {
        await _computeCombatTarget(rollData);
        await _rollTarget(rollData);
        rollData.attackDos = rollData.dos;
        rollData.attackResult = rollData.result;
        if (rollData.attackType) {
            _computeRateOfFire(rollData);
        }
        // Block hits if weapon jammed or overheated
        if (rollData.weaponJammed || rollData.weaponOverheated) {
            rollData.numberOfHits = 0;
        } else {
            rollData.numberOfHits = _computeNumberOfHits(
                rollData.attackDos,
                0,
                rollData.attackType,
                rollData.shotsFired,
                rollData.weapon.traits);
        }
        await _sendRollToChat(rollData);
        // Consume ammo after regular attack
        await _consumeAmmo(rollData);
    }
}

/**
 * Roll damage for an attack and post the result to chat
 * @param {object} rollData
 */
async function damageRoll(rollData) {
    // Block damage if weapon jammed or overheated
    if (rollData.weaponJammed || rollData.weaponOverheated) {
        return;
    }
    
    // For melee attacks against hordes: set numberOfHits to potential kills (DoS/2)
    // Each hit will be checked separately for armor penetration
    // Force trait doubles kills AFTER checking damage, not potential hits
    if (_isHordeTarget(rollData) && rollData.weapon?.weaponClass === "melee" && rollData.attackDos) {
        const potentialKills = Math.floor(rollData.attackDos / 2);
        rollData.numberOfHits = potentialKills;
    }
    
    await _rollDamage(rollData);
    const message = await sendDamageToChat(rollData);
    if (_shouldAutoApplyDamage(rollData)) {
        await applyAutoDamageToTarget(rollData, message);
    }
}

function _shouldAutoApplyDamage(rollData) {
    // Don't auto-apply damage for mass evasion
    if (rollData?.flags?.isMassEvasion) return false;
    
    // Don't auto-apply damage if there are multiple targets
    const targets = Array.isArray(rollData?.targets) ? rollData.targets : [];
    if (targets.length > 1) return false;
    
    // Auto-apply damage for hordes
    if (_isHordeTarget(rollData)) return true;
    
    // Auto-apply damage for single targets
    return true;
}

/**
 * Calculate required ammo for attack type based on rate of fire
 * @param {object} rollData - Roll data with weapon and attackType
 * @returns {number} - Required ammo count
 */
function _calculateRequiredAmmo(rollData) {
    return _calculateBaseRequiredAmmo(rollData) * _getLasSettingAmmoMultiplier(rollData);
}

/**
 * Кратность расхода заряда по режиму лазерного оружия (DH2, стр. 185):
 * усиленный заряд тратит вдвое, перегрузка — вчетверо.
 * @param {object} rollData
 * @returns {number}
 */
function _getLasSettingAmmoMultiplier(rollData) {
    if (!rollData.weapon?.traits?.lasSetting) return 1;
    switch (rollData.weapon?.lasSetting) {
        case "overcharge": return 2;
        case "maximal": return 4;
        default: return 1;
    }
}

/**
 * Расход выстрелов по типу атаки, без учёта режима лазерного оружия.
 * @param {object} rollData
 * @returns {number}
 */
function _calculateBaseRequiredAmmo(rollData) {
    const attackType = rollData.attackType?.name || "standard";
    const rateOfFire = rollData.weapon?.rateOfFire || {};
    
    // Handle modifiers for storm/twinLinked traits
    const mod = rollData.weapon?.traits?.storm || rollData.weapon?.traits?.twinLinked ? 2 : 1;
    
    switch (attackType) {
        case "standard":
        case "called_shot":
        case "bolt":
        case "blast":
            return 1;
        
        case "semi_auto":
        case "swift":
        case "barrage":
            return (Number(rateOfFire.burst) || 0) * mod;
        
        case "full_auto":
        case "lightning":
            return (Number(rateOfFire.full) || 0) * mod;
        
        case "suppression": {
            const baseShots = rollData.suppressionLength === "full"
                ? (Number(rateOfFire.full) || 0)
                : (Number(rateOfFire.burst) || 0);
            return baseShots * mod;
        }
        
        case "wide_auto": {
            const baseShots = rollData.wideRofLength === "semi"
                ? (Number(rateOfFire.burst) || 0)
                : (Number(rateOfFire.full) || 0);
            return Math.max((baseShots || 0) - 2, 0) * mod;
        }
        
        default:
            return 1;
    }
}

/**
 * Check if weapon has enough ammo for the attack
 * @param {object} rollData - Roll data with weapon and attackType
 * @returns {{enough: boolean, required: number, available: number}}
 */
function _checkAmmo(rollData) {
    // Only check for ranged weapons
    if (!rollData.weapon?.isRange) {
        return { enough: true, required: 0, available: 0 };
    }
    
    const clip = rollData.weapon?.clip || {};
    const clipValue = Number(clip.value) || 0;
    const clipMax = Number(clip.max) || 0;
    
    // If weapon has no clip system, skip check
    if (clipMax === 0) {
        return { enough: true, required: 0, available: 0 };
    }
    
    const required = _calculateRequiredAmmo(rollData);

    // A magazine shorter than the rate of fire does not forbid the burst: the
    // weapon fires what it has left and the hits are capped at that number.
    // Only an empty magazine stops the attack. The cap reaches the roll through
    // rollData.shotsFired, which _computeNumberOfHits has always honoured but
    // which nothing ever assigned.
    const fired = Math.min(required, clipValue);
    return {
        enough: clipValue > 0,
        required: required,
        available: clipValue,
        fired: fired
    };
}

/**
 * Consume ammo from weapon clip after attack
 * @param {object} rollData - Roll data with weapon and attackType
 * @returns {Promise<void>}
 */
async function _consumeAmmo(rollData) {
    if (rollData.flags?.isReRoll) return;
    // Only consume for ranged weapons
    if (!rollData.weapon?.isRange) {
        return;
    }
    
    const clip = rollData.weapon?.clip || {};
    const clipMax = Number(clip.max) || 0;
    
    // If weapon has no clip system, skip
    if (clipMax === 0) {
        return;
    }
    
    const required = _calculateRequiredAmmo(rollData);
    const currentClip = Number(clip.value) || 0;
    let newClip = Math.max(0, currentClip - required);

    // Патроны машинного орудия лежат в машине, а не в карманах стрелка: искать
    // предмет надо там же, где он записан, иначе выстрел уходит бесплатно.
    if (rollData.vehicle?.actorId) {
        const vehicle = game.actors.get(rollData.vehicle.actorId);
        const weapon = vehicle?.items.get(rollData.itemId);
        if (weapon) await weapon.update({ "system.clip.value": newClip });
        else console.warn("Dark Heresy: _consumeAmmo - Vehicle weapon not found");
        return;
    }

    // Get actor and weapon
    const actor = await _getActorFromOwnerId(rollData.actorUuid || rollData.ownerId, rollData.tokenId);
    if (!actor) {
        console.warn("Dark Heresy: _consumeAmmo - Actor not found");
        return;
    }
    
    let weapon = actor.items.get(rollData.itemId);
    
    // For token actors, if weapon not found by ID, try to find by name
    // (token items have different IDs than base actor items)
    if (!weapon && actor.isToken) {
        const weaponName = rollData.weapon?.name || rollData.name;
        if (weaponName) {
            weapon = actor.items.find(item => 
                item.type === "weapon" && item.name === weaponName
            );
        }
    }
    
    // Try UUID resolution as fallback
    if (!weapon && rollData.itemId) {
        try {
            if (rollData.itemId.includes(".")) {
                const resolved = await fromUuid(rollData.itemId);
                if (resolved && resolved.type === "weapon") {
                    // For token actors, if resolved weapon belongs to base actor, find by name in token
                    if (actor.isToken && resolved.parent?.id !== actor.id) {
                        const weaponName = resolved.name;
                        weapon = actor.items.find(item => 
                            item.type === "weapon" && item.name === weaponName
                        );
                    } else {
                        weapon = resolved;
                    }
                }
            }
        } catch (e) {
            // Ignore
        }
    }
    
    if (!weapon) {
        console.warn("Dark Heresy: _consumeAmmo - Weapon not found", {
            itemId: rollData.itemId,
            weaponName: rollData.weapon?.name,
            actorId: actor.id,
            isToken: actor.isToken
        });
        return;
    }
    
    // Считаем от того, что в стволе сейчас, а не от того, что запомнил диалог:
    // два окна атаки, открытые подряд, оба помнили полный магазин, и второй
    // выстрел записывал тот же остаток, что и первый, — патроны не убывали.
    const loaded = Number(weapon.system?.clip?.value);
    if (Number.isFinite(loaded)) newClip = Math.max(0, loaded - required);
    await weapon.update({"system.clip.value": newClip});
    
    // Sync for unlinked acolyte tokens
    if (actor?.isToken && ["acolyte", "heretic"].includes(actor?.type)) {
        const isLinked = actor.prototypeToken?.actorLink ?? actor.getFlag("core", "actorLink") ?? false;
        if (!isLinked) {
            const sourceId = actor.getFlag("core", "sourceId");
            const baseActor = sourceId ? game.actors.get(sourceId) : null;
            if (baseActor) {
                const baseWeapon = baseActor.items.find(item => 
                    item.type === "weapon" && item.name === weapon.name
                );
                if (baseWeapon) {
                    await baseWeapon.update({"system.clip.value": newClip});
                }
            }
        }
    }
    
    // Update rollData
    rollData.weapon.clip.value = newClip;
}

/**
 * Reload weapon using ammunition
 * @param {DarkHeresyItem} weapon - Weapon item to reload
 * @param {string} ownerId - Actor ID
 * @param {string} tokenId - Optional token ID
 * @param {boolean} showChatMessage - Show chat message
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function _reloadWeapon(weapon, ownerId, tokenId = null, showChatMessage = true) {
    // Выбранный для ствола боеприпас лежит в system.ammo — там же, где его читает
    // getLoadedAmmunition. Раньше здесь и на листе оружия стояло ammunitionId,
    // поля которого в модели нет: выбор не сохранялся, а эффекты патрона не доходили
    // до атаки, потому что искали его в другом поле.
    const ammunitionRef = weapon.system.ammo;

    // Get actor
    const actor = await _getActorFromOwnerId(ownerId, tokenId);
    if (!actor) {
        return { success: false, reason: "no_actor" };
    }

    // Find ammunition
    let ammunition = null;
    if (!ammunitionRef || ammunitionRef.trim() === "") {
        // Без заранее выбранного патрона перезарядка просто не шла: система знала
        // только выбранный патрон и никогда не искала в снаряжении сама. Поэтому
        // лазган с батареями в подсумке отказывался перезаряжаться, а расстановка
        // категорий у патронов делу не помогала — сверять было не с чем.
        ammunition = actor.items.find(item => item.type === "ammunition"
            && (Number(item.system?.quantity) || 0) > 0
            && DarkHeresyUtil.ammunitionFitsWeapon(item, weapon)) ?? null;
        if (!ammunition) {
            return { success: false, reason: "no_compatible_ammunition" };
        }
    } else if (ammunitionRef.startsWith("Actor.") || ammunitionRef.startsWith("Item.")) {
        try {
            const resolved = await fromUuid(ammunitionRef);
            if (resolved && resolved.type === "ammunition") {
                if (actor.isToken) {
                    // For token actors, find by name
                    const ammoName = resolved.name;
                    ammunition = actor.items.find(item => 
                        item.type === "ammunition" && item.name === ammoName
                    );
                } else {
                    ammunition = resolved;
                }
            }
        } catch (e) {
            console.warn("Dark Heresy: Failed to resolve ammunition UUID:", e);
        }
    } else {
        // Try to get by ID first
        ammunition = actor.items.get(ammunitionRef);
        if (ammunition && !ammunition.isAmmunition) {
            ammunition = null;
        }
        
        // For token actors, if not found by ID, try to find by resolving from base actor and then searching by name
        if (!ammunition && actor.isToken) {
            try {
                // Try to get base actor to resolve the reference
                const sourceId = actor.getFlag("core", "sourceId");
                const baseActor = sourceId ? game.actors.get(sourceId) : null;
                if (baseActor) {
                    const baseAmmo = baseActor.items.get(ammunitionRef);
                    if (baseAmmo && baseAmmo.type === "ammunition") {
                        // Find by name in token actor
                        ammunition = actor.items.find(item => 
                            item.type === "ammunition" && item.name === baseAmmo.name
                        );
                    }
                }
            } catch (e) {
                // Ignore errors
            }
        }
    }
    
    if (!ammunition || !ammunition.isAmmunition) {
        return { success: false, reason: "no_ammunition" };
    }

    // Патрон должен подходить стволу. Текстовое поле «к чему подходит» читает
    // человек, а не система, поэтому болтерные снаряды спокойно заряжались
    // в лазган. Списки типов и классов заполнены — сверяем; пусты — считаем
    // патрон универсальным и не мешаем мастеру.
    if (!DarkHeresyUtil.ammunitionFitsWeapon(ammunition, weapon)) {
        return { success: false, reason: "wrong_ammunition" };
    }

    // Check quantity
    const quantity = Number(ammunition.system.quantity) || 0;
    if (quantity <= 0) {
        return { success: false, reason: "out_of_ammo" };
    }
    
    // Perform reload: decrease quantity by 1 and restore clip to max
    const newQuantity = Math.max(quantity - 1, 0);
    const clipMax = Number(weapon.system.clip.max) || 0;
    
    // Update ammunition and weapon. Что заряжено, запоминается на стволе: иначе
    // патрон списывался, а его урон, пробитие и свойства к выстрелу не применялись.
    await Promise.all([
        ammunition.update({"system.quantity": newQuantity}),
        weapon.update({"system.clip.value": clipMax, "system.ammo": ammunition.id})
    ]);
    
    // Sync for unlinked acolyte tokens
    if (actor?.isToken && ["acolyte", "heretic"].includes(actor?.type)) {
        const isLinked = actor.prototypeToken?.actorLink ?? actor.getFlag("core", "actorLink") ?? false;
        if (!isLinked) {
            const sourceId = actor.getFlag("core", "sourceId");
            const baseActor = sourceId ? game.actors.get(sourceId) : null;
            if (baseActor) {
                const baseWeapon = baseActor.items.find(item => 
                    item.type === "weapon" && item.name === weapon.name
                );
                const baseAmmunition = baseActor.items.find(item => 
                    item.type === "ammunition" && item.name === ammunition.name
                );
                if (baseWeapon && baseAmmunition) {
                    await Promise.all([
                        baseAmmunition.update({"system.quantity": newQuantity}),
                        baseWeapon.update({"system.clip.value": clipMax})
                    ]);
                }
            }
        }
    }
    
    // Show chat message
    if (showChatMessage) {
        const actorName = actor.name || game.i18n.localize("ACTOR.UNKNOWN");
        await ChatMessage.create({
            user: game.user.id,
            // Та же карточка, что у остальных сообщений чата: шапка «кто · что» и тело.
            content: `<div class="dark-heresy chat roll">
                <div class="dh-card is-neutral">
                    <div class="dh-card-h">
                        <span class="who">${actorName}</span>
                        <span class="verdict">${game.i18n.localize("CHAT.RELOADED")}</span>
                    </div>
                    <div class="dh-card-b">
                        <p class="dh-note"><b>${weapon?.name ?? ""}</b></p>
                    </div>
                </div>
            </div>`
        });
    }
    
    return { success: true };
}

/**
 * Compute the target value, including all +/-modifiers, for a roll.
 * @param {object} rollData
 */
async function _computeCombatTarget(rollData) {
    // A module can restore a saved target and cancel recomputation.
    if (Hooks.call("darkHeresy.preComputeRollTarget", rollData) === false) return;

    let attackType = 0;
    if (rollData.attackType) {
        _computeRateOfFire(rollData);
        attackType = rollData.attackType.modifier;
    }
    let psyModifier = 0;
    if (typeof rollData.psy !== "undefined" && typeof rollData.psy.useModifier !== "undefined" && rollData.psy.useModifier) {
    // Set Current Psyrating to the allowed maximum if it is bigger
        if (rollData.psy.value > rollData.psy.max) {
            rollData.psy.value = rollData.psy.max;
        }
        
        const psyRules = Dh.rulesetFor(_actorFromRollData(rollData)).psychic;

        // Calculate push status (going above current rating)
        // Use currentRating (with sustained applied) instead of base rating
        let baseCurrentRating = rollData.psy.currentRating !== undefined ? rollData.psy.currentRating : rollData.psy.rating;
        // Половинный рейтинг Fettered — правило Black Crusade; в DH2 такого шага нет.
        let baseDisplayedRating = baseCurrentRating;
        if (psyRules.fetteredHalving && rollData.psy.class === "bound") {
            baseDisplayedRating = Math.ceil(baseCurrentRating / 2);
        }
        const pushModifier = (baseDisplayedRating - rollData.psy.value) * 10;
        rollData.psy.push = pushModifier < 0;

        // Две разные модели: Black Crusade даёт +5 за каждое использованное очко
        // рейтинга (стр. 208), Dark Heresy 2 — ±10 за каждое очко отклонения от
        // базового рейтинга (стр. 194). Раньше и там и там считалось по BC, а
        // дифференциал DH2 вычислялся и молча выбрасывался.
        const psyRatingBonus = () => psyRules.ratingBonus === "deviation"
            ? (baseDisplayedRating - rollData.psy.value) * 10
            : rollData.psy.value * 5;
        let psyBonus = psyRatingBonus();
        psyModifier = psyBonus;
        
        // Store initial rating for display in chat
        rollData.psy.initialRating = baseDisplayedRating;
        rollData.psy.initialDisplayedRating = baseDisplayedRating;
        
        // For Bound: if pushing from divided-by-2 to current rating, it's "Unbrake", not "Push"
        if (rollData.psy.class === "bound" && rollData.psy.push) {
            // Check if we're pushing from divided-by-2 to exactly current rating (unbrake)
            if (rollData.psy.value === baseCurrentRating) {
                rollData.psy.isUnbrake = true;
            } else {
                rollData.psy.isUnbrake = false;
            }
        } else {
            rollData.psy.isUnbrake = false;
        }
        
        rollData.psy.actualBonus = psyBonus; // Store the actual bonus used
        
        if (rollData.psy.push && rollData.psy.warpConduit) {
            let ratingBonus = new Roll("1d5").evaluateSync().total;
            rollData.psy.value += ratingBonus;
            // Recalculate after warp conduit bonus
            psyBonus = psyRatingBonus();
            psyModifier = psyBonus;
            rollData.psy.actualBonus = psyBonus;
        }
    }

    const hordeBonus = _getHordeAttackBonus(rollData);
    const difficultyMod = Number(rollData?.difficulty?.value) || 0;
    const targetConditionMod = _getTargetConditionModifier(rollData);
    const actorConditionMod = _getActorConditionModifier(_actorFromRollData(rollData), rollData);
    const targetSizeMod = _getTargetSizeModifier(rollData);
    
    rollData.targetConditionModifier = targetConditionMod;
    rollData.actorConditionModifier = actorConditionMod;
    rollData.targetSizeModifier = targetSizeMod;
    // Одного числа мало: ноль за Чёрным Панцирем выглядит как «правила не было».
    rollData.targetSizeLabel = _targetSizeLabel(rollData);
    
    // Разброс даёт бонус к попаданию только вблизи; ступень берётся из уже
    // посчитанного модификатора дальности (BC, стр. 152).
    const scatter = DarkHeresyUtil.getScatterModifiers(rollData);
    rollData.scatterModifiers = scatter;

    let targetMods = rollData.target.modifier
    + (rollData.aim?.val ? rollData.aim.val : 0)
    + (rollData.rangeMod ? rollData.rangeMod : 0)
    + (rollData.weapon?.traits?.twinLinkedBonus ? 10: 0)
    + (rollData.weapon?.traits?.accurate && rollData.aim?.isAiming && rollData.weapon?.isRange ? 10: 0) // Accurate trait: +10 bonus when aiming
    + scatter.attack
    // Защитное оружие — щит: им обороняются, а не бьют (BC, стр. 150).
    + (rollData.weapon?.traits?.defensive ? -10 : 0)
    + attackType
    + psyModifier
    + difficultyMod
    + hordeBonus
    + targetConditionMod
    + actorConditionMod
    + targetSizeMod;

    rollData.target.final = _getRollTarget(targetMods, rollData.target.base);
}

function _getHordeAttackBonus(rollData) {
    const target = rollData?.targets?.[0];
    if (!target || !canvas?.ready) return 0;
    if (target.sceneId && canvas.scene?.id !== target.sceneId) return 0;
    const token = canvas.tokens.get(target.tokenId);
    // Use getter to get horde value from token actor (actual instance on canvas)
    const hordeValue = Number(token?.actor?.horde) || 0;
    if (hordeValue >= 115) return 60;
    if (hordeValue >= 85) return 50;
    if (hordeValue >= 55) return 40;
    if (hordeValue >= 25) return 30;
    return 0;
}

/**
 * Compute the target value, including all +/-modifiers, for a roll.
 * @param {object} rollData
 */
async function _computeCommonTarget(rollData) {
    // A module can restore a saved target and cancel recomputation.
    if (Hooks.call("darkHeresy.preComputeRollTarget", rollData) === false) return;
    const difficultyMod = Number(rollData?.difficulty?.value) || 0;
    const actor = _actorFromRollData(rollData);
    const actorConditionMod = _getActorConditionModifier(actor, rollData);
    
    rollData.actorConditionModifier = actorConditionMod;
    
    // В захвате реакций нет вовсе, а уклонение — реакция (BC, стр. 236).
    if (rollData.flags.isEvasion) {
        const evader = _actorFromRollData(rollData);
        const evaderToken = evader?.getActiveTokens?.(true)?.[0];
        if (evaderToken && _hasCondition(evaderToken, "grappled")) rollData.evasionBlocked = true;
    }

    if (rollData.flags.isEvasion) {
        let skill;
        switch (rollData.evasions.selected) {
            case "dodge": skill = rollData.evasions.dodge; break;
            case "parry": skill = rollData.evasions.parry; break;
            case "deny": skill = rollData.evasions.deny; break;
            case "willpower": skill = rollData.evasions.willpower; break;
            case "toughness": skill = rollData.evasions.toughness; break;
            case "agility": skill = rollData.evasions.agility; break;
            case "strength": skill = rollData.evasions.strength; break;
        }
        // Apply -10 penalty to parry if attacker's weapon is unbalanced
        let parryPenalty = 0;
        if (rollData.evasions.selected === "parry" && rollData.weapon?.traits?.unbalanced) {
            parryPenalty = -10;
        }
        // Гибкое оружие — цеп, кнут, цепь: оно хлещет мимо клинка, и парировать
        // его нельзя вовсе (BC, стр. 150). Уклонение при этом работает.
        if (rollData.evasions.selected === "parry" && rollData.weapon?.traits?.flexible) {
            rollData.parryBlocked = true;
            ui.notifications.warn(game.i18n.format("WEAPON.FLEXIBLE_NO_PARRY", {
                weapon: rollData.weapon?.name || game.i18n.localize("WEAPON.HEADER")
            }));
        }
        // Из чего сложилось уклонение. Раньше карточка показывала одно голое
        // число, и спорить с ним было нечем: ни состояния, ни сложность, ни
        // штраф за Несбалансированное в нём не различались.
        const evasionSources = [];
        const noteEvasion = (key, value) => {
            if (!value) return;
            evasionSources.push(`${game.i18n.localize(key)} (${value > 0 ? "+" : ""}${value})`);
        };
        noteEvasion("CHAT.TEST_MODIFIER", Number(rollData.target.modifier) || 0);
        noteEvasion("DIALOG.DIFFICULTY", difficultyMod);
        if (rollData.actorConditionSources) evasionSources.push(rollData.actorConditionSources);
        noteEvasion("WEAPON.TRAIT.UNBALANCED", parryPenalty);
        if (rollData.parryBlocked) evasionSources.push(game.i18n.localize("WEAPON.FLEXIBLE_NO_PARRY_SHORT"));
        if (rollData.evasionBlocked) evasionSources.push(game.i18n.localize("CONDITION.GRAPPLED"));
        rollData.evasionSources = evasionSources.join(", ");

        rollData.target.final = _getRollTarget(rollData.target.modifier + difficultyMod + actorConditionMod + parryPenalty, skill.target.base);
        // Парировать гибкое оружие невозможно, а не «трудно»: цель ноль,
        // бросок гарантированно провалится и останется в чате как отметка,
        // что попытка была.
        if (rollData.parryBlocked) rollData.target.final = 0;
        // Захват режет любую реакцию, не только парирование.
        if (rollData.evasionBlocked) rollData.target.final = 0;
    } else {
        rollData.target.final = _getRollTarget(rollData.target.modifier + difficultyMod + actorConditionMod, rollData.target.base);
    }
}

/**
 * Checks and adjusts modifiers for the rolls target number and returns the final target number
 * @param {int} targetMod calculated bonuses
 * @param {int} baseTarget the intial target value to be modified
 * @returns {int} the final target number
 */
function _getRollTarget(targetMod, baseTarget) {
    // No maximum limit - apply all modifiers as they are
    return baseTarget + targetMod;
}


/**
 * Roll a d100 against a target, and apply the result to the rollData.
 * @param {object} rollData
 */
async function _rollTarget(rollData) {
    let r = new Roll("1d100", {});
    await r.evaluate();
    let result = r.total;
    const range = _getGenderRange(rollData);
    if (range) {
        const min = range.min;
        const max = range.max;
        const secret = Math.floor(Math.random() * (max - min + 1)) + min;
        result = secret;
    }
    
    // Get unmodified dice result (original value before modifiers)
    let unmodifiedResult = result;
    if (r.terms && r.terms.length > 0 && r.terms[0].results && r.terms[0].results.length > 0) {
        // Get the first die result (unmodified)
        unmodifiedResult = r.terms[0].results[0].result;
        // Handle d100: if result is 0, it means 00 (100)
        if (unmodifiedResult === 0 && r.terms[0].faces === 100) {
            unmodifiedResult = 100;
        }
    }
    
    // Check for weapon jam and overheating for ranged weapons
    if (rollData.weapon?.isRange) {
        const traits = rollData.weapon.traits || {};

        // Каждый бросок решает заново. Переброс за Очко Судьбы повторяет тот же
        // rollData, а флаги ставились только при осечке и никогда не снимались:
        // заклинивание переживало удачный переброс и продолжало гасить урон.
        rollData.weaponJammed = false;
        rollData.weaponOverheated = false;

        // Overheating weapons don't jam, but can overheat on 91+
        if (traits.overheating) {
            if (unmodifiedResult >= OVERHEAT_THRESHOLD && unmodifiedResult <= 100) {
                const weaponName = rollData.weapon.name || game.i18n.localize("WEAPON.HEADER");
                ui.notifications.warn(game.i18n.format("WEAPON.OVERHEAT", { weapon: weaponName }));
                // Store overheating flag for chat message
                rollData.weaponOverheated = true;
                // Перегрев не просто отменял попадание, как осечка, — он ничего
                // больше и не делал, хотя книга жжёт им самого стрелка.
                await _burnOverheatWielder(rollData);
            }
        } else {
            // Normal jam logic for non-overheating weapons
            let isJam = false;
            if (traits.reliable) {
                // Reliable weapons jam only on 100
                isJam = (unmodifiedResult === 100);
            } else if (traits.unreliable) {
                // Unreliable weapons jam on 91-100
                isJam = (unmodifiedResult >= 91 && unmodifiedResult <= 100);
            } else {
                // Одиночный выстрел клинит с 96, очередь и подавляющий огонь — уже с 94
                // (DH2, стр. 222, 224, 225: «a dice result of 94 or higher»).
                const automatic = ["semi_auto", "full_auto", "suppression", "wide_auto"]
                    .includes(rollData.attackType?.name);
                isJam = (unmodifiedResult >= (automatic ? 94 : 96) && unmodifiedResult <= 100);
            }
            
            if (isJam) {
                const weaponName = rollData.weapon.name || game.i18n.localize("WEAPON.HEADER");
                ui.notifications.warn(game.i18n.format("WEAPON.JAM", { weapon: weaponName }));
                // Store jam flag for chat message and to block damage
                rollData.weaponJammed = true;
                // Persist it too, so the weapon row can state the jam and offer the
                // clear. Without this the jam vanished with the roll that caused it.
                // Орудие машины принадлежит машине, а не тому, кто за ним сидит:
                // искать его у стрелка бесполезно, и заклинивание пропадало.
                const owner = rollData.vehicle?.actorId
                    ? game.actors.get(rollData.vehicle.actorId)
                    : _actorFromRollData(rollData);
                const jammedWeapon = owner?.items?.get(rollData.itemId);
                if (jammedWeapon) await jammedWeapon.setFlag("dark-heresy", "jammed", true);
            } else if (rollData.flags?.isReRoll) {
                // Переброс повторяет тот же выстрел, а не делает новый. Если он
                // осечки не дал, её не было: снимаем и отметку на оружии, иначе
                // ствол остаётся заклиненным после успешного переброска.
                // Только при перебросе: осечку могла поставить таблица критов,
                // и гасить её чужим выстрелом нельзя.
                const owner = rollData.vehicle?.actorId
                    ? game.actors.get(rollData.vehicle.actorId)
                    : _actorFromRollData(rollData);
                const rolledWeapon = owner?.items?.get(rollData.itemId);
                if (rolledWeapon) await rolledWeapon.unsetFlag("dark-heresy", "jammed");
            }
        }
    }
    
    rollData.result = result;
    rollData.unmodifiedResult = unmodifiedResult; // Store unmodified result for reference
    rollData.rollObject = r;
    // Натуральная «1» — успех всегда, натуральная «100» — провал всегда, какими бы
    // ни были модификаторы (BC, стр. 36). Решает неизменённый кубик, а не result:
    // тот мог быть подменён скрытым броском.
    const autoSuccess = unmodifiedResult === 1;
    // У Deathwatch проверка Сосредоточения проваливается на 91-00 при любом
    // рейтинге (стр. 186). Это потолок только для психики: обычные проверки
    // по-прежнему валит лишь натуральная сотня.
    const focusAutoFail = rollData.psy?.useModifier
        ? Number(Dh.rulesetFor(_actorFromRollData(rollData)).psychic.focusAutoFail) || 0
        : 0;
    const autoFailure = unmodifiedResult === 100
        || (focusAutoFail > 0 && unmodifiedResult >= focusAutoFail);
    rollData.autoOutcome = autoSuccess ? "success" : (autoFailure ? "failure" : null);
    rollData.flags.isSuccess = autoSuccess
        || (!autoFailure && rollData.result <= rollData.target.final);
    if (rollData.flags.isSuccess) {
        rollData.dof = 0;
        // При автоуспехе цель бывает ниже броска, и разность уходит в минус:
        // ступень успеха не бывает меньше одной.
        rollData.dos = Math.max(1 + _getDegree(rollData.target.final, rollData.result), 1);
        const unnaturalBonus = _getUnnaturalDosBonus(rollData);
        rollData.unnaturalDosBonus = unnaturalBonus;
        if (unnaturalBonus > 0) {
            rollData.dos += unnaturalBonus;
        }
    } else {
        rollData.dos = 0;
        rollData.dof = Math.max(1 + _getDegree(rollData.result, rollData.target.final), 1);
    }
    if (rollData.psy) _computePsychicPhenomena(rollData);
}

/**
 * Проверка цели, вызванная свойством оружия.
 *
 * Все такие свойства устроены одинаково: цель кидает характеристику со штрафом,
 * и важна не сама удача, а число ступеней провала — от него считаются раунды
 * оглушения и длительность бреда. Поэтому здесь один бросок на всех, а решают,
 * что с ним делать, вызывающие.
 *
 * @param {Actor} actor кто проверяется
 * @param {string} characteristicKey ключ характеристики (`toughness`, `agility`)
 * @param {number} modifier штраф или бонус к проверке
 * @param {string} label подпись в чате — название сработавшего свойства
 * @returns {Promise<{dof: number, success: boolean}|null>} null, если проверять нечем
 */
async function _rollWeaponEffectTest(actor, characteristicKey, modifier, label) {
    const characteristic = actor?.characteristics?.[characteristicKey];
    if (!characteristic) return null;

    const rollData = DarkHeresyUtil.createCommonNormalRollData(actor, characteristic);
    rollData.name = label;
    // Модификатор свойства — это и есть сложность проверки, и учесть его надо
    // один раз. Раньше он клался и в target.modifier, и в difficulty.value, а
    // _computeCommonTarget складывает оба поля: Токсичное (1) вместо Трудной
    // (−10) уходило в −20, и так же удваивались Оглушающее, Опутывающее и
    // Галлюциногенное. Штраф горящей машины при этом остаётся: он не сложность.
    rollData.target.modifier = _burningCrewModifier(actor);
    rollData.difficulty = {
        value: modifier,
        text: game.i18n.localize(Dh.difficulties[modifier] || "DIFFICULTY.CHALLENGING")
    };

    await _computeCommonTarget(rollData);
    await _rollTarget(rollData);
    await _sendRollToChat(rollData);

    return { dof: Number(rollData.dof) || 0, success: !!rollData.flags?.isSuccess };
}

/**
 * Свойства оружия, срабатывающие после попадания (BC, стр. 149–153).
 *
 * Часть свойств требует лишь попадания, часть — чтобы урон прошёл сквозь броню
 * и стойкость, а Калечащее — чтобы цель получила хотя бы одну рану. Разница
 * существенная: огнемёт поджигает даже того, кому не нанёс ни очка урона.
 *
 * Что система доводит до конца сама: проверки, состояния (оглушение, падение,
 * горение, обездвиживание) и добавочный урон Токсичного. Что она только
 * объявляет в чате, потому что решение остаётся за столом: таблица
 * Галлюциногенного, дымовая завеса, поле помех и урон Калечащего за движение —
 * их применяет мастер, как это уже сделано с критами.
 *
 * @param {Actor} actor цель
 * @param {object[]} damages записи урона этой атаки
 */
async function _resolveOnHitWeaponEffects(actor, damages) {
    if (!actor || !damages?.length) return;
    const traits = damages[0]?.weaponTraits || {};

    // Попадание было — этого хватает Пламени, Оглушающему, Опутывающему
    // и Галлюциногенному.
    const struck = damages.length > 0;
    // Урон прошёл — нужен Шоковому и Токсичному.
    const woundsDealt = damages.reduce((sum, d) => {
        const armour = actor._getEffectiveArmour(d);
        return sum + Math.max((Number(d.amount) || 0) - armour, 0);
    }, 0);
    const damageDealt = woundsDealt > 0 || damages.some(d => d.righteousFury);

    const announcements = [];

    // Пламя: цель проверяет Ловкость или загорается — даже если урона не было.
    if (struck && traits.flame) {
        const test = await _rollWeaponEffectTest(actor, "agility", 0, game.i18n.localize("WEAPON.TRAIT.FLAME"));
        if (test && !test.success) {
            await actor.addCondition("fire", { type: "minor" });
        }
    }

    // Шоковое: Обычная (+0) проверка Стойкости, провал — оглушение на число
    // раундов, равное ступеням провала.
    if (damageDealt && traits.shock) {
        const test = await _rollWeaponEffectTest(actor, "toughness", 0, game.i18n.localize("WEAPON.TRAIT.SHOCKING"));
        if (test && !test.success) {
            await actor.addCondition("stunned", { type: "minor" });
            announcements.push(game.i18n.format("WEAPON.TRAIT.STUNNED_ROUNDS", { rounds: test.dof }));
        }
    }

    // Оглушающее (X): штраф −10×X к Стойкости; провал — оглушение по ступеням,
    // а урон выше бонуса Силы вдобавок роняет цель наземь.
    if (struck && Number.isInteger(traits.concussive)) {
        const test = await _rollWeaponEffectTest(actor, "toughness", -10 * traits.concussive,
            `${game.i18n.localize("WEAPON.TRAIT.CONCUSSIVE")} (${traits.concussive})`);
        if (test && !test.success) {
            await actor.addCondition("stunned", { type: "minor" });
            announcements.push(game.i18n.format("WEAPON.TRAIT.STUNNED_ROUNDS", { rounds: test.dof }));
        }
        const strengthBonus = Number(actor.characteristics?.strength?.displayBonus
            ?? actor.characteristics?.strength?.bonus) || 0;
        if (woundsDealt > strengthBonus) {
            await actor.addCondition("prone", { type: "minor" });
        }
    }

    // Опутывающее (X): штраф −10×X к Ловкости; провал — цель обездвижена
    // и считается беспомощной, пока не выпутается.
    if (struck && Number.isInteger(traits.snare)) {
        const test = await _rollWeaponEffectTest(actor, "agility", -10 * traits.snare,
            `${game.i18n.localize("WEAPON.TRAIT.SNARE")} (${traits.snare})`);
        if (test && !test.success) {
            await actor.addCondition("grappled", { type: "minor" });
        }
    }

    // Едкое: броня в задетой локации теряет 1d10 очков, а всё, что она не
    // поглотила, достаётся носителю и не снижается Стойкостью (DH2, стр. 146).
    // Потери накапливаются; чинится Обычной (+0) проверкой Технологий. Свойство
    // написано у шести видов оружия в компендиуме и до сих пор не срабатывало:
    // словарь свойств не знал этого слова.
    if (struck && traits.corrosive) {
        const key = DH_ARMOUR_KEYS[damages[0]?.location];
        if (key) {
            const acid = new Roll("1d10");
            await acid.evaluate();
            const worn = Number(actor.system?.armour?.[key]?.value) || 0;
            const bite = corrosiveBite({ roll: acid.total, armourAtLocation: worn });
            if (bite.armourLost > 0) {
                const current = Number(actor.system?.armour?.[key]?.tempModifier) || 0;
                await actor.update({ [`system.armour.${key}.tempModifier`]: current - bite.armourLost });
            }
            if (bite.toTarget > 0) {
                await actor.applyDamage([{
                    amount: bite.toTarget,
                    penetration: 9999,          // излишек не снижается ни бронёй, ни стойкостью
                    location: damages[0].location,
                    type: damages[0].type,
                    weaponTraits: {},
                    source: game.i18n.localize("WEAPON.TRAIT.CORROSIVE")
                }]);
            }
            announcements.push(game.i18n.format("WEAPON.TRAIT.CORROSIVE_BITE", {
                armour: bite.armourLost, damage: bite.toTarget
            }));
        }
    }

    // Токсичное (X): штраф −10×X к Стойкости; провал — ещё 1d10 урона того же
    // типа, и его не снижают ни броня, ни стойкость.
    //
    // Момент проверки у игр разный. Black Crusade (стр. 153) требует её сразу
    // по попаданию. Dark Heresy 2 (стр. 152) — в конце хода пострадавшего, если
    // за прошедший раунд он получил урон от токсичного оружия. Поэтому у
    // аколита попадание только помечает его «отравленным», а бросок делается
    // на его ходу; состояние и есть та самая отметка.
    const toxicRules = Dh.rulesetFor(actor).toxic;
    // Rogue Trader считает Токсичное от прошедшего урона, и рейтинга у него нет.
    const toxicPerDamage = toxicRules.penalty === "perDamage";
    const toxicPresent = Number.isInteger(traits.toxic) || (toxicPerDamage && !!traits.toxicUnrated);
    if (damageDealt && Number.isInteger(traits.toxic)
        && toxicRules.timing === "endOfTurn") {
        await actor.setFlag("dark-heresy", "toxic", {
            value: traits.toxic,
            type: damages[0].type,
            location: damages[0].location
        });
        if (!actor.hasCondition("poisond")) await actor.addCondition("poisond", { type: "minor" });
        announcements.push(game.i18n.format("WEAPON.TRAIT.TOXIC_PENDING", { value: traits.toxic }));
    } else if (damageDealt && toxicPresent) {
        // −5 за каждое очко прошедшего урона у Rogue Trader, −10 за очко рейтинга
        // у Black Crusade. Названия в карточке тоже разные: рейтинг без числа не
        // называют.
        const penalty = toxicPerDamage
            ? (Number(toxicRules.step) || -5) * woundsDealt
            : -10 * traits.toxic;
        const label = Number.isInteger(traits.toxic) && !toxicPerDamage
            ? `${game.i18n.localize("WEAPON.TRAIT.TOXIC")} (${traits.toxic})`
            : game.i18n.localize("WEAPON.TRAIT.TOXIC");
        const test = await _rollWeaponEffectTest(actor, "toughness", penalty, label);
        if (test && !test.success) {
            const extra = new Roll("1d10");
            await extra.evaluate();
            await actor.applyDamage([{
                amount: extra.total,
                penetration: 9999,          // урон не снижается ни бронёй, ни стойкостью
                location: damages[0].location,
                type: damages[0].type,
                weaponTraits: {},
                source: game.i18n.localize("WEAPON.TRAIT.TOXIC")
            }]);
            announcements.push(game.i18n.format("WEAPON.TRAIT.TOXIC_DAMAGE", { damage: extra.total }));
        }
    }

    // Галлюциногенное (X): проверка Стойкости; провал — бросок по таблице 5-1
    // на 1 раунд плюс раунд за ступень провала. Респиратор и герметичный доспех
    // дают +20, но система не знает, надет ли он, — поправку вносит мастер.
    if (struck && Number.isInteger(traits.hallucinogenic)) {
        const test = await _rollWeaponEffectTest(actor, "toughness", -10 * traits.hallucinogenic,
            `${game.i18n.localize("WEAPON.TRAIT.HALLUCINOGENIC")} (${traits.hallucinogenic})`);
        if (test && !test.success) {
            const table = new Roll("1d100");
            await table.evaluate();
            announcements.push(game.i18n.format("WEAPON.TRAIT.HALLUCINOGENIC_RESULT", {
                roll: table.total,
                rounds: 1 + test.dof
            }));
        }
    }

    // Калечащее (X): хотя бы одна рана — и цель искалечена до конца схватки или
    // до полного излечения. Урон за движение сверх Половинного действия система
    // не отслеживает: она не знает, что персонаж делает в свой ход.
    if (woundsDealt > 0 && traits.crippling) {
        announcements.push(game.i18n.format("WEAPON.TRAIT.CRIPPLED", { damage: traits.crippling }));
    }

    // Площадное: радиус называется, расстановка на сцене остаётся за мастером.
    if (struck && Number.isInteger(traits.smoke)) {
        announcements.push(game.i18n.format("WEAPON.TRAIT.SMOKE_CLOUD", { radius: traits.smoke }));
    }
    if (struck && Number.isInteger(traits.haywire)) {
        announcements.push(game.i18n.format("WEAPON.TRAIT.HAYWIRE_FIELD", { radius: traits.haywire }));
    }

    if (announcements.length) {
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="dark-heresy chat roll">
                <div class="dh-card is-neutral">
                    <div class="dh-card-h">
                        <span class="who">${actor.name}</span>
                        <span class="verdict">${game.i18n.localize("WEAPON.TRAIT.EFFECTS")}</span>
                    </div>
                    <div class="dh-card-b">
                        ${announcements.map(line => `<p class="dh-note">${line}</p>`).join("")}
                    </div>
                </div>
            </div>`
        });
    }
}

function _getUnnaturalDosBonus(rollData) {
    let actorId = rollData?.ownerId;
    let characteristicKey = rollData?.characteristicKey;

    if (rollData?.flags?.isEvasion && rollData?.evasions?.selected) {
        const evasionRoll = rollData.evasions[rollData.evasions.selected];
        if (evasionRoll) {
            actorId = evasionRoll.ownerId;
            characteristicKey = evasionRoll.characteristicKey;
        }
    }

    if (!actorId || !characteristicKey) return 0;
    const actor = game.actors.get(actorId);
    const characteristic = actor?.system?.characteristics?.[characteristicKey];
    // Deathwatch записывает неестественность множителем, а не прибавкой, поэтому
    // поле unnatural у брата пустое. Книга даёт множитель к ступеням успеха только
    // в противоборстве психосил (стр. 186) — за пределами психики он ступеней не
    // прибавляет, и общее правило Dark Heresy остаётся как было.
    const psyRules = Dh.rulesetFor(actor).psychic;
    if (psyRules.unnaturalWillpowerToRating && rollData?.psy?.useModifier) {
        const multiplier = Number(characteristic?.unnaturalMultiplier) || 1;
        if (multiplier > 1) return multiplier;
    }
    const unnatural = Number(characteristic?.unnatural) || 0;
    // Half the Unnatural value in bonus degrees (DH2 p. 140), and p. 23 rounds
    // every division up, so Unnatural (3) is worth two degrees rather than one.
    return halfRoundedUp(unnatural);
}
/**
 * Handle rolling and collecting parts of a combat damage roll.
 * @param {object} rollData
 */
async function _rollDamage(rollData) {
    let formula = "0";
    rollData.damages = [];
    if (rollData.weapon.damageFormula) {
        formula = rollData.weapon.damageFormula;

        if (rollData.weapon.traits.tearing) {
            formula = _appendTearing(formula);
        }
        if (rollData.weapon.traits.proven) {
            formula = _appendNumberedDiceModifier(formula, "min", rollData.weapon.traits.proven);
        }
        if (rollData.weapon.traits.primitive) {
            formula = _appendNumberedDiceModifier(formula, "max", rollData.weapon.traits.primitive);
        }
        // Разброс: вблизи дробовик кладёт больше свинца, вдали — рассеивается
        // (BC, стр. 152). Ступень уже определена при расчёте цели попадания;
        // если атака шла в обход броска (Распыление), считаем её здесь.
        const scatter = rollData.scatterModifiers
            ?? DarkHeresyUtil.getScatterModifiers(rollData);
        if (scatter.damage) {
            formula = `${formula}${scatter.damage > 0 ? "+" : ""}${scatter.damage}`;
        }
        // Осквернённое оружие питается Порчей носителя: к урону добавляется
        // десятковый разряд его очков Порчи (BC, стр. 153).
        if (rollData.weapon.traits.tainted) {
            const bearer = _getActorFromTokenOrCollection(rollData.ownerId, rollData.tokenId);
            const corruptionBonus = Math.floor((Number(bearer?.system?.corruption) || 0) / 10);
            if (corruptionBonus > 0) formula = `${formula}+${corruptionBonus}`;
        }

        formula = `${formula}+${rollData.weapon.damageBonus}`;
        formula = _replaceSymbols(formula, rollData);
    }

    let hordeBonusDice = Number(rollData.hordeDamageBonusDice) || 0;
    if (!rollData.hordeBonusApplied && !hordeBonusDice && rollData?.ownerId) {
        // Get actor from token on canvas if available, otherwise from collection
        const owner = _getActorFromTokenOrCollection(rollData.ownerId, rollData.tokenId);
        hordeBonusDice = _getHordeDamageBonusDiceFromActor(owner);
    }
    if (rollData.hordeBonusApplied) {
        hordeBonusDice = 0;
    }
    if (hordeBonusDice > 0) {
        formula = `${formula}+${hordeBonusDice}d10`;
    }


    let penetration = await _rollPenetration(rollData);

    let firstHit = await _computeDamage(
        formula,
        penetration,
        rollData.attackDos,
        rollData.aim?.isAiming,
        rollData.weapon.traits,
        rollData.weapon.weaponClass,
        rollData.attackType?.name,
        rollData
    );
    // По машине бьют не в руку и не в ногу: сторона решает броню, зона — таблицу
    // критов. Стороне всё равно, куда целились, поэтому она считается один раз
    // на всю очередь, а зона перебрасывается для каждого попадания.
    const vehicleHit = _getVehicleHitContext(rollData);
    const firstLocation = vehicleHit
        ? _getVehicleZone(rollData.attackResult)
        : ((rollData.attackType?.name === "called_shot" && rollData.calledShotLocation)
            ? rollData.calledShotLocation
            : _getLocation(rollData.attackResult));
    firstHit.location = firstLocation;
    if (vehicleHit) {
        firstHit.zone = firstLocation;
        firstHit.facing = vehicleHit.facing;
    }
    rollData.damages.push(firstHit);

    let additionalhits = rollData.numberOfHits -1;

    for (let i = 0; i < additionalhits; i++) {
        let additionalHit = await _computeDamage(
            formula,
            penetration,
            rollData.attackDos,
            rollData.aim?.isAiming,
            rollData.weapon.traits,
            rollData.weapon.weaponClass,
            rollData.attackType?.name,
            rollData
        );
        if (vehicleHit) {
            // Дополнительные попадания в ту же машину бросаются по таблице зон
            // заново — по правилу для множественных попаданий.
            additionalHit.location = additionalHit.zone = _getVehicleZone(
                Math.ceil(CONFIG.Dice.randomUniform() * 100));
            additionalHit.facing = vehicleHit.facing;
        } else {
            additionalHit.location = _getAdditionalLocation(firstLocation, i);
        }
        rollData.damages.push(additionalHit);
    }

    let minDamage = rollData.damages.reduce(
        (min, damage) => min.minDice < damage.minDice ? min : damage, rollData.damages[0]);

    // Атакующий вправе заменить результат одной кости урона числом степеней
    // успеха. Степени берутся из attackDos: при броске урона отдельной кнопкой
    // из карточки rollData.dos равен нулю, и правило не срабатывало вовсе.
    const dosForSwap = Number(rollData.dos) || Number(rollData.attackDos) || 0;
    if (minDamage.minDice < dosForSwap) {
        minDamage.total += (dosForSwap - minDamage.minDice);
        minDamage.replaced = true;
    }
}

function _getHordeDamageBonusDiceFromTarget(target) {
    if (!target || !canvas?.ready) return 0;
    if (target.sceneId && canvas.scene?.id !== target.sceneId) return 0;
    const token = canvas.tokens.get(target.tokenId);
    return _getHordeDamageBonusDiceFromActor(token?.actor);
}

/**
 * Get actor from token on canvas if available, otherwise from collection
 * This ensures we get the actual token actor instance, not the base actor
 * @param {string} actorId - Actor ID
 * @param {string} tokenId - Optional token ID
 * @returns {Actor|null} Actor from token if available, otherwise from collection
 */
function _getActorFromTokenOrCollection(actorId, tokenId = null) {
    // Priority 1: Get actor from token on canvas (token actor instance)
    if (tokenId && canvas?.ready) {
        const token = canvas.tokens.get(tokenId);
        if (token?.actor) {
            return token.actor;
        }
    }
    
    // Priority 2: Try to find token by actor ID on current scene
    if (actorId && canvas?.ready) {
        const tokens = canvas.tokens.placeables.filter(t => t.actor?.id === actorId);
        if (tokens.length > 0) {
            return tokens[0].actor;
        }
    }
    
    // Priority 3: Fall back to actor from collection
    if (actorId) {
        return game.actors.get(actorId);
    }
    
    return null;
}

function _getHordeDamageBonusDiceFromActor(actor) {
    if (!actor) return 0;
    
    // Priority: Get actor from token on canvas if available (token actor instance)
    // This ensures we get the actual horde value from the token, not the base actor
    let tokenActor = actor;
    
    // If actor has a token on canvas, use token actor instead
    if (canvas?.ready && actor.id) {
        const tokens = canvas.tokens.placeables.filter(t => t.actor?.id === actor.id);
        if (tokens.length > 0) {
            tokenActor = tokens[0].actor; // Use token actor (actual instance on canvas)
        }
    }
    
    // Use getter to get horde value from token actor (actual instance on canvas)
    const hordeValue = Number(tokenActor?.horde) || 0;
    if (hordeValue <= 0) return 0;
    return Math.min(Math.floor(hordeValue / 10), 2);
}

/**
 * Calculates the amount of hits of a successful attack
 * @param {int} attackDos Degrees of success on the Attack
 * @param {int} evasionDos Degrees of success on the Evasion
 * @param {object} attackType The mode of attack and its parameters
 * @param {int} shotsFired Number actually achiveable hits
 * @param {object} weaponTraits The traits of the weapon used for the attack
 * @returns {int}  the number of hits the attack has scrored
 */
function _computeNumberOfHits(attackDos, evasionDos, attackType, shotsFired, weaponTraits) {

    // Качество оружия «Штормовое» удваивает попадания. К психическому шторму оно
    // не относится: там число болтов задано ступенями успеха и потолком в
    // психорейтинг, а удвоение сверху давало вдвое больше положенного.
    const psychicStorm = attackType?.name === "storm";
    let stormMod = (weaponTraits.storm && !psychicStorm) ? 2 : 1;
    let maxHits = attackType.maxHits * stormMod;

    let hits = (1 + Math.floor((attackDos - 1) / attackType.hitMargin)) * stormMod;

    // For Storm weapons, max hits cannot exceed double the shots fired
    // For other weapons, max hits cannot exceed shots fired
    if (shotsFired) {
        const maxAllowedHits = shotsFired * stormMod;
        if (maxAllowedHits < maxHits) {
            maxHits = maxAllowedHits;
        }
    }

    if (hits > maxHits) {
        hits = maxHits;
    }

    // Каждая степень успеха уклонения снимает одно попадание, а против
    // Штормового — два: качество удваивает не только попадания, но и то,
    // сколько их снимает уклонение.
    hits -= evasionDos * stormMod;

    // Twin-Linked X1: add one extra hit if attack hit at least once (hits > 0 after evasion)
    // This is applied after calculating base hits, so it's a bonus hit
    let twinLinkedExtraHit = 0;
    if (weaponTraits.twinLinked && hits > 0) {
        twinLinkedExtraHit = 1;
    }

    if (hits <= 0) {
        return 0;
    } else {
        // Add Twin-Linked X1 extra hit only if we have at least one hit
        return hits + twinLinkedExtraHit;
    }
}

/**
 * Roll and compute damage.
 * @param {string} damageFormula
 * @param {number} penetration
 * @param {number} dos
 * @param {boolean} isAiming
 * @param {object} weaponTraits
 * @param {string} weaponClass - Optional: weapon class (pistol, basic, heavy, etc.)
 * @param {string} attackTypeName - Optional: attack type name (standard, single, burst, full, etc.)
 * @returns {object}
 */
async function _computeDamage(damageFormula, penetration, dos, isAiming, weaponTraits, weaponClass = null, attackTypeName = null, rollData = null) {
    let r = new Roll(damageFormula);
    await r.evaluate();
    
    // Apply Primitive trait: limit each die result to the primitive value
    if (weaponTraits.primitive) {
        const primitiveValue = weaponTraits.primitive;
        let totalAdjustment = 0;
        r.terms.forEach(term => {
            if (typeof term === "object" && term !== null && term.results) {
                term.results?.forEach(result => {
                    if (result.active) {
                        const originalResult = result.count !== undefined ? result.count : result.result;
                        if (originalResult > primitiveValue) {
                            const adjustment = primitiveValue - originalResult;
                            totalAdjustment += adjustment;
                            // Update the result
                            if (result.count !== undefined) {
                                result.count = primitiveValue;
                            } else {
                                result.result = primitiveValue;
                            }
                        }
                    }
                });
            }
        });
        // Adjust total if needed
        if (totalAdjustment !== 0) {
            r._total = r.total + totalAdjustment;
        }
    }
    
    // Apply Proven trait: ensure each die result is at least the proven value
    // Check if proven exists and is a valid number
    if (weaponTraits && weaponTraits.proven !== undefined && weaponTraits.proven !== null && weaponTraits.proven !== false) {
        const provenValue = Number(weaponTraits.proven);
        if (!isNaN(provenValue) && provenValue > 0) {
            let totalAdjustment = 0;
            // Process all terms in the roll
            for (const term of r.terms) {
                if (term && typeof term === "object" && term.results) {
                    // Handle Die term results
                    for (const result of term.results || []) {
                        if (result && result.active !== false) {
                            // Get the actual result value
                            let currentValue = result.result;
                            if (result.count !== undefined && result.count !== null) {
                                currentValue = result.count;
                            }
                            
                            // Apply proven minimum
                            if (currentValue < provenValue) {
                                const adjustment = provenValue - currentValue;
                                totalAdjustment += adjustment;
                                
                                // Update both result and count if they exist
                                result.result = provenValue;
                                if (result.count !== undefined) {
                                    result.count = provenValue;
                                }
                            }
                        }
                    }
                }
            }
            // Adjust total if needed
            if (totalAdjustment !== 0) {
                r._total = r.total + totalAdjustment;
                // Force recalculation
                r._evaluated = true;
            }
        }
    }
    
    let damage = {
        total: r.total,
        righteousFury: 0,
        dices: [],
        penetration: penetration,
        dos: dos,
        formula: damageFormula,
        replaced: false,
        damageRender: await r.render(),
        damageRoll: r,
        weaponTraits: weaponTraits
    };

    // Accurate trait: additional damage dice for light weapons on single shot
    // Only applies to light weapons (pistol) and single/standard attacks
    if (weaponTraits.accurate && isAiming) {
        // Правило не ограничивает класс оружия: дополнительные кости даёт любое
        // Точное оружие за прицельный одиночный выстрел. Здесь стояла проверка
        // weaponClass === "pistol", и точные винтовки — те самые, ради которых
        // качество и существует, — не получали их никогда.
        const isSingleShot = attackTypeName === "standard" || attackTypeName === "single" || attackTypeName === "called_shot";

        if (isSingleShot) {
            let numDice = ~~((dos - 1) / 2); // -1 because each degree after the first counts
            if (numDice >= 1) {
                if (numDice > 2) numDice = 2; // Maximum 2d10
                let ar = new Roll(`${numDice}d10`);
                await ar.evaluate();
                
            // Apply Primitive trait to accurate bonus dice as well
            if (weaponTraits.primitive) {
                const primitiveValue = weaponTraits.primitive;
                let accurateAdjustment = 0;
                ar.terms.flatMap(term => term.results).forEach(die => {
                    if (die.active && die.result > primitiveValue) {
                        accurateAdjustment += primitiveValue - die.result;
                        die.result = primitiveValue;
                    }
                });
                if (accurateAdjustment !== 0) {
                    ar._total = ar.total + accurateAdjustment;
                }
            }
            
            // Apply Proven trait to accurate bonus dice as well
            if (weaponTraits.proven) {
                const provenValue = weaponTraits.proven;
                let accurateAdjustment = 0;
                ar.terms.flatMap(term => term.results).forEach(die => {
                    if (die.active && die.result < provenValue) {
                        accurateAdjustment += provenValue - die.result;
                        die.result = provenValue;
                    }
                });
                if (accurateAdjustment !== 0) {
                    ar._total = ar.total + accurateAdjustment;
                }
            }
                
                damage.total += ar.total;
                ar.terms.flatMap(term => term.results).forEach(async die => {
                    if (die.active && die.result < dos) damage.dices.push(die.result);
                    if (die.active && (typeof damage.minDice === "undefined" || die.result < damage.minDice)) damage.minDice = die.result;
                });
                damage.accurateRender = await ar.render();
            }
        }
    }

    // forEach не ждёт асинхронный обработчик: бросок 1d5 на Праведную ярость
    // успевал присвоиться уже после того, как damage уходил наверх, и в карточку
    // он не попадал почти никогда. Отсюда обычный цикл с await.
    for (const term of r.terms) {
        if (typeof term !== "object" || term === null) continue;
        const rfFace = weaponTraits.rfFace ? weaponTraits.rfFace : term.faces; // Without the Vengeful weapon trait rfFace is undefined
        for (const result of (term.results ?? [])) {
            if (!result.active) continue;
            const dieResult = result.count ? result.count : result.result; // Result.count = actual value if modified by term
            if (dieResult >= rfFace) {
                damage.righteousFuryDie = dieResult;
                // Книги считают ярость по-разному: у Dark Heresy это крит, у
                // Rogue Trader — вторая атака и лишние кости урона (стр. 245).
                if (righteousFuryMode(Dh.rulesetFor(_actorFromRollData(rollData)).righteousFury) === EXTRA_DAMAGE) {
                    await _resolveRighteousFuryDamage(damage, rollData);
                } else {
                    damage.righteousFury = await _rollRighteousFury();
                }
            }
            if (dieResult < dos) damage.dices.push(dieResult);
            if (typeof damage.minDice === "undefined" || dieResult < damage.minDice) damage.minDice = dieResult;
        }
    }
    return damage;
}


/**
 * Get actor from ownerId, handling both regular actors and token actors
 * @param {string} ownerId - Actor ID or token ID
 * @param {string} tokenId - Optional token ID from rollData
 * @returns {Promise<Actor|null>} - The actor or null if not found
 */
function _actorFromRollData(rollData) {
    if (!rollData) return null;
    if (rollData.actorUuid) return fromUuidSync(rollData.actorUuid);
    if (rollData.tokenId) {
        const matches = Array.from(game.scenes.values()).map(scene => scene.tokens.get(rollData.tokenId))
            .filter(token => token?.actor && (!rollData.ownerId || token.actor.id === rollData.ownerId));
        return matches.length === 1 ? matches[0].actor : null;
    }
    return game.actors.get(rollData.ownerId) ?? null;
}

async function _getActorFromOwnerId(ownerId, tokenId = null) {
    if (!ownerId && !tokenId) return null;
    // New cards retain a full UUID. Never substitute a base Actor for a missing token.
    if (typeof ownerId === "string" && ownerId.includes(".")) {
        try {
            const doc = await fromUuid(ownerId);
            if (doc?.documentName === "Token") return doc.actor ?? null;
            if (doc?.documentName === "Actor") return doc;
        } catch (err) { console.warn("dark-heresy | Cannot resolve actor", ownerId, err); }
        return null;
    }
    if (tokenId) {
        if (tokenId.includes(".")) {
            try { return (await fromUuid(tokenId))?.actor ?? null; }
            catch (err) { return null; }
        }
        const matches = Array.from(game.scenes.values()).map(scene => scene.tokens.get(tokenId))
            .filter(token => token?.actor && (!ownerId || token.actor.id === ownerId || token.id === ownerId));
        return matches.length === 1 ? matches[0].actor : null;
    }
    return game.actors.get(ownerId) ?? null;
}

/**
 * Evaluate final penetration, by leveraging the dice roll API.
 * @param {object} rollData
 * @returns {number}
 */
async function _rollPenetration(rollData) {
    let penetration = (rollData.weapon.penetrationFormula) ? _replaceSymbols(rollData.weapon.penetrationFormula, rollData) : "0";
    let multiplier = 1;

    // Use attackDos if available, otherwise fall back to dos
    const dos = rollData.attackDos !== undefined ? rollData.attackDos : rollData.dos;
    
    if (dos >= 3) {
        if (penetration.includes("(")) // Legacy Support
        {
            let rsValue = penetration.match(/\(\d+\)/gi); // Get Razorsharp Value
            if (rsValue && rsValue.length > 0) {
                penetration = penetration.replace(/\d+.*\(\d+\)/gi, rsValue[0]); // Replace construct BaseValue(RazorsharpValue) with the extracted value
            }
        } else if (rollData.weapon.traits.razorSharp) {
            multiplier = 2;
        }
    }
    // Мельта прожигает броню вблизи: накоротке пробитие удваивается
    // (BC, стр. 151). Ступень дальности берём из уже посчитанного модификатора,
    // как и Разброс, — второго источника правды о дистанции быть не должно.
    // С Бритвенной остротой множители не перемножаются: удвоение одно.
    if (rollData.weapon.traits.melta && Number(rollData.rangeMod) >= 10) {
        multiplier = 2;
    }
    let r = new Roll(penetration.toString());
    await r.evaluate();
    return r.total * multiplier;
}

/**
 * Roll a Righteous Fury dice, and return the value.
 * @returns {number}
 */
/**
 * Как называется это правило в книге, по которой играет владелец броска.
 * Dark Heresy 2 — Праведная ярость, Black Crusade — Ревностная ненависть.
 * @param {object} rollData
 * @returns {string} ключ локализации
 */
function _righteousFuryLabel(rollData) {
    return Dh.rulesetFor(_actorFromRollData(rollData)).righteousFury.label;
}

async function _rollRighteousFury() {
    let r = new Roll("1d5");
    await r.evaluate();
    return r.total;
}

/**
 * Праведная ярость по Rogue Trader (стр. 245).
 *
 * Десятка на кости урона требует второго броска атаки — того же самого, со всеми
 * модификаторами. Попал — кость урона сверх итога, и пока выпадают десятки, кости
 * идут дальше. Крита эта ярость не даёт вовсе, поэтому damage.righteousFury
 * остаётся нулём: за ним стоит таблица критических эффектов Dark Heresy.
 *
 * @param {object} damage урон этого попадания, меняется на месте
 * @param {object|null} rollData бросок атаки, от которого идёт подтверждение
 */
async function _resolveRighteousFuryDamage(damage, rollData) {
    // Одна ярость на попадание, сколько бы десяток ни легло: книга говорит
    // «если ЛЮБАЯ кость показала натуральную десятку» — это одно событие, а не
    // одно на каждую кость.
    if (damage.righteousFuryExtra !== undefined) return;
    damage.righteousFuryExtra = 0;

    // Второй бросок атаки — тот же самый, со всеми модификаторами.
    const target = rollData?.target?.final;
    const confirm = new Roll("1d100");
    await confirm.evaluate();
    const hit = confirmationHits(confirm.total, target);
    damage.righteousFuryConfirm = {roll: confirm.total, target: Number(target), hit};
    if (!hit) return;

    // «Пока хотя бы одна кость урона показывает натуральную десятку» — цепочка
    // идёт дальше. Предел стоит от бесконечности, а не от правила.
    const dice = [];
    let die = 10;
    for (let rolled = 0; rolled < MAX_CHAIN && explodes(die); rolled++) {
        const extra = new Roll("1d10");
        await extra.evaluate();
        die = extra.total;
        dice.push(die);
    }
    damage.righteousFuryDice = dice;
    damage.righteousFuryExtra = extraDamage(dice);
    damage.total += damage.righteousFuryExtra;
}

/**
 * Check for psychic phenomena (i.e, the user rolled two matching numbers, etc.), and add the result to the rollData.
 * @param {object} rollData
 */
function _computePsychicPhenomena(rollData) {
    // For Bound characters using Psy Rating divided by 2 (not pushing), no phenomena occur
    const psyRules = Dh.rulesetFor(_actorFromRollData(rollData)).psychic;
    const phenomenaRule = psyRules.phenomena;
    const isDouble = _isDouble(rollData.result);
    const isPush = rollData.psy.push && !rollData.psy.isUnbrake;
    // Проталкивание изматывает: дубль на проверке стоит уровня усталости
    // (Deathwatch, стр. 186). Карточка об этом говорит, уровень ставит игрок —
    // как и с феноменом, броска здесь нет и автоматика не нужна.
    rollData.psy.pushFatigue = !!(psyRules.pushFatigueOnDouble && isPush && isDouble);
    // Таблица у каждой книги своя, и на карточке она названа по имени: иначе брат
    // Караула Смерти кидал бы по таблице Dark Heresy, лежащей рядом в том же паке.
    rollData.psy.phenomenaTable = psyRules.phenomenaTable ?? "Psychic Phenomena";

    if (phenomenaRule === "dh2") {
        // Dark Heresy 2 (стр. 194): обычно феномен ловится дублем — в том числе на
        // проваленной проверке. При проталкивании правило переворачивается: феномен
        // даёт любой результат, КРОМЕ дубля.
        rollData.psy.hasPhenomena = isPush ? !isDouble : isDouble;
    } else if (isPush) {
        // Black Crusade (стр. 210): на Push феномен безусловен. «Разгон» Bound с
        // половины рейтинга до полного — это Unfettered, а не Push, сюда он не идёт.
        rollData.psy.hasPhenomena = true;
    } else if (rollData.psy.class === "bound") {
        // Fettered: феноменов не бывает.
        rollData.psy.hasPhenomena = false;
    } else {
        // Unfettered: только на дубле.
        rollData.psy.hasPhenomena = isDouble;
    }
    
    // If Unbound and a double is rolled, mark as unbound status
    if (rollData.psy.class === "unbound" && _isDouble(rollData.result)) {
        rollData.psy.isUnbound = true;
    } else {
        rollData.psy.isUnbound = false;
    }
}

/**
 * Check if a number (d100 roll) has two matching digits.
 * @param {number} number
 * @returns {boolean}
 */
function _isDouble(number) {
    if (number === 100) {
        return true;
    } else {
        const digit = number % 10;
        return number - digit === digit * 10;
    }
}

/**
 * Понять, бьют ли по машине, и с какой стороны.
 *
 * Возвращает null для обычной цели — тогда работает человеческая таблица
 * локаций. Цель берётся из rollData, сторона — из положения токенов на сцене.
 * @param {object} rollData
 * @returns {{token: Token, facing: string}|null}
 */
function _getVehicleHitContext(rollData) {
    const target = rollData?.targets?.[0];
    if (!target || !canvas?.ready) return null;
    const token = canvas.tokens.get(target.tokenId);
    if (token?.actor?.type !== "vehicle") return null;
    // Токен стрелка: сперва тот, чьим листом бросали, потом выделенный на сцене.
    const owner = _actorFromRollData(rollData);
    const attacker = owner?.getActiveTokens?.(true)?.[0] ?? canvas.tokens.controlled[0];
    return { token, facing: _getVehicleFacing(attacker, token) };
}

/**
 * Зона попадания по машине — Таблица 7-29.
 *
 * Число переворачивается так же, как для людей (32 → 23), но сверяется со своей
 * таблицей: ходовая, корпус, орудие, турель.
 * @param {number} result
 * @returns {string}
 */
function _getVehicleZone(result) {
    const toReverse = result < 10 ? `0${result}` : result.toString();
    const zoneTarget = parseInt(toReverse.split("").reverse().join(""));
    if (zoneTarget <= 20) return "motive";
    if (zoneTarget <= 60) return "hull";
    if (zoneTarget <= 80) return "weapon";
    return "turret";
}

/**
 * Сторона машины, в которую пришла атака.
 *
 * Машина поделена на четыре сектора по 90°, отсчёт идёт от её носа: куда
 * смотрит токен, там и лоб. Если позиции на сцене нет — считаем по лбу, как при
 * лобовой атаке, и МИ поправит вручную.
 * @param {Token} attacker
 * @param {Token} target
 * @returns {string}
 */
function _getVehicleFacing(attacker, target) {
    if (!attacker || !target) return "front";
    const dx = attacker.center.x - target.center.x;
    const dy = attacker.center.y - target.center.y;
    if (!dx && !dy) return "front";
    // Токен без поворота смотрит вверх, то есть на −90° в экранных координатах;
    // добавленные 90° переводят угол в отсчёт от носа машины.
    const toAttacker = Math.toDegrees(Math.atan2(dy, dx)) + 90;
    const relative = ((toAttacker - (target.document.rotation || 0)) % 360 + 360) % 360;
    if (relative >= 315 || relative < 45) return "front";
    if (relative < 135) return "rightSide";
    if (relative < 225) return "rear";
    return "leftSide";
}

/**
 * Куда смотрит орудие машины и попадает ли туда цель.
 *
 * Сектор отсчитывается от направления крепления, а оно — от носа машины:
 * лобовое орудие смотрит вперёд, спонсон — вбок, корма — назад. Башня и
 * пинтль держат все 360° и потому проверку проходят всегда.
 * @param {Token} vehicleToken
 * @param {Item} weapon        Орудие с подготовленными `arcTotal` и `system.facing`
 * @param {Token} targetToken
 * @returns {boolean}
 */
function _isInFiringArc(vehicleToken, weapon, targetToken) {
    const arc = Number(weapon.arcTotal) || 0;
    // Круговой обзор проверять нечего; неподвижное крепление с нулевым сектором
    // всё-таки должно уметь стрелять по прямой, поэтому ему даётся узкий клин.
    if (arc >= 360) return true;
    if (!vehicleToken || !targetToken) return true;

    const dx = targetToken.center.x - vehicleToken.center.x;
    const dy = targetToken.center.y - vehicleToken.center.y;
    if (!dx && !dy) return true;

    // Токен без поворота смотрит вверх — те же +90°, что и при выборе стороны.
    const toTarget = Math.toDegrees(Math.atan2(dy, dx)) + 90;
    const relative = ((toTarget - (vehicleToken.document.rotation || 0)) % 360 + 360) % 360;
    const centre = Dh.vehicleFacingAngles[weapon.system.facing] ?? 0;
    let offset = Math.abs(((relative - centre) % 360 + 540) % 360 - 180);
    return offset <= Math.max(arc, 5) / 2;
}

/**
 * Спросить, стрелять ли орудием, которое цель не достаёт сектором.
 *
 * Отказ — не запрет: стол вправе решить, что машина успела довернуть, а фишки
 * на сцене просто стоят не так. Поэтому это вопрос, а не ошибка.
 * @param {Item} weapon
 * @returns {Promise<boolean>}
 */
async function _confirmOutOfArc(weapon) {
    return foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("VEHICLE.ARC_TITLE") },
        content: `<p>${game.i18n.format("VEHICLE.ARC_WARN", {
            name: weapon.name,
            facing: game.i18n.localize(Dh.vehicleFacings[weapon.system.facing] ?? Dh.vehicleFacings.front),
            arc: weapon.arcTotal
        })}</p>`,
        rejectClose: false,
        modal: true
    });
}

/**
 * Спросить, сколько машина прошла до тарана.
 *
 * Каждые полные 10 метров разгона дают таранящей машине лишнюю кость урона.
 * @returns {Promise<number|null>} Метры либо null, если отказались
 */
async function _promptRamRunUp(tracked = 0) {
    const value = await foundry.applications.api.DialogV2.prompt({
        window: { title: game.i18n.localize("VEHICLE.RAM") },
        content: `<div class="dh-dialog"><label>${game.i18n.localize("VEHICLE.RAM_RUN_UP")}
            <input type="number" name="runUp" value="${tracked}" min="0" step="1" /></label></div>`,
        ok: { callback: (event, button) => Number(button.form.elements.runUp.value) || 0 },
        rejectClose: false,
        modal: true
    });
    return value ?? null;
}

/**
 * Кто встал за турельное орудие.
 *
 * Штатного расчёта у него нет, поэтому берём того, кем игрок распоряжается
 * прямо сейчас: выделенный токен, а если его нет — назначенного персонажа.
 * @returns {Actor|null}
 */
function _getPintleGunner() {
    const controlled = canvas?.tokens?.controlled?.find(t => t.actor?.isOwner
        && ["acolyte", "heretic", "npc"].includes(t.actor.type));
    return controlled?.actor ?? (game.user.character?.isOwner ? game.user.character : null);
}

/**
 * Токен машины на текущей сцене.
 * @param {Actor} vehicle
 * @returns {Token|null}
 */
function _getVehicleToken(vehicle) {
    if (!vehicle || !canvas?.ready) return null;
    return vehicle.getActiveTokens?.(true)?.[0] ?? null;
}

/**
 * Get the hit location from a WS/BS roll.
 * @param {number} result
 * @returns {string}
 */
function _getLocation(result) {
    const toReverse = result < 10 ? `0${result}` : result.toString();
    const locationTarget = parseInt(toReverse.split("").reverse().join(""));
    if (locationTarget <= 10) {
        return "ARMOUR.HEAD";
    } else if (locationTarget <= 20) {
        return "ARMOUR.RIGHT_ARM";
    } else if (locationTarget <= 30) {
        return "ARMOUR.LEFT_ARM";
    } else if (locationTarget <= 70) {
        return "ARMOUR.BODY";
    } else if (locationTarget <= 85) {
        return "ARMOUR.RIGHT_LEG";
    } else if (locationTarget <= 100) {
        return "ARMOUR.LEFT_LEG";
    } else {
        return "ARMOUR.BODY";
    }
}

/**
 * Calculate modifiers/etc. from RoF type, and add them to the rollData.
 * @param {object} rollData
 */
/**
 * Подзарядка (BC, стр. 152): выстрелив, оружие пропускает следующий раунд.
 *
 * Отметка живёт на самом оружии, а не в броске: между выстрелами лежит чужой ход,
 * и rollData до него не доживает. Считаем по номеру раунда боя — вне боя правило
 * не применяется, потому что «раунда» там нет, а держать таймер в реальном
 * времени книга не просит.
 *
 * @param {object} rollData
 * @returns {Promise<boolean>} false, если стрелять сейчас нельзя
 */
async function _checkAndMarkRecharge(rollData) {
    if (!rollData?.weapon?.traits?.recharge) return true;

    const round = Number(game.combat?.round) || 0;
    if (!round) return true;

    const actor = await _getActorFromOwnerId(rollData.actorUuid || rollData.ownerId, rollData.tokenId);
    const weapon = actor?.items?.get(rollData.itemId);
    if (!weapon) return true;

    const state = weapon.getFlag("dark-heresy", "rechargeState");
    const firedOn = Number(state?.round ?? weapon.getFlag("dark-heresy", "rechargeFiredRound")) || 0;
    const firedCombat = state?.combatId ?? weapon.getFlag("dark-heresy", "rechargeCombatId");
    if (firedOn > 0 && (!firedCombat || firedCombat === game.combat.id) && round <= firedOn + 1) {
        ui.notifications.warn(game.i18n.format("WEAPON.RECHARGE_WAIT", { weapon: weapon.name }));
        return false;
    }

    await weapon.setFlag("dark-heresy", "rechargeState", {combatId:game.combat.id, round});
    return true;
}

/**
 * Умеет ли оружие стрелять выбранным режимом.
 *
 * Скорострельность записана тремя числами: одиночный, короткая очередь, длинная.
 * Пустое значение означает, что режима у оружия нет, и действие невозможно —
 * до этой проверки такой выстрел разрешался и тихо заканчивался ничем.
 *
 * @param {object} rollData
 * @returns {boolean}
 */
/**
 * Обжечь стрелка перегревшимся оружием (DH2, стр. 149).
 *
 * Урон равен урону самого оружия, тип — энергетический, пробитие нулевое, и
 * приходится он в руку. Владелец вправе вместо этого бросить оружие Свободным
 * действием, поэтому выбор задаётся ему, а не решается за него.
 *
 * @param {object} rollData
 */
async function _burnOverheatWielder(rollData) {
    const actor = _actorFromRollData(rollData);
    const formula = rollData.weapon?.damageFormula;
    if (!actor?.applyDamage || !formula) return;

    const burn = new Roll(String(formula));
    await burn.evaluate();
    const weaponName = rollData.weapon?.name || game.i18n.localize("WEAPON.HEADER");

    const dropped = await foundry.applications.api.DialogV2.confirm({
        window: { title: game.i18n.localize("WEAPON.OVERHEAT_TITLE") },
        content: `<p>${game.i18n.format("WEAPON.OVERHEAT_DROP", {
            weapon: weaponName,
            damage: burn.total
        })}</p>`,
        rejectClose: false,
        modal: true
    });

    // Пистолет держат одной рукой, основное и тяжёлое — двумя, и тогда рука
    // случайна. Класс оружия говорит об этом прямо, в отличие от Громоздкости.
    const twoHanded = ["basic", "heavy"].includes(rollData.weapon?.weaponClass);
    const arm = overheatArm({ twoHanded, roll: Math.random() });
    const hurt = overheatSelfDamage({ damage: burn.total, dropped: !!dropped, arm });

    if (!hurt) {
        const weapon = actor.items?.get?.(rollData.itemId);
        if (weapon) await weapon.update({ "system.equipped": false });
        ui.notifications.info(game.i18n.format("WEAPON.OVERHEAT_DROPPED", { weapon: weaponName }));
        return;
    }

    await actor.applyDamage([{
        ...hurt,
        weaponTraits: {},
        source: game.i18n.localize("WEAPON.OVERHEAT_SOURCE")
    }]);
}

function _weaponSupportsAttackType(rollData) {
    if (!rollData?.weapon?.isRange) {
        return !(rollData.attackType?.name === "lightning"
            && (rollData.weapon?.traits?.unwieldy || rollData.weapon?.traits?.unbalanced));
    }
    // Spray weapons skip the hit roll entirely (DH2 p. 179), so rate of fire
    // never applies to them. prepareCombatRoll relabels them "standard", and
    // demanding rof.single here froze the attack dialog with no message at all.
    if (rollData.weapon?.traits?.skipAttackRoll) return true;

    const rof = rollData.weapon.rateOfFire || {};
    const name = rollData.attackType?.name;
    const needsBurst = name === "semi_auto"
        || (name === "wide_auto" && rollData.wideRofLength !== "full")
        || (name === "suppression" && rollData.suppressionLength !== "full");
    const needsFull = name === "full_auto"
        || (name === "wide_auto" && rollData.wideRofLength === "full")
        || (name === "suppression" && rollData.suppressionLength === "full");

    const has = value => Number(value) > 0;
    // A refusal must say so. This branch returned false without a notification,
    // so any weapon with missing rate-of-fire data failed with no explanation.
    if (["standard", "called_shot"].includes(name) && !has(rof.single)) {
        ui.notifications.warn(game.i18n.format("WEAPON.NO_SINGLE_SHOT", { weapon: rollData.weapon.name || rollData.name }));
        return false;
    }
    if (needsBurst && !has(rof.burst)) {
        ui.notifications.warn(game.i18n.format("WEAPON.NO_SEMI_AUTO", { weapon: rollData.weapon.name || rollData.name }));
        return false;
    }
    if (needsFull && !has(rof.full)) {
        ui.notifications.warn(game.i18n.format("WEAPON.NO_FULL_AUTO", { weapon: rollData.weapon.name || rollData.name }));
        return false;
    }
    return true;
}

function _computeRateOfFire(rollData) {
    switch (rollData.attackType.name) {
        case "standard":
            rollData.attackType.modifier = 10;
            rollData.attackType.hitMargin = 1;
            rollData.attackType.maxHits = 1;
            break;

        case "bolt":
        case "blast":
            rollData.attackType.modifier = 0;
            rollData.attackType.hitMargin = 1;
            rollData.attackType.maxHits = 1;
            break;
        case "wide_auto":
            rollData.attackType.modifier = 0;
            rollData.evasionModifier = -20;
            if (rollData.wideRofLength === "semi") {
                rollData.attackType.hitMargin = 2;
                rollData.attackType.maxHits = Math.max((rollData.weapon.rateOfFire.burst || 0) - 2, 0);
                rollData.attackType.text = game.i18n.localize("ATTACK_TYPE.WIDE_SEMI");
                rollData.attackType.length = "semi";
            } else {
                rollData.attackType.modifier = -10;
                rollData.attackType.hitMargin = 1;
                rollData.attackType.maxHits = Math.max((rollData.weapon.rateOfFire.full || 0) - 2, 0);
                rollData.attackType.text = game.i18n.localize("ATTACK_TYPE.WIDE_FULL");
                rollData.attackType.length = "full";
            }
            break;

        case "swift":
        case "semi_auto":
        case "barrage":
            rollData.attackType.modifier = 0;
            rollData.attackType.hitMargin = 2;
            rollData.attackType.maxHits = rollData.weapon.rateOfFire.burst;
            break;
        case "suppression":
            rollData.attackType.modifier = -20;
            rollData.attackType.hitMargin = 2;
            rollData.evasionModifier = 0;
            if (rollData.suppressionLength === "full") {
                rollData.attackType.maxHits = rollData.weapon.rateOfFire.full;
                rollData.attackType.text = game.i18n.localize("ATTACK_TYPE.SUPPRESSION_FULL");
                rollData.attackType.length = "full";
            } else {
                rollData.attackType.maxHits = rollData.weapon.rateOfFire.burst;
                rollData.attackType.text = game.i18n.localize("ATTACK_TYPE.SUPPRESSION_SEMI");
                rollData.attackType.length = "semi";
            }
            break;

        // Психический шторм (BC, стр. 210; DH2, стр. 198): болтов столько же,
        // сколько ступеней успеха, и не больше эффективного психорейтинга —
        // он лежит в rateOfFire, туда его кладёт createPsychicRollData.
        // Своей ветки не было, и шторм падал в default с одним попаданием,
        // которое качество Storm потом удваивало до двух.
        case "storm":
            rollData.attackType.modifier = 0;
            rollData.attackType.hitMargin = 1;
            rollData.attackType.maxHits = rollData.weapon?.rateOfFire?.full ?? 1;
            break;

        case "lightning":
        case "full_auto":
            rollData.attackType.modifier = -10;
            rollData.attackType.hitMargin = 1;
            rollData.attackType.maxHits = rollData.weapon.rateOfFire.full;
            break;

        case "called_shot":
            rollData.attackType.modifier = -20;
            rollData.attackType.hitMargin = 1;
            rollData.attackType.maxHits = 1;
            break;

        case "charge":
            rollData.attackType.modifier = 20;
            rollData.attackType.hitMargin = 1;
            rollData.attackType.maxHits = 1;
            break;

        case "allOut":
            rollData.attackType.modifier = 30;
            rollData.attackType.hitMargin = 1;
            rollData.attackType.maxHits = 1;
            break;

        default:
            rollData.attackType.modifier = 0;
            rollData.attackType.hitMargin = 0;
            rollData.attackType.maxHits = 1;
            break;
    }
}

const additionalHit = {
    head: ["ARMOUR.HEAD", "ARMOUR.RIGHT_ARM", "ARMOUR.BODY", "ARMOUR.LEFT_ARM", "ARMOUR.BODY"],
    rightArm: ["ARMOUR.RIGHT_ARM", "ARMOUR.RIGHT_ARM", "ARMOUR.HEAD", "ARMOUR.BODY", "ARMOUR.RIGHT_ARM"],
    leftArm: ["ARMOUR.LEFT_ARM", "ARMOUR.LEFT_ARM", "ARMOUR.HEAD", "ARMOUR.BODY", "ARMOUR.LEFT_ARM"],
    body: ["ARMOUR.BODY", "ARMOUR.RIGHT_ARM", "ARMOUR.HEAD", "ARMOUR.LEFT_ARM", "ARMOUR.BODY"],
    rightLeg: ["ARMOUR.RIGHT_LEG", "ARMOUR.BODY", "ARMOUR.RIGHT_ARM", "ARMOUR.HEAD", "ARMOUR.BODY"],
    leftLeg: ["ARMOUR.LEFT_LEG", "ARMOUR.BODY", "ARMOUR.LEFT_ARM", "ARMOUR.HEAD", "ARMOUR.BODY"]
};

/**
 * Get successive hit locations for an attack which scored multiple hits.
 * @param {string} firstLocation
 * @param {number} numberOfHit
 * @returns {string}
 */
function _getAdditionalLocation(firstLocation, numberOfHit) {
    if (firstLocation === "ARMOUR.HEAD") {
        return _getLocationByIt(additionalHit.head, numberOfHit);
    } else if (firstLocation === "ARMOUR.RIGHT_ARM") {
        return _getLocationByIt(additionalHit.rightArm, numberOfHit);
    } else if (firstLocation === "ARMOUR.LEFT_ARM") {
        return _getLocationByIt(additionalHit.leftArm, numberOfHit);
    } else if (firstLocation === "ARMOUR.BODY") {
        return _getLocationByIt(additionalHit.body, numberOfHit);
    } else if (firstLocation === "ARMOUR.RIGHT_LEG") {
        return _getLocationByIt(additionalHit.rightLeg, numberOfHit);
    } else if (firstLocation === "ARMOUR.LEFT_LEG") {
        return _getLocationByIt(additionalHit.leftLeg, numberOfHit);
    } else {
        return _getLocationByIt(additionalHit.body, numberOfHit);
    }
}

/**
 * Lookup hit location from array.
 * @param {Array} part
 * @param {number} numberOfHit
 * @returns {string}
 */
function _getLocationByIt(part, numberOfHit) {
    const index = numberOfHit > (part.length - 1) ? part.length - 1 : numberOfHit;
    return part[index];
}


/**
 * Get degrees of success/failure from a target and a roll.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function _getDegree(a, b) {
    return Math.floor((a - b) / 10);
}
/**
 * Replaces all Symbols in the given Formula with their Respective Values
 * The Symbols consist of Attribute Boni and Psyrating
 * @param {*} formula
 * @param {*} rollData
 * @returns {string}
 */
function _replaceSymbols(formula, rollData) {
    let actor = _actorFromRollData(rollData);
    let attributeBoni = actor?.attributeBoni || rollData.attributeBoni || [];
    const psyValue = rollData.psy ? (Number(rollData.psy.value) || 0) : 0;
    const psyBonus = psyValue;
    // Always replace psy symbols to avoid unresolved StringTerm errors
    formula = formula.replaceAll(/PR/gi, psyValue);
    formula = formula.replaceAll(/PP/gi, psyBonus);
    for (let boni of attributeBoni) {
        formula = formula.replaceAll(boni.regex, boni.value);
    }
    return formula;
}

function _getGenderRange(rollData) {
    const actor = _actorFromRollData(rollData);
    const gender = actor?.system?.bio?.gender;
    switch (gender) {
        case "D0mintarN0siliya":
            return { min: 1, max: 10 };
        case "Gendern0fluid":
            return { min: 10, max: 30 };
        case "Pen1smaster":
            return { min: 10, max: 50 };
        default:
            return null;
    }
}

/**
 * Add a special weapon modifier value to a roll formula.
 * @param {string} formula
 * @param {string} modifier
 * @param {number} value
 * @returns {string}
 */
function _appendNumberedDiceModifier(formula, modifier, value) {
    let diceRegex = /\d+d\d+/;
    if (!formula.includes(modifier)) {
        let match = formula.match(diceRegex);
        if (match) {
            let dice = match[0];
            dice += `${modifier}${value}`;
            formula = formula.replace(diceRegex, dice);
        }
    }
    return formula;
}

/**
 * Add the "tearing" special weapon modifier to a roll formula.
 * @param {string} formula
 * @returns {string}
 */
function _appendTearing(formula) {
    let diceRegex = /\d+d\d+/;
    if (!formula.match(/dl|kh/gi, formula)) { // Already has drop lowest or keep highest
        let match = formula.match(/\d+/g, formula);
        let numDice = parseInt(match[0]) + 1;
        let faces = parseInt(match[1]);
        let diceTerm = `${numDice}d${faces}dl`;
        formula = formula.replace(diceRegex, diceTerm);
    }
    return formula;
}

function _normalizeDamageType(value) {
    if (!value) return "impact";
    const normalized = value.toString().toLowerCase();
    const map = {
        e: "energy",
        i: "impact",
        r: "rending",
        x: "explosive"
    };
    if (map[normalized]) return map[normalized];
    if (["energy", "impact", "rending", "explosive"].includes(normalized)) return normalized;
    return "impact";
}

/**
 * Post a roll to chat.
 * @param {object} rollData
 */
async function _sendRollToChat(rollData) {
    if (rollData?.flags?.isAttack) {
        const targets = Array.isArray(rollData.targets) ? rollData.targets : [];
        if (!targets.length) {
            const currentTargets = DarkHeresyUtil.getCurrentTargets();
            if (currentTargets.length) rollData.targets = currentTargets;
        }
        rollData.flags.hasMultipleTargets = Array.isArray(rollData.targets)
            && rollData.targets.length > 1;
    }
    await _sendSingleRollToChat(rollData);
}

async function _sendSingleRollToChat(rollData) {
    // Requested checks may belong to another character than the selected token.
    const rollingActor = _actorFromRollData(rollData);
    let speaker = rollingActor ? {
        actor:rollingActor.id, alias:rollingActor.name,
        scene:rollingActor.token?.parent?.id ?? canvas?.scene?.id ?? null,
        token:rollingActor.token?.id ?? null
    } : ChatMessage.getSpeaker();
    let chatData = {
        user: game.user.id,
        rollMode: game.settings.get("core", "rollMode"),
        speaker: speaker,
        flags: {
            "dark-heresy.rollData": rollData
        }
    };

    if (speaker.token) {
        rollData.tokenId = speaker.token;
    }

    if (rollData.rollObject && typeof rollData.rollObject.render === "function") {
        rollData.render = await rollData.rollObject.render();
        chatData.rolls = [rollData.rollObject];
    } else {
        delete rollData.rollObject;
    }

    if (rollData.attackType?.name === "none") {
        rollData.attackType = null;
    }
    if (rollData?.flags?.isAttack) {
        if (rollData.rangeMod === undefined || rollData.rangeMod === null) {
            rollData.rangeMod = 0;
        }
        if (!rollData.rangeModText) {
            rollData.rangeModText = game.i18n.localize("RANGE.NONE");
        }
    }

    let html;
    if (rollData.flags.isEvasion) {
            html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/evasion.hbs", rollData);
    } else {
        html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/roll.hbs", rollData);
    }
    chatData.content = html;

    if (["gmroll", "blindroll"].includes(chatData.rollMode)) {
        chatData.whisper = ChatMessage.getWhisperRecipients("GM");
    } else if (chatData.rollMode === "selfroll") {
        chatData.whisper = [game.user];
    }

    ChatMessage.applyRollMode?.(chatData, chatData.rollMode);
    // Optional caller metadata; never replace the system's own roll record.
    for (const [scope,flags] of Object.entries(rollData.messageFlags ?? {})) {
        if (scope !== 'dark-heresy' && scope !== 'core') chatData.flags[scope] = flags;
    }
    return await ChatMessage.create(chatData);
}
/**
 * Post rolled damage to chat.
 * @param {object} rollData
 */
async function sendDamageToChat(rollData) {
    let speaker = ChatMessage.getSpeaker();
    // canRevert is now checked dynamically in renderChatMessage hook based on current user
    let chatData = {
        user: game.user.id,
        rollMode: game.settings.get("core", "rollMode"),
        speaker: speaker,
        flags: {
            "dark-heresy.rollData": rollData
        }
    };

    if (speaker.token) {
        rollData.tokenId = speaker.token;
    }

    const actor = rollData.ownerId ? _actorFromRollData(rollData) : null;
    const item = actor?.items?.get(rollData.itemId);
    if (!rollData.weapon) rollData.weapon = {};
    if (!rollData.weapon.damageType || rollData.weapon.damageType === "none") {
        const fallbackType = item?.damageType
            || item?.system?.damageType
            || item?.system?.damage?.type;
        rollData.weapon.damageType = _normalizeDamageType(fallbackType);
    } else {
        rollData.weapon.damageType = _normalizeDamageType(rollData.weapon.damageType);
    }

    chatData.rolls = rollData.damages.flatMap(r => r.damageRoll);

    rollData.rfLabel = _righteousFuryLabel(rollData);
    const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/damage.hbs", rollData);
    chatData.content = html;

    if (["gmroll", "blindroll"].includes(chatData.rollMode)) {
        chatData.whisper = ChatMessage.getWhisperRecipients("GM");
    } else if (chatData.rollMode === "selfroll") {
        chatData.whisper = [game.user];
    }

    return ChatMessage.create(chatData);
}


/**
 * Show a generic roll dialog.
 * @param {object} rollData
 */
async function prepareCommonRoll(rollData) {
    if (rollData.difficulty && typeof rollData.difficulty === "object") {
        rollData.difficulty = rollData.difficulty.value ?? 0;
    } else if (rollData.difficulty === undefined || rollData.difficulty === null) {
        rollData.difficulty = 0;
    }
    const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/dialog/common-roll.hbs", rollData);
    let dialog = dhDialog({
        title: game.i18n.localize(rollData.name),
        content: html,
        buttons: {
            roll: {
                icon: '<i class="fas fa-check"></i>',
                label: game.i18n.localize("BUTTON.ROLL"),
                callback: async html => {
                    if (rollData.flags?.isEvasion) {
                        const skill = html.find("#selectedSkill")[0];
                        if (skill) {
                            rollData.name = game.i18n.localize(skill.options[skill.selectedIndex].text);
                            rollData.evasions.selected = skill.value;
                        }
                    } else {
                        rollData.name = game.i18n.localize(rollData.name);
                        const selectedOption = html.find("[name=characteristic] :selected");
                        if (selectedOption.length) {
                            rollData.target.base = parseInt(selectedOption.data("target"), 10);
                            rollData.rolledWith = selectedOption.text();
                            rollData.characteristicKey = selectedOption.val();
                        } else {
                        rollData.target.base = parseInt(html.find("#target")[0].value, 10);
                        }
                    }
                    rollData.target.modifier = parseInt(html.find("#modifier")[0].value, 10);
                    const difficulty = html.find("#difficulty")[0];
                    if (difficulty) {
                        const selectedOption = difficulty.options[difficulty.selectedIndex];
                        rollData.difficulty = {
                            value: parseInt(difficulty.value, 10) || 0,
                            text: $(selectedOption).data("baseText") || selectedOption.text
                        };
                    } else {
                        rollData.difficulty = { value: 0, text: game.i18n.localize("DIFFICULTY.CHALLENGING") };
                    }
                    rollData.flags.isDamageRoll = false;
                    rollData.flags.isCombatRoll = false;
                    await commonRoll(rollData);
                    // Точка подключения для тех, кому мало карточки: действия
                    // машины читают степени успеха и вешают на неё последствия.
                    await rollData.afterRoll?.(rollData);
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: game.i18n.localize("BUTTON.CANCEL"),
                callback: () => {}
            }

        },
        default: "roll",
        close: () => {},
        render: html => {
            const formatSigned = value => {
                const num = Number(value) || 0;
                if (num > 0) return `+${num}`;
                if (num < 0) return `${num}`;
                return "0";
            };
            const setOptionLabels = (select, getSuffix) => {
                if (!select?.length) return;
                select.find("option").each((_, opt) => {
                    const option = $(opt);
                    const baseText = option.data("baseText") || option.text();
                    option.data("baseText", baseText);
                    const suffix = getSuffix(option.val(), baseText, option);
                    option.text(suffix ? `${baseText} (${suffix})` : baseText);
                });
            };
            const sel = html.find("select[name=characteristic");
            const target = html.find("#target");
            sel.change(() => {
                const selectedOption = sel.find(":selected");
                target.val(selectedOption.data("target"));
            });
            const initialOption = sel.find(":selected");
            if (initialOption.length) {
                target.val(initialOption.data("target"));
            }
            setOptionLabels(html.find("#difficulty"), value => formatSigned(value));
        }
    }, {
        width: 200
    });
    dialog.render(true);
}

function _promptCalledShotLocation(selected) {
    const locations = [
        Dh.hitLocations.head,
        Dh.hitLocations.body,
        Dh.hitLocations.leftArm,
        Dh.hitLocations.rightArm,
        Dh.hitLocations.leftLeg,
        Dh.hitLocations.rightLeg
    ];
    const options = locations
        .map(loc => {
            const label = game.i18n.localize(loc);
            const isSelected = selected === loc ? "selected" : "";
            return `<option value="${loc}" ${isSelected}>${label}</option>`;
        })
        .join("");
    const content = `
        <div class="dh-dialog">
            <div class="dh-dialog-row">
                <label for="called-shot-location">${game.i18n.localize("CHAT.TARGET")}</label>
                <select id="called-shot-location">
                    ${options}
                </select>
            </div>
        </div>
    `;
    return new Promise(resolve => {
        const dialog = dhDialog({
            title: game.i18n.localize("UI.CALLED_SHOT"),
            content,
            buttons: {
                select: {
                    icon: '<i class="fas fa-check"></i>',
                    label: game.i18n.localize("BUTTON.APPLY") || "Apply",
                    callback: html => {
                        const value = html.find("#called-shot-location")[0]?.value;
                        resolve(value || null);
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize("BUTTON.CANCEL"),
                    callback: () => resolve(null)
                }
            },
            default: "select",
            close: () => resolve(null)
        }, { width: 240 });
        dialog.render(true);
    });
}

/**
 * Calculate distance between two tokens in meters
 * @param {Token} token1 - First token
 * @param {Token} token2 - Second token
 * @returns {number} Distance in meters
 */
function _calculateTokenDistanceInMeters(token1, token2) {
    if (!token1 || !token2 || !canvas?.ready || !canvas?.grid) return null;
    
    // Get grid configuration
    const gridConfig = canvas.scene?.grid;
    if (!gridConfig) return null;
    
    // Get token center coordinates - use getCenter() method if available (like in other parts of the code)
    const center1 = token1.center || (token1.getCenter ? token1.getCenter() : null);
    const center2 = token2.center || (token2.getCenter ? token2.getCenter() : null);
    
    if (!center1 || !center2) {
        console.error("[Dark Heresy Distance] Cannot get token centers", { 
            token1HasCenter: !!token1.center, 
            token1HasGetCenter: !!token1.getCenter,
            token2HasCenter: !!token2.center,
            token2HasGetCenter: !!token2.getCenter
        });
        return null;
    }
    
    const x1 = center1.x;
    const y1 = center1.y;
    const x2 = center2.x;
    const y2 = center2.y;
    
    // Calculate distance using token center coordinates
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distanceInPixels = Math.sqrt(dx * dx + dy * dy);
    
    // Get grid size in pixels (size of one grid square)
    const gridSize = gridConfig.size || 100; // Default 100 pixels per grid square
    
    // Calculate distance in grid units
    const distanceInGridUnits = distanceInPixels / gridSize;
    
    // Get grid unit size and type
    const gridUnitSize = gridConfig.distance || 5; // Size of one grid unit in scene units
    const gridUnits = gridConfig.units || "ft"; // Unit type (ft, m, etc.)
    
    // Convert to meters based on grid units
    let distanceInMeters;
    if (gridUnits.toLowerCase().includes("meter") || gridUnits.toLowerCase().includes("m")) {
        // Grid is already in meters
        distanceInMeters = distanceInGridUnits * gridUnitSize;
    } else if (gridUnits.toLowerCase().includes("foot") || gridUnits.toLowerCase().includes("ft")) {
        // Grid is in feet, convert to meters (1 foot = 0.3048 meters)
        distanceInMeters = distanceInGridUnits * gridUnitSize * 0.3048;
    } else {
        // Default: assume feet if unknown
        distanceInMeters = distanceInGridUnits * gridUnitSize * 0.3048;
    }
    
    return distanceInMeters;
}

/**
 * Automatically determine range modifier based on distance and weapon range
 * @param {object} rollData - Roll data containing weapon and targets
 * @param {DarkHeresyActor} actorRef - Actor making the attack
 * @returns {object} Object with rangeMod (number) and rangeModText (string)
 */
function _determineRangeModifier(rollData, actorRef) {
    // Only for ranged weapons
    if (!rollData?.weapon?.isRange || !rollData?.weapon?.range) {
        return { rangeMod: 0, rangeModText: game.i18n.localize("RANGE.NONE") };
    }
    
    // Need at least one target
    if (!rollData?.targets?.length) {
        return { rangeMod: 0, rangeModText: game.i18n.localize("RANGE.NONE") };
    }
    
    const target = rollData.targets[0];
    if (!target || !canvas?.ready) {
        return { rangeMod: 0, rangeModText: game.i18n.localize("RANGE.NONE") };
    }
    
    // Get actor's token (the one making the attack)
    // We need the actual Token object on the canvas, not TokenDocument
    let actorToken = null;

    // Орудие машины стреляет с машины, а не оттуда, где стоит фишка стрелка:
    // сам он сидит внутри, и его собственный токен на сцене может вообще не
    // стоять. Поэтому у машины приоритет над всеми прочими способами.
    if (rollData?.vehicle?.actorId) {
        const vehicle = game.actors.get(rollData.vehicle.actorId);
        actorToken = (rollData.vehicle.tokenId ? canvas.tokens?.get(rollData.vehicle.tokenId) : null)
            ?? _getVehicleToken(vehicle);
    }

    // Method 1: Find token by actor ID on current scene (most reliable)
    if (!actorToken && actorRef?.id) {
        const tokens = canvas.tokens?.placeables?.filter(t => t.actor?.id === actorRef.id);
        if (tokens && tokens.length > 0) {
            actorToken = tokens[0];
        }
    }
    
    // Method 2: Try to find token by ownerId from rollData
    if (!actorToken && rollData?.ownerId) {
        const tokens = canvas.tokens?.placeables?.filter(t => t.actor?.id === rollData.ownerId);
        if (tokens && tokens.length > 0) {
            actorToken = tokens[0];
        }
    }
    
    // Method 3: If actorRef has token document, try to get Token from canvas
    if (!actorToken && actorRef?.token) {
        const tokenDoc = actorRef.token;
        // If tokenDoc has an id, get the actual Token from canvas
        if (tokenDoc.id) {
            actorToken = canvas.tokens?.get(tokenDoc.id);
        }
    }
    
    // Method 4: Fallback to controlled token
    if (!actorToken && canvas.tokens?.controlled?.length > 0) {
        actorToken = canvas.tokens.controlled[0];
    }
    
    // Verify we have a valid Token object (not TokenDocument)
    if (!actorToken) {
        console.warn("[Dark Heresy Range] Cannot find actor token on canvas");
        return { rangeMod: 0, rangeModText: game.i18n.localize("RANGE.NONE") };
    }
    
    // Verify token is a Token object (has center or getCenter method)
    const hasCenter = actorToken.center !== undefined;
    const hasGetCenter = actorToken.getCenter && typeof actorToken.getCenter === 'function';
    if (!hasCenter && !hasGetCenter) {
        console.warn("[Dark Heresy Range] Actor token is not a valid Token object", {
            tokenType: actorToken.constructor?.name,
            hasCenter,
            hasGetCenter,
            token: actorToken
        });
        return { rangeMod: 0, rangeModText: game.i18n.localize("RANGE.NONE") };
    }
    
    // Get target token
    const targetToken = canvas.tokens.get(target.tokenId);
    if (!targetToken || targetToken.scene?.id !== canvas.scene?.id) {
        return { rangeMod: 0, rangeModText: game.i18n.localize("RANGE.NONE") };
    }
    
    // Calculate distance in meters
    const distanceInMeters = _calculateTokenDistanceInMeters(actorToken, targetToken);
    if (distanceInMeters === null) {
        return { rangeMod: 0, rangeModText: game.i18n.localize("RANGE.NONE") };
    }
    
    const weaponRange = Number(rollData.weapon.range) || 0;
    if (weaponRange <= 0) {
        return { rangeMod: 0, rangeModText: game.i18n.localize("RANGE.NONE") };
    }
    
    // Determine range category based on rules:
    // Order matters - check from most specific to least specific
    
    // 1. Point Blank: exactly 2 meters or less (highest priority, checked first)
    // This takes precedence over all other range calculations
    if (distanceInMeters <= 2.0) {
        return { 
            rangeMod: 30, 
            rangeModText: game.i18n.localize("RANGE.POINT_BLANK") 
        };
    }
    
    // All checks below are for distances > 2 meters
    const halfRange = weaponRange / 2;
    const doubleRange = weaponRange * 2;
    const tripleRange = weaponRange * 3;
    
    // Гиростабилизация не даёт цели считаться дальше Дальней дистанции
    // (BC, стр. 150): предельной для такого оружия просто не бывает.
    const clamp = result => {
        if (rollData?.weapon?.traits?.gyroStabilised && result.rangeMod === -30) {
            return { rangeMod: -10, rangeModText: game.i18n.localize("RANGE.LONG") };
        }
        return result;
    };

    // 2. Extreme: three times weapon range or more
    if (distanceInMeters >= tripleRange) {
        return clamp({
            rangeMod: -30,
            rangeModText: game.i18n.localize("RANGE.EXTREME")
        });
    }
    
    // 3. Long: more than double weapon range (but less than triple)
    if (distanceInMeters > doubleRange) {
        return { 
            rangeMod: -10, 
            rangeModText: game.i18n.localize("RANGE.LONG") 
        };
    }
    
    // 4. Short: less than half weapon range (but more than 2 meters)
    if (distanceInMeters < halfRange) {
        return { 
            rangeMod: 10, 
            rangeModText: game.i18n.localize("RANGE.SHORT") 
        };
    }
    
    // От половины дальности до двойной — обычная дистанция, и книга не даёт
    // ей никакой поправки (стр. 246–247: Короткая — это «меньше половины»).
    // Здесь возвращалась Короткая с её +10, то есть почти любой выстрел получал
    // бесплатный бонус, а Разброс и Мельта — свои льготы не на той дистанции.
    return { 
        rangeMod: 0, 
        rangeModText: game.i18n.localize("RANGE.NONE") 
    };
}

/**
 * Show a combat roll dialog.
 * @param {object} rollData
 * @param {DarkHeresyActor} actorRef
 */
/**
 * Штраф за то, что цель виляет: машина объявила манёвр, и попасть по ней труднее.
 * @param {object} rollData
 * @returns {number} Отрицательное число либо 0
 */
function _getTargetManoeuvrePenalty(rollData) {
    const target = rollData?.targets?.[0];
    if (!target || !canvas?.ready) return 0;
    const actor = canvas.tokens.get(target.tokenId)?.actor;
    if (actor?.type !== "vehicle") return 0;
    return Number(actor.system.manoeuvre?.effect) || 0;
}

async function prepareCombatRoll(rollData, actorRef) {
    rollData.wideRofLength = rollData.wideRofLength || "semi";
    rollData.suppressionLength = rollData.suppressionLength || "semi";
    
    // Automatically determine range modifier for ranged weapons
    if (rollData?.weapon?.isRange && rollData?.targets?.length > 0) {
        // Стрельба в упор не даёт +30, если стрелок и цель сцеплены в ближнем
        // бою (DH2, стр. 231). Расстоянием это не определяется — сцепка есть
        // состояние стола, — поэтому её объявляют тумблером в окне атаки.
        const autoRange = applyMeleeEngagement(
            _determineRangeModifier(rollData, actorRef), rollData.engagedInMelee === true);
        rollData.rangeMod = autoRange.rangeMod;
        rollData.rangeModText = autoRange.rangeModText;
        rollData.pointBlankDenied = autoRange.pointBlankDenied;
    } else {
        // Default to None if not ranged or no targets
        rollData.rangeMod = rollData.rangeMod || 0;
        rollData.rangeModText = rollData.rangeModText || game.i18n.localize("RANGE.NONE");
    }

    // По виляющей машине попасть труднее. Штраф кладётся в общий модификатор, а
    // не прячется в расчёте, чтобы стрелок видел, за что теряет.
    const manoeuvring = _getTargetManoeuvrePenalty(rollData);
    if (manoeuvring) {
        rollData.target.modifier = (Number(rollData.target.modifier) || 0) + manoeuvring;
    }


    const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/dialog/combat-roll.hbs", rollData);
    let dialog = dhDialog({
            title: rollData.name,
            content: html,
            buttons: {
                roll: {
                    icon: '<i class="fas fa-check"></i>',
                    label: game.i18n.localize("BUTTON.ROLL"),
                    callback: async html => {
                        rollData.name = game.i18n.localize(rollData.name);
                        const getBaseText = option => ($(option).data("baseText") || option.text);
                        rollData.target.base = parseInt(html.find("#target")[0]?.value, 10);
                        rollData.target.modifier = parseInt(html.find("#modifier")[0]?.value, 10);
                        const range = html.find("#range")[0];
                        if (range) {
                            rollData.rangeMod = parseInt(range.value, 10);
                            rollData.rangeModText = getBaseText(range.options[range.selectedIndex]);
                        }

                        const attackType = html.find("#attackType")[0];
                        rollData.attackType = {
                            name: attackType?.value,
                            text: getBaseText(attackType?.options[attackType.selectedIndex]),
                            modifier: 0
                        };
                        if (attackType?.value === "wide_auto") {
                            const wideRofLength = html.find("#wideRofLength")[0];
                            if (wideRofLength) {
                                rollData.wideRofLength = wideRofLength.value;
                                rollData.wideRofLengthText = wideRofLength.options[wideRofLength.selectedIndex].text;
                            }
                        }
                        if (attackType?.value === "suppression") {
                            const suppressionLength = html.find("#suppressionLength")[0];
                            if (suppressionLength) {
                                rollData.suppressionLength = suppressionLength.value;
                                rollData.suppressionLengthText = suppressionLength.options[suppressionLength.selectedIndex].text;
                            }
                        }
                    if (rollData.attackType.name === "called_shot") {
                        const calledShotLocation = await _promptCalledShotLocation(rollData.calledShotLocation);
                        if (!calledShotLocation) return;
                        rollData.calledShotLocation = calledShotLocation;
                    }

                        const aim = html.find("#aim")[0];
                        rollData.aim = {
                            val: parseInt(aim?.value, 10),
                            isAiming: aim?.value !== "0",
                            text: getBaseText(aim?.options[aim.selectedIndex])
                        };

                        if (rollData.weapon.traits.inaccurate) {
                            rollData.aim.val=0;
                        }
                        // Note: Accurate trait bonus (+10) is applied in _computeCombatTarget() to avoid double counting

                        rollData.weapon.damageFormula = html.find("#damageFormula")[0].value.replace(" ", "");
                        rollData.weapon.damageType = html.find("#damageType")[0].value;
                        rollData.weapon.damageBonus = parseInt(html.find("#damageBonus")[0].value, 10);
                        rollData.weapon.penetrationFormula = html.find("#penetration")[0].value;

                        // Максимальный режим (BC, стр. 151): дальность +10, урон
                        // +1d10, пробитие +2, радиус Взрыва +2. Правки вносим
                        // прямо в формулы, потому что дальше их читают все —
                        // и бросок урона, и карточка в чате.
                        // Смена режима лазерного оружия (DH2, стр. 185): усиленный
                        // заряд — +1 к урону и двойной расход; перегрузка — +2 к
                        // урону, +2 к пробитию, четверной расход, и оружие теряет
                        // Надёжное, становясь Ненадёжным. Правки идут в формулы и
                        // трейты, потому что дальше их читают и бросок урона, и
                        // проверка заклинивания, и расчёт патронов.
                        if (rollData.weapon.traits.lasSetting) {
                            const setting = html.find("#lasSetting")[0]?.value || "standard";
                            rollData.weapon.lasSetting = setting;
                            if (setting === "overcharge") {
                                rollData.weapon.damageFormula = `${rollData.weapon.damageFormula}+1`;
                            } else if (setting === "maximal") {
                                rollData.weapon.damageFormula = `${rollData.weapon.damageFormula}+2`;
                                rollData.weapon.penetrationFormula = `${rollData.weapon.penetrationFormula || 0}+2`;
                                rollData.weapon.traits.reliable = false;
                                rollData.weapon.traits.unreliable = true;
                            }
                        }

                        // Сцепка в ближнем бою снимает бонус за упор (стр. 231).
                        // Расстоянием её не вывести, поэтому читаем объявление.
                        rollData.engagedInMelee = !!html.find("#engagedInMelee")[0]?.checked;

                        rollData.weapon.useMaximal = !!html.find("#maximal")[0]?.checked;
                        if (rollData.weapon.useMaximal && rollData.weapon.traits.maximal) {
                            rollData.weapon.damageFormula = `${rollData.weapon.damageFormula}+1d10`;
                            rollData.weapon.penetrationFormula = `${rollData.weapon.penetrationFormula || 0}+2`;
                            rollData.weapon.range = (Number(rollData.weapon.range) || 0) + 10;
                            if (Number.isInteger(rollData.weapon.traits.blast)) {
                                rollData.weapon.traits.blast += 2;
                            }
                        }
                        rollData.flags.isDamageRoll = false;
                        rollData.flags.isCombatRoll = true;
                        // Refresh targets right before the roll to capture current selection
                        const currentTargets = DarkHeresyUtil.getCurrentTargets();
                        rollData.targets = currentTargets.length ? [currentTargets[0]] : undefined;

                        if (rollData.weapon.traits.skipAttackRoll) {
                            rollData.attackType.name = "standard";
                        }

                        // Режим огня должен быть у оружия: болтер без автоматического
                        // режима раньше спокойно отыгрывал Длинную очередь и выдавал
                        // успех с нулём попаданий, потому что потолок попаданий
                        // считался от несуществующей скорострельности.
                        if (!_weaponSupportsAttackType(rollData)) return;

                        // Подзарядка: раунд после выстрела оружие копит заряд и
                        // стрелять не может (BC, стр. 152).
                        // Recharge is checked in combatRoll after ammunition validation.

                        // Sync clip from database before checking ammo
                        if (rollData.weapon.isRange) {
                            const actor = await _getActorFromOwnerId(rollData.actorUuid || rollData.ownerId, rollData.tokenId);
                            if (actor) {
                                let currentWeapon = actor.items.get(rollData.itemId);
                                
                                // For token actors, if weapon not found by ID, try to find by name
                                if (!currentWeapon && actor.isToken) {
                                    const weaponName = rollData.weapon?.name || rollData.name;
                                    if (weaponName) {
                                        currentWeapon = actor.items.find(item => 
                                            item.type === "weapon" && item.name === weaponName
                                        );
                                    }
                                }
                                
                                if (currentWeapon) {
                                    const dbClip = currentWeapon.clip || {};
                                    rollData.weapon.clip = {
                                        value: Number(dbClip.value) || 0,
                                        max: Number(dbClip.max) || 0
                                    };
                                }
                            }
                        }

                        // Check ammo before attack
                        const ammoCheck = _checkAmmo(rollData);
                        rollData.shotsFired = ammoCheck.fired;
                        if (!ammoCheck.enough && rollData.weapon.isRange && rollData.weapon.clip.max > 0) {
                            // Not enough ammo - offer reload
                            const actor = await _getActorFromOwnerId(rollData.actorUuid || rollData.ownerId, rollData.tokenId);
                            if (!actor) {
                                console.warn("Dark Heresy: prepareCombatRoll - Actor not found for reload");
                                return;
                            }
                            
                            let weapon = actor.items.get(rollData.itemId);
                            
                            // For token actors, if weapon not found by ID, try to find by name
                            if (!weapon && actor.isToken) {
                                const weaponName = rollData.weapon?.name || rollData.name;
                                if (weaponName) {
                                    weapon = actor.items.find(item => 
                                        item.type === "weapon" && item.name === weaponName
                                    );
                                }
                            }
                            
                            if (weapon) {
                                const messageText = game.i18n.format("DIALOG.RELOAD_MESSAGE", {
                                    required: ammoCheck.required,
                                    available: ammoCheck.available
                                }) || `Недостаточно патронов для выстрела. Требуется: ${ammoCheck.required}, доступно: ${ammoCheck.available}. Перезарядить оружие?`;
                                
                                const reloadDialog = dhDialog({
                                    title: game.i18n.localize("DIALOG.RELOAD_TITLE") || "Недостаточно патронов",
                                    content: `
                                        <div class="dh-dialog">
                                            <p class="dh-dialog-prose">${messageText}</p>
                                        </div>
                                    `,
                                    buttons: {
                                        reload: {
                                            icon: '<i class="fas fa-check"></i>',
                                            label: game.i18n.localize("BUTTON.RELOAD") || "Перезарядить",
                                            callback: async () => {
                                                const reloadResult = await _reloadWeapon(weapon, rollData.ownerId, rollData.tokenId, true);
                                                
                                                if (reloadResult.success) {
                                                    // Update rollData with new clip value
                                                    const updatedActor = await _getActorFromOwnerId(rollData.actorUuid || rollData.ownerId, rollData.tokenId);
                                                    if (updatedActor) {
                                                        let updatedWeapon = updatedActor.items.get(rollData.itemId);
                                                        
                                                        // For token actors, if weapon not found by ID, try to find by name
                                                        if (!updatedWeapon && updatedActor.isToken) {
                                                            const weaponName = rollData.weapon?.name || rollData.name;
                                                            if (weaponName) {
                                                                updatedWeapon = updatedActor.items.find(item => 
                                                                    item.type === "weapon" && item.name === weaponName
                                                                );
                                                            }
                                                        }
                                                        
                                                        if (updatedWeapon) {
                                                            const updatedClip = updatedWeapon.clip || {};
                                                            rollData.weapon.clip.value = Number(updatedClip.value) || Number(updatedClip.max) || 0;
                                                            rollData.weapon.clip.max = Number(updatedClip.max) || 0;
                                                        }
                                                    }
                                                    // Don't proceed automatically - user can click Roll again
                                                } else {
                                                    // Сообщение должно совпадать с тем, что произошло: попап
                                                    // говорил «патронов нет», не различая, кончились они или
                                                    // ни один не подходит стволу.
                                                    const reason = reloadResult.reason === "out_of_ammo"
                                                        ? game.i18n.localize("CHAT.OUT_OF_AMMO")
                                                        : reloadResult.reason === "no_compatible_ammunition"
                                                            ? game.i18n.format("CHAT.RELOAD_NO_COMPATIBLE", { weapon: weapon?.name ?? "" })
                                                            : game.i18n.localize("CHAT.RELOAD_FAILED");
                                                    
                                                    await ChatMessage.create({
                                                        user: game.user.id,
                                                        content: `<div class="dark-heresy chat roll">
                                                            <div class="dh-card is-fail">
                                                                <div class="dh-card-h">
                                                                    <span class="who">${actor?.name || "Unknown"}</span>
                                                                    <span class="verdict">${game.i18n.localize("CHAT.RELOAD_FAILED")}</span>
                                                                </div>
                                                                <div class="dh-card-b">
                                                                    <p class="dh-note">${reason}</p>
                                                                </div>
                                                            </div>
                                                        </div>`
                                                    });
                                                }
                                            }
                                        },
                                        cancel: {
                                            icon: '<i class="fas fa-times"></i>',
                                            label: game.i18n.localize("BUTTON.CANCEL"),
                                            callback: () => {}
                                        }
                                    },
                                    default: "reload"
                                });
                                reloadDialog.render(true);
                                return; // Don't proceed with roll
                            }
                        }

                        await combatRoll(rollData);
                        
                        // Ammo is already consumed inside combatRoll, no need to consume again
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize("BUTTON.CANCEL"),
                    callback: () => {}
                }
            },
            default: "roll",
            close: () => {},
            render: dlgHtml => {
                const formatSigned = value => {
                    const num = Number(value) || 0;
                    if (num > 0) return `+${num}`;
                    if (num < 0) return `${num}`;
                    return "0";
                };
                const setOptionLabels = (select, getSuffix) => {
                    if (!select?.length) return;
                    select.find("option").each((_, opt) => {
                        const option = $(opt);
                        const baseText = option.data("baseText") || option.text();
                        option.data("baseText", baseText);
                        const suffix = getSuffix(option.val(), baseText, option);
                        option.text(suffix ? `${baseText} (${suffix})` : baseText);
                    });
                };

                setOptionLabels(dlgHtml.find("#aim"), value => formatSigned(value));
                setOptionLabels(dlgHtml.find("#range"), value => formatSigned(value));

                // Disable aiming options for inaccurate weapons (only "0" should be available)
                if (rollData.weapon?.traits?.inaccurate) {
                    const aimSelect = dlgHtml.find("#aim");
                    if (aimSelect.length) {
                        const disableAimOption = (value, disabled) => {
                            const option = aimSelect.find(`option[value='${value}']`);
                            if (!option.length) return;
                            option.prop("disabled", disabled);
                            // Add visual styling class
                            if (disabled) {
                                option.addClass("disabled-option");
                            } else {
                                option.removeClass("disabled-option");
                            }
                        };
                        // Disable all aiming options except "0" (no aiming)
                        aimSelect.find("option").each((_, opt) => {
                            const option = $(opt);
                            const value = option.val();
                            if (value !== "0" && value !== "none") {
                                option.prop("disabled", true);
                                option.addClass("disabled-option");
                            }
                        });
                        // Set to "0" if currently aiming
                        const currentAim = aimSelect.val();
                        if (currentAim && currentAim !== "0" && currentAim !== "none") {
                            aimSelect.val("0");
                        }
                    }
                }

                const attackTypeMods = rollData.weapon?.isRange
                    ? {
                        none: null,
                        standard: "+10",
                        semi_auto: "0",
                        full_auto: "-10",
                        wide_auto: "0/-10",
                        suppression: "-20",
                        called_shot: "-20"
                    }
                    : {
                        none: null,
                        standard: "+10",
                        charge: "+20",
                        swift: "0",
                        lightning: "-10",
                        allOut: "+30",
                        called_shot: "-20"
                    };
                setOptionLabels(dlgHtml.find("#attackType"), value => attackTypeMods[value]);
                setOptionLabels(dlgHtml.find("#wideRofLength"), value => (value === "full" ? "-10" : "0"));
                setOptionLabels(dlgHtml.find("#suppressionLength"), value => (value === "full" ? "-20" : "-10"));

                // For melee weapons, disable lightning attack if weapon is unwieldy or unbalanced
                if (!rollData.weapon?.isRange) {
                    const select = dlgHtml.find("#attackType");
                    if (select.length && (rollData.weapon?.traits?.unwieldy || rollData.weapon?.traits?.unbalanced)) {
                        const disableOption = (value, disabled) => {
                            const option = select.find(`option[value='${value}']`);
                            if (!option.length) return;
                            option.prop("disabled", disabled);
                            // Add visual styling class
                            if (disabled) {
                                option.addClass("disabled-option");
                            } else {
                                option.removeClass("disabled-option");
                            }
                        };
                        disableOption("lightning", true);
                        // If lightning was selected, reset to standard
                        const current = select.val();
                        if (current === "lightning") {
                            select.val("standard");
                        }
                    }
                    return;
                }
                const rof = rollData.weapon.rateOfFire || {};
                const canSingle = Number(rof.single) > 0;
                const canBurst = Number(rof.burst) > 0;
                const canFull = Number(rof.full) > 0;
                const canBurstWide = Number(rof.burst) >= 2;
                const canFullWide = Number(rof.full) >= 2;
                const select = dlgHtml.find("#attackType");
                if (!select.length) return;
                const disableOption = (value, disabled) => {
                    const option = select.find(`option[value='${value}']`);
                    if (!option.length) return;
                    option.prop("disabled", disabled);
                };
                disableOption("standard", !canSingle);
                disableOption("called_shot", !canSingle);
                disableOption("semi_auto", !canBurst);
                disableOption("full_auto", !canFull);
                disableOption("wide_auto", !canBurstWide && !canFullWide);
                disableOption("suppression", !canBurst && !canFull);
                const current = select.val();
                const currentOption = select.find(`option[value='${current}']`);
                if (current === "none" || currentOption.prop("disabled")) {
                    const firstEnabled = select
                        .find("option")
                        .filter((_, opt) => !opt.disabled && opt.value !== "none")
                        .first();
                    if (firstEnabled.length) {
                        select.val(firstEnabled.val());
                    }
                }
                const toggleWideAutoFields = () => {
                    const selectedValue = select.val();
                    const wideAutoWrapper = dlgHtml.find(".wide-auto-wrapper");
                    if (selectedValue === "wide_auto") {
                        wideAutoWrapper.show();
                    } else {
                        wideAutoWrapper.hide();
                        dlgHtml.find("#wideRofLength").val("semi");
                    }
                };
                const toggleSuppressionFields = () => {
                    const selectedValue = select.val();
                    const suppressionWrapper = dlgHtml.find(".suppression-wrapper");
                    if (selectedValue === "suppression") {
                        suppressionWrapper.show();
                    } else {
                        suppressionWrapper.hide();
                        dlgHtml.find("#suppressionLength").val("semi");
                    }
                };
                toggleWideAutoFields();
                toggleSuppressionFields();
                const wideSelect = dlgHtml.find("#wideRofLength");
                if (wideSelect.length) {
                    const semiOption = wideSelect.find("option[value='semi']");
                    const fullOption = wideSelect.find("option[value='full']");
                    semiOption.prop("disabled", !canBurstWide);
                    fullOption.prop("disabled", !canFullWide);
                    if (canBurstWide && !canFullWide) wideSelect.val("semi");
                    if (!canBurstWide && canFullWide) wideSelect.val("full");
                }
                const suppressionSelect = dlgHtml.find("#suppressionLength");
                if (suppressionSelect.length) {
                    const semiOption = suppressionSelect.find("option[value='semi']");
                    const fullOption = suppressionSelect.find("option[value='full']");
                    semiOption.prop("disabled", !canBurst);
                    fullOption.prop("disabled", !canFull);
                    if (canBurst && !canFull) suppressionSelect.val("semi");
                    if (!canBurst && canFull) suppressionSelect.val("full");
                }
                dlgHtml.on("change", "#attackType", function () {
                    toggleWideAutoFields();
                    toggleSuppressionFields();
                });
            }
        }, {width: 200});
        dialog.render(true);
}

async function openDirectDamageDialog(rollData) {
    const buildTargetOptions = () => {
        const targets = DarkHeresyUtil.getCurrentTargets();
        if (!targets.length) {
            return `<option value="">—</option>`;
        }
        return targets.map((target, index) => {
            const selected = index === 0 ? "selected" : "";
            const sceneId = target.sceneId ?? "";
            return `<option value="${target.tokenId}" data-scene-id="${sceneId}" ${selected}>${target.name}</option>`;
        }).join("");
    };

    const content = `
        <div class="dh-dialog">
            <div class="dh-dialog-row">
                <label for="hits-count">${game.i18n.localize("CHAT.HITS_COUNT")}</label>
                <input id="hits-count" type="number" value="1" min="1" data-dtype="Number" />
            </div>
            <div class="dh-dialog-row">
                <label for="damage-target">${game.i18n.localize("DIALOG.TARGET")}</label>
                <select id="damage-target">
                    ${buildTargetOptions()}
                </select>
            </div>
        </div>
    `;

    const title = game.i18n.localize("CHAT.ROLL_DAMAGE");
    let hookId = null;
    const dialog = dhDialog({
        title,
        content,
        buttons: {
            ok: {
                icon: "<i class='fas fa-check'></i>",
                label: game.i18n.localize("DIALOG.CONFIRM"),
                callback: async html => {
                    const hits = Math.max(Number(html.find("#hits-count").val()) || 1, 1);
                    const selected = html.find("#damage-target option:selected");
                    const tokenId = selected.val();
                    const sceneId = selected.data("scene-id") || "";
                    const targetName = selected.text();
                    if (!tokenId) {
                        ui.notifications.warn(game.i18n.localize("NOTIFICATION.NO_TARGET_SELECTED"));
                        return;
                    }
                    rollData.numberOfHits = hits;
                    rollData.attackResult = 5;
                    rollData.attackDos = 0;
                    rollData.dos = 0;
                    rollData.aim = { isAiming: false, val: 0, text: "" };
                    rollData.flags = rollData.flags || {};
                    rollData.flags.isDamageRoll = true;
                    rollData.flags.isCombatRoll = false;
                    rollData.flags.isEvasion = false;
                    rollData.flags.isAttack = false;
                    rollData.targets = [{
                        tokenId,
                        sceneId,
                        name: targetName
                    }];
                    await damageRoll(rollData);
                }
            },
            cancel: {
                icon: "<i class='fas fa-times'></i>",
                label: game.i18n.localize("DIALOG.CANCEL")
            }
        },
        default: "ok",
        close: () => {
            if (hookId !== null) {
                Hooks.off("targetToken", hookId);
            }
        }
    }, { width: 280 });
    dialog.render(true);
    hookId = Hooks.on("targetToken", () => {
        const select = dialog.element?.find("#damage-target");
        if (!select?.length) return;
        select.html(buildTargetOptions());
    });
}

// Store reference to the current psychic power dialog to close it when opening a new one
let currentPsychicPowerDialog = null;

/**
 * Show a psychic power roll dialog.
 * @param {object} rollData
 */
async function preparePsychicPowerRoll(rollData) {
    if (rollData.difficulty && typeof rollData.difficulty === "object") {
        rollData.difficulty = rollData.difficulty.value ?? 0;
    } else if (rollData.difficulty === undefined || rollData.difficulty === null) {
        rollData.difficulty = 0;
    }
    // Close previous psychic power dialog if it exists
    if (currentPsychicPowerDialog) {
        currentPsychicPowerDialog.close();
        currentPsychicPowerDialog = null;
    }
    
    const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/dialog/psychic-power-roll.hbs", rollData);
    let dialog = dhDialog({
        title: rollData.name,
        content: html,
        buttons: {
            roll: {
                icon: '<i class="fas fa-check"></i>',
                label: game.i18n.localize("BUTTON.ROLL"),
                callback: async html => {
                    rollData.name = game.i18n.localize(rollData.name);
                    rollData.target.base = parseInt(html.find("#target")[0]?.value, 10);
                    rollData.target.modifier = parseInt(html.find("#modifier")[0]?.value, 10);
                    const difficulty = html.find("#difficulty")[0];
                    if (difficulty) {
                        const selectedOption = difficulty.options[difficulty.selectedIndex];
                        rollData.difficulty = {
                            value: parseInt(difficulty.value, 10) || 0,
                            text: $(selectedOption).data("baseText") || selectedOption.text
                        };
                    } else {
                        rollData.difficulty = { value: 0, text: game.i18n.localize("DIFFICULTY.CHALLENGING") };
                    }
                    rollData.psy.value = parseInt(html.find("#psy")[0].value, 10);
                    rollData.psy.warpConduit = html.find("#warpConduit")[0].checked;
                    rollData.weapon.damageFormula = html.find("#damageFormula")[0].value;
                    rollData.weapon.damageType = html.find("#damageType")[0].value;
                    rollData.weapon.damageBonus = parseInt(html.find("#damageBonus")[0].value, 10);
                    rollData.weapon.penetrationFormula = html.find("#penetration")[0].value;
                    rollData.weapon.rateOfFire = { burst: rollData.psy.value, full: rollData.psy.value };
                    const attackType = html.find("#attackType")[0];
                    rollData.attackType.name = attackType.value;
                    rollData.attackType.text = attackType.options[attackType.selectedIndex].text;
                    rollData.psy.useModifier = true;
                    rollData.flags.isDamageRoll = false;
                    rollData.flags.isCombatRoll = true;
                    await combatRoll(rollData);
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: game.i18n.localize("BUTTON.CANCEL"),
                callback: () => {}
            }
        },
        default: "roll",
        close: () => {
            // Clear reference when dialog is closed
            if (currentPsychicPowerDialog === dialog) {
                currentPsychicPowerDialog = null;
            }
        },
        render: dialogHtml => {
            const formatSigned = value => {
                const num = Number(value) || 0;
                if (num > 0) return `+${num}`;
                if (num < 0) return `${num}`;
                return "0";
            };
            const setOptionLabels = (select, getSuffix) => {
                if (!select?.length) return;
                select.find("option").each((_, opt) => {
                    const option = $(opt);
                    const baseText = option.data("baseText") || option.text();
                    option.data("baseText", baseText);
                    const suffix = getSuffix(option.val(), baseText, option);
                    option.text(suffix ? `${baseText} (${suffix})` : baseText);
                });
            };
            setOptionLabels(dialogHtml.find("#difficulty"), value => formatSigned(value));

            // One value, two controls: drag the slider or type the figure, and the
            // psy bonus follows. This lived in an inline <script> in the template,
            // which cleanHTML strips, so neither the sync nor the bonus ever worked.
            const slider = dialogHtml.find(".psy-rating-slider")[0];
            const figure = dialogHtml.find(".psy-rating-input")[0];
            const bonus = dialogHtml.find(".psy-bonus-display")[0];
            if (!slider || !figure) return;
            const max = Number(slider.max) || 10;
            const sync = source => {
                const rating = Math.max(1, Math.min(Number(source.value) || 1, max));
                slider.value = rating;
                figure.value = rating;
                if (bonus) bonus.textContent = formatSigned(rating * 5);
            };
            slider.addEventListener("input", () => sync(slider));
            figure.addEventListener("input", () => sync(figure));
            sync(figure);
        }
    }, {width: 200});
    
    // Store reference to this dialog
    currentPsychicPowerDialog = dialog;
    dialog.render(true);
}


class DarkHeresyUtil {

    static getCurrentTargets() {
        return Array.from(game.user?.targets || []).map(token => ({
            tokenId: token.id,
            sceneId: token.scene?.id,
            name: token.name
        }));
    }

    static createCommonAttackRollData(actor, item) {
        const targets = this.getCurrentTargets();
        const primaryTarget = targets[0];
        // Внутри горящей машины −20 идёт ко всему подряд, стрельба не исключение.
        const burning = _burningCrewModifier(actor);
        return {
            name: item.name,
            itemName: item.name, // Seperately here because evasion may override it
            // The card header names who acted as well as what they used; without this the
            // chat log showed a weapon with no owner.
            actorName: actor.name,
            actorUuid: actor.uuid,
            ownerId: actor.id,
            itemId: item.id,
            target: {
                base: 0,
                modifier: burning
            },
            weapon: {
                damageBonus: 0,
                damageType: item.damageType
            },
            psy: {
                value: actor.psy.rating,
                display: false
            },
            attackType: {
                name: "standard",
                text: ""
            },
            targets: primaryTarget ? [primaryTarget] : undefined,
            flags: {
                isAttack: true
            }
        };
    }

    static createCommonNormalRollData(actor, value) {
        return {
            target: {
                base: value.displayTotal ?? value.total,
                // Горящая машина мешает всему, что делает сидящий в ней боец.
                modifier: _burningCrewModifier(actor)
            },
            flags: {
                isAttack: false
            },
            actorName: actor.name,
            actorUuid: actor.uuid,
            ownerId: actor.id
        };
    }

    /**
     * Find effect data from CONFIG.statusEffects by key and type
     * @param {string} key - Condition key (id)
     * @param {string} type - Effect type (minor/major), defaults to "minor"
     * @returns {object|undefined} - Effect data or undefined
     */
    static findEffect(key, type = "minor") {
        const statusEffect = CONFIG.statusEffects.find(s => s.id === key);
        if (!statusEffect) {
            return undefined;
        }

        // Тяжесть кладётся во флаги, а не в system: у ActiveEffect в v14 system —
        // типизированное поле и принимает только changes. Раньше findEffect писал
        // system.type, а getCreateData читал флаг, которого не было, поэтому у любого
        // состояния тяжесть выходила «minor» и повышение до «major» не работало.
        return foundry.utils.deepClone({
            ...statusEffect,
            flags: {
                ...(statusEffect.flags || {}),
                "dark-heresy": { ...(statusEffect.flags?.["dark-heresy"] || {}), type }
            }
        });
    }

    /**
     * Get create data for ActiveEffect from effect config
     * @param {object} effectData - Effect data from findEffect
     * @param {string} key - Condition key (id)
     * @returns {object} - Data for creating ActiveEffect
     */
    static getCreateData(effectData, key) {
        if (!effectData) {
            return null;
        }

        // Localize the name
        // Имя приходит ключом локализации. Раньше переводились только ключи
        // CONDITION.*, поэтому «мёртв» с ключом ядра EFFECT.StatusDead попадал в
        // журнал сырой строкой.
        let effectName = effectData.name || effectData.id;
        if (effectData.name && /^[A-Z][A-Z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(effectData.name)) {
            const localized = game.i18n.localize(effectData.name);
            effectName = (localized !== effectData.name) ? localized : (effectData.name || effectData.id);
        }

        // ActiveEffect#system is a core TypeDataField in v14 and only accepts `changes`, so the
        // condition key and severity live in flags. A top-level `key` is not part of the schema
        // either and would be dropped on create.
        const type = effectData.flags?.["dark-heresy"]?.type || "minor";

        // У части состояний есть отдельные значки для малой и большой тяжести —
        // берём их, когда файл существует, иначе остаётся общий.
        const img = (type === "major" && effectData.imgMajor) ? effectData.imgMajor : effectData.img;

        const data = {
            name: type === "major" ? `${effectName} (${game.i18n.localize("CONDITION.MAJOR")})` : effectName,
            img,
            // Значок показывается всегда. По умолчанию v14 рисует его только у
            // эффектов с длительностью, поэтому бессрочные состояния — кровотечение,
            // лежачее положение, схваченность — не появлялись ни в окне инициативы,
            // ни поверх токена: состояние без таймера всё равно состояние.
            showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
            flags: {
                "dark-heresy": { key, type }
            },
            // Use statuses array for token synchronization
            statuses: effectData.statuses || [key]
            // transfer: true (default) automatically syncs statuses to tokens
        };

        // Длительность в раундах. Форма именно такая: v14 хранит срок как
        // {value, units} и нормализует переданное {rounds: n} в неё же, поэтому
        // читать потом надо duration.value, а не duration.rounds.
        // Раунд начала Foundry подставит сама по активному бою, а истёкшее снимает
        // sweepExpiredConditions на смене раунда.
        const rounds = Number(effectData.rounds);
        if (Number.isFinite(rounds) && rounds > 0) {
            data.duration = { value: rounds, units: "rounds" };
        }

        return data;
    }

    static createWeaponRollData(actor, weaponItem) {
        let characteristic = this.getWeaponCharacteristic(actor, weaponItem);
        const characteristicKey = weaponItem.class === "melee" ? "weaponSkill" : "ballisticSkill";
        let rateOfFire;
        if (weaponItem.class === "melee") {
            // Use displayBonus from STATS (the "source of truth") which includes tempModifier
            const bonusValue = characteristic.displayBonus || characteristic.bonus;
            rateOfFire = { single: 1, burst: bonusValue, full: bonusValue };
        } else {
            rateOfFire = {
                single: weaponItem.rateOfFire?.single || 0,
                burst: weaponItem.rateOfFire?.burst || 0,
                full: weaponItem.rateOfFire?.full || 0
            };
        }
        // Заряженный боеприпас правит профиль ствола (BC, стр. 173): ампутаторные
        // снаряды дают +2 к урону и снимают Разброс, «адское пламя» добавляет
        // своё. Раньше эти поля в предмете были, но их не читал никто — патрон
        // менял только строчку в инвентаре.
        const loadedAmmo = this.getLoadedAmmunition(actor, weaponItem);
        const ammoEffect = loadedAmmo?.system?.effect || {};
        const specialWithAmmo = this.applyTraitEdits(weaponItem.special, ammoEffect.special, ammoEffect.removeSpecial);

        const traitOverrides = editTraitOverrides(weaponItem.system?.traitOverrides ?? {}, ammoEffect.special,
            ammoEffect.removeSpecial, text => this.extractWeaponTraits(text));
        let weaponTraits = this.extractWeaponTraits(specialWithAmmo, traitOverrides);
        let isMelee = weaponItem.class === "melee";
        let attributeMod = (isMelee && !weaponItem.damage.match(/SB/gi) ? "+SB" : "");

        let rollData = this.createCommonAttackRollData(actor, weaponItem);

        // Set tokenId if actor is a token actor
        if (actor.isToken && actor.token) {
            rollData.tokenId = actor.token.id;
        }

        const baseTarget = characteristic.displayTotal ?? characteristic.total;
        rollData.target.base = baseTarget + weaponItem.attack
            + (Number(ammoEffect?.attack?.modifier) || 0);
        rollData.characteristicKey = characteristicKey;
        rollData.rangeMod = !isMelee ? 10 : 0;

        // Handle Force weapon property: add psy rating to damage and penetration
        // Force is now a weapon TRAIT from Special field, not a type
        let forcePsyRating = 0;
        let forcePenetrationValue = weaponItem.penetration || "0";
        
        // Check if weapon has Force trait from Special field
        let hasForce = weaponTraits.force === true;
        
        if (hasForce) {
            // Get BASE psy rating from actor (from Advances, not currentRating)
            // Structure is: system.psy.rating (flat, same as used in createPsychicRollData)
            // actor.psy getter returns system.psy, so actor.psy.rating works
            // For Force weapons, we always use BASE rating, not currentRating (which includes sustained)
            let psyRating = 0;
            
            // Primary: via getter - get BASE rating (actor.psy.rating)
            if (actor.psy && actor.psy.rating !== undefined && actor.psy.rating !== null) {
                psyRating = parseInt(actor.psy.rating, 10) || 0;
            }
            // Fallback: direct system access to BASE rating
            else if (actor.system && actor.system.psy && actor.system.psy.rating !== undefined && actor.system.psy.rating !== null) {
                psyRating = parseInt(actor.system.psy.rating, 10) || 0;
            }
            
            forcePsyRating = psyRating;
            
            if (forcePsyRating > 0) {
                // For penetration, calculate base value and add psy rating
                let basePenetration = 0;
                try {
                    // Handle both string and number types
                    let penetrationValue = weaponItem.penetration;
                    let penetrationStr = "";
                    
                    if (penetrationValue === null || penetrationValue === undefined) {
                        penetrationStr = "0";
                    } else if (typeof penetrationValue === 'number') {
                        basePenetration = penetrationValue || 0;
                    } else {
                        penetrationStr = penetrationValue.toString().trim();
                        // If it's a simple number string, parse it directly
                        if (penetrationStr && !isNaN(penetrationStr)) {
                            basePenetration = parseInt(penetrationStr, 10) || 0;
                        } else {
                            // Replace common symbols with 0 to get base numeric value
                            let baseFormula = penetrationStr
                                .replace(/SB/gi, "0")
                                .replace(/TB/gi, "0")
                                .replace(/PR/gi, "0")
                                .replace(/[A-Za-z]+/g, "0"); // Replace any remaining letters with 0
                            try {
                                let tempRoll = new Roll(baseFormula || "0");
                                tempRoll.evaluateSync();
                                basePenetration = tempRoll.total || 0;
                            } catch (e) {
                                // If evaluation fails, try to extract first number
                                let numericMatch = penetrationStr.match(/^(\d+)/);
                                if (numericMatch) {
                                    basePenetration = parseInt(numericMatch[1], 10) || 0;
                                }
                            }
                        }
                    }
                } catch (e) {
                    // If parsing fails, default to 0
                    basePenetration = 0;
                }
                forcePenetrationValue = (basePenetration + forcePsyRating).toString();
            }
        }

        // Build damage formula with Force bonus if applicable
        let damageFormula = weaponItem.damage + attributeMod;
        if (hasForce && forcePsyRating > 0) {
            damageFormula += `+${forcePsyRating}`;
        }
        // Прибавка патрона к урону: у ампутаторных снарядов это +2 (стр. 173).
        const ammoDamage = Number(ammoEffect?.damage?.modifier) || 0;
        if (ammoDamage) {
            damageFormula += `${ammoDamage > 0 ? "+" : ""}${ammoDamage}`;
        }
        // Патрон может нести и своё пробитие — тогда оно заменяет штатное.
        if (ammoEffect?.penetration) {
            forcePenetrationValue = ammoEffect.penetration;
        }

        const hordeBonusDice = _getHordeDamageBonusDiceFromActor(actor);
        if (hordeBonusDice > 0) {
            damageFormula += `+${hordeBonusDice}d10`;
        }
        
        // Get clip data
        const clipData = weaponItem.clip || weaponItem.system?.clip || { value: 0, max: 0 };
        const clip = {
            value: Number(clipData.value) || 0,
            max: Number(clipData.max) || 0
        };
        
        rollData.weapon = foundry.utils.mergeObject(rollData.weapon, {
            isMelee: isMelee,
            isRange: !isMelee,
            ammoName: loadedAmmo?.name || "",
            ammoDamageBonus: Number(ammoEffect?.damage?.modifier) || 0,
            ammoAttackBonus: Number(ammoEffect?.attack?.modifier) || 0,
            weaponClass: weaponItem.class,
            weaponType: weaponItem.subtype || weaponItem.system?.type,
            clip: clip,
            rateOfFire: rateOfFire,
            range: !isMelee ? weaponItem.range : 0,
            damageFormula: damageFormula,
            penetrationFormula: forcePenetrationValue,
            // Режим лазерного оружия выбирается перед каждым выстрелом заново:
            // «по умолчанию обычный» — единственное безопасное состояние, иначе
            // забытая перегрузка молча съест батарею.
            lasSetting: "standard",
            traits: weaponTraits,
            // Строка свойств с учётом заряженного патрона: карточка в чате и
            // разбор трейтов должны видеть одно и то же.
            special: specialWithAmmo
        });
        rollData.hordeDamageBonusDice = hordeBonusDice;
        rollData.hordeBonusApplied = hordeBonusDice > 0;

        return rollData;
    }

    static createPsychicRollData(actor, power) {
        let focusPowerTarget = this.getFocusPowerTarget(actor, power);

        let rollData = this.createCommonAttackRollData(actor, power);
        rollData.target.base= focusPowerTarget.displayTotal ?? focusPowerTarget.total;
        // У психосилы два поля сложности: число в строке «Фокусировка» и список
        // «Сложность». Раньше первое уходило в target.modifier, второе — в
        // difficulty.value, а _computeCommonTarget складывает оба: у 25 сил в
        // паках оба поля заполнены одним числом, и −30 превращалось в −60.
        // Сложность учитываем один раз; список главнее, число — запасной путь
        // для сил, где заполнено только оно.
        const difficultyValue = Number(power.system?.difficulty)
            || Number(power.focusPower?.difficulty) || 0;
        // Обнуление снимает удвоение сложности, но не штраф горящей машины.
        rollData.target.modifier = _burningCrewModifier(actor);
        rollData.difficulty = {
            value: difficultyValue,
            text: game.i18n.localize(Dh.difficulties[difficultyValue] || "DIFFICULTY.CHALLENGING")
        };
        const focusKey = power.focusPower?.test?.toLowerCase();
        if (focusKey && actor.characteristics.hasOwnProperty(focusKey)) {
            rollData.characteristicKey = focusKey;
        } else if (focusKey && actor.skills.hasOwnProperty(focusKey)) {
            const skill = actor.skills[focusKey];
            const short = skill?.defaultCharacteristic || skill?.characteristics?.[0];
            if (short) {
                const match = Object.entries(actor.characteristics)
                    .find(([, char]) => char.short === short);
                if (match) {
                    rollData.characteristicKey = match[0];
                }
            }
        } else {
            const match = Object.entries(actor.characteristics)
                .find(([, char]) => char === focusPowerTarget);
            if (match) {
                rollData.characteristicKey = match[0];
            }
        }
        // Часть свойств книга задаёт не числом, а самим Psy Rating — «Felling
        // (Psy Rating)» у Bolt of Change. Разбор свойств числа в скобках ждёт и
        // такую запись пропускал, поэтому Валящее у психосил не срабатывало.
        // Здесь рейтинг уже известен, так что подставляем его до разбора.
        // Неестественная Сила Воли прибавляет свой множитель к Psy Rating — и к
        // рейтингу, и к ступеням успеха в противоборстве (Deathwatch, стр. 186).
        // Правило книги Караула Смерти: в остальных книгах неестественность
        // рейтинга не касается вовсе.
        const psyRules = Dh.rulesetFor(actor).psychic;
        const willpowerMultiplier = Number(actor.characteristics?.willpower?.unnaturalMultiplier) || 1;
        const unnaturalRating = psyRules.unnaturalWillpowerToRating && willpowerMultiplier > 1
            ? willpowerMultiplier : 0;
        const psyForTraits = (Number(actor.psy.currentRating || actor.psy.rating) || 0) + unnaturalRating;
        const specialWithPsy = String(power.damage.special || "")
            .replace(/\(\s*(?:Psy Rating|PR)\s*\)/gi, `(${psyForTraits})`);

        rollData.weapon = foundry.utils.mergeObject(rollData.weapon, {
            damageFormula: power.damage.formula,
            penetrationFormula: power.damage.penetration,
            traits: this.extractWeaponTraits(specialWithPsy, power.system?.traitOverrides),
            special: specialWithPsy
        });
        rollData.attackType.name = power.damage.zone;

        // Барраж и шторм считают число болтов по Psy Rating, а _computeRateOfFire
        // читает его из того же поля, что и у ствола. Раньше это заполнял только
        // диалог, поэтому rollData из фабрики падал при первом же расчёте — макросы
        // и автоматика психосилами пользоваться не могли.
        const psyClass = actor.psy.class || "bound";
        // Use currentRating (base rating - sustained - sustained powers count) instead of base rating
        let baseCurrentRating = (actor.psy.currentRating || actor.psy.rating || 0) + unnaturalRating;
        let displayedRating = baseCurrentRating;
        
        // If Bound, the displayed Psy Rating is divided by 2 and rounded UP
        if (psyClass === "bound") {
            displayedRating = Math.ceil(baseCurrentRating / 2);
        }
        
        // Ensure value doesn't exceed max (10)
        const maxRating = 10;
        if (displayedRating > maxRating) {
            displayedRating = maxRating;
        }
        
        rollData.psy = {
            value: displayedRating, // Displayed value (already adjusted for Bound and sustained)
            rating: actor.psy.rating, // Base rating (for reference)
            currentRating: baseCurrentRating, // Current rating (base - sustained)
            max: maxRating, // Maximum slider value is always 10
            warpConduit: false,
            display: true,
            class: psyClass, // Store the class (bound/unbound/daemonic)
            useModifier: true,
            unnaturalRating // сколько дала Неестественная Сила Воли — для карточки броска
        };
        // Барраж и шторм считают число болтов по Psy Rating, а _computeRateOfFire
        // читает его из того же поля, что и у ствола.
        rollData.weapon.rateOfFire = { single: 1, burst: displayedRating, full: displayedRating };
        return rollData;
    }

    static createSkillRollData(actor, skillName) {
        const skill = actor.skills[skillName];
        const defaultChar = skill.defaultCharacteristic || skill.characteristics[0];

        let characteristics = this.getCharacteristicOptions(actor, defaultChar);
        // Цель броска должна считаться той же моделью, что и число на листе.
        // Прибавлять сырое продвижение здесь значило показывать одно, а бросать
        // другое: у Rogue Trader необученный базовый идёт на половине
        // характеристики, а не на минус двадцати (стр. 231).
        const skillModel = Dh.rulesetFor(actor).skills?.model ?? "dh2";
        characteristics = characteristics.map(char => {
            if (skillModel === "basicAdvanced") {
                char.target = rtSkillBase({
                    characteristic: char.target,
                    advance: skill.advance,
                    type: rtSkillType(skillName)
                }).base;
            } else {
                char.target += skill.advance;
            }
            return char;
        });
        const defaultCharKey = characteristics.find(char => char.selected)?.key;

        return foundry.utils.mergeObject(this.createCommonNormalRollData(actor, skill), {
            name: skill.label,
            characteristics: characteristics,
            characteristicKey: defaultCharKey
        });
    }

    static createSpecialtyRollData(actor, skillName, specialityName) {
        const skill = actor.skills[skillName];
        const speciality = skill.specialities[specialityName];
        const defaultChar = skill.defaultCharacteristic || skill.characteristics[0];

        let characteristics = this.getCharacteristicOptions(actor, defaultChar);
        // Специализация считается моделью своей группы, как и её число на листе.
        const specialityModel = Dh.rulesetFor(actor).skills?.model ?? "dh2";
        characteristics = characteristics.map(char => {
            if (specialityModel === "basicAdvanced") {
                char.target = rtSkillBase({
                    characteristic: char.target,
                    advance: speciality.advance,
                    type: rtSkillType(skillName)
                }).base;
            } else {
                char.target += speciality.advance;
            }
            return char;
        });
        const defaultCharKey = characteristics.find(char => char.selected)?.key;

        return foundry.utils.mergeObject(this.createCommonNormalRollData(actor, speciality), {
            name: speciality.label,
            characteristics: characteristics,
            characteristicKey: defaultCharKey
        });
    }

    static createCharacteristicRollData(actor, characteristicName) {
        const characteristic = actor.characteristics[characteristicName];
        return foundry.utils.mergeObject(this.createCommonNormalRollData(actor, characteristic), {
            name: characteristic.label,
            characteristicKey: characteristicName
        });
    }

    static createFearTestRolldata(actor) {
        const characteristic = actor.characteristics.willpower;
        return foundry.utils.mergeObject(this.createCommonNormalRollData(actor, characteristic), {
            name: "FEAR.HEADER"
        });
    }

    static createMalignancyTestRolldata(actor) {
        const characteristic = actor.characteristics.willpower;
        return foundry.utils.mergeObject(this.createCommonNormalRollData(actor, characteristic), {
            name: "CORRUPTION.MALIGNANCY",
            target: {
                modifier: this.getMalignancyModifier(actor.corruption)
            }
        });
    }

    static createTraumaTestRolldata(actor) {
        const characteristic = actor.characteristics.willpower;
        return foundry.utils.mergeObject(this.createCommonNormalRollData(actor, characteristic), {
            name: "TRAUMA.HEADER",
            target: {
                modifier: this.getTraumaModifier(actor.insanity, Dh.rulesetFor(actor).insanity.traumaTable ?? "dh2")
            }
        });
    }


    static extractWeaponTraits(traits, overrides = {}) {
    // These weapon traits never go above 9 or below 2
        return applyTraitOverrides({
            accurate: this.hasNamedTrait(/(?<!in)Accurate|Точное/gi, traits),
            // Числа берём нежадно и допускаем две цифры: Primitive (10) читался
            // как 1, а жадная точка цепляла скобку соседнего свойства.
            rfFace: this.extractNumberedTrait(/Vengeful[^,;()]*?\(\d+\)|Мстительное[^,;()]*?\(\d+\)/gi, traits), // The alternativ die face Righteous Fury is triggered on
            devastating: this.extractNumberedTrait(/Devastating[^,;()]*?\(\d+\)|Опустошительное[^,;()]*?\(\d+\)/gi, traits), // Additional horde size reduction on successful hit
            proven: this.extractNumberedTrait(/Proven[^,;()]*?\(\d+\)|Проверенное[^,;()]*?\(\d+\)|Надёжное[^,;()]*?\(\d+\)/gi, traits),
            primitive: this.extractNumberedTrait(/Primitive[^,;()]*?\(\d+\)|Примитивное[^,;()]*?\(\d+\)/gi, traits),
            razorSharp: this.hasNamedTrait(/Razor.?-? *Sharp|Бритвенной остроты|Острое как бритва/gi, traits),
            skipAttackRoll: this.hasNamedTrait(/Spray|Распыление|Распыляющее/gi, traits), // Weapons that skip the attack roll
            tearing: this.hasNamedTrait(/Tearing|Разрывающее/gi, traits),
            storm: this.hasNamedTrait(/Storm|Шторм|Шквальное/gi, traits),
            // Twin-Linked can be either "+10 bonus" or "X1 extra hit"
            // Check for "+10" variant first
            twinLinkedBonus: this.hasNamedTrait(/Twin.?-? *Linked.*\+10|Спаренн(?:ые|ое).*\+10/gi, traits),
            // Check for "X1" variant or default (if just "Twin-Linked" or "Спаренные" without modifier)
            // Only set if NOT twinLinkedBonus (to avoid conflicts)
            twinLinked: (() => {
                const hasBonus = this.hasNamedTrait(/Twin.?-? *Linked.*\+10|Спаренн(?:ые|ое).*\+10/gi, traits);
                if (hasBonus) return false; // Don't set twinLinked if +10 variant is present
                // Check for X1 variant explicitly
                const hasX1 = this.hasNamedTrait(/Twin.?-? *Linked.*[XxХх]1|Спаренн(?:ые|ое).*[XxХх]1/gi, traits);
                if (hasX1) return true;
                // Check for default (just "Twin-Linked" or "Спаренные" without any modifier)
                return this.hasNamedTrait(/Twin.?-? *Linked(?!.*\+10)(?!.*[XxХх]1)|Спаренн(?:ые|ое)(?!.*\+10)(?!.*[XxХх]1)/gi, traits);
            })(),
            force: this.hasNamedTrait(/Force|Психосиловое|Психосиловой/gi, traits),
            inaccurate: this.hasNamedTrait(/Inaccurate|Неточное/gi, traits),
            unwieldy: this.hasNamedTrait(/Unwieldy|Громоздкое/gi, traits),
            reliable: this.hasNamedTrait(/(?<![\p{L}])(?:Reliable|Надёжное|Надежное)(?![\p{L}])/giu, traits),
            unreliable: this.hasNamedTrait(/Unreliable|Ненадёжное|Ненадежное/gi, traits),
            unbalanced: this.hasNamedTrait(/Unbalanced|Несбалансированное/gi, traits),
            // Книга пишет свойство как "Overheats", код искал "Overheating" —
            // ни один ствол из таблицы 5-3 не опознавался. Корень покрывает оба.
            overheating: this.hasNamedTrait(/Overheat|Перегревающееся/gi, traits),
            shock: this.hasNamedTrait(/Shock|Шоковое/gi, traits),
            warpWeapon: this.hasNamedTrait(/Warp Weapon|Оружие Варпа|Варп-оружие/gi, traits),

            // --- Остальные свойства из таблицы книги (BC, стр. 149–153) ---------
            // Разброс: поправка зависит от дистанции, поэтому здесь только факт,
            // а числа выдаёт getScatterModifiers в момент броска.
            scatter: this.hasNamedTrait(/Scatter|Разброс/gi, traits),
            // Максимальный режим — выбор стрелка перед выстрелом.
            maximal: this.hasNamedTrait(/Maximal|Максимальный/gi, traits),
            // Смена режима лазерного оружия (DH2, стр. 185): усиленный заряд и
            // перегрузка. Не путать с плазменным «Максимальным» выше — там свои
            // числа. Лазсамострелы и хот-шот оружие свойство не получают.
            lasSetting: this.hasNamedTrait(/Las Weapon Setting|Las Setting|Смена режима лазерного оружия|Смена режима/gi, traits),
            recharge: this.hasNamedTrait(/Recharge|Подзарядка|Накачка/gi, traits),
            // Мельта удваивает пробитие накоротке (BC, стр. 151).
            melta: this.hasNamedTrait(/Melta(?!gun)|Мельта/gi, traits),
            // Гиростабилизация не даёт цели считаться дальше Дальней дистанции.
            gyroStabilised: this.hasNamedTrait(/Gyro.?-? *Stabilised|Gyro.?-? *Stabilized|Гиростабилизированное/gi, traits),
            // "Flame", но не "Flamer" в названии ствола.
            flame: this.hasNamedTrait(/Flame(?!r)|Пламя|Огненное/gi, traits),

            // Ближний бой: правят парирование, своё и чужое.
            balanced: this.hasNamedTrait(/(?<!Un)(?<!Un-)Balanced|(?<!Не)Сбалансированное/gi, traits),
            defensive: this.hasNamedTrait(/Defensive|Защитное/gi, traits),
            flexible: this.hasNamedTrait(/Flexible|Гибкое/gi, traits),
            powerField: this.hasNamedTrait(/Power Field|Силовое поле/gi, traits),

            // Расчёт урона.
            felling: this.extractNumberedTrait(/Felling[^,;()]*?\(\d+\)|(?:Валящее|Разящее)[^,;()]*?\(\d+\)/gi, traits),
            tainted: this.hasNamedTrait(/Tainted|Осквернённое|Оскверненное/gi, traits),
            sanctified: this.hasNamedTrait(/Sanctified|Освящённое|Освященное/gi, traits),

            // Последствия попадания — проверки цели после применения урона.
            toxic: this.extractNumberedTrait(/Toxic[^,;()]*?\(\d+\)|(?:Токсичное|Отравленное)[^,;()]*?\(\d+\)/gi, traits),
            // Rogue Trader печатает «Toxic» без числа (стр. 118): там проверка идёт
            // от прошедшего урона, а не от рейтинга. Ключ отдельный — чтобы
            // рейтинговое Токсичное других книг читалось ровно как читалось.
            toxicUnrated: this.hasNamedTrait(/Toxic(?!\w)(?!\s*\()|(?:Токсичное|Отравленное)(?!\s*\()/gi, traits),
            concussive: this.extractNumberedTrait(/Concussive[^,;()]*?\(\d+\)|Оглушающее[^,;()]*?\(\d+\)/gi, traits),
            // Шесть видов оружия в компендиуме несут «Corrosive» в тексте свойств,
            // а словарь этого слова не знал: качество вычёркивалось при разборе и
            // не срабатывало ни разу.
            corrosive: this.hasNamedTrait(/Corrosive|Едкое|Разъедающее|Коррозийное/gi, traits),
            snare: this.extractNumberedTrait(/Snare[^,;()]*?\(-?\d+\)|Опутывающее[^,;()]*?\(-?\d+\)/gi, traits),
            // Калечащее задаётся не только числом: у части психосил книга ставит
            // в скобки кость. Система это свойство только объявляет в карточке,
            // поэтому значение хранится строкой — иначе «(1d10)» читалось как 1.
            crippling: this.extractTraitValue(/Crippling[^,;()]*?\(([^)]+)\)|Калечащее[^,;()]*?\(([^)]+)\)/i, traits),
            hallucinogenic: this.extractNumberedTrait(/Hallucinogenic[^,;()]*?\(\d+\)|Галлюциногенное[^,;()]*?\(\d+\)/gi, traits),

            // Площадное: система объявляет радиус в карточке, но сама поле дыма
            // и электромагнитный разряд на сцену не ставит — это работа мастера.
            smoke: this.extractNumberedTrait(/Smoke[^,;()]*?\(\d+\)|Дым[^,;()]*?\(\d+\)/gi, traits),
            haywire: this.extractNumberedTrait(/Haywire[^,;()]*?\(\d+\)|(?:Помехи|Электромагнитное)[^,;()]*?\(\d+\)/gi, traits),
            blast: this.extractNumberedTrait(/Blast[^,;()]*?\(\d+\)|Взрыв[^,;()]*?\(\d+\)/gi, traits)
        }, overrides);
    }

    /**
     * Боеприпас, заряженный в ствол прямо сейчас.
     *
     * Ссылка живёт в `weapon.system.ammo` и хранит то id предмета, то UUID —
     * так сложилось исторически. Разбираем оба вида, а на токене без связи с
     * актёром падаем на поиск по имени: id там свой.
     *
     * @param {Actor} actor владелец
     * @param {Item} weapon ствол
     * @returns {Item|null}
     */
    static getLoadedAmmunition(actor, weapon) {
        const reference = weapon?.system?.ammo;
        if (!reference || !actor) return null;

        if (reference.startsWith("Actor.") || reference.startsWith("Item.")) {
            const resolved = fromUuidSync(reference);
            if (!resolved || resolved.type !== "ammunition") return null;
            return actor.items.get(resolved.id)
                || actor.items.find(item => item.type === "ammunition" && item.name === resolved.name)
                || null;
        }

        const byId = actor.items.get(reference);
        return byId?.type === "ammunition" ? byId : null;
    }

    /**
     * Подходит ли патрон этому стволу (BC, стр. 173, Табл. 5-9).
     *
     * Книга разрешает специальный боеприпас не всякому оружию: ампутаторные
     * снаряды идут в дробовики и револьверы, «адское пламя» — только в болтерное.
     * Раньше это ограничение жило свободным текстом в описании и системой не
     * проверялось.
     *
     * Пустые списки означают «подходит всему»: так ведут себя обычные патроны,
     * и так же будет вести себя патрон, который мастер завёл наспех, не заполнив
     * совместимость. Запрещать по умолчанию нельзя — сломается всё уже собранное.
     *
     * @param {Item} ammunition боеприпас
     * @param {Item} weapon ствол
     * @returns {boolean}
     */
    static ammunitionFitsWeapon(ammunition, weapon) {
        if (!ammunition || !weapon) return false;

        const types = ammunition.system?.weaponTypes || [];
        const classes = ammunition.system?.weaponClasses || [];
        if (!types.length && !classes.length) return true;

        const typeOk = !types.length || types.includes(weapon.system?.type);
        const classOk = !classes.length || classes.includes(weapon.system?.class);
        return typeOk && classOk;
    }

    /**
     * Дописать и вычеркнуть свойства в текстовом поле Special.
     *
     * Свойства оружия живут строкой, и разбирает их регулярками
     * `extractWeaponTraits`. Поэтому модификация правит ту же строку, а не
     * заводит параллельный список: иначе пришлось бы держать два источника
     * правды о том, что это оружие умеет.
     *
     * Удаление работает по началу названия, чтобы «Primitive» убирало и
     * «Primitive (7)» — числовой хвост в записи мода повторять не нужно.
     *
     * @param {string} special исходная строка свойств
     * @param {string} addTraits что дописать, через запятую
     * @param {string} removeTraits что убрать, через запятую
     * @returns {string}
     */
    static applyTraitEdits(special, addTraits, removeTraits) {
        const split = value => String(value || "")
            .split(",")
            .map(part => part.trim())
            .filter(Boolean);

        let traits = split(special);

        for (const removed of split(removeTraits)) {
            const needle = removed.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
            traits = traits.filter(trait => !trait.toLowerCase().startsWith(needle));
        }

        for (const added of split(addTraits)) {
            const needle = added.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
            // Повтор одного и того же свойства ничего не даёт, а в строке мешает.
            if (!traits.some(trait => trait.toLowerCase().startsWith(needle))) {
                traits.push(added);
            }
        }

        return traits.join(", ");
    }

    /**
     * Сдвинуть доступность на несколько ступеней (BC, стр. 170).
     *
     * Положительный сдвиг делает вещь более редкой: каждая модификация
     * поднимает ствол на ступень вверх по шкале Приобретения. Выше Уникального
     * и ниже Вездесущего шкала не идёт, поэтому края обрезаются.
     *
     * @param {string} availability текущая ступень
     * @param {number} steps на сколько ступеней сдвинуть
     * @returns {string}
     */
    static shiftAvailability(availability, steps) {
        const scale = Object.keys(Dh.availability);
        const index = scale.indexOf(availability);
        if (index < 0) return availability;
        const shifted = Math.min(Math.max(index + steps, 0), scale.length - 1);
        return scale[shifted];
    }

    /**
     * Разброс (BC, стр. 152): дробовик тем страшнее, чем ближе цель.
     *
     * Ступень дальности система уже посчитала и положила в `rollData.rangeMod` —
     * второй источник правды о дистанции заводить нельзя, разъедется с первым.
     * Книга даёт три ступени: в упор +10 к попаданию и +3 урона, накоротке ещё
     * +10, на дальней и предельной −3 урона. Средняя не упомянута — там свойство
     * не делает ничего.
     * @param {object} rollData
     * @returns {{attack: number, damage: number}}
     */
    static getScatterModifiers(rollData) {
        const none = { attack: 0, damage: 0 };
        if (!rollData?.weapon?.traits?.scatter) return none;
        switch (Number(rollData.rangeMod)) {
            case 30: return { attack: 10, damage: 3 };   // В упор
            case 10: return { attack: 10, damage: 0 };   // Накоротке
            case -10:                                    // Дальняя
            case -30: return { attack: 0, damage: -3 };  // Предельная
            default: return none;
        }
    }

    static getMaxPsyRating(actor) {
        let base = actor.psy.rating;
        switch (actor.psy.class) {
            case "bound":
                return base + 2;
            case "unbound":
                return base + 4;
            case "daemonic":
                return base + 3;
        }
    }

    static extractNumberedTrait(regex, traits) {
        // Свойства читаются из свободного текста, который может оказаться пустым
        // или отсутствовать вовсе; hasNamedTrait это уже переживал, а здесь
        // undefined ронял разбор всего оружия.
        if (!traits || typeof traits !== "string") {
            return undefined;
        }
        let rfMatch = traits.match(regex);
        if (rfMatch) {
            // Знак сохраняется: часть свойств принимает отрицательное значение —
            // «Snare (−1)» это бонус к проверке, а не её отсутствие. Раньше минус
            // срезался здесь, и даже совпавший внешний шаблон терял его.
            regex = /-?\d+/gi;
            return parseInt(rfMatch[0].match(regex)[0]);
        }
        return undefined;
    }

    /**
     * Достать значение свойства из скобок как есть.
     *
     * Отличается от extractNumberedTrait тем, что не приводит к числу: часть
     * свойств несёт в скобках кость («Crippling (1d10)»), и разбор до первого
     * числа терял бы её. Годится только для свойств, которые система объявляет,
     * а не считает.
     *
     * @param {RegExp} regex - с одной или двумя группами захвата
     * @param {string} traits
     * @returns {string|undefined}
     */
    static extractTraitValue(regex, traits) {
        if (!traits || typeof traits !== "string") {
            return undefined;
        }
        const match = traits.match(regex);
        if (!match) {
            return undefined;
        }
        const value = (match[1] ?? match[2] ?? "").trim();
        return value || undefined;
    }

    static hasNamedTrait(regex, traits) {
        if (!traits || typeof traits !== 'string') {
            return false;
        }
        let rfMatch = traits.match(regex);
        if (rfMatch) {
            return true;
        } else {
            return false;
        }
    }

    static getWeaponCharacteristic(actor, weapon) {
        if (weapon.class === "melee") {
            return actor.characteristics.weaponSkill;
        } else {
            return actor.characteristics.ballisticSkill;
        }
    }

    static getFocusPowerTarget(actor, psychicPower) {
        const normalizeName = psychicPower.focusPower.test.toLowerCase();
        if (actor.characteristics.hasOwnProperty(normalizeName)) {
            return actor.characteristics[normalizeName];
        } else if (actor.skills.hasOwnProperty(normalizeName)) {
            return actor.skills[normalizeName];
        } else {
            return actor.characteristics.willpower;
        }
    }

    static getCharacteristicOptions(actor, selected) {
        const characteristics = [];
        for (let [key, char] of Object.entries(actor.characteristics)) {
            const baseTarget = char.displayTotal ?? char.total;
            characteristics.push({
                key: key,
                label: char.label,
                target: baseTarget,
                selected: char.short === selected
            });
        }
        return characteristics;
    }

    static getMalignancyModifier(corruption) {
        // Пороги живут одним списком в Dh.corruptionPath: лестница ступеней и
        // модификатор проверки — две колонки одной таблицы правил, и расходиться
        // они не должны.
        return Dh.getCorruptionStep(corruption).malignancyModifier;
    }

    static getTraumaModifier(insanity, ruleset = "dh2") {
        // Дорожки безумия у книг разные: у брата Караула Смерти это таблица 9-8,
        // где штраф растёт ступенями по тридцать очков, а не по десять.
        if (ruleset === "dw") return dwTraumaModifier(insanity);
        if (insanity < 10) {
            return 0;
        } else if (insanity < 40) {
            return 10;
        } else if (insanity < 60) {
            return 0;
        } else if (insanity < 80) {
            return -10;
        } else {
            return -20;
        }
    }
}

function effectView(effect) {
    const item = effect.parent?.documentName === "Item" ? effect.parent : null;
    const itemOnly = !!item && effect.transfer === false;
    const state = effect.duration?.expired ? "expired" : effect.disabled ? "disabled"
        : effect.isSuppressed ? "suppressed" : itemOnly ? "itemOnly" : "active";
    return {id:effect.id,uuid:effect.uuid,name:effect.name,img:effect.img || "icons/svg/aura.svg",
        disabled:effect.disabled, inactive:state !== "active", state, stateLabel:`EFFECTS.STATE.${state}`,
        source:item?.name || effect.sourceName || "Actor",item,flags:effect.flags || {},
        statuses:_effectStatuses(effect),isCondition:_effectStatuses(effect).length > 0,
        temporary:effect.isTemporary,itemOnly,expired:!!effect.duration?.expired,
        durationLabel:effect.isTemporary ? effect.duration?.label : null,
        durationValue:Number.isFinite(effect.duration?.value) ? effect.duration.value : null,
        durationUnit:effect.duration?.units ? `EFFECT.DURATION.UNITS.${effect.duration.units}` : null};
}

async function restartEffect(effect) {
    if (!effect) return;
    return effect.update({disabled:false,"duration.expired":false,start:ActiveEffect.getEffectStart()});
}

/**
 * `system` for a sheet template. Native data models serialise only their schema, so the
 * document copy that getData() hands over lacks everything prepareData derived: armour
 * per location, movement, encumbrance, insanity and corruption bonuses. The sheet gets
 * the prepared values instead, as a copy, because some sheets rewrite fields of their
 * context before rendering and must not write into the live document.
 */
function sheetSystem(document) {
    return foundry.utils.deepClone({...document.system});
}

class DarkHeresySheet extends foundry.appv1.sheets.ActorSheet {

    /**
     * The width the layout is drawn for. Panels, table columns and the profile's three
     * columns are all sized against this, and the sheet is then scaled to whatever width
     * the window has. Paired with the default window width below, it lands on a scale of
     * exactly 1, where the type renders crisp rather than through a fractional zoom, and
     * the name column on Advances holds ~423px.
     * @type {number}
     */
    static DESIGN_WIDTH = 800;

    /**
     * The padding the window content adds either side of the form: 8px each side.
     * @type {number}
     */
    static CONTENT_PADDING = 16;

    /**
     * Room for the vertical scrollbar, which appears on the taller tabs and not the
     * short ones. Without allowing for it the sheet opens a shade under scale 1.
     * @type {number}
     */
    static SCROLLBAR_ALLOWANCE = 12;

    /**
     * Scales this close to 1 are snapped to it. Two things want this: the type renders
     * crisp at exactly 1, and the scrollbar coming and going as tabs change would
     * otherwise re-scale the whole sheet by a percent each time it switched.
     * @type {number}
     */
    static SNAP_TOLERANCE = 0.04;

    /** How far the sheet may shrink before it stops scaling. @type {number} */
    static MIN_SCALE = 0.55;

    /** How far it may grow, so a wide window does not balloon the type. */
    static MAX_SCALE = 1.35;

    /**
     * Scale the sheet to the window instead of rearranging it.
     * The layout is laid out once at DESIGN_WIDTH and zoomed to fit whatever width is
     * available, so panels never trade places when the window is dragged. Zoom is
     * used rather than a transform because it participates in layout, which keeps
     * scroll height and pointer targets correct.
     */
    /**
     * The sheet's frame element, or null before it is attached.
     * On a first render `this.element` is still an empty jQuery object, so anything
     * that needs a real node has to check rather than assume.
     * @returns {HTMLElement|null}
     */
    _dhFrame() {
        const raw = this.element;
        if (!raw) return null;
        if (raw.nodeType === 1) return raw;
        const first = raw[0];
        return first?.nodeType === 1 ? first : null;
    }

    _applySheetScale() {
        const frame = this._dhFrame();
        const content = frame?.querySelector(":scope > .window-content");
        if (!content) return;
        const styles = getComputedStyle(content);
        // offsetWidth rather than clientWidth, minus a fixed allowance for the
        // scrollbar. clientWidth shrinks when a scrollbar appears, and it appears on the
        // taller tabs and not the short ones - measuring it would re-scale the whole
        // sheet by a percent or two every time the tab changed.
        const available = content.offsetWidth
            - parseFloat(styles.paddingLeft || 0)
            - parseFloat(styles.paddingRight || 0)
            - DarkHeresySheet.SCROLLBAR_ALLOWANCE;
        if (!(available > 0)) return;
        const design = DarkHeresySheet.DESIGN_WIDTH;
        let scale = Math.min(
            DarkHeresySheet.MAX_SCALE,
            Math.max(DarkHeresySheet.MIN_SCALE, available / design)
        );
        if (Math.abs(scale - 1) <= DarkHeresySheet.SNAP_TOLERANCE) scale = 1;
        const form = content.querySelector(":scope > form");
        if (!form) return;
        form.style.setProperty("--dh-design-width", `${design}px`);
        form.style.setProperty("--dh-sheet-zoom", String(Math.round(scale * 1000) / 1000));
    }

    /** Keep the scale current while the window is dragged. */
    _watchSheetScale() {
        const frame = this._dhFrame();
        if (!frame || this._dhScaleObserver) return;
        this._dhScaleObserver = new ResizeObserver(() => this._applySheetScale());
        this._dhScaleObserver.observe(frame);
    }

    /** @inheritDoc */
    async close(options) {
        this._dhScaleObserver?.disconnect();
        this._dhScaleObserver = null;
        return super.close(options);
    }

    /**
     * Write a field that is shown in two places at once.
     * Wounds appear both in the always-visible header bar and on the combat tab. Two
     * inputs sharing one `name` inside a single form make the submitted value an
     * array - "8,8" - which a number input then refuses to display and every
     * Number() guard downstream reads as 0. The header keeps the real form field;
     * the duplicate carries data-actor-field and writes straight to the actor.
     * @param {Event} event
     */
    async _onRemainingWoundsChange(event) {
        event.preventDefault();event.stopPropagation();
        if(!this.actor.isOwner)return;
        const input=event.currentTarget;
        try {
            if(input.value.trim()==='')throw new Error('Invalid remaining wounds');
            await this.actor.update(remainingWoundsPatch(input.value,this.actor._source.system.wounds.max));
        } catch(error) {ui.notifications.error(game.i18n.localize('WOUND.INVALID_REMAINING'));input.value=remainingWounds(this.actor._source.system.wounds);}
    }

    async _onActorFieldChange(event) {
        event.preventDefault();
        const input = event.currentTarget;
        const field = input.dataset.actorField;
        if (!field) return;
        const value = input.dataset.dtype === "Number" || input.type === "number"
            ? (Number(input.value) || 0)
            : input.value;
        await this.actor.update({ [field]: value });
    }

    /**
     * Clear a jam so the weapon can be fired again.
     * @param {Event} event
     */
    async _onClearJam(event) {
        event.preventDefault();
        event.stopPropagation();
        const itemId = event.currentTarget.closest("[data-item-id]")?.dataset.itemId;
        const weapon = this.actor.items.get(itemId);
        if (!weapon) return;

        // Устранение осечки — Полное действие и проверка Меткости (DH2, стр. 225).
        // Раньше осечка снималась нажатием: ни броска, ни потерянных патронов,
        // ни перезарядки, — и потому не стоила ничего.
        const test = await _rollWeaponEffectTest(this.actor, "ballisticSkill", 0,
            game.i18n.localize("WEAPON.CLEAR_JAM"));

        // У машины своей Меткости нет — за неё бросает наводчик, и этот путь
        // сюда не ведёт. Оставлять орудие заклиненным навсегда нельзя, поэтому
        // для неё осечка снимается как прежде.
        const outcome = test === null
            ? { cleared: true, emptyMagazine: false }
            : resolveJamClear(test);
        if (!outcome.cleared) return;

        await weapon.unsetFlag("dark-heresy", "jammed");

        // «Any ammo in it is lost»: магазин опустошается, и стрелять оружие
        // сможет только после перезарядки.
        if (outcome.emptyMagazine && (Number(weapon.system?.clip?.max) || 0) > 0) {
            await weapon.update({ "system.clip.value": 0 });
        }
    }

    /**
     * Add something to the gear list.
     * With one list there is no per-type "+" to press any more, so the type is asked
     * for once, here, instead of being implied by which of nine headers you clicked.
     * @param {Event} event
     */
    async _onGearCreate(event) {
        event.preventDefault();
        const types = {
            weapon: "TYPES.Item.weapon", armour: "TYPES.Item.armour",
            forceField: "TYPES.Item.forceField", ammunition: "TYPES.Item.ammunition",
            weaponModification: "TYPES.Item.weaponModification", gear: "TYPES.Item.gear",
            tool: "TYPES.Item.tool", drug: "TYPES.Item.drug", cybernetic: "TYPES.Item.cybernetic"
        };
        const options = Object.entries(types)
            .map(([type, key]) => `<option value="${type}">${game.i18n.localize(key)}</option>`)
            .join("");
        const chosen = await new Promise(resolve => {
            // dhDialog builds the dialog but leaves rendering to the caller.
            const dialog = dhDialog({
                title: game.i18n.localize("ITEM.ADD"),
                content: `<div class="dh-dialog">
                        <div class="dh-dialog-row">
                            <label for="gearType">${game.i18n.localize("ITEM.TYPE")}</label>
                            <select id="gearType" name="gearType">${options}</select>
                        </div>
                    </div>`,
                buttons: {
                    create: {
                        label: game.i18n.localize("ITEM.ADD"),
                        callback: html => resolve(html.find("[name='gearType']").val())
                    },
                    cancel: { label: game.i18n.localize("Cancel"), callback: () => resolve(null) }
                },
                default: "create",
                close: () => resolve(null)
            });
            dialog.render(true);
        });
        if (!chosen) return;
        await this.actor.createEmbeddedDocuments("Item", [{
            name: game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(types[chosen]) }),
            type: chosen
        }]);
    }

    activateListeners(html) {
        super.activateListeners(html);
        // Fit the layout to the window on every render, and keep fitting it while the
        // window is dragged.
        this._applySheetScale();
        this._watchSheetScale();
        html.find(".item-create").click(ev => this._onItemCreate(ev));
        html.find(".item-edit").click(ev => this._onItemEdit(ev));
        html.find(".item-delete").click(ev => this._onItemDelete(ev));
        html.find(".item-chat").click(async ev => await this._onItemChat(ev));
        html.find("input").focusin(ev => this._onFocusIn(ev));
        html.find(".roll-characteristic").click(async ev => await this._prepareRollCharacteristic(ev));
        html.find(".roll-skill").click(async ev => await this._prepareRollSkill(ev));
        html.find(".roll-speciality").click(async ev => await this._prepareRollSpeciality(ev));
        html.find(".skill-create").click(async ev => await this._onSkillCreate(ev));
        html.find(".skill-delete").click(async ev => await this._onSkillDelete(ev));
        html.find(".roll-insanity").click(async ev => await this._prepareRollInsanity(ev));
        html.find(".roll-corruption").click(async ev => await this._prepareRollCorruption(ev));
        html.find(".roll-regeneration").click(async ev => await this._prepareRollRegeneration(ev));
        html.find(".roll-weapon").click(async ev => await this._prepareRollWeapon(ev));
        html.find(".roll-weapon-damage").click(async ev => await this._prepareWeaponDamage(ev));
        html.find(".weapon.item").contextmenu(async ev => await this._onWeaponContextMenu(ev));
        html.find(".toggle-equipped").click(async ev => await this._toggleEquipped(ev));
        html.find(".roll-initiative").click(async ev => await this._onRollInitiative(ev));
        html.find(".grapple-test").click(async ev => await this._onGrappleTest(ev));
        html.find(".roll-psychic-power").click(async ev => await this._prepareRollPsychicPower(ev));
        html.find(".roll-psychic-damage").click(async ev => await this._preparePsychicDamage(ev));
        html.find("[data-wounds-remaining]").change(async ev => await this._onRemainingWoundsChange(ev));
        html.find("[data-actor-field]").change(async ev => await this._onActorFieldChange(ev));
        html.find(".clear-jam").click(async ev => await this._onClearJam(ev));
        html.find(".gear-create").click(async ev => await this._onGearCreate(ev));

        // Effects listeners
        html.find(".list-create[data-type='effect']").click(ev => this._onEffectCreate(ev));
        html.find(".list-toggle").click(ev => this._onListToggle(ev));
        html.find(".list-restart").click(ev => { ev.preventDefault(); return restartEffect(this._getDocument(ev)); });
        html.find(".list-delete").click(ev => this._onListDelete(ev));
        html.find(".list-edit").click(ev => this._onListEdit(ev));
        html.find(".pip").click(ev => this._onConditionPipClick(ev));

        this._bindLightningReflexesToggle(html);
        this._bindSpaceMarineToggle(html);
    }

    _onFocusIn(event) {
        $(event.currentTarget).select();
    }

    _bindLightningReflexesToggle(html) {
        const label = html.find(".information.initiative label");
        if (!label.length || !this.actor?.isOwner) return;

        if (!label.find(".dh-lr-toggle").length) {
            // Appearance lives in CSS against the design tokens; state is carried by
            // aria-pressed so it is exposed to assistive tech as well as to the eye.
            label.append($(
                `<button type="button" class="dh-lr-toggle" aria-pressed="false" aria-label="Lightning Reflexes">LR</button>`
            ));
        }

        const updateTitle = async () => {
            const enabled = !!this.actor.getFlag("dark-heresy", "lightningReflexes");
            const state = `Lightning Reflexes: ${enabled ? "ON" : "OFF"}`;
            label.attr("title", state);
            label.find(".dh-lr-toggle")
                .attr({ "aria-pressed": String(enabled), title: state, "data-tooltip": state });
        };

        updateTitle();
        label.find(".dh-lr-toggle").off("click.dhLightningReflexes").on("click.dhLightningReflexes", async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const current = !!this.actor.getFlag("dark-heresy", "lightningReflexes");
            const next = !current;
            await this.actor.setFlag("dark-heresy", "lightningReflexes", next);
            await updateTitle();
            ui.notifications.info(game.i18n.format("NOTIFICATION.REFLEXES_STATE", {state:game.i18n.localize(next ? "UI.ENABLED" : "UI.DISABLED")}));
        });
    }

    _bindSpaceMarineToggle(html) {
        const sizeInput = html.find("input[name='system.size']");
        if (!sizeInput.length || !this.actor?.isOwner) return;
        const label = sizeInput.closest(".information").find("label");
        if (!label.length) return;

        if (!label.find(".dh-sm-toggle").length) {
            // Appearance lives in CSS against the design tokens; state is carried by
            // aria-pressed so it is exposed to assistive tech as well as to the eye.
            const button = $(
                `<button type="button" class="dh-sm-toggle" aria-pressed="false" aria-label="Space Marine">SM</button>`
            );
            label.append(button);
        }

        const updateTitle = async () => {
            const enabled = !!this.actor.getFlag("dark-heresy", "spaceMarine");
            label.attr("title", `Space Marine: ${enabled ? "ON" : "OFF"}`);
            const state = `Space Marine: ${enabled ? "ON" : "OFF"}`;
            label.find(".dh-sm-toggle")
                .attr({ "aria-pressed": String(enabled), title: state, "data-tooltip": state })
                .text(enabled ? "SM ON" : "SM");
        };

        updateTitle();
        label.find(".dh-sm-toggle").off("click.dhSpaceMarine").on("click.dhSpaceMarine", async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const current = !!this.actor.getFlag("dark-heresy", "spaceMarine");
            const next = !current;
            await this.actor.setFlag("dark-heresy", "spaceMarine", next);
            await updateTitle();
            ui.notifications.info(game.i18n.format("NOTIFICATION.MARINE_STATE", {state:game.i18n.localize(next ? "UI.ENABLED" : "UI.DISABLED")}));
        });
    }

    /** @override */
    async getData() {
        const data = super.getData();
        data.system = sheetSystem(this.document);
        // The stored figures, before active effects are applied. An editable field bound
        // to a value that effects have already modified writes that modified value back
        // on the next submit, and the effect then adds its bonus on top again - so the
        // characteristic climbs a little every time the tab is saved. Fields that write
        // to the actor use these; fields that only display use data.system.
        data.source = this.actor._source.system;
        data.items = this.constructItemLists(data);
        data.enrichment = await this._enrichment();
        
        // Prepare effects data for the effects tab
        data.effects = this.organizeEffects(data);
        data.conditions = this.formatConditions(data);
        // Аптитьюды — механика Dark Heresy: у еретика цену задаёт покровитель,
        // и панель на вкладке продвижения ему нечем заполнять.
        data.hasAptitudes = this.actor?.type !== "heretic";

        // Инициативу бросают от характеристики, и выбирать её надо из тех, что у
        // книги есть. Список брался из всех подряд, поэтому лист Rogue Trader
        // предлагал Влияние — показатель, который сам же и прячет. Выбрать спрятанное
        // значит бросать по пустому месту.
        data.presentCharacteristics = Object.fromEntries(
            Object.entries(data.system?.characteristics ?? {}).filter(([, c]) => !c.absent));

        return data;
    }

    /**
     * Organize effects into active, passive, and disabled categories
     */
    organizeEffects() {
        const groups = {active:[], passive:[], disabled:[], itemOnly:[]};
        if (!this.actor) return groups;
        const effects = [...(this.actor.effects ?? []), ...Array.from(this.actor.items ?? [])
            .flatMap(item => Array.from(item.effects ?? []))];
        for (const effect of effects.sort((a,b) => (a.name || '').localeCompare(b.name || ''))) {
            const view = effectView(effect);
            if (view.itemOnly) groups.itemOnly.push(view);
            else if (view.inactive) groups.disabled.push(view);
            else groups[view.temporary ? 'active' : 'passive'].push(view);
        }
        return groups;
    }

    /**
     * Format conditions for display (like impmal)
     */
    formatConditions(data) {
        // Get status effects from CONFIG
        const conditions = foundry.utils.deepClone(CONFIG.statusEffects || []);
        
        // For now, all conditions are boolean (no tiered support yet)
        // In future, can add game.darkHeresy.config.tieredCondition similar to impmal
        conditions.forEach(c => {
            c.boolean = true; // All conditions are boolean for now
            c.existing = this.actor.hasCondition(c.id);
            c.opacity = 30;

            // Conditions have 1 or 2 pips, two for minor/major
            // If condition exists on actor, it must have at least one filled pip
            c.pips = [{ filled: !!c.existing, type: "minor" }];

            // If not boolean (minor/major), add another pip, filled if major
            // For now, we only support boolean conditions
            // if (!c.boolean) {
            //     c.pips.push({ filled: c.existing?.isMajor, type: "major" });
            // }

            if (c.boolean && c.existing) {
                c.opacity = 100;
            }
            // else if (c.existing?.isMinor) {
            //     c.opacity = 60;
            // }

            // Localize the status name
            let localizedName = c.name || c.id;
            if (c.name && (c.name.startsWith("CONDITION.") || c.name.startsWith("EFFECT."))) {
                const localized = game.i18n.localize(c.name);
                localizedName = (localized !== c.name) ? localized : (c.name || c.id);
            }
            c.name = localizedName;
        });

        return conditions;
    }

    async _enrichment() {
        let enrichment = {};
        if (this.actor.type !== "npc") {
            enrichment["system.bio.notes"] = await foundry.applications.ux.TextEditor.implementation.enrichHTML(this.actor.system.bio.notes);
        } else {
            enrichment["system.notes"] = await foundry.applications.ux.TextEditor.implementation.enrichHTML(this.actor.system.notes);
        }
        return foundry.utils.expandObject(enrichment);
    }

    /** @override */
    get template() {
        if (!game.user.isGM && this.actor.limited) {
            return "systems/dark-heresy/template/sheet/actor/limited-sheet.hbs";
        } else {
            return this.options.template;
        }
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        if (this.actor.isOwner) {
            buttons = [
                {
                    label: game.i18n.localize("BUTTON.ROLL"),
                    class: "custom-roll",
                    icon: "fas fa-dice",
                    onclick: async () => await this._prepareCustomRoll()
                }
            ].concat(buttons);
        }
        return buttons;
    }

    _onItemCreate(event) {
        event.preventDefault();
        let header = event.currentTarget.dataset;

        let data = {
            name: `New ${game.i18n.localize(`TYPES.Item.${header.type.toLowerCase()}`)}`,
            type: header.type
        };
        
        // Для NPC автоматически активируем оружие, броню и force field
        if (this.actor.type === "npc" && (header.type === "weapon" || header.type === "armour" || header.type === "forceField")) {
            data.system = { equipped: true };
        }
        
        this.actor.createEmbeddedDocuments("Item", [data], { renderSheet: true });
    }

    _onItemEdit(event) {
        event.preventDefault();
        const div = $(event.currentTarget).closest("[data-item-id]");
        let item = this.actor.items.get(div.data("itemId"));
        if (item) {
        item.sheet.render(true);
        }
    }

    _onItemDelete(event) {
        event.preventDefault();
        const div = $(event.currentTarget).closest("[data-item-id]");
        const itemId = div.data("itemId");
        this.actor.deleteEmbeddedDocuments("Item", [itemId]);
        div.slideUp(200, () => this.render(false));
    }

    async _onItemChat(event) {
        event.preventDefault();
        const div = $(event.currentTarget).closest("[data-item-id]");
        const itemId = div.data("itemId");
        if (!itemId) {
            console.warn("Item ID not found");
            return;
        }
        const item = this.actor.items.get(itemId);
        if (!item) {
            console.warn(`Item with ID ${itemId} not found`);
            return;
        }
        if (typeof item.sendToChat === "function") {
            await item.sendToChat();
        } else {
            console.warn("sendToChat method not found on item", item);
        }
    }

    // ============================================
    // Effects Handlers
    // ============================================

    /**
     * Get document from event (effect or item)
     */
    _getDocument(event) {
        // Try both .list-item and .effect.item selectors
        const li = $(event.currentTarget).closest(".list-item, .effect.item");
        const collection = this._getCollection(event);
        const id = li.data("id");
        const uuid = li.data("uuid");
        
        if (collection === "effects") {
            if (uuid) {
                const candidates = [...this.actor.effects.values(), ...Array.from(this.actor.items ?? []).flatMap(item => Array.from(item.effects?.values() ?? []))];
                return candidates.find(effect => effect.uuid === uuid) ?? null;
            }
            // First try to find in actor effects
            if (id) {
                const actorEffect = this.actor.effects.get(id);
                if (actorEffect) return actorEffect;
            } else if (uuid) {
                const actorEffect = this.actor.effects.find(e => e.uuid === uuid);
                if (actorEffect) return actorEffect;
            }
            
            // If not found in actor, search in item effects
            if (this.actor.items) {
                for (const item of this.actor.items) {
                    if (item.effects) {
                        if (id) {
                            const itemEffect = item.effects.get(id);
                            if (itemEffect) return itemEffect;
                        } else if (uuid) {
                            const itemEffect = item.effects.find(e => e.uuid === uuid);
                            if (itemEffect) return itemEffect;
                        }
                    }
                }
            }
            
            return null;
        } else if (collection === "items") {
            if (id) {
                return this.actor.items.get(id);
            }
        }
        
        return null;
    }

    /**
     * Get collection name from event
     */
    _getCollection(event) {
        // Try both .list-item and .effect.item selectors
        const li = $(event.currentTarget).closest(".list-item, .effect.item");
        return li.data("collection") || "items";
    }

    /**
     * Get ID from event
     */
    _getId(event) {
        // Try both .list-item and .effect.item selectors
        const li = $(event.currentTarget).closest(".list-item, .effect.item");
        return li.data("id") || li.data("uuid");
    }

    /**
     * Create a new effect
     */
    async _onEffectCreate(ev) {
        ev.preventDefault();
        const category = ev.currentTarget.dataset.category || "passive";
        
        let effectData = {
            name: game.i18n.localize("EFFECTS.TITLE"),
            img: "icons/svg/aura.svg"
        };

        // Set duration for temporary effects
        if (category === "temporary") {
            effectData.duration = {
                value: 1, units: "rounds"
            };
        } else if (category === "disabled") {
            effectData.disabled = true;
        }

        // If Item effect, use item name for effect name
        if (this.object.documentName === "Item") {
            effectData.name = this.object.name;
        }

        const effects = await this.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        if (effects.length > 0) {
            const effect = effects[0];
            
            // Effect with statuses array automatically applies to tokens via transfer: true
            // No manual toggleStatusEffect needed (like impmal)
            
            effect.sheet.render(true);
        }
    }

    /**
     * Toggle effect enabled/disabled
     */
    async _onListToggle(event) {
        event.preventDefault();
        const document = this._getDocument(event);
        
        if (!document) return;

        const newDisabled = !document.disabled;
        await document.update({ disabled: newDisabled });
        
        // Effect with statuses array automatically syncs with tokens via transfer: true
        // No manual toggleStatusEffect needed (like impmal)
        
        // Force sheet update to reflect changes in conditions
        this.render(false);
    }

    /**
     * Delete effect or item
     */
    async _onListDelete(event) {
        event.preventDefault();
        const document = this._getDocument(event);
        const collection = this._getCollection(event);
        
        if (!document) return;

        const docName = collection === "effects" ? "ActiveEffect" : "Item";
        const title = game.i18n.localize(`Delete${docName}`);
        const content = `<p>${game.i18n.localize(`Delete${docName}Confirmation`)}</p>`;

        await foundry.applications.api.DialogV2.confirm({
            window: {title},
            content,
            yes: {
                default: true,
                callback: async () => {
                    // When effect is deleted, statuses are automatically removed via transfer: true
                    // No manual toggleStatusEffect needed (like impmal)
                    await document.delete();
                    // Force sheet update to reflect changes in conditions
                    this.render(false);
                }
            }
        });
    }

    /**
     * Edit effect or item
     */
    async _onListEdit(event) {
        event.preventDefault();
        event.stopPropagation();
        
        // Check if this is a link to an item (has data-uuid)
        const uuid = $(event.currentTarget).data("uuid");
        if (uuid) {
            try {
                const item = await fromUuid(uuid);
                if (item) {
                    item.sheet.render(true);
                    return;
                }
            } catch (err) {
                console.warn("Failed to resolve UUID:", uuid, err);
            }
        }
        
        // Otherwise, get the document from the parent element
        const document = this._getDocument(event);
        
        if (document) {
            document.sheet.render(true);
        }
    }

    /**
     * Handle condition pip click (like impmal)
     */
    async _onConditionPipClick(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        
        const key = ev.currentTarget.dataset.key;
        const type = ev.currentTarget.dataset.type || "minor";
        const existing = this.actor.hasCondition(key);

        if (!existing || (existing?.system?.type === "minor" && type === "major")) {
            await this.actor.addCondition(key, { type });
        } else {
            await this.actor.removeCondition(key);
        }
    }

    async _prepareCustomRoll() {
        const rollData = {
            name: "DIALOG.CUSTOM_ROLL",
            baseTarget: 50,
            modifier: 0,
            ownerId: this.actor.id
        };
        await prepareCommonRoll(rollData);
    }

    async _prepareRollCharacteristic(event) {
        event.preventDefault();
        const characteristicName = $(event.currentTarget).data("characteristic");
        await prepareCommonRoll(
            DarkHeresyUtil.createCharacteristicRollData(this.actor, characteristicName)
        );
    }

    async _prepareRollSkill(event) {
        event.preventDefault();
        const skillName = $(event.currentTarget).data("skill");
        if (this._refuseUntrainedAdvanced(this.actor.system?.skills?.[skillName])) return;
        await prepareCommonRoll(
            DarkHeresyUtil.createSkillRollData(this.actor, skillName)
        );
    }

    /**
     * Отказать в проверке, которой книга не допускает.
     *
     * «Untrained Advanced Skill: Cannot perform a test with this Skill» (стр. 231).
     * Это именно запрет, а не трудная проверка: бросить и провалиться — значит
     * потратить действие и оставить в чате запись о попытке, которой не было.
     *
     * @param {object} skill навык или специализация
     * @returns {boolean} отказано ли
     */
    _refuseUntrainedAdvanced(skill) {
        if (!skill?.unusable) return false;
        ui.notifications.warn(game.i18n.localize("SKILL.UNTRAINED_ADVANCED"));
        return true;
    }

    async _prepareRollSpeciality(event) {
        event.preventDefault();
        const skillName = $(event.currentTarget).parents(".item").data("skill");
        const specialityName = $(event.currentTarget).data("speciality");
        const speciality = this.actor.system?.skills?.[skillName]?.specialities?.[specialityName];
        if (this._refuseUntrainedAdvanced(speciality)) return;
        await prepareCommonRoll(
            DarkHeresyUtil.createSpecialtyRollData(this.actor, skillName, specialityName)
        );
    }

    /**
     * Delete a hand-added skill.
     * Only the Custom group is deletable: the template groups - Common Lore, Trade and
     * the rest - are part of the game's skill list, and removing an entry from them
     * would just have it restored from the template on the next render. Until now there
     * was no way to remove a custom skill at all.
     * @param {Event} event
     */
    async _onSkillDelete(event) {
        event.preventDefault();
        event.stopPropagation();
        const row = event.currentTarget.closest("[data-speciality]");
        const skillKey = row?.dataset.skill;
        const specialityKey = row?.dataset.speciality;
        if (skillKey !== "custom" || !specialityKey) return;

        const label = this.actor.system.skills.custom?.specialities?.[specialityKey]?.label
            ?? specialityKey;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: {title: game.i18n.localize("SKILL.DELETE_CUSTOM")},
            classes: ["dark-heresy-dialog"],
            content: `<div class="dh-dialog"><p class="dh-dialog-prose">${
                game.i18n.format("SKILL.DELETE_CONFIRM", {name: label})}</p></div>`
        });
        if (!confirmed) return;

        // The -= prefix removes the key rather than writing over the object, which would
        // take the rest of the group's specialities with it.
        await this.actor.update({
            [`system.skills.custom.specialities.-=${specialityKey}`]: null
        });
    }

    async _onSkillCreate(event) {
        event.preventDefault();
        
        // Get list of characteristics for selection
        const characteristics = Object.entries(this.actor.characteristics).map(([key, char]) => ({
            key: key,
            label: game.i18n.localize(char.label) || char.label,
            short: char.short
        }));
        
        // The characteristic is always asked for. It used to be asked only when the
        // Custom group did not exist yet, so the first skill somebody added decided the
        // characteristic for every one after it - with no way to see that, let alone
        // change it. Each skill now carries its own.
        const html = `
            <div class="dh-dialog">
                <div class="dh-dialog-row">
                    <label for="skillName">${game.i18n.localize("SKILL.NAME")}</label>
                    <input id="skillName" type="text" name="skillName" required />
                </div>
                <div class="dh-dialog-row">
                    <label for="characteristic">${game.i18n.localize("SKILL.CHARACTERISTIC")}</label>
                    <select id="characteristic" name="characteristic" required>
                        ${characteristics.map(char => `<option value="${char.short}">${char.label} (${char.short})</option>`).join("")}
                    </select>
                </div>
            </div>
        `;

        dhDialog({
            title: game.i18n.localize("SKILL.CREATE_CUSTOM"),
            content: html,
            buttons: {
                create: {
                    icon: '<i class="fas fa-check"></i>',
                    label: game.i18n.localize("BUTTON.CREATE"),
                    callback: async (html) => {
                        const skillName = (html.find("[name='skillName']").val() ?? "").trim();

                        if (!skillName) {
                            ui.notifications.warn(game.i18n.localize("SKILL.NAME_REQUIRED"));
                            return;
                        }
                        
                        // Create speciality key from the name. The old slug kept only
                        // [a-z0-9], so any Cyrillic name collapsed to an empty key -
                        // the skill was stored under "" and a second one overwrote it.
                        // Unicode letters and digits are kept, and anything that still
                        // ends up empty falls back to a key that cannot collide.
                        let specialityKey = skillName.toLowerCase()
                            .replace(/[^\p{L}\p{N}]+/gu, "_")
                            .replace(/^_+|_+$/g, "");
                        if (!specialityKey) specialityKey = `skill_${Date.now().toString(36)}`;
                        
                        const characteristic = html.find("[name='characteristic']").val();
                        if (!characteristic) {
                            ui.notifications.warn(game.i18n.localize("SKILL.CHARACTERISTIC_REQUIRED"));
                            return;
                        }

                        // Check if Custom skill exists
                        let customSkill = this.actor.system.skills.custom;
                        const updateData = {};

                        if (!customSkill) {
                            // Create Custom skill first. Its own characteristic is only a
                            // fallback now; each speciality names its own.
                            updateData["system.skills.custom"] = {
                                label: "Custom",
                                characteristics: [characteristic],
                                advance: -20,
                                isSpecialist: true,
                                specialities: {},
                                aptitudes: [],
                                starter: false,
                                cost: 0
                            };
                            customSkill = updateData["system.skills.custom"];
                        }
                        
                        // Check if speciality already exists
                        if (customSkill.specialities && customSkill.specialities[specialityKey]) {
                            ui.notifications.warn(game.i18n.localize("SKILL.ALREADY_EXISTS"));
                            return;
                        }
                        
                        // Create speciality data. It carries the characteristic it rolls
                        // against, so two hand-added skills can use different ones.
                        const specialityData = {
                            label: skillName,
                            characteristics: [characteristic],
                            advance: -20, // Untrained by default
                            starter: false,
                            cost: 0
                        };
                        
                        // Add speciality to Custom skill
                        if (!updateData["system.skills.custom"]) {
                            updateData["system.skills.custom"] = foundry.utils.deepClone(customSkill);
                        }
                        updateData["system.skills.custom"].specialities = foundry.utils.deepClone(customSkill.specialities || {});
                        updateData["system.skills.custom"].specialities[specialityKey] = specialityData;
                        
                        // Update actor
                        await this.actor.update(updateData);
                        
                        ui.notifications.info(game.i18n.format("SKILL.CREATED", { name: skillName }));
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize("BUTTON.CANCEL")
                }
            },
            default: "create"
        }).render(true);
    }

    async _prepareRollInsanity(event) {
        event.preventDefault();
        await prepareCommonRoll(
            DarkHeresyUtil.createFearTestRolldata(this.actor)
        );
    }

    async _prepareRollCorruption(event) {
        event.preventDefault();
        // Кнопка спрятана у еретика шаблоном, но до обработчика можно дотянуться
        // макросом: в Black Crusade проверки на Рудименты не существует.
        if (Dh.rulesetFor(this.actor).corruption.track !== "malignancy") {
            ui.notifications.info(game.i18n.localize("GIFT.NO_MALIGNANCY"));
            return;
        }
        await prepareCommonRoll(
            DarkHeresyUtil.createMalignancyTestRolldata(this.actor)
        );
    }

    async _prepareRollRegeneration(event) {
        event.preventDefault();
        const rollData = DarkHeresyUtil.createCharacteristicRollData(this.actor, "toughness");
        rollData.name = "WOUND.REGENERATION";
        rollData.flags = rollData.flags || {};
        rollData.flags.isRegeneration = true;
        rollData.regeneration = Number(this.actor.system?.wounds?.regeneration) || 0;
        rollData.actorUuid = this.actor.uuid;
        if (this.actor.token?.id) {
            rollData.tokenId = this.actor.token.id;
        }
        if (this.actor.token?.uuid) {
            rollData.tokenUuid = this.actor.token.uuid;
        }
        if (this.actor.token?.scene?.id) {
            rollData.sceneId = this.actor.token.scene.id;
        }
        await prepareCommonRoll(rollData);
    }

    async _prepareRollWeapon(event) {
        event.preventDefault();
        const div = $(event.currentTarget).parents(".item");
        const weapon = this.actor.items.get(div.data("itemId"));
        
        // Check if weapon is equipped
        if (!weapon || weapon.system.equipped !== true) {
            ui.notifications.warn(game.i18n.localize("WEAPON.NOT_EQUIPPED") || "Weapon must be equipped to use");
            return;
        }
        
        await game.darkHeresy.api.useItem({actorUuid:this.actor.uuid, itemId:weapon.id});
    }

    async _prepareWeaponDamage(event) {
        event.preventDefault();
        const div = $(event.currentTarget).parents(".item");
        const weapon = this.actor.items.get(div.data("itemId"));
        
        // Check if weapon is equipped
        if (!weapon || weapon.system.equipped !== true) {
            ui.notifications.warn(game.i18n.localize("WEAPON.NOT_EQUIPPED") || "Weapon must be equipped to use");
            return;
        }
        
        const rollData = DarkHeresyUtil.createWeaponRollData(this.actor, weapon);
        await openDirectDamageDialog(rollData);
    }

    async _onWeaponContextMenu(event) {
        event.preventDefault();
        const div = $(event.currentTarget).closest(".item");
        const weapon = this.actor.items.get(div.data("itemId"));
        
        if (!weapon) return;
        
        // Check if weapon is equipped
        if (weapon.system.equipped !== true) {
            ui.notifications.warn(game.i18n.localize("WEAPON.NOT_EQUIPPED") || "Weapon must be equipped to use");
            return;
        }
        
        // Check if weapon is ranged (only ranged weapons can be reloaded)
        if (weapon.class === "melee") {
            ui.notifications.warn(game.i18n.localize("WEAPON.NOT_RANGED") || "Only ranged weapons can be reloaded");
            return;
        }
        
        // Get ownerId and tokenId
        const ownerId = this.actor.id;
        const tokenId = (this.actor.isToken && this.actor.token) ? this.actor.token.id : null;
        
        // Reload weapon
        const reloadResult = await _reloadWeapon(weapon, ownerId, tokenId, true);
        
        if (!reloadResult.success) {
            let message = game.i18n.localize("CHAT.RELOAD_FAILED") || "Failed to reload";
            if (reloadResult.reason === "out_of_ammo") {
                message = game.i18n.localize("CHAT.RELOAD_OUT_OF_AMMO") || "Out of ammunition";
            } else if (reloadResult.reason === "no_ammunition") {
                message = game.i18n.localize("CHAT.RELOAD_NO_AMMUNITION") || "Weapon has no ammunition configured";
            } else if (reloadResult.reason === "wrong_ammunition") {
                message = game.i18n.format("CHAT.RELOAD_WRONG_AMMUNITION", { weapon: weapon.name });
            } else if (reloadResult.reason === "no_compatible_ammunition") {
                message = game.i18n.format("CHAT.RELOAD_NO_COMPATIBLE", { weapon: weapon.name });
            }
            ui.notifications.warn(message);
        }
    }

    /**
     * Бросить инициативу за этого персонажа.
     *
     * Игроку негде было это сделать: на листе стояла формула, но не кнопка, а у
     * машины такая кнопка есть давно. Бросок идёт через боевой документ, поэтому
     * Молниеносные рефлексы и прочая обработка остаются на месте — своей второй
     * механики здесь не заводится.
     *
     * @param {Event} event
     */
    async _onRollInitiative(event) {
        event.preventDefault();
        event.stopPropagation();

        const combat = game.combat;
        if (!combat) {
            ui.notifications.warn(game.i18n.localize("INITIATIVE_NO_COMBAT"));
            return;
        }

        const combatant = combat.combatants.find(entry => entry.actor?.id === this.actor.id);
        if (!combatant) {
            ui.notifications.warn(game.i18n.format("INITIATIVE_NOT_IN_COMBAT", { name: this.actor.name }));
            return;
        }
        if (combatant.initiative !== null && combatant.initiative !== undefined) {
            ui.notifications.info(game.i18n.format("INITIATIVE_ALREADY_ROLLED",
                { name: this.actor.name, value: combatant.initiative }));
            return;
        }

        await combat.rollInitiative([combatant.id]);
    }

    /**
     * Действие захвата (DH2, стр. 222-223).
     *
     * Сторону система выводит из состояния: схваченный выбирает из своих трёх
     * опций, держащий — из своих. Кто именно держит захват, данные не хранят,
     * поэтому вывод можно поправить прямо в окне.
     */
    async _onGrappleTest(event) {
        event.preventDefault();
        event.stopPropagation();

        const actor = this.actor;
        const targets = DarkHeresyUtil.getCurrentTargets();
        const opponentToken = targets.length ? canvas.tokens.get(targets[0].tokenId) : null;
        const opponent = opponentToken?.actor;
        if (!opponent) {
            ui.notifications.warn(game.i18n.localize("GRAPPLE.NO_OPPONENT"));
            return;
        }

        const grappled = !!actor.hasCondition?.("grappled");
        const side = grappled ? "target" : "controller";
        const options = optionsFor(side)
            .map(o => `<option value="${o.id}">${game.i18n.localize(o.label)}</option>`)
            .join("");

        const dialog = dhDialog({
            title: game.i18n.localize("GRAPPLE.TITLE"),
            content: `<div class="form-group">
                <label>${game.i18n.format("GRAPPLE.PROMPT", { opponent: opponent.name })}</label>
                <select name="option">${options}</select>
            </div>
            <p class="dh-dialog-hint">${game.i18n.localize(side === "target"
                ? "GRAPPLE.HINT_TARGET" : "GRAPPLE.HINT_CONTROLLER")}</p>`,
            buttons: {
                act: {
                    icon: '<i class="fas fa-check"></i>',
                    label: game.i18n.localize("GRAPPLE.ACT"),
                    callback: async html => {
                        const chosen = html.find('select[name="option"]')[0]?.value;
                        if (chosen) await _resolveGrapple(actor, opponent, chosen);
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize("BUTTON.CANCEL"),
                    callback: () => {}
                }
            }
        });
        dialog.render(true);
    }

    async _toggleEquipped(event) {
        event.preventDefault();
        event.stopPropagation();
        
        // Try to get itemId from button's data attribute first, then from parent
        const itemId = $(event.currentTarget).data("itemId") || $(event.currentTarget).parents(".item").data("itemId") || $(event.currentTarget).parents(".gear-block").data("itemId");
        if (!itemId) {
            console.warn("Dark Heresy: Could not find itemId for toggle equipped");
            return;
        }
        
        const item = this.actor.items.get(itemId);
        if (!item) {
            console.warn("Dark Heresy: Item not found for toggle equipped", itemId);
            return;
        }
        
        const currentEquipped = item.system.equipped === true;
        await item.update({"system.equipped": !currentEquipped});
    }

    async _prepareRollPsychicPower(event) {
        event.preventDefault();
        // Кровавый бог не выносит колдовства: пока еретик принадлежит Кхорну, он
        // считается не имеющим особенности «Псайкер» и не творит психосил вовсе
        // (Black Crusade, стр. 78). Уйдёт принадлежность — вернётся и сила.
        if (Dh.rulesetFor(this.actor).id === "bc" && this.actor.system.patron === "khorne") {
            ui.notifications.warn(game.i18n.localize("PSY.KHORNE_FORBIDS"));
            return;
        }
        const div = $(event.currentTarget).parents(".item");
        const psychicPower = this.actor.items.get(div.data("itemId"));
        await preparePsychicPowerRoll(
            DarkHeresyUtil.createPsychicRollData(this.actor, psychicPower)
        );
    }

    async _preparePsychicDamage(event) {
        event.preventDefault();
        const div = $(event.currentTarget).parents(".item");
        const psychicPower = this.actor.items.get(div.data("itemId"));
        const rollData = DarkHeresyUtil.createPsychicRollData(this.actor, psychicPower);
        await openDirectDamageDialog(rollData);
    }

    constructItemLists() {
        let items = {};
        let itemTypes = this.actor.itemTypes;
        items.mentalDisorders = itemTypes.mentalDisorder;
        items.malignancies = itemTypes.malignancy;
        items.mutations = itemTypes.mutation;
        if (this.actor.type === "npc") {
            items.abilities = itemTypes.talent
                .concat(itemTypes.trait)
                .concat(itemTypes.specialAbility);
        }
        items.talents = itemTypes.talent;
        items.traits = itemTypes.trait;
        items.specialAbilities = itemTypes.specialAbility;
        items.aptitudes = itemTypes.aptitude;

        items.psychicPowers = itemTypes.psychicPower;

        items.criticalInjuries = itemTypes.criticalInjury;

        items.gear = itemTypes.gear;
        items.drugs = itemTypes.drug;
        items.tools = itemTypes.tool;
        items.cybernetics = itemTypes.cybernetic;

        items.armour = itemTypes.armour;
        items.forceFields = itemTypes.forceField;

        // Show all weapons in combat tab (equipped and unequipped)
        //
        // Кибернетика и снаряжение тоже умеют бить: клинковые шпицы — это оружие
        // ближнего боя внутри импланта. Такие предметы попадают в боевую вкладку
        // наравне со стволами, чтобы по ним можно было ударить, не заводя предмет
        // -двойник, который придётся вручную держать в синхроне.
        items.weapons = itemTypes.weapon
            .concat(this.actor.items.filter(item => item.system?.grantsAttack?.enabled));
        items.weaponMods = itemTypes.weaponModification;
        items.ammunitions = itemTypes.ammunition;
        this._sortItemLists(items);

        // Everything a character carries, in sections by kind. One table with one set
        // of columns, divided by a caption per kind - so weapons sit with weapons
        // without every kind bringing its own header row and column widths. Kinds the
        // character carries nothing of are left out; the panel's add control covers
        // starting a new one.
        const carriedOrder = ["weapon", "armour", "forceField", "ammunition",
            "weaponModification", "gear", "tool", "drug", "cybernetic"];
        items.gearGroups = carriedOrder
            .map(type => ({
                type,
                label: `TYPES.Item.${type}`,
                items: (itemTypes[type] ?? []).slice().sort((a, b) => {
                    // What is held or worn floats above what is only packed.
                    const carried = Number(!!b.system.equipped) - Number(!!a.system.equipped);
                    return carried || a.name.localeCompare(b.name);
                })
            }))
            .filter(group => group.items.length);

        return items;
    }

    _sortItemLists(items) {
        for (let list in items) {
            if (Array.isArray(items[list])) items[list] = items[list].sort((a, b) => a.sort - b.sort);
            else if (typeof items[list] == "object") _sortItemLists(items[list]);
        }
    }
}

/**
 * Поля анкеты, значение которых поставил Мастер создания.
 *
 * Предмет Происхождения на акторе — и есть запись выбора; подпись в анкете лишь
 * его копия. Поэтому сверяем по значению: переписанное игроком перестаёт
 * считаться нашим само, без отдельного флага, который пришлось бы чистить.
 *
 * @param {Actor} actor
 * @returns {Record<string, string>} путь поля → название происхождения
 */
function originFilledFields(actor) {
    const out = {};
    for (const step of stepsFor(actor?.system?.ruleset ?? "")) {
        if (!step.bioField) continue;
        const carrier = actor.items.find(item => item.type === "origin" && item.system.stage === step.stage);
        if (!carrier) continue;
        if (foundry.utils.getProperty(actor, step.bioField) === carrier.name) out[step.bioField] = carrier.name;
    }
    return out;
}

/**
 * Общая часть листа игрового персонажа.
 *
 * Книг пять, и у каждой свой лист: свои поля анкеты, свои показатели и свой набор
 * вкладок. Общее — портрет, характеристики, кнопка Мастера и работа со склонностями,
 * поэтому оно живёт здесь, а расходящееся — в наследниках.
 *
 * Тип актора листа не выбирает: у обоих типов персонажа поля одни и те же, а лист
 * подбирается по книге (см. Dh.sheetFor). Так персонаж, перешедший из Инквизиции в
 * Чёрный Крестовый Поход, меняет книгу, а не документ.
 */
class BookSheet extends DarkHeresySheet {

    /** Книга этого листа. Наследник называет её, и по ней же лист находится. */
    static ruleset = "dh2";

    /** Путь к партиалу анкеты: чем книга описывает происхождение персонажа. */
    static bioPartial = "systems/dark-heresy/template/sheet/actor/partial/bio-dark-heresy.hbs";

    /** Полосы показателей в шапке, слева направо. */
    static vitals = ["wounds", "fate", "fatigue"];

    /**
     * Вкладки листа, по порядку. Первая открывается при входе.
     * `id` — ключ вкладки, `label` — строка интерфейса, `partial` — её содержимое.
     */
    static tabList = [
        {id: "stats", label: "TAB.STATS", partial: "tab/stats.hbs"},
        {id: "combat", label: "TAB.COMBAT", partial: "tab/combat.hbs"},
        {id: "abilities", label: "TAB.ABILITIES", partial: "tab/abilities.hbs"},
        {id: "psychic-powers", label: "TAB.PSYCHIC_POWERS", partial: "tab/psychic-powers.hbs"},
        {id: "gear", label: "TAB.GEAR", partial: "tab/gear.hbs"},
        {id: "progression", label: "TAB.ADVANCES", partial: "tab/progression.hbs"},
        {id: "effects", label: "TAB.EFFECTS", partial: "tab/effects.hbs"},
        {id: "notes", label: "TAB.NOTES", partial: "tab/notes.hbs"}
    ];

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "actor"],
            template: "systems/dark-heresy/template/sheet/actor/character.hbs",
            // Opens at exactly its design size, so the scale is 1.0. Drag it from here
            // and everything scales with it; nothing rearranges. See _applySheetScale.
            width: DarkHeresySheet.DESIGN_WIDTH + DarkHeresySheet.CONTENT_PADDING
                + DarkHeresySheet.SCROLLBAR_ALLOWANCE,
            height: 900,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        // Вход в Мастер создания прямо с листа. Второй путь, кроме кнопки в панели
        // «Актёры»: Мастера чаще открывают на уже заведённом персонаже — доделать
        // начатого или пройти шаги заново. HereticSheet наследует эту кнопку.
        //
        // Пока Мастер не готов, кнопка скрыта настройкой мира. Сам Мастер никуда
        // не делся и доступен через программный интерфейс, так что доделывать и
        // проверять его можно, не показывая столу.
        if (this.actor.isOwner && _creationWizardVisible()) {
            buttons = [
                {
                    label: game.i18n.localize("WIZARD.HEADER_BUTTON"),
                    class: "creation-wizard",
                    icon: "fas fa-user-plus",
                    onclick: () => openCharacterWizard(this.actor)
                }
            ].concat(buttons);
        }
        return buttons;
    }

    async getData() {
        // Базовый getData асинхронный: без await пометка ложилась на промис и терялась.
        const data = await super.getData();
        // Какие поля анкеты заполнил Мастер создания. Поля остаются обычными:
        // пометка лишь говорит, откуда взялось значение, чтобы случайная правка
        // была заметна, а не молчалива.
        data.fromOrigin = originFilledFields(this.actor);
        // Каждая книга зовёт эти поля по-своему: у Only War это полк и специальность,
        // а не предыстория и роль. Подписи берёт профиль книги, а не тип листа.
        data.bioLabels = Dh.rulesetFor(this.actor).bioLabels ?? Dh.bioLabels.dh2;
        // Из чего собран лист этой книги. Каркас один, начинка называется классом.
        const parts = this.constructor;
        data.bioPartial = parts.bioPartial;
        data.bookClass = `book-${parts.ruleset}`;
        // Ключ книги — чтобы шаблон мог показать то, что печатает только она.
        data.ruleset = parts.ruleset;
        data.vitalPartials = parts.vitals.map(key => ({
            partial: `systems/dark-heresy/template/sheet/actor/partial/vital-${key}.hbs`
        }));
        data.sheetTabs = parts.tabList.map(tab => ({
            ...tab, partial: `systems/dark-heresy/template/sheet/actor/${tab.partial}`
        }));
        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find(".aptitude-create").click(async ev => { await this._onAptitudeCreate(ev); });
        html.find(".aptitude-delete").click(async ev => { await this._onAptitudeDelete(ev); });
        // item-cost is now disabled (read-only) - cost is edited in item sheet settings
        html.find(".item-starter").click(async ev => { await this._onItemStarterClick(ev); });
    }

    async _onAptitudeCreate(event) {
        event.preventDefault();
        let aptitudeId = Date.now().toString();
        let aptitude = { id: Date.now().toString(), name: game.i18n.localize("UI.NEW_APTITUDE") };
        await this.actor.update({[`system.aptitudes.${aptitudeId}`]: aptitude});
        this._render(true);
    }

    async _onAptitudeDelete(event) {
        event.preventDefault();
        const div = $(event.currentTarget).parents(".item");
        const aptitudeId = div.data("aptitudeId").toString();
        await this.actor.update({[`system.aptitudes.-=${aptitudeId}`]: null});
        this._render(true);
    }

    async _onItemStarterClick(event) {
        event.preventDefault();
        const div = $(event.currentTarget).parents(".item");
        let item = this.actor.items.get(div.data("itemId"));
        item.update({"system.starter": $(event.currentTarget)[0].checked});
    }
}


/**
 * Лист Чёрного Крестового Похода: Тёмная слава вместо Влияния, Порча со счётчиком
 * принадлежности и покровитель, от которого зависит цена каждого улучшения.
 */
class BlackCrusadeSheet extends BookSheet {

    static ruleset = "bc";
    static bioPartial = "systems/dark-heresy/template/sheet/actor/partial/bio-black-crusade.hbs";
    // Судьбы у еретика нет: на её месте очки Тёмной славы, и потолок им не вводят.
    static vitals = ["wounds", "infamy", "fatigue"];
    // Присяга — своя вкладка: покровитель решает цену каждого улучшения, а счёт
    // принадлежности растёт с каждой покупкой. В Dark Heresy такой вкладки нет.
    static tabList = BookSheet.tabList.toSpliced(6, 0,
        {id: "allegiance", label: "TAB.ALLEGIANCE", partial: "tab/allegiance.hbs"});

    async getData() {
        // Базовый getData асинхронный: без await сюда приходит промис, и поле,
        // положенное на него, до шаблона не доезжает.
        const data = await super.getData();
        data.chaosPatrons = Dh.chaosPatrons;
        // Счётчики принадлежности собираются здесь, а не в шаблоне: сравнение
        // с вожаком — логика, и helper'а под неё в системе нет.
        const counts = this.actor.system.alignmentCounts ?? {};
        const totals = this.actor.system.alignmentTotals ?? {};
        const manual = this.actor.system.alignment ?? {};
        const leader = this.actor.system.alignmentLeader;
        data.alignmentRows = Object.keys(counts).map(god => ({
            key: god,
            label: Dh.chaosPatrons[god],
            count: counts[god],
            manual: Number(manual[god]) || 0,
            total: totals[god],
            isLeader: god === leader,
            isPatron: god === this.actor.system.patron
        }));
        return data;
    }

    /**
     * Приобретение висит в шапке окна, а не на вкладке снаряжения: вкладка общая
     * с аколитом и НИП, а выбивать вещь репутацией умеет только еретик.
     */
    _getHeaderButtons() {
        const buttons = super._getHeaderButtons();
        if (this.actor.isOwner) {
            buttons.unshift({
                class: "acquisition",
                icon: "fa-solid fa-hand-holding",
                label: game.i18n.localize("ACQUISITION.TITLE"),
                onclick: () => prepareAcquisition(this.actor)
            });
        }
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;
        html.find(".infamy-refresh").click(async () => await this._onInfamyRefresh());
        html.find(".infamy-spend").click(async () => await this._onInfamySpend());
        html.find(".fate-spend").click(async () => await this._onFateSpend());
    }

    /**
     * Очки Тёмной славы восстанавливаются в начале новой игровой встречи
     * (Black Crusade, стр. 308). Встречу система не отслеживает — её объявляет
     * МИ, поэтому это кнопка, а не хук на начало боя: бой и встреча не одно и то же.
     */
    async _onInfamyRefresh() {
        const max = Number(this.actor.system.fate?.max) || 0;
        await this.actor.update({ "system.fate.value": max });
    }

    /**
     * Потратить очко Тёмной славы. Что именно предложено — решают накопленная
     * Порча и покровитель, поэтому список собирается каждый раз заново.
     */
    /**
     * Потратить очко Судьбы. Список у аколита один и тот же: в отличие от
     * Тёмной славы, он не растёт с Порчей и не зависит от покровителя.
     */
    async _onFateSpend() {
        const actor = this.actor;
        if ((Number(actor.system.fate?.value) || 0) <= 0) {
            ui.notifications.warn(game.i18n.localize("FATE_NO_POINTS"));
            return;
        }

        const options = FATE_ABILITIES
            .map(a => `<option value="${a.id}">${game.i18n.localize(a.label)}</option>`)
            .join("");

        const dialog = dhDialog({
            title: game.i18n.localize("FATE_SPEND_TITLE"),
            content: `<div class="form-group">
                <label>${game.i18n.localize("FATE_SPEND_PROMPT")}</label>
                <select name="ability">${options}</select>
            </div>`,
            buttons: {
                spend: {
                    icon: '<i class="fas fa-check"></i>',
                    label: game.i18n.localize("FATE_SPEND"),
                    callback: async html => {
                        const chosen = html.find('select[name="ability"]')[0]?.value;
                        if (chosen) await spendFatePoint(actor, chosen);
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize("BUTTON.CANCEL"),
                    callback: () => {}
                }
            }
        });
        dialog.render(true);
    }

    async _onInfamySpend() {
        const actor = this.actor;
        if ((Number(actor.system.fate?.value) || 0) <= 0) {
            ui.notifications.warn(game.i18n.localize("INFAMY.NO_POINTS"));
            return;
        }

        const abilities = infamyAbilitiesFor(actor);
        if (!abilities.length) return;

        const options = abilities
            .map(a => `<option value="${a.id}">${game.i18n.localize(a.label)}</option>`)
            .join("");

        const dialog = dhDialog({
            title: game.i18n.localize("INFAMY.SPEND_TITLE"),
            content: `<div class="form-group">
                <label>${game.i18n.localize("INFAMY.SPEND_PROMPT")}</label>
                <select name="ability">${options}</select>
            </div>`,
            buttons: {
                spend: {
                    label: game.i18n.localize("INFAMY.SPEND"),
                    callback: html => spendInfamyPoint(actor, html.find("[name=ability]").val())
                },
                cancel: { label: game.i18n.localize("DIALOG.CANCEL") }
            },
            default: "spend"
            // Названия способностей — это фразы из таблицы, а не ярлыки, и в
            // минимальную ширину диалога они не помещаются.
        }, { width: 520 });
        dialog.render(true);
    }
}

/**
 * Лист Dark Heresy 2: родной мир, предыстория и роль, Влияние, Судьба и дивинация.
 * Это же лист по умолчанию для персонажа, который свою книгу ещё не назвал.
 */
class DarkHeresy2Sheet extends BookSheet {
    static ruleset = "dh2";
}

/**
 * Лист Only War: полк и специальность вместо предыстории и роли, и вкладка отряда,
 * где живёт Comrade. Влияния у гвардейца нет вовсе (стр. 74).
 */
class OnlyWarSheet extends BookSheet {

    static ruleset = "ow";
    static bioPartial = "systems/dark-heresy/template/sheet/actor/partial/bio-only-war.hbs";
    // Отряд — своя вкладка: у гвардейца рядом Comrade, и это не снаряжение.
    static tabList = BookSheet.tabList.toSpliced(5, 0,
        {id: "squad", label: "TAB.SQUAD", partial: "tab/squad.hbs"});
}

/**
 * Лист Rogue Trader — по книжному листу (стр. 398-399).
 *
 * Характеристик девять: Влиятельности книга не знает, её убирает профиль правил.
 * Вместо неё у династии Profit Factor — Стартовый, Текущий и Невзгоды, — и он
 * становится своим показателем рядом с Судьбой, потому что от него считаются
 * приобретения.
 *
 * Анкета спрашивает то же, что печатает лист: карьеру и её ранг, родной мир и
 * побуждение — последнюю ступень Пути Происхождения, которую книга выносит
 * в шапку наравне с ними.
 */
class RogueTraderSheet extends BookSheet {

    static ruleset = "rt";
    static bioPartial = "systems/dark-heresy/template/sheet/actor/partial/bio-rogue-trader.hbs";
    // Три полосы держатся вместе, Profit Factor стоит последним: он не полоса, а
    // три поля, и между полосами он рвал ряд надвое.
    static vitals = ["wounds", "fate", "fatigue", "profit-factor"];

    /**
     * Приобретение — в шапке окна, как у еретика.
     *
     * Вся экономика книги идёт через Profit Factor (стр. 271), а бросить его было
     * нечем: кнопка существовала только на листе Black Crusade. Показатель, который
     * никто не читает, — это тот же дефект, что неработающая броня.
     */
    _getHeaderButtons() {
        const buttons = super._getHeaderButtons();
        if (this.actor.isOwner) {
            buttons.unshift({
                class: "acquisition",
                icon: "fa-solid fa-hand-holding",
                label: game.i18n.localize("ACQUISITION.TITLE"),
                onclick: () => prepareAcquisition(this.actor)
            });
        }
        return buttons;
    }
}

/**
 * Лист Deathwatch — по книжному листу (стр. 397-399).
 *
 * Анкета спрашивает то же, что печатает книга: орден, событие прошлого, нрав
 * ордена и свой, специальность и историю силовой брони. А вторая страница
 * книжного листа — Известность, Единство, клятва и способности режимов —
 * становится своей вкладкой: у аколита такого нет ни в одной книге.
 */
class DeathwatchSheet extends BookSheet {

    static ruleset = "dw";
    static bioPartial = "systems/dark-heresy/template/sheet/actor/partial/bio-deathwatch.hbs";
    // Караул — своя вкладка, сразу за способностями: режимы и Единство читаются
    // в бою, а не между делом.
    static tabList = BookSheet.tabList.toSpliced(3, 0,
        {id: "deathwatch", label: "TAB.DEATHWATCH", partial: "tab/deathwatch.hbs"});

    async getData() {
        const data = await super.getData();
        // Способности режимов книга печатает двумя таблицами: одиночные с рангом,
        // отрядные с ценой Единства. Разделение живёт в самом предмете (system.mode),
        // а не в папке компендиума: на листе папки нет, а способность есть.
        const rank = Number(this.actor.system.rank) || 1;
        const abilities = this.actor.items.filter(item => item.type === "specialAbility");
        const group = mode => abilities
            .filter(item => (item.system?.mode ?? "") === mode)
            .map(item => ({
                id: item.id, img: item.img, name: item.name, system: item.system,
                // Ранг брата ещё не дорос — способность видна, но помечена.
                lockedByRank: (Number(item.system?.requiredRank) || 0) > rank
            }))
            .sort((a, b) => (Number(a.system?.requiredRank) || 0) - (Number(b.system?.requiredRank) || 0)
                || String(a.name).localeCompare(String(b.name)));
        data.deathwatchModes = [
            {key: "solo", label: "MODE.SOLO_ABILITIES", isSquad: false, items: group("solo")},
            {key: "squad", label: "MODE.SQUAD_ABILITIES", isSquad: true, items: group("squad")}
        ];
        return data;
    }
}


/**
 * Сколько рангов у умения куплено.
 *
 * Нетренированное умение стоит на −20 и рангов не имеет; обученное стоит на
 * нуле и это уже первый ранг, дальше по +10 за ранг. Ступень «−20 → 0» —
 * покупка, а не пустота, поэтому считать её надо от нуля, а не от −20.
 * @param {object} entry
 * @returns {number}
 */
function _skillRanks(entry) {
    const advance = Number(entry?.advance ?? -20);
    if (!Number.isFinite(advance) || advance < 0) return 0;
    return Math.floor(advance / 10) + 1;
}

/**
 * Проверка Приобретения (Black Crusade, стр. 310).
 *
 * Еретик не покупает вещь, а выбивает её репутацией, поэтому это проверка Тёмной
 * славы с тремя модификаторами: доступность, количество, качество. Диалог их
 * складывает и показывает сумму до броска — она же решает, будет ли бросок
 * вообще: за 100 вещь достаётся молча, ниже нуля не достаётся никак.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
async function prepareAcquisition(actor) {
    // Подписи берём из уже существующих словарей доступности и качества: это те же
    // ступени, что стоят в карточке предмета, и заводить им вторые имена незачем.
    const options = (config, prefix, selected) => Object.entries(config)
        .map(([key, mod]) => {
            const label = game.i18n.localize(`${prefix}.${key.toUpperCase().replace(/-/g, "_")}`);
            const sign = mod > 0 ? `+${mod}` : mod;
            return `<option value="${key}"${key === selected ? " selected" : ""}>${label} (${sign})</option>`;
        })
        .join("");

    const content = `<div class="dh-dialog">
        <div class="form-group">
            <label>${game.i18n.localize("ACQUISITION.ITEM")}</label>
            <input type="text" name="item" value="" />
        </div>
        <div class="form-group">
            <label>${game.i18n.localize("ACQUISITION.AVAILABILITY")}</label>
            <select name="availability">${options(Dh.acquisitionAvailability, "AVAILABILITY", "average")}</select>
        </div>
        <div class="form-group">
            <label>${game.i18n.localize("ACQUISITION.AMOUNT")}</label>
            <select name="quantity">${options(Dh.acquisitionQuantity, "ACQUISITION.QUANTITY", "single")}</select>
        </div>
        <div class="form-group">
            <label>${game.i18n.localize("ACQUISITION.QUALITY")}</label>
            <select name="quality">${options(Dh.acquisitionQuality, "CRAFTSMANSHIP", "common")}</select>
        </div>
    </div>`;

    const dialog = dhDialog({
        title: game.i18n.localize("ACQUISITION.TITLE"),
        content,
        buttons: {
            roll: {
                icon: '<i class="fas fa-check"></i>',
                label: game.i18n.localize("BUTTON.ROLL"),
                callback: html => rollAcquisition(actor, {
                    item: html.find("[name=item]").val(),
                    availability: html.find("[name=availability]").val(),
                    quantity: html.find("[name=quantity]").val(),
                    quality: html.find("[name=quality]").val()
                })
            },
            cancel: { label: game.i18n.localize("DIALOG.CANCEL") }
        },
        default: "roll"
    }, { width: 460 });
    dialog.render(true);
}

/**
 * Катнуть проверку Приобретения.
 * @param {Actor} actor
 * @param {{item: string, availability: string, quantity: string, quality: string}} choice
 * @returns {Promise<void>}
 */
async function rollAcquisition(actor, choice) {
    const modifier = (Dh.acquisitionAvailability[choice.availability] ?? 0)
        + (Dh.acquisitionQuantity[choice.quantity] ?? 0)
        + (Dh.acquisitionQuality[choice.quality] ?? 0);

    // Против чего бросают приобретение. У аколита это Влиятельность, у еретика
    // Дурная слава — одно поле под двумя именами. У Rogue Trader Влиятельности
    // нет вовсе: там за это отвечает Profit Factor, сила Торговой хартии
    // династии (стр. 271). Без этой развилки лист исследователя бросал бы против
    // характеристики, которой на нём даже не показано.
    const rules = Dh.rulesetFor(actor);
    const infamy = actor.characteristics.influence;
    const base = rules.resource?.profitFactor
        ? (Number(actor.system.profitFactor?.value) || 0)
        : (infamy.displayTotal ?? infamy.total);
    const target = base + modifier;
    const item = choice.item?.trim() || game.i18n.localize("ACQUISITION.ITEM");

    // Края таблицы разрешаются без броска: столь расхожие вещи не стоят проверки,
    // а недостижимых не найти вовсе.
    if (target > 100 || target < 0) {
        const verdict = target > 100 ? "ACQUISITION.AUTOMATIC" : "ACQUISITION.IMPOSSIBLE";
        await ChatMessage.create({
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="dark-heresy chat roll">
                <div class="dh-card is-neutral">
                    <div class="dh-card-h">
                        <span class="who">${actor.name}</span>
                        <span class="verdict">${game.i18n.localize("ACQUISITION.TITLE")}</span>
                    </div>
                    <div class="dh-card-b">
                        <p class="dh-note"><b>${item}</b></p>
                        <p class="dh-note">${game.i18n.localize(verdict)}</p>
                    </div>
                </div>
            </div>`
        });
        return;
    }

    const rollData = DarkHeresyUtil.createCharacteristicRollData(actor, "influence");
    // Карточка печатает name как есть, а мимо диалога общего броска мы прошли,
    // так что переводить некому — переводим здесь.
    rollData.name = game.i18n.localize("ACQUISITION.TITLE");
    rollData.rolledWith = item;
    rollData.target.modifier = modifier;
    await commonRoll(rollData);
}

/**
 * Способности Тёмной славы, доступные этому еретику прямо сейчас.
 *
 * Уровень открывается Порчей, покровитель одну строку вычёркивает, а другую
 * дописывает (таблица 9-10). Переброс сюда не попадает: он живёт в контекстном
 * меню чата, где и происходит, — иначе способность была бы в двух местах сразу.
 * @param {Actor} actor
 * @returns {object[]}
 */
function infamyAbilitiesFor(actor) {
    const level = Dh.getInfamyLevel(actor.corruption);
    const rules = Dh.infamyPatronRules[actor.system.patron] ?? {};
    const denied = new Set(rules.deny ?? []);

    const available = Dh.infamyAbilities
        .concat(rules.grant ?? [])
        .filter(ability => !denied.has(ability.id))
        .filter(ability => {
            // Тзинчу ступень успеха открыта раньше срока, всем остальным — по таблице.
            const required = ability.id === "degree" && rules.degreeLevel
                ? rules.degreeLevel
                : ability.level;
            return level >= required;
        });

    return available;
}

/**
 * Применить способность Тёмной славы и списать очко.
 *
 * Механическое система делает сама, остальное объявляет карточкой — тем же
 * приёмом, что и криты: система называет строку, стол решает, как её отыграть.
 * @param {Actor} actor
 * @param {string} abilityId
 * @returns {Promise<void>}
 */
async function spendInfamyPoint(actor, abilityId) {
    const ability = infamyAbilitiesFor(actor).find(a => a.id === abilityId);
    if (!ability) return;

    const points = Number(actor.system.fate?.value) || 0;
    if (points <= 0) {
        ui.notifications.warn(game.i18n.localize("INFAMY.NO_POINTS"));
        return;
    }

    const rules = Dh.infamyPatronRules[actor.system.patron] ?? {};
    const level = Dh.getInfamyLevel(actor.corruption);
    const update = { "system.fate.value": points - 1 };
    let detail = "";

    switch (ability.id) {
        case "fatigue":
            update["system.fatigue.value"] = 0;
            break;

        case "heal": {
            const healed = await _rollInfamyHealing(level, rules);
            const taken = Number(actor.system.wounds?.value) || 0;
            update["system.wounds.value"] = Math.max(taken - healed, 0);
            // Критический урон снимается весь, но его последствия остаются:
            // рука не отрастает от того, что раны затянулись.
            update["system.wounds.critical"] = 0;
            detail = `${game.i18n.localize("INFAMY.HEALED")}: ${healed}`;
            break;
        }

        case "initiative": {
            const combatant = game.combat?.getCombatantByActor?.(actor.id);
            if (!combatant) {
                ui.notifications.warn(game.i18n.localize("INFAMY.NOT_IN_COMBAT"));
                return;
            }
            // «Считается выбросившим 10» — кость заменяется, бонус остаётся.
            const initiative = 10 + (Number(actor.initiative?.bonus) || 0);
            await combatant.update({ initiative });
            detail = `${game.i18n.localize("INITIATIVE")}: ${initiative}`;
            break;
        }

        case "stun":
            await actor.removeCondition("stunned");
            break;

        case "degree":
            // У Тзинча со второго уровня ступеней не одна, а 1к5.
            if (rules.degreeDiceLevel && level >= rules.degreeDiceLevel) {
                const roll = await new Roll("1d5").evaluate();
                detail = `${game.i18n.localize("INFAMY.DEGREES")}: ${roll.total}`;
            }
            break;
    }

    await actor.update(update);
    await _postInfamyCard(actor, ability, detail);
}

/**
 * Потратить очко Судьбы (DH2, стр. 294).
 *
 * Ресурс тот же, что у Дурной славы, и поле то же; отличается список. У еретика
 * он открывается по уровню Порчи и покровителю, у аколита доступен целиком.
 * Механическое система доводит до конца сама, остальное объявляет карточкой.
 *
 * @param {Actor} actor
 * @param {string} abilityId
 */
async function spendFatePoint(actor, abilityId) {
    const ability = FATE_ABILITIES.find(a => a.id === abilityId);
    if (!ability) return;

    const points = Number(actor.system.fate?.value) || 0;
    if (points <= 0) {
        ui.notifications.warn(game.i18n.localize("FATE_NO_POINTS"));
        return;
    }

    const update = { "system.fate.value": points - 1 };
    let detail = "";

    switch (ability.id) {
        case "fatigue":
            update["system.fatigue.value"] = 0;
            break;

        case "heal": {
            // «Instantly remove 1d5 damage... This cannot be used to remove
            // Critical damage» — поэтому критические раны не трогаются вовсе,
            // и этим Судьба отличается от Тёмной славы, которая их обнуляет.
            const roll = await new Roll("1d5").evaluate();
            const healed = fateHealing({ wounds: actor.system.wounds?.value, roll: roll.total });
            update["system.wounds.value"] = healed.wounds;
            detail = `${game.i18n.localize("FATE_HEALED")}: ${healed.healed}`;
            break;
        }

        case "initiative": {
            const combatant = game.combat?.getCombatantByActor?.(actor.id);
            if (!combatant) {
                ui.notifications.warn(game.i18n.localize("INITIATIVE_NOT_IN_COMBAT"));
                return;
            }
            // «Считается выбросившим 10» — кость заменяется, бонус остаётся.
            const initiative = FATE_INITIATIVE_ROLL + (Number(actor.initiative?.bonus) || 0);
            await combatant.update({ initiative });
            detail = `${game.i18n.localize("INITIATIVE")}: ${initiative}`;
            break;
        }

        case "stun":
            await actor.removeCondition("stunned");
            break;
    }

    await actor.update(update);
    await _postInfamyCard(actor, ability, detail);
}

/**
 * Сколько ран возвращает очко Тёмной славы.
 *
 * Кость растёт с уровнем (1к5, 1к5+1, 1к10). Нургл всегда считает её выпавшей
 * на максимум, а Кхорн отнимает две раны, но меньше одной не выходит.
 * @param {number} level
 * @param {object} rules
 * @returns {Promise<number>}
 */
async function _rollInfamyHealing(level, rules) {
    const formula = level >= 3 ? "1d10" : (level === 2 ? "1d5+1" : "1d5");
    let healed;
    if (rules.healMaximised) {
        const roll = await new Roll(formula).evaluate({ maximize: true });
        healed = roll.total;
    } else {
        const roll = await new Roll(formula).evaluate();
        healed = roll.total;
    }
    return Math.max(healed - (rules.healPenalty ?? 0), 1);
}

/**
 * Объявить трату очка Тёмной славы в чат.
 * @param {Actor} actor
 * @param {object} ability
 * @param {string} detail
 * @returns {Promise<ChatMessage>}
 */
function _postInfamyCard(actor, ability, detail) {
    const patron = game.i18n.localize(Dh.chaosPatrons[actor.system.patron] ?? Dh.chaosPatrons.undivided);
    return ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="dark-heresy chat roll">
            <div class="dh-card is-neutral">
                <div class="dh-card-h">
                    <span class="who">${actor.name}</span>
                    <span class="verdict">${game.i18n.localize("INFAMY_POINTS")}</span>
                </div>
                <div class="dh-card-b">
                    <p class="dh-note"><b>${game.i18n.localize(ability.label)}</b></p>
                    ${detail ? `<p class="dh-note">${detail}</p>` : ""}
                    <p class="dh-note">${patron}</p>
                </div>
            </div>
        </div>`
    });
}

class NpcSheet extends DarkHeresySheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "actor"],
            template: "systems/dark-heresy/template/sheet/actor/npc.hbs",
            width: DarkHeresySheet.DESIGN_WIDTH + DarkHeresySheet.CONTENT_PADDING
                + DarkHeresySheet.SCROLLBAR_ALLOWANCE,
            height: 900,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        if (this.actor.isOwner) {
            buttons = [].concat(buttons);
        }
        return buttons;
    }

    getData() {
        const data = super.getData();
        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);
        // item-cost is now disabled (read-only) - cost is edited in item sheet settings
        html.find(".item-starter").click(async ev => { await this._onItemStarterClick(ev); });
    }

    async _onItemStarterClick(event) {
        event.preventDefault();
        const div = $(event.currentTarget).parents(".item");
        let item = this.actor.items.get(div.data("itemId"));
        item.update({"system.starter": $(event.currentTarget)[0].checked});
    }
}

/**
 * Лист техники.
 *
 * Наследует хром и масштабирование общего листа, но собирает данные сам:
 * у машины нет ни характеристик, ни навыков, ни снаряжения по слотам, и общий
 * constructItemLists ей нечего разбирать.
 */
class VehicleSheet extends DarkHeresySheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "actor", "vehicle"],
            template: "systems/dark-heresy/template/sheet/actor/vehicle.hbs",
            width: DarkHeresySheet.DESIGN_WIDTH + DarkHeresySheet.CONTENT_PADDING
                + DarkHeresySheet.SCROLLBAR_ALLOWANCE,
            height: 820,
            resizable: true,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "profile" }]
        });
    }

    async getData() {
        const data = await foundry.appv1.sheets.ActorSheet.prototype.getData.call(this);
        data.system = sheetSystem(this.document);
        data.source = this.actor._source.system;
        data.config = {
            types: Dh.vehicleTypes,
            facings: Dh.vehicleFacings,
            mounts: Object.fromEntries(Object.entries(Dh.vehicleMounts).map(([k, v]) => [k, v.label])),
            zones: Dh.vehicleHitZones,
            damageTypes: Dh.damageTypes,
            speedModes: Dh.vehicleSpeedModes,
            manoeuvres: Dh.vehicleManoeuvres
        };
        data.weapons = this.actor.vehicleWeapons ?? [];
        data.traits = this.actor.vehicleTraits ?? [];
        data.crew = this.actor.crewMembers ?? [];
        // Стреляет не машина, а живой человек за её орудием: список кандидатов —
        // те, кем этот пользователь вправе бросать.
        data.gunners = game.actors
            .filter(a => ["acolyte", "heretic", "npc"].includes(a.type) && a.isOwner)
            .map(a => ({ id: a.id, name: a.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
        data.enrichment = {
            notes: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
                this.actor.system.notes ?? "", { async: true, relativeTo: this.actor }),
            gmNotes: await foundry.applications.ux.TextEditor.implementation.enrichHTML(
                this.actor.system.gmNotes ?? "", { async: true, relativeTo: this.actor })
        };
        data.effects = this.organizeEffects(data);
        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;
        html.find(".vehicle-item-create").click(ev => this._onVehicleItemCreate(ev));
        html.find(".vehicle-weapon-attack").click(ev => this._onVehicleWeaponAttack(ev));
        html.find(".vehicle-weapon-reload").click(ev => this._onVehicleWeaponReload(ev));
        // Расклинивание — тот же обработчик, что у ручного оружия: флаг общий.
        html.find(".clear-jam").click(ev => this._onClearJam(ev));
        html.find(".vehicle-crew-initiative").click(ev => this._onVehicleCrewInitiative(ev));
        html.find(".vehicle-ram").click(ev => this._onVehicleRam(ev));
        html.find(".vehicle-manoeuvre").click(ev => this._onVehicleManoeuvre(ev));
        html.find(".vehicle-jink").click(ev => this._onVehicleJink(ev));
        html.find(".vehicle-extinguish").click(ev => this._onVehicleExtinguish(ev));
        // Щелчок по метке снимает объявленный манёвр — он же и подсказка.
        html.find(".manoeuvre-state").click(async ev => {
            ev.preventDefault();
            await this.actor.update({ "system.manoeuvre.action": "",
                "system.manoeuvre.penalty": 0, "system.manoeuvre.round": 0 });
        });
        html.find(".vehicle-crew-remove").click(ev => this._onCrewRemove(ev));
        html.find(".vehicle-crew-open").click(ev => this._onCrewOpenSheet(ev));
        html.find(".vehicle-crew-role").change(ev => this._onCrewFieldChange(ev, "role", ev.currentTarget.value));
        html.find(".vehicle-crew-passenger").change(ev => this._onCrewFieldChange(ev, "passenger", ev.currentTarget.checked));
        html.find(".vehicle-gunner-select").change(async ev => {
            const item = this.actor.items.get(ev.currentTarget.dataset.itemId);
            await item?.update({ "system.gunnerId": ev.currentTarget.value });
            // Кого посадили за орудие, тот уже на борту: отдельно записывать его
            // в экипаж никто не станет, а под обстрелом он должен там быть.
            if (ev.currentTarget.value) {
                await this._seatCrew(ev.currentTarget.value, { role: item?.name ?? "" });
            }
        });
        html.find(".item-edit").click(ev => this._onVehicleItemEdit(ev));
        html.find(".item-delete").click(ev => this._onVehicleItemDelete(ev));
    }

    /**
     * Выстрел из орудия машины.
     *
     * Машина не имеет ни характеристик, ни навыков — стреляет приписанный к
     * орудию член экипажа своим Навыком Стрельбы, а профиль (дальность, темп,
     * урон, пробиваемость, черты) берётся с орудия. Правило добавляет к этому
     * одну поблажку: тому, кто умеет управлять этой машиной, специализация по
     * оружию не нужна и штрафа за неё нет.
     */
    async _onVehicleWeaponAttack(event) {
        event.preventDefault();
        const weapon = this._itemFromEvent(event);
        if (!weapon) return;
        if (weapon.blockedBy) {
            return ui.notifications.warn(game.i18n.localize(weapon.blockedBy));
        }
        // За турельным орудием штатного стрелка не держат: к нему встаёт любой,
        // кто свободен, — хоть пассажир. Поэтому если стрелок не приписан,
        // берём того, кем игрок сейчас распоряжается на сцене.
        const gunner = game.actors.get(weapon.system.gunnerId)
            ?? (weapon.system.mount === "pintle" ? _getPintleGunner() : null);
        if (!gunner) {
            return ui.notifications.warn(game.i18n.localize(weapon.system.mount === "pintle"
                ? "VEHICLE.NO_PINTLE_GUNNER" : "VEHICLE.NO_GUNNER"));
        }
        if (!gunner.isOwner) {
            return ui.notifications.warn(game.i18n.localize("VEHICLE.GUNNER_NOT_OWNED"));
        }

        // Сектор обстрела проверяется до броска: развернуть машину — это
        // отдельное действие оператора, и узнавать об этом после попадания
        // поздно. Проверка возможна только когда обе фишки стоят на сцене.
        const vehicleToken = _getVehicleToken(this.actor);
        const target = DarkHeresyUtil.getCurrentTargets()[0];
        const targetToken = target ? canvas.tokens.get(target.tokenId) : null;
        if (vehicleToken && targetToken && !_isInFiringArc(vehicleToken, weapon, targetToken)) {
            const proceed = await _confirmOutOfArc(weapon);
            if (!proceed) return;
        }

        const rollData = DarkHeresyUtil.createWeaponRollData(gunner, weapon);
        // Стреляет человек, но орудие и его патроны принадлежат машине, и
        // расстояние до цели меряется тоже от машины — стрелок сидит внутри.
        rollData.vehicle = { actorId: this.actor.id, tokenId: vehicleToken?.id ?? null };
        // Карточка должна называть и стрелка, и машину — иначе в логе висит
        // орудие без хозяина.
        rollData.actorName = `${gunner.name} — ${this.actor.name}`;
        // Любая стрельба с машины, которая двигалась в прошлом раунде, идёт со
        // штрафом: −10 за Тактическую Скорость, −20 за двойную.
        const firingPenalty = Number(this.actor.system.speed?.firingPenalty) || 0;
        if (firingPenalty) rollData.target.modifier += firingPenalty;
        await prepareCombatRoll(rollData, gunner);
    }

    /**
     * Действия оператора в бою на машине — Таблица действий со страницы 310.
     *
     * Все три полные, все три катятся оператором, и все три при провале на
     * достаточное число степеней делают машину Неуправляемой. Неуправляемость
     * система не разыгрывает — её ведёт МИ, — но в карточке о ней говорит.
     *
     * Последствия успеха записываются на машину и держатся до конца раунда:
     * Манёвр Уклонения даёт −10 за каждую степень успеха, Педаль в пол! — −20.
     * Штраф общий: он мешает и тем, кто целит в машину, и стрельбе с её борта.
     */
    async _onVehicleManoeuvre(event) {
        event.preventDefault();
        const action = event.currentTarget.dataset.action;
        const spec = Dh.vehicleManoeuvres[action];
        if (!spec) return;

        const sys = this.actor.system;
        if (!sys.can?.move) {
            return ui.notifications.warn(game.i18n.localize("VEHICLE.NO_MANOEUVRE_IMMOBILE"));
        }
        // Шагоход не топит педаль и не проносится мимо с ударом: ног для этого
        // мало. Открытая машина нужна, чтобы было откуда бить.
        if (spec.noWalker && sys.vehicleType === "walker") {
            return ui.notifications.warn(game.i18n.localize("VEHICLE.NO_MANOEUVRE_WALKER"));
        }
        if (spec.needsOpen && !sys.openTopped) {
            return ui.notifications.warn(game.i18n.localize("VEHICLE.NO_MANOEUVRE_CLOSED"));
        }

        const operator = game.actors.get(sys.operatorId);
        if (!operator) return ui.notifications.warn(game.i18n.localize("VEHICLE.NO_OPERATOR"));
        if (!operator.isOwner) return ui.notifications.warn(game.i18n.localize("VEHICLE.GUNNER_NOT_OWNED"));

        const rollData = spec.skill === "weaponSkill"
            ? DarkHeresyUtil.createCharacteristicRollData(operator, "weaponSkill")
            : DarkHeresyUtil.createSkillRollData(operator, "operate");
        rollData.name = spec.label;
        rollData.difficulty = { value: spec.difficulty,
            text: game.i18n.localize(Dh.difficulties[spec.difficulty]) };
        // Поправки к Управлению идут в тот же модификатор, что и у Виража.
        if (spec.skill !== "weaponSkill") {
            rollData.target.modifier = (Number(rollData.target.modifier) || 0)
                + (Number(sys.operateModifier) || 0);
        }

        const vehicle = this.actor;
        rollData.afterRoll = async data => {
            const notes = [];
            if (data.flags?.isSuccess) {
                const dos = Number(data.dos) || 1;
                const penalty = spec.penaltyPerDos ? spec.penaltyPerDos * dos : (spec.penalty ?? 0);
                if (penalty) {
                    await vehicle.update({
                        "system.manoeuvre.action": action,
                        "system.manoeuvre.penalty": penalty,
                        "system.manoeuvre.round": game.combat?.round ?? 0
                    });
                    notes.push(game.i18n.format("VEHICLE.MANOEUVRE_PENALTY",
                        { penalty, name: game.i18n.localize(spec.label) }));
                }
                if (spec.extraMovePerDos) {
                    notes.push(game.i18n.format("VEHICLE.MANOEUVRE_DISTANCE", {
                        distance: (Number(sys.speed.tactical) || 0) * 2 + spec.extraMovePerDos * dos
                    }));
                }
            } else if ((Number(data.dof) || 0) >= spec.unmanageableOn) {
                notes.push(game.i18n.format("VEHICLE.MANOEUVRE_UNMANAGEABLE", { dof: data.dof }));
            }
            if (notes.length) {
                await ChatMessage.create({
                    content: `<div class="dark-heresy chat roll"><div class="dh-card is-neutral">
                        <div class="dh-card-h"><span class="who">${vehicle.name}</span>
                        <span class="verdict">${game.i18n.localize(spec.label)}</span></div>
                        <div class="dh-card-b">${notes.map(n => `<p class="dh-note">${n}</p>`).join("")}</div>
                        </div></div>`
                });
            }
        };

        await prepareCommonRoll(rollData);
    }

    /**
     * Сбить пламя изнутри — полное действие любого, кто на борту.
     *
     * Книга называет проверку Трудной (−20) на Ловкость и тут же оговаривает,
     * что эти −20 — тот самый штраф, который экипаж уже несёт за пожар, а не
     * добавка к нему. Поэтому сложность здесь Серьёзная (+0): −20 приезжает
     * сам вместе с броском любого, кто сидит в горящей машине.
     *
     * Удача гасит огонь и оставляет машину Обгоревшей: −10 к Управлению, пока
     * её не починят.
     */
    async _onVehicleExtinguish(event) {
        event.preventDefault();
        const vehicle = this.actor;
        if (!vehicle.system.conditions?.onFire) {
            return ui.notifications.info(game.i18n.localize("VEHICLE.EXTINGUISH_NOT_ON_FIRE"));
        }
        // Тушит тот, кем игрок распоряжается: выделенный токен, иначе оператор.
        const controlled = canvas?.tokens?.controlled
            ?.find(t => t.actor?.isOwner && ["acolyte", "heretic", "npc"].includes(t.actor.type));
        const fighter = controlled?.actor
            ?? game.actors.get(vehicle.system.operatorId)
            ?? this._vehicleCrew().find(a => a.isOwner);
        if (!fighter?.isOwner) {
            return ui.notifications.warn(game.i18n.localize("VEHICLE.EXTINGUISH_NO_CREW"));
        }

        const rollData = DarkHeresyUtil.createCharacteristicRollData(fighter, "agility");
        rollData.name = "VEHICLE.EXTINGUISH";
        rollData.difficulty = { value: 0, text: game.i18n.localize(Dh.difficulties[0]) };
        rollData.afterRoll = async data => {
            const ok = !!data.flags?.isSuccess;
            if (ok) {
                await vehicle.update({
                    "system.conditions.onFire": false,
                    "system.conditions.burnt": true
                });
            }
            await ChatMessage.create({
                content: `<div class="dark-heresy chat roll"><div class="dh-card ${ok ? "is-neutral" : "is-fail"}">
                    <div class="dh-card-h"><span class="who">${vehicle.name}</span>
                    <span class="verdict">${game.i18n.localize("VEHICLE.EXTINGUISH")}</span></div>
                    <div class="dh-card-b"><p class="dh-note">${game.i18n.format(
                        ok ? "VEHICLE.EXTINGUISH_OK" : "VEHICLE.EXTINGUISH_FAIL",
                        { name: fighter.name })}</p></div>
                    </div></div>`
            });
        };

        await prepareCommonRoll(rollData);
    }

    /**
     * Вираж — единственная реакция уклонения, доступная машине.
     *
     * Dodge машине не полагается, Парирование — только шагоходу с руками.
     * Вираж требует, чтобы в прошлом ходу машина прошла хотя бы Тактическую
     * Скорость (шагоходу это не нужно), катится Управлением на Серьёзную (+0) и
     * получает штраф, равный поправке за величину машины: чем она крупнее, тем
     * труднее ей выскользнуть из-под выстрела. Успех снимает одно попадание и
     * ещё по одному за каждую степень сверх первой; провал на пять степеней
     * делает машину Неуправляемой.
     *
     * Снятые попадания система не вычёркивает из чужой карточки — она называет
     * их число, а убирает попадания тот, кто применяет урон.
     */
    async _onVehicleJink(event) {
        event.preventDefault();
        const sys = this.actor.system;
        if (!sys.can?.swerve) {
            return ui.notifications.warn(game.i18n.localize("VEHICLE.NO_MANOEUVRE_IMMOBILE"));
        }
        // Шагоход виляет корпусом стоя, остальным нужен ход: правило смотрит на
        // прошлый раунд, и пройденное за него система уже считает сама.
        const walker = sys.vehicleType === "walker";
        const tactical = Number(sys.speed?.tactical) || 0;
        if (!walker && (Number(sys.speed?.movedLastRound) || 0) < Math.max(tactical, 1)) {
            return ui.notifications.warn(game.i18n.localize("VEHICLE.JINK_TOO_SLOW"));
        }

        const operator = game.actors.get(sys.operatorId);
        if (!operator) return ui.notifications.warn(game.i18n.localize("VEHICLE.NO_OPERATOR"));
        if (!operator.isOwner) return ui.notifications.warn(game.i18n.localize("VEHICLE.GUNNER_NOT_OWNED"));

        const sizePenalty = _sizeModifier(sys.size);
        const rollData = DarkHeresyUtil.createSkillRollData(operator, "operate");
        rollData.name = "VEHICLE.ACTION.JINK";
        rollData.difficulty = { value: 0, text: game.i18n.localize(Dh.difficulties[0]) };
        rollData.target.modifier = (Number(rollData.target.modifier) || 0)
            + (Number(sys.operateModifier) || 0) - sizePenalty;

        const vehicle = this.actor;
        rollData.afterRoll = async data => {
            const notes = [];
            if (data.flags?.isSuccess) {
                const hits = Math.max(1, Number(data.dos) || 1);
                notes.push(game.i18n.format("VEHICLE.JINK_NEGATED", { hits }));
            } else if ((Number(data.dof) || 0) >= 5) {
                notes.push(game.i18n.format("VEHICLE.MANOEUVRE_UNMANAGEABLE", { dof: data.dof }));
            } else {
                notes.push(game.i18n.localize("VEHICLE.JINK_FAILED"));
            }
            if (sizePenalty) {
                notes.push(game.i18n.format("VEHICLE.JINK_SIZE", { penalty: -sizePenalty }));
            }
            await ChatMessage.create({
                content: `<div class="dark-heresy chat roll"><div class="dh-card ${data.flags?.isSuccess ? "is-neutral" : "is-fail"}">
                    <div class="dh-card-h"><span class="who">${vehicle.name}</span>
                    <span class="verdict">${game.i18n.localize("VEHICLE.ACTION.JINK")}</span></div>
                    <div class="dh-card-b">${notes.map(n => `<p class="dh-note">${n}</p>`).join("")}</div>
                    </div></div>`
            });
        };

        await prepareCommonRoll(rollData);
    }

    /**
     * На таран! — полное действие: машина бьёт целью саму себя.
     *
     * Оператор проходит Серьёзную (+0) проверку Управления, и только при успехе
     * машина сталкивается с целью. Урон по книге: 1d10 ударного плюс очки брони
     * той стороны, которой машина ударила, и ещё 1d10 за каждые полные 10 метров,
     * пройденные сверх Тактической Скорости.
     *
     * По другой машине таран отдаёт: таранящая получает урон, равный броне той
     * стороны цели, в которую попала, плюс 1d5.
     *
     * Шагоход таранить не может — ног для этого мало; ему остаётся Натиск.
     */
    async _onVehicleRam(event) {
        event.preventDefault();
        const sys = this.actor.system;
        if (!sys.can?.move) {
            return ui.notifications.warn(game.i18n.localize("VEHICLE.NO_RAM_IMMOBILE"));
        }
        if (sys.vehicleType === "walker") {
            return ui.notifications.warn(game.i18n.localize("VEHICLE.NO_RAM_WALKER"));
        }
        const target = DarkHeresyUtil.getCurrentTargets()[0];
        const victim = target ? canvas.tokens.get(target.tokenId)?.actor : null;
        if (!victim) return ui.notifications.warn(game.i18n.localize("VEHICLE.RAM_NO_TARGET"));

        const operator = game.actors.get(sys.operatorId);
        if (!operator) return ui.notifications.warn(game.i18n.localize("VEHICLE.NO_OPERATOR"));
        if (!operator.isOwner) return ui.notifications.warn(game.i18n.localize("VEHICLE.GUNNER_NOT_OWNED"));

        // Разгон машина знает сама: это пройденное ею в этом раунде. Спрашиваем
        // только затем, чтобы стол мог поправить — фишку двигают и мышкой мимо.
        const vehicleToken = _getVehicleToken(this.actor);
        const tracked = Number(canvas.scene?.tokens?.get(vehicleToken?.id)
            ?.getFlag("dark-heresy", "movedThisRound")) || 0;
        const runUp = await _promptRamRunUp(Math.round(tracked));
        if (runUp === null) return;

        const rollData = DarkHeresyUtil.createSkillRollData(operator, "operate");
        rollData.name = "VEHICLE.RAM";
        rollData.difficulty = { value: 0, text: game.i18n.localize(Dh.difficulties[0]) };
        rollData.target.modifier = (Number(rollData.target.modifier) || 0)
            + (Number(sys.operateModifier) || 0);

        const vehicle = this.actor;
        const victimToken = canvas.tokens.get(target.tokenId);
        rollData.afterRoll = async data => {
            if (!data.flags?.isSuccess) {
                // Промах по цели: столкновения не было. Провал на пять и больше
                // делает машину Неуправляемой — это уже читает МИ.
                const note = (Number(data.dof) || 0) >= 5
                    ? game.i18n.format("VEHICLE.MANOEUVRE_UNMANAGEABLE", { dof: data.dof })
                    : game.i18n.localize("VEHICLE.RAM_MISSED");
                await ChatMessage.create({
                    content: `<div class="dark-heresy chat roll"><div class="dh-card is-neutral">
                        <div class="dh-card-h"><span class="who">${vehicle.name}</span>
                        <span class="verdict">${game.i18n.localize("VEHICLE.RAM")}</span></div>
                        <div class="dh-card-b"><p class="dh-note">${note}</p></div></div></div>`
                });
                return;
            }
            await vehicle.sheet._resolveRam(victim, victimToken, vehicleToken, runUp);
        };

        await prepareCommonRoll(rollData);
    }

    /**
     * Разыграть состоявшееся столкновение: урон цели и отдача таранящему.
     * @param {Actor} victim
     * @param {Token} victimToken
     * @param {Token} vehicleToken
     * @param {number} runUp
     */
    async _resolveRam(victim, victimToken, vehicleToken, runUp) {
        // Бьёт машина той стороной, которой развёрнута к цели, и её броня идёт
        // в урон; сторону цели считаем как при выстреле.
        const strikingSide = _getVehicleFacing(victimToken, vehicleToken);
        const strikingArmour = this.actor._vehicleArmour(strikingSide);
        // Лишняя кость идёт за каждые полные 10 метров, пройденных СВЕРХ
        // Тактической Скорости, а не за весь разгон: сама Тактическая Скорость —
        // это тот минимум, без которого таран вообще не состоится.
        const tactical = Number(this.actor.system.speed?.tactical) || 0;
        const runUpDice = Math.floor(Math.max(0, runUp - tactical) / 10);

        const roll = await new Roll(`1d10 + ${strikingArmour}`
            + (runUpDice ? ` + ${runUpDice}d10` : "")).evaluate();
        const total = roll.total;

        const victimFacing = _getVehicleFacing(vehicleToken, victimToken);
        await this._applyRamHit(victim, total, victimFacing);

        // Отдача — только при столкновении с другой машиной.
        let recoil = 0;
        if (victim.type === "vehicle") {
            const recoilRoll = await new Roll(`1d5 + ${victim._vehicleArmour(victimFacing)}`).evaluate();
            recoil = recoilRoll.total;
            await this._applyRamHit(this.actor, recoil, strikingSide);
        }

        await roll.toMessage({
            flavor: game.i18n.format("VEHICLE.RAM_FLAVOR", {
                name: this.actor.name, victim: victim.name,
                armour: strikingArmour, runUp, tactical,
                push: total,
                recoil: recoil || "—"
            })
        });
    }

    /**
     * Приложить попадание тарана. Пробиваемости у тарана нет.
     * @param {Actor} actor
     * @param {number} amount
     * @param {string} facing
     */
    async _applyRamHit(actor, amount, facing) {
        if (amount <= 0) return;
        await actor.applyDamage([{
            amount, penetration: 0, type: "impact", righteousFury: 0,
            ...(actor.type === "vehicle"
                ? { zone: "hull", facing }
                : { location: _getLocation((await new Roll("1d100").evaluate()).total) })
        }]);
    }

    /**
     * Перезарядить орудие машины — набить магазин под завязку.
     */
    async _onVehicleWeaponReload(event) {
        event.preventDefault();
        const weapon = this._itemFromEvent(event);
        const max = Number(weapon?.system.clip?.max) || 0;
        if (!weapon || max <= 0) return;
        if (Number(weapon.system.clip.value) >= max) {
            return ui.notifications.info(game.i18n.localize("VEHICLE.CLIP_FULL"));
        }
        await weapon.update({ "system.clip.value": max });
        ui.notifications.info(game.i18n.format("VEHICLE.RELOADED",
            { name: weapon.name, reload: weapon.system.reload || "—" }));
    }

    async _updateObject(event, formData) {
        const result = await super._updateObject(event, formData);
        // Назначенный оператор садится за рычаги сам: без этого он не попадал
        // ни под осколки, ни в общую инициативу экипажа.
        const operatorId = this.actor.system.operatorId;
        if (operatorId) await this._seatCrew(operatorId, { role: game.i18n.localize("VEHICLE.OPERATOR") });
        return result;
    }

    /**
     * Собрать экипаж: посаженные на борт, оператор и все приписанные к орудиям
     * стрелки. Последние два попадают в список, даже если их забыли посадить, —
     * иначе командир задал бы инициативу не тем, кто на самом деле работает.
     * @returns {Actor[]}
     */
    _vehicleCrew() {
        const ids = [
            ...(this.actor.crewMembers ?? []).map(m => m.actorId),
            this.actor.system.operatorId,
            ...this.actor.vehicleWeapons.map(w => w.system.gunnerId)
        ];
        return [...new Set(ids.filter(Boolean))].map(id => game.actors.get(id)).filter(Boolean);
    }

    /**
     * Посадить актёра на борт. Приходит либо перетаскиванием на лист, либо
     * назначением оператором или стрелком.
     * @param {string} actorId
     * @param {object} [seat]
     * @returns {Promise<void>}
     */
    async _seatCrew(actorId, seat = {}) {
        const actor = game.actors.get(actorId);
        if (!actor || !["acolyte", "heretic", "npc"].includes(actor.type)) return;
        const members = foundry.utils.deepClone(this.actor.system.crew?.members ?? []);
        if (members.some(m => m.actorId === actorId)) return;
        members.push({ actorId, role: seat.role ?? "", passenger: !!seat.passenger });
        await this.actor.update({ "system.crew.members": members });
    }

    async _onDropActor(event, data) {
        if (!this.actor.isOwner) return false;
        const actor = await Actor.implementation.fromDropData(data);
        if (!actor) return;
        // Машину в машину не сажают — это не гараж.
        if (!["acolyte", "heretic", "npc"].includes(actor.type)) {
            return ui.notifications.warn(game.i18n.localize("VEHICLE.CREW_BAD_TYPE"));
        }
        await this._seatCrew(actor.id);
        ui.notifications.info(game.i18n.format("VEHICLE.CREW_SEATED", { name: actor.name }));
    }

    _crewIdFromEvent(event) {
        return event.currentTarget.closest("[data-actor-id]")?.dataset.actorId;
    }

    async _onCrewRemove(event) {
        event.preventDefault();
        const actorId = this._crewIdFromEvent(event);
        if (!actorId) return;
        const members = (this.actor.system.crew?.members ?? []).filter(m => m.actorId !== actorId);
        await this.actor.update({ "system.crew.members": members });
    }

    _onCrewOpenSheet(event) {
        event.preventDefault();
        game.actors.get(this._crewIdFromEvent(event))?.sheet.render(true);
    }

    async _onCrewFieldChange(event, field, value) {
        const actorId = this._crewIdFromEvent(event);
        if (!actorId) return;
        const members = foundry.utils.deepClone(this.actor.system.crew?.members ?? []);
        const seat = members.find(m => m.actorId === actorId);
        if (!seat) return;
        seat[field] = value;
        await this.actor.update({ "system.crew.members": members });
    }

    /**
     * Инициатива экипажа по командиру.
     *
     * Правило: бросок командира (за неимением — оператора) задаёт инициативу
     * всей команде, а внутри неё порядок остаётся прежним — сначала тот, кто
     * выбросил больше. Здесь общий результат просто раздаётся всем: система
     * ставит числа, а рассадка по порядку остаётся за столом.
     */
    async _onVehicleCrewInitiative(event) {
        event.preventDefault();
        const combat = game.combat;
        if (!combat) return ui.notifications.warn(game.i18n.localize("VEHICLE.NO_COMBAT"));
        const crew = this._vehicleCrew();
        const commander = game.actors.get(this.actor.system.operatorId) ?? crew[0];
        if (!commander) return ui.notifications.warn(game.i18n.localize("VEHICLE.NO_OPERATOR"));

        const combatants = combat.combatants.filter(c =>
            crew.some(a => a.id === c.actorId) || c.actorId === this.actor.id);
        if (!combatants.length) return ui.notifications.warn(game.i18n.localize("VEHICLE.CREW_NOT_IN_COMBAT"));

        const lead = combat.combatants.find(c => c.actorId === commander.id);
        let initiative = lead?.initiative;
        if (initiative === null || initiative === undefined) {
            await combat.rollInitiative(lead ? [lead.id] : [combatants[0].id]);
            initiative = combat.combatants.get(lead?.id ?? combatants[0].id)?.initiative;
        }
        await combat.setMultipleInitiatives?.(combatants.map(c => c.id), initiative)
            ?? await combat.updateEmbeddedDocuments("Combatant",
                combatants.map(c => ({ _id: c.id, initiative })));
        ui.notifications.info(game.i18n.format("VEHICLE.CREW_INITIATIVE_SET",
            { value: initiative, count: combatants.length, name: commander.name }));
    }

    async _onVehicleItemCreate(event) {
        event.preventDefault();
        const type = event.currentTarget.dataset.type;
        const name = game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(`TYPES.Item.${type}`) });
        await this.actor.createEmbeddedDocuments("Item", [{ name, type }]);
    }

    _itemFromEvent(event) {
        const row = event.currentTarget.closest("[data-item-id]");
        return row ? this.actor.items.get(row.dataset.itemId) : null;
    }

    _onVehicleItemEdit(event) {
        event.preventDefault();
        this._itemFromEvent(event)?.sheet.render(true);
    }

    async _onVehicleItemDelete(event) {
        event.preventDefault();
        const item = this._itemFromEvent(event);
        if (item) await item.delete();
    }
}

/**
 * Лист пустотного корабля — тот же бумажный бланк Rogue Trader, только нашей
 * вёрсткой. Ничего не бросает и ничего не решает: это гроссбух.
 */
/* ══ Пустотный бой ═══════════════════════════════════════════════════════════
   Rogue Trader, глава VIII, стр. 212-223. Правила чужие для остальной системы:
   свой счёт ступеней, свои щиты, своя таблица критов и запрет на Праведную
   ярость. Поэтому весь пустотный бой живёт здесь, отдельным блоком, и ничего
   не занимает у наземного, кроме броска кубика. */

/**
 * Ступени успеха по счёту Rogue Trader.
 *
 * Привычной по Dark Heresy 2 единицы здесь нет: в примере на стр. 221 разница
 * 58 − 29 = 29 объявлена «двумя ступенями», а не тремя, и три попадания из неё
 * выходят как «одно плюс две». Общесистемный счёт (1 + _getDegree) дал бы
 * лишнее попадание с каждого выстрела, поэтому берётся голое деление.
 *
 * @param {number} target итоговое значение Меткости
 * @param {number} roll выпавшее на d100
 * @returns {number} ступеней успеха, не меньше нуля
 */
function _shipDegrees(target, roll) {
    return Math.max(0, _getDegree(target, roll));
}

/**
 * Сколько попаданий даёт залп.
 *
 * Макробатарея кладёт одно попадание плюс по одному за ступень, но не больше
 * своей Силы. Лэнс — одно плюс по одному за каждые три ступени, и потолка у
 * него нет: Сила лэнса и так обычно единица.
 *
 * @param {string} weaponType "macrobattery" | "lance"
 * @param {number} degrees ступеней успеха
 * @param {number} strength действующая Сила орудия
 * @returns {number}
 */
function _shipHitCount(weaponType, degrees, strength) {
    if (weaponType === "lance") return 1 + Math.floor(degrees / 3);
    const hits = 1 + degrees;
    return strength > 0 ? Math.min(hits, strength) : hits;
}

/**
 * Погасить попадания пустотными щитами (стр. 220-221).
 *
 * Щит снимает столько попаданий, какова его сила, и после этого схлопывается —
 * но только против того, кто его продавил. Другой стрелок в том же раунде
 * застаёт щиты снова поднятыми, поэтому счёт ведётся по каждому нападающему
 * отдельно и сбрасывается со сменой раунда.
 *
 * @param {Actor} target
 * @param {string} attackerId
 * @param {number} hits
 * @returns {Promise<{cancelled: number, remaining: number, collapsed: boolean}>}
 */
/**
 * Раунд того боя, в котором стоит корабль.
 *
 * game.combat — это бой, открытый в трекере, а не обязательно тот, где идёт
 * корабельная схватка: на одной сцене легко висит и старая наземная стычка.
 * Щиты и отметки хода, привязанные к чужому раунду, никогда бы не сбросились.
 * Поэтому раунд берётся из боя, куда внесён сам корабль, а ключ несёт и id боя,
 * чтобы раунд 1 одного боя не путался с раундом 1 другого.
 *
 * @param {Actor} actor
 * @returns {string}
 */
function _shipCombatRound(actor) {
    const combat = game.combats.find(c => c.started && c.combatants.some(cb => cb.actor?.id === actor?.id))
        ?? game.combat;
    return combat ? `${combat.id}:${combat.round}` : "none";
}

async function _consumeVoidShields(target, attackerId, hits) {
    const strength = Number(target?.system?.shields) || 0;
    if (strength <= 0 || hits <= 0) {
        return { cancelled: 0, remaining: Math.max(0, hits), collapsed: strength <= 0 };
    }

    const round = _shipCombatRound(target);
    const state = target.getFlag("dark-heresy", "voidShields");
    const absorbed = (state && state.round === round) ? { ...(state.absorbed ?? {}) } : {};
    const already = Number(absorbed[attackerId]) || 0;

    const cancelled = Math.min(Math.max(0, strength - already), hits);
    absorbed[attackerId] = already + cancelled;
    await target.setFlag("dark-heresy", "voidShields", { round, absorbed });

    return {
        cancelled,
        remaining: hits - cancelled,
        collapsed: (already + cancelled) >= strength
    };
}

/**
 * Достать строку из таблицы критов кораблей.
 *
 * Таблица лежит в компендиуме, а не в коде: стол должен иметь возможность её
 * прочитать и подправить. Если компендиума нет — карточка честно скажет, что
 * крит случился, но текста к нему не нашлось, вместо того чтобы выдумать его.
 *
 * @param {number} value номер строки (1d5 при обычном крите, превышение брони
 *                       у обездвиженного корабля)
 * @returns {Promise<{value: number, name: string, text: string}|null>}
 */
async function _lookupShipCritical(value) {
    return _lookupTableRow("Starship Critical Hits", value);
}

/**
 * Достать строку из таблицы компендиума по номеру.
 *
 * Крит — не единственная такая таблица: «Двигатели искалечены» бросаются и
 * при сорванном Полном ходе, и при крите номер 6. Отсюда же читаются и
 * таблицы критов машин.
 *
 * @param {string} tableName
 * @param {number} value
 * @returns {Promise<{value: number, name: string, text: string}|null>}
 */
async function _lookupTableRow(tableName, value) {
    const pack = game.packs.get("dark-heresy.bc-tables");
    if (!pack) return null;
    const index = await pack.getIndex();
    const entry = index.find(e => matchesRuleName(e, tableName));
    if (!entry) return null;
    const table = await pack.getDocument(entry._id);
    const rows = [...(table?.results ?? [])];
    if (!rows.length) return null;
    // Превышение брони у обездвиженного корабля легко уходит за 11, а таблица
    // на 11 кончается: всё, что выше, — та же Катастрофа. Ниже единицы строк
    // нет вовсе. Поэтому число прижимается к краям таблицы.
    const top = Math.max(...rows.map(r => r.range[1]));
    const bottom = Math.min(...rows.map(r => r.range[0]));
    const looked = Math.min(Math.max(value, bottom), top);
    const row = rows.find(r => looked >= r.range[0] && looked <= r.range[1]);
    if (!row) return null;
    return { value, name: row.name, text: row.description ?? row.text ?? "" };
}

/**
 * Выстрел корабельного орудия (стр. 219-221).
 *
 * Считает всё до конца — попадания, щиты, урон, броню, крит, — но ничего не
 * записывает: урон уходит в карточку с кнопкой. Списывать Целостность корпуса
 * молча нельзя, слишком многое в пустотном бою решается за столом.
 *
 * @param {object} options
 * @returns {Promise<object|null>} разбор выстрела, либо null если стрелять нечем
 */
async function rollShipAttack({
    ship, weapon, gunner = null, target = null,
    rangeBand = "normal", surprised = false, evasion = 0,
    lockOn = 0, modifier = 0, post = true, skipDamage = false
} = {}) {
    if (!ship || !weapon) return null;

    // Меткость. Наводчик-игрок бросает своей; когда действие поручено команде,
    // бросает она — по своей выучке (табл. 8-9).
    const bs = gunner
        ? (gunner.characteristics?.ballisticSkill?.displayTotal
            ?? gunner.characteristics?.ballisticSkill?.total ?? 0)
        : (Number(ship.system.crewRating) || 0);

    // Поправки. Дальность из стр. 220, внезапность из стр. 213, штраф за
    // просевший Дух приходит готовым из сводки корабля.
    const rangeMods = { close: 10, normal: 0, long: -10 };
    const parts = [];
    const add = (label, value) => { if (value) parts.push({ label, value }); };
    add(`SHIP.RANGE.${rangeBand.toUpperCase()}`, rangeMods[rangeBand] ?? 0);
    if (surprised) add("SHIP.MOD.SURPRISED", 20);
    add("SHIP.MOD.MORALE", Number(ship.system.mods?.ballisticSkill) || 0);
    // Всё, что манёвры и расширенные действия этого хода повесили на корабли,
    // подхватывается само: вводить это второй раз в диалоге — значит однажды
    // забыть или посчитать дважды.
    const ownTurn = foundry.utils.duplicate(ship.getFlag("dark-heresy", "shipTurn") ?? {});
    const ownEvasion = Number(ship.getFlag("dark-heresy", "evasion")?.value) || 0;
    const targetEvasion = Number(target?.getFlag("dark-heresy", "evasion")?.value) || 0;
    add("SHIP.ACTION.COME_TO_NEW_HEADING", Number(ownTurn.bsPenalty) || 0);
    // Уклоняющийся корабль и сам стреляет хуже (стр. 215).
    add("SHIP.MOD.OWN_EVASION", -ownEvasion);
    add("SHIP.MOD.EVASION", -(targetEvasion + Math.abs(Number(evasion) || 0)));
    const lockOnBonus = (Number(lockOn) || 0) || (Number(ownTurn.lockOn) || 0);
    add("SHIP.EXTENDED.LOCK_ON", lockOnBonus);
    const backsBonus = (Number(ownTurn.backs) || 0) > 0 ? 5 : 0;
    add("SHIP.ACTION.PUT_BACKS_INTO_IT", backsBonus);
    add("DIALOG.MODIFIER", Number(modifier) || 0);

    const totalMod = parts.reduce((sum, p) => sum + p.value, 0);
    const finalTarget = Math.max(0, bs + totalMod);

    const roll = new Roll("1d100");
    await roll.evaluate();
    const result = roll.total;
    const attackRender = await roll.render();

    // Разовые подспорья тратятся на этом стволе: наводка — на один компонент
    // (стр. 218), «Навались!» — на один тест. Отметка «стрелял» ставится всегда.
    if (lockOnBonus && !lockOn) ownTurn.lockOn = 0;
    if (backsBonus) ownTurn.backs = (Number(ownTurn.backs) || 0) - 1;
    ownTurn.shot = true;
    await ship.setFlag("dark-heresy", "shipTurn", ownTurn);

    const success = result <= finalTarget;
    const degrees = success ? _shipDegrees(finalTarget, result) : 0;

    const weaponType = weapon.system.weaponType === "lance" ? "lance" : "macrobattery";
    const strength = Number(weapon.system.strengthEffective ?? weapon.system.strength) || 0;
    const critRating = Number(weapon.system.critRating) || 0;

    const out = {
        shipId: ship.id, shipName: ship.name,
        weaponId: weapon.id, weaponName: weapon.name, weaponType,
        gunnerName: gunner?.name ?? null,
        targetId: target?.id ?? null, targetName: target?.name ?? null,
        bs, parts, totalMod, target: finalTarget, result, success, degrees, attackRender,
        strength, critRating,
        hits: 0, cancelled: 0, landed: 0, shieldsCollapsed: false,
        damageRolls: [], damageTotal: 0, armour: 0, hullDamage: 0,
        critical: null, notes: []
    };
    if (ownTurn.noFire) out.notes.push("SHIP.NOTE.NO_FIRE_DISENGAGE");
    if (ship.getFlag("dark-heresy", "boarding")) out.notes.push("SHIP.NOTE.BOARDED_NO_FIRE");

    if (!success) {
        if (post) await _postShipAttackCard(out);
        return out;
    }

    out.hits = _shipHitCount(weaponType, degrees, strength);

    // В залпе щиты и урон разбираются позже и разом: сначала надо свести
    // попадания всех стволов. Выход обязан стоять до щитов — иначе каждый ствол
    // продавил бы их сам, и залп списал бы щиты второй раз.
    if (skipDamage) return out;

    // Щиты снимают попадания до того, как бросается урон.
    if (target) {
        const shielded = await _consumeVoidShields(target, ship.id, out.hits);
        out.cancelled = shielded.cancelled;
        out.landed = shielded.remaining;
        out.shieldsCollapsed = shielded.collapsed;
    } else {
        out.landed = out.hits;
        out.notes.push("SHIP.NOTE.NO_TARGET");
    }

    const formula = String(weapon.system.damage || "").trim();
    if (out.landed > 0 && formula) {
        for (let i = 0; i < out.landed; i++) {
            const dmg = new Roll(formula);
            await dmg.evaluate();
            out.damageRolls.push(dmg.total);
        }
        out.damageTotal = out.damageRolls.reduce((a, b) => a + b, 0);
    }

    // Броня. Макробатарея складывает броски в один вал и бьётся об неё разом;
    // лэнс броню не замечает вовсе и идёт прямо в корпус (стр. 220).
    out.armour = Number(target?.system?.armour) || 0;
    if (out.landed > 0) {
        out.hullDamage = weaponType === "lance"
            ? out.damageTotal
            : Math.max(0, out.damageTotal - out.armour);
    }

    // Крит. Две дороги к нему, и книга не говорит, что делать, когда обе
    // открыты разом. Система берёт вариант для обездвиженного корабля: это
    // более частное правило, и оно же обычно страшнее.
    const excess = weaponType === "lance"
        ? out.damageTotal
        : out.damageTotal - out.armour;
    const crippledCrit = !!target?.system?.crippled && excess > 0;
    const ratingCrit = critRating > 0 && degrees >= critRating;

    if (crippledCrit) {
        out.critical = await _lookupShipCritical(excess);
        out.criticalSource = "crippled";
    } else if (ratingCrit) {
        // Выстрел, дошедший до Крит-рейтинга, но не пробивший корпус, всё равно
        // снимает одно очко Целостности — иначе крита бы не было (стр. 220).
        if (out.hullDamage <= 0) {
            out.hullDamage = 1;
            out.notes.push("SHIP.NOTE.CRIT_MINIMUM");
        }
        const die = new Roll("1d5");
        await die.evaluate();
        out.criticalRoll = die.total;
        out.critical = await _lookupShipCritical(die.total);
        out.criticalSource = "rating";
    }
    if ((crippledCrit || ratingCrit) && !out.critical) out.notes.push("SHIP.NOTE.CRIT_NO_TABLE");

    // Праведная ярость к корабельным орудиям не применяется (стр. 220) — здесь
    // её и нет: пустотный бой считает урон сам и мимо _computeDamage.

    if (post) await _postShipAttackCard(out);
    return out;
}

/**
 * Средний бросок формулы урона.
 *
 * Нужен только для того, чтобы решить, чьи попадания скормить щитам в залпе:
 * книга говорит, что стрелок гасит щиты лёгкими стволами, а «лёгкий» — это и
 * есть меньший средний урон. Разбор грубый (кубики и плюсы), но точнее здесь
 * и не требуется: сравниваются между собой две-три формулы.
 *
 * @param {string} formula
 * @returns {number}
 */
function _averageFormula(formula) {
    let sum = 0;
    for (const m of String(formula ?? "").matchAll(/([+-]?)\s*(\d*)d(\d+)|([+-]?\s*\d+)(?!d)/gi)) {
        if (m[3]) {
            const sign = m[1] === "-" ? -1 : 1;
            sum += sign * (Number(m[2] || 1) * (Number(m[3]) + 1) / 2);
        } else if (m[4]) {
            sum += Number(m[4].replace(/\s+/g, ""));
        }
    }
    return sum;
}

/**
 * Единый залп из нескольких макробатарей (стр. 220).
 *
 * Каждый ствол бросает Меткость сам, а вот урон складывается в один вал и
 * бьётся о броню один раз — в этом весь смысл залпа. Платой идёт крит: сколько
 * бы стволов ни достало до Крит-рейтинга, залп наносит не больше одного.
 *
 * Лэнсы в залп не входят: книга разрешает объединять только макробатареи, да и
 * складывать нечего — броню лэнс и так не замечает.
 *
 * @param {object} options
 * @returns {Promise<object|null>}
 */
async function rollShipSalvo({
    ship, weapons = [], target = null, gunner = null,
    rangeBand = "normal", surprised = false, evasion = 0,
    lockOn = 0, modifier = 0, post = true
} = {}) {
    const guns = weapons.filter(w => w?.system?.weaponType !== "lance");
    if (!ship || guns.length < 2) return null;

    // Каждый ствол стреляет своим броском, но урон пока не катится: сперва надо
    // узнать, сколько попаданий переживёт щиты.
    const shots = [];
    for (const weapon of guns) {
        const shot = await rollShipAttack({
            ship, weapon, target, gunner, rangeBand, surprised,
            evasion, lockOn, modifier, post: false, skipDamage: true
        });
        if (shot) shots.push(shot);
    }
    if (!shots.length) return null;

    const out = {
        shipId: ship.id, shipName: ship.name,
        gunnerName: gunner?.name ?? null,
        targetId: target?.id ?? null, targetName: target?.name ?? null,
        shots, hits: 0, cancelled: 0, landed: 0, shieldsCollapsed: false,
        damageRolls: [], damageTotal: 0, armour: 0, hullDamage: 0,
        critical: null, notes: []
    };

    out.hits = shots.reduce((sum, sh) => sum + sh.hits, 0);

    if (target) {
        const shielded = await _consumeVoidShields(target, ship.id, out.hits);
        out.cancelled = shielded.cancelled;
        out.landed = shielded.remaining;
        out.shieldsCollapsed = shielded.collapsed;
    } else {
        out.landed = out.hits;
        out.notes.push("SHIP.NOTE.NO_TARGET");
    }

    // Какие именно попадания съедят щиты, выбирает стрелок, и книга говорит,
    // чем он выбирает: лёгкими стволами, чтобы тяжёлые дошли. Отсюда порядок —
    // от меньшего среднего урона к большему.
    const order = [...shots].sort((a, b) =>
        _averageFormula(_shipWeaponFormula(ship, a.weaponId))
        - _averageFormula(_shipWeaponFormula(ship, b.weaponId)));
    let toDiscard = out.cancelled;
    const surviving = new Map();
    for (const shot of order) {
        const kept = Math.max(0, shot.hits - toDiscard);
        toDiscard = Math.max(0, toDiscard - shot.hits);
        surviving.set(shot.weaponId, kept);
    }

    for (const shot of shots) {
        const count = surviving.get(shot.weaponId) ?? 0;
        const formula = _shipWeaponFormula(ship, shot.weaponId);
        shot.landed = count;
        shot.damageRolls = [];
        for (let i = 0; i < count && formula; i++) {
            const dmg = new Roll(formula);
            await dmg.evaluate();
            shot.damageRolls.push(dmg.total);
            out.damageRolls.push(dmg.total);
        }
        shot.damageTotal = shot.damageRolls.reduce((a, b) => a + b, 0);
    }
    out.damageTotal = out.damageRolls.reduce((a, b) => a + b, 0);

    // Броня вычитается один раз из общего вала — ради этого залп и собирают.
    out.armour = Number(target?.system?.armour) || 0;
    const excess = out.damageTotal - out.armour;
    out.hullDamage = Math.max(0, excess);

    // Крит один на весь залп, даже если до рейтинга дотянулись все стволы.
    const critShot = shots.find(sh => sh.success && sh.critRating > 0 && sh.degrees >= sh.critRating);
    if (target?.system?.crippled && excess > 0) {
        out.critical = await _lookupShipCritical(excess);
        out.criticalSource = "crippled";
    } else if (critShot) {
        if (out.hullDamage <= 0) {
            out.hullDamage = 1;
            out.notes.push("SHIP.NOTE.CRIT_MINIMUM");
        }
        const die = new Roll("1d5");
        await die.evaluate();
        out.criticalRoll = die.total;
        out.critical = await _lookupShipCritical(die.total);
        out.criticalSource = "rating";
    }
    if (out.criticalSource && !out.critical) out.notes.push("SHIP.NOTE.CRIT_NO_TABLE");
    if (shots.filter(sh => sh.success && sh.critRating > 0 && sh.degrees >= sh.critRating).length > 1) {
        out.notes.push("SHIP.NOTE.SALVO_ONE_CRIT");
    }

    if (post) await _postShipSalvoCard(out);
    return out;
}

/**
 * Формула урона ствола по его идентификатору.
 * @param {Actor} ship
 * @param {string} weaponId
 * @returns {string}
 */
function _shipWeaponFormula(ship, weaponId) {
    return String(ship.items.get(weaponId)?.system?.damage ?? "").trim();
}

/**
 * Выложить в чат разбор залпа.
 * @param {object} data
 */
async function _postShipSalvoCard(data) {
    const view = foundry.utils.duplicate(data);
    await _enrichShipCritical(view.critical);
    view.canApply = !!(data.targetId && data.hullDamage > 0);
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/dark-heresy/template/chat/ship-salvo.hbs", view);
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: game.actors.get(data.shipId) }),
        content
    });
}

/**
 * Обогатить текст крита для карточки.
 *
 * В строках таблицы стоят инлайн-броски вроде [[1d10]] — «брось на тягу»,
 * «сколько компонентов». Сырым текстом их пришлось бы перебивать руками, а
 * после обогащения они щёлкаются прямо в карточке.
 *
 * @param {object|null} critical
 */
async function _enrichShipCritical(critical) {
    if (!critical?.text) return;
    critical.html = await foundry.applications.ux.TextEditor.implementation
        .enrichHTML(critical.text, { async: true });
}

/**
 * Выложить в чат разбор выстрела.
 *
 * Шаблону отдаётся уже готовое: ключ типа орудия в верхнем регистре, признак
 * лэнса и признак «есть что применять». Считать это в Handlebars нечем, а
 * гонять логику через хелперы значит размазать её по двум файлам.
 *
 * @param {object} data результат rollShipAttack
 */
async function _postShipAttackCard(data) {
    const view = foundry.utils.duplicate(data);
    await _enrichShipCritical(view.critical);
    view.weaponTypeKey = data.weaponType === "lance" ? "LANCE" : "MACROBATTERY";
    view.isLance = data.weaponType === "lance";
    view.canApply = !!(data.targetId && data.hullDamage > 0);
    view.attackRender = data.attackRender ?? "";

    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/dark-heresy/template/chat/ship-attack.hbs", view);
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: game.actors.get(data.shipId) }),
        content
    });
}

/**
 * Списать урон корабля: корпус, а с ним команда и боевой дух.
 *
 * Каждое очко Целостности стоит очка Команды и очка Духа (стр. 221) — это
 * не отдельный бросок, а тот же урон, посчитанный людьми.
 *
 * @param {Actor} target
 * @param {number} hullDamage
 * @returns {Promise<object>} что именно ушло
 */
async function applyShipDamage(target, hullDamage) {
    const amount = Math.max(0, Number(hullDamage) || 0);
    if (!target || !amount) return { hull: 0, crew: 0, morale: 0 };

    const num = v => Number(v) || 0;
    const was = {
        hull: num(target._source.system.hullIntegrity?.value),
        crew: num(target._source.system.crew?.value),
        morale: num(target._source.system.morale?.value)
    };
    const hull = Math.max(0, was.hull - amount);
    const crew = Math.max(0, was.crew - amount);
    const morale = Math.max(0, was.morale - amount);

    // Потери копятся до начала следующего хода пострадавшего: по ним Триаж и
    // «Стоять насмерть!» решают, что ещё можно отыграть назад (стр. 218).
    const loss = foundry.utils.duplicate(target.getFlag("dark-heresy", "shipLoss") ?? {});
    loss.sinceTurn = {
        crew: num(loss.sinceTurn?.crew) + (was.crew - crew),
        morale: num(loss.sinceTurn?.morale) + (was.morale - morale)
    };

    await target.update({
        "system.hullIntegrity.value": hull,
        "system.crew.value": crew,
        "system.morale.value": morale,
        "flags.dark-heresy.shipLoss": loss
    });
    return { hull: was.hull - hull, crew: was.crew - crew, morale: was.morale - morale };
}

/**
 * Итог навыка исполнителя для корабельного действия.
 *
 * @param {Actor|null} actor
 * @param {string} skill ключ из Dh.shipSkillLabels
 * @returns {number|null} null — у исполнителя такого навыка нет вовсе
 */
function _shipPerformerSkill(actor, skill) {
    if (!actor) return null;
    const pick = v => (v === undefined || v === null || Number.isNaN(Number(v))) ? null : Number(v);
    switch (skill) {
        case "pilot": return pick(actor.skills?.operate?.specialities?.voidship?.total);
        case "willpower": {
            const c = actor.characteristics?.willpower;
            return pick(c?.displayTotal ?? c?.total);
        }
        default: return pick(actor.skills?.[skill]?.total);
    }
}

/**
 * Корабельное действие: манёвр или расширенное действие (стр. 213-218).
 *
 * Бросок комбинированный, как велит книга: навык исполнителя плюс
 * характеристика корабля, если действие её называет. Когда действие поручено
 * команде, бросают по выучке (табл. 8-9).
 *
 * Эффекты, которые система умеет держать сама, ложатся на корабль отметками:
 * уклонение, наводка, помощь духу машины, «Навались!», ремонт, Триаж. То, что
 * решается картой и расстояниями, карточка называет числом и оставляет столу.
 *
 * @param {Actor} ship
 * @param {string} key ключ Dh.shipActions
 * @param {object} [options]
 * @returns {Promise<object|null>}
 */
async function rollShipAction(ship, key, { performer = null, modifier = 0, choice = {}, post = true } = {}) {
    const def = Dh.shipActions[key];
    if (!ship || !def) return null;
    const sys = ship.system;
    const num = v => Number(v) || 0;
    const warn = k => { ui.notifications.warn(game.i18n.localize(k)); return null; };

    // Противопоставленные тесты с двумя сторонами живут отдельно.
    const defender = game.actors.get(choice?.defenderId) ?? null;
    if (key === "boardingRound") return rollBoardingAction(ship, { performer, defender, modifier, post });
    if (key === "suppressMutiny") {
        return _rollMutinySuppression(ship, { performer, defender, skill: choice?.skill, modifier, post });
    }

    const boarding = ship.getFlag("dark-heresy", "boarding");
    // Сцепленные абордажем корабли не маневрируют и не стреляют (стр. 215).
    if (def.group === "manoeuvre" && boarding) return warn("SHIP.BOARDING.NO_MANOEUVRE");
    if (def.boardedOnly && !boarding) return warn("SHIP.BOARDING.NOT_BOARDED");
    if (["board", "hitAndRun"].includes(key) && sys.boardingDisabled) return warn("SHIP.STATE.NO_BOARDING");
    const targetShip = def.needsTarget ? (game.actors.get(choice?.targetId) ?? null) : null;
    if (def.needsTarget && !targetShip) return warn("SHIP.DIALOG.NEED_TARGET");
    // Что сделать после карточки броска: таран и налёт выкладывают свою.
    let after = null;

    const skill = (def.skillChoice && def.skillChoice.includes(choice?.skill)) ? choice.skill : def.skill;
    const own = _shipPerformerSkill(performer, skill);
    const base = own ?? num(sys.crewRating);

    const parts = [];
    const add = (label, value) => { if (value) parts.push({ label, value }); };
    if (def.stat === "manoeuvrability") add("SHIP.MANOEUVRABILITY", num(sys.manoeuvrabilityEffective));
    if (def.stat === "detection") add("SHIP.DETECTION", num(sys.detectionEffective));
    add("SHIP.ACTION_PART.DIFFICULTY", num(def.difficulty));
    if (def.group === "manoeuvre" && sys.silentRunning) add("SHIP.STATE.SILENT_RUNNING", -10);
    // Штраф Духа — на «все тесты Командования, касающиеся корабля и команды».
    if (skill === "command") add("SHIP.MOD.COMMAND", num(sys.mods?.command));
    if (def.shipboard) add("SHIP.MOD.SHIPBOARD_ACTIONS", num(sys.mods?.shipboardActions));
    // Турели цели мешают подойти налётчикам: −10 за каждое очко (стр. 220).
    if (key === "hitAndRun") add("SHIP.TURRET_RATING", -10 * num(targetShip?.system?.turretRating));

    const turn = foundry.utils.duplicate(ship.getFlag("dark-heresy", "shipTurn") ?? {});
    if (def.aidedByBacks && num(turn.backs) > 0) {
        add("SHIP.ACTION.PUT_BACKS_INTO_IT", 5);
        turn.backs = num(turn.backs) - 1;
    }
    add("DIALOG.MODIFIER", num(modifier));

    const totalMod = parts.reduce((sum, part) => sum + part.value, 0);
    const target = Math.max(0, base + totalMod);
    const roll = new Roll("1d100");
    await roll.evaluate();
    const result = roll.total;
    const success = result <= target;
    const degrees = success ? _shipDegrees(target, result) : 0;
    const failDegrees = success ? 0 : _shipDegrees(result, target);

    const out = {
        shipId: ship.id, shipName: ship.name, key, label: def.label, group: def.group,
        performerName: performer?.name ?? null, skillLabel: Dh.shipSkillLabels[skill],
        base, parts, totalMod, target, result, success, degrees, failDegrees,
        attackRender: await roll.render(), effect: null, critical: null, notes: []
    };
    const say = (k, data = {}) => { out.effect = game.i18n.format(k, data); };
    // «+5 и ещё +5 за каждые две дополнительные ступени» — у наводки и духа машины.
    const step5 = 5 + 5 * Math.floor(degrees / 2);

    if (def.group === "manoeuvre") turn.manoeuvre = key;

    switch (key) {
        case "fightFire": {
            if (!success) break;
            const comp = ship.items.get(choice?.componentId);
            if (!comp?.system?.onFire) {
                out.notes.push("SHIP.NOTE.NO_FIRE_CHOSEN");
                break;
            }
            await comp.update({ "system.onFire": false, "flags.dark-heresy.fireAge": 0 });
            say("SHIP.ACTION_OK.FIGHT_FIRE", { name: comp.name });
            break;
        }

        case "board":
            // Абордаж и таран идут вместо стрельбы — при любом исходе.
            turn.noFire = true;
            if (success) {
                await _setBoarding(ship, targetShip);
                say("SHIP.ACTION_OK.BOARD", { name: targetShip.name });
            } else {
                say("SHIP.ACTION_FAIL.BOARD");
            }
            break;

        case "ram":
            turn.noFire = true;
            if (success) {
                say("SHIP.ACTION_OK.RAM", { name: targetShip.name });
                after = () => _resolveRam(ship, targetShip);
            } else {
                say("SHIP.ACTION_FAIL.RAM");
            }
            break;

        case "breakFree":
            if (success) {
                await _clearBoarding(ship);
                say("SHIP.ACTION_OK.BREAK_FREE");
            } else {
                await ship.setFlag("dark-heresy", "breakFreePenalty", -20);
                say("SHIP.ACTION_FAIL.BREAK_FREE");
            }
            break;

        case "hitAndRun":
            if (success) {
                say("SHIP.ACTION_OK.HIT_AND_RUN");
                after = () => _rollHitAndRunRaid(ship, targetShip, { performer, defender });
            } else {
                say(failDegrees >= 4 ? "SHIP.ACTION_FAIL.HIT_AND_RUN_SHOT_DOWN" : "SHIP.ACTION_FAIL.HIT_AND_RUN");
            }
            break;

        case "mutinyTest":
            if (ship.getFlag("dark-heresy", "mutinyPending")) await ship.unsetFlag("dark-heresy", "mutinyPending");
            if (success) {
                say("SHIP.ACTION_OK.MUTINY_TEST");
            } else {
                await ship.setFlag("dark-heresy", "mutiny", true);
                say("SHIP.ACTION_FAIL.MUTINY_TEST");
                out.buttons = [{ cls: "ship-mutiny-suppress", label: "SHIP.MUTINY.SUPPRESS" }];
            }
            break;

        case "adjustBearing":
        case "adjustSpeed":
        case "adjustSpeedBearing":
            if (success) say(`SHIP.ACTION_OK.${def.code}`, { n: 1 + degrees });
            break;

        case "comeToNewHeading":
            if (success) {
                turn.bsPenalty = -20;
                say("SHIP.ACTION_OK.COME_TO_NEW_HEADING");
            }
            break;

        case "disengage":
            // Стрелять нельзя при любом исходе (стр. 215).
            turn.noFire = true;
            say(success ? "SHIP.ACTION_OK.DISENGAGE" : "SHIP.ACTION_FAIL.DISENGAGE", { n: degrees });
            break;

        case "evasive":
            if (success) {
                // «Успех и каждая следующая ступень» — по −10 за штуку.
                const value = 10 + 10 * degrees;
                await ship.setFlag("dark-heresy", "evasion", { value });
                say("SHIP.ACTION_OK.EVASIVE", { n: value });
            }
            break;

        case "activeAugury":
            if (success) say("SHIP.ACTION_OK.ACTIVE_AUGURY", { n: 20 + 5 * degrees });
            break;

        case "aidMachineSpirit":
            if (success) {
                const stat = choice?.stat === "detection" ? "detection" : "manoeuvrability";
                turn.aid = { stat, value: step5 };
                say("SHIP.ACTION_OK.AID_MACHINE_SPIRIT", {
                    n: step5,
                    stat: game.i18n.localize(stat === "detection" ? "SHIP.DETECTION" : "SHIP.MANOEUVRABILITY")
                });
            }
            break;

        case "disinformation":
            if (success) {
                // «1d5 за каждую ступень». Голый успех по счёту RT — ноль
                // ступеней; система засчитывает его за одну, иначе удачный
                // тест не давал бы ничего.
                const dice = new Roll(`${Math.max(1, degrees)}d5`);
                await dice.evaluate();
                const max = num(sys.morale?.max) || 100;
                const now = num(ship._source.system.morale?.value);
                const raised = Math.min(max, now + dice.total) - now;
                await ship.update({ "system.morale.value": now + raised });
                say("SHIP.ACTION_OK.DISINFORMATION", { n: raised });
            }
            break;

        case "emergencyRepairs": {
            if (!success) break;
            const comp = ship.items.get(choice?.componentId);
            if (!comp || comp.type !== "shipComponent" || comp.system.status === "destroyed") {
                out.notes.push("SHIP.NOTE.NO_COMPONENT");
                break;
            }
            // Ремонт идёт 1d5 ходов, каждая ступень снимает ход, но не меньше одного.
            const time = new Roll("1d5");
            await time.evaluate();
            const turns = Math.max(1, time.total - degrees);
            await comp.update({ "system.repairTurns": turns });
            say("SHIP.ACTION_OK.EMERGENCY_REPAIRS", { name: comp.name, n: turns });
            break;
        }

        case "flankSpeed":
            if (success) {
                say("SHIP.ACTION_OK.FLANK_SPEED", { n: 1 + degrees });
            } else if (failDegrees >= 2) {
                const die = new Roll("1d10");
                await die.evaluate();
                out.critical = await _lookupTableRow("Starship Engines Crippled", die.total);
                out.criticalRoll = die.total;
                say("SHIP.ACTION_FAIL.FLANK_SPEED_BURNOUT");
            }
            break;

        case "focusedAugury":
            if (success) say(`SHIP.ACTION_OK.FOCUSED_AUGURY_${Math.min(3, degrees)}`);
            break;

        case "holdFast":
        case "triage": {
            out.notes.push(key === "holdFast" ? "SHIP.NOTE.HOLD_FAST_TALENT" : null);
            if (!success) break;
            // Отыгрывается только урон прошлого хода и не больше 1 + ступени.
            const track = key === "holdFast" ? "morale" : "crew";
            const loss = foundry.utils.duplicate(ship.getFlag("dark-heresy", "shipLoss") ?? {});
            const lost = num(loss.prevTurn?.[track]);
            const back = Math.min(1 + degrees, lost);
            if (back <= 0) {
                out.notes.push("SHIP.NOTE.NOTHING_TO_CANCEL");
                break;
            }
            const max = num(sys[track]?.max) || 100;
            const now = num(ship._source.system[track]?.value);
            const restored = Math.min(max, now + back) - now;
            loss.prevTurn = { ...(loss.prevTurn ?? {}), [track]: lost - restored };
            await ship.update({
                [`system.${track}.value`]: now + restored,
                "flags.dark-heresy.shipLoss": loss
            });
            say(`SHIP.ACTION_OK.${def.code}`, { n: restored });
            break;
        }

        case "jamComms":
            if (success) say("SHIP.ACTION_OK.JAM_COMMUNICATIONS", { n: 10 + degrees });
            break;

        case "lockOn":
            if (success) {
                turn.lockOn = step5;
                say("SHIP.ACTION_OK.LOCK_ON_TARGET", { n: step5 });
            }
            break;

        case "prepareRepel":
            if (success) {
                // Держится, пока персонаж сплачивает защитников, — не до конца
                // хода, поэтому отдельной отметкой, а не в отметке хода.
                const value = 10 + 5 * degrees;
                await ship.setFlag("dark-heresy", "repelBonus", value);
                say("SHIP.ACTION_OK.PREPARE_TO_REPEL", { n: value });
            }
            break;

        case "putBacks":
            if (success) {
                turn.backs = 1 + Math.floor(degrees / 3);
                say("SHIP.ACTION_OK.PUT_BACKS_INTO_IT", { n: turn.backs });
            }
            break;
    }

    out.notes = out.notes.filter(Boolean);
    if (!out.effect) {
        out.effect = game.i18n.localize(success ? "SHIP.ACTION_FAIL.GENERIC"
            : (def.group === "manoeuvre" ? "SHIP.ACTION_FAIL.MANOEUVRE" : "SHIP.ACTION_FAIL.GENERIC"));
    }

    await ship.setFlag("dark-heresy", "shipTurn", turn);
    if (post) await _postShipActionCard(out);
    if (after) await after();
    return out;
}

/**
 * Выложить в чат разбор корабельного действия.
 * @param {object} data
 */
async function _postShipActionCard(data) {
    const view = foundry.utils.duplicate(data);
    await _enrichShipCritical(view.critical);
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/dark-heresy/template/chat/ship-action.hbs", view);
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: game.actors.get(data.shipId) }),
        content
    });
}

/**
 * Начало стратегического хода корабля.
 *
 * Снимается всё, что держалось «до начала следующего хода»: уклонение,
 * отметки манёвра и выстрела, разовые подспорья. Потери, накопленные с
 * прошлого хода, переезжают в «прошлый ход» — их ещё могут отыграть Триаж и
 * «Стоять насмерть!». Идущий ремонт отсчитывает ход.
 *
 * @param {Actor} ship
 * @param {object|null} combatant
 */
async function _onShipTurnStart(ship, combatant) {
    const num = v => Number(v) || 0;
    const loss = ship.getFlag("dark-heresy", "shipLoss") ?? {};
    await ship.update({
        "flags.dark-heresy.shipTurn": {
            round: _shipCombatRound(ship), manoeuvre: null, shot: false, noFire: false,
            bsPenalty: 0, lockOn: 0, aid: null, backs: 0
        },
        "flags.dark-heresy.shipLoss": {
            sinceTurn: { crew: 0, morale: 0 },
            prevTurn: { crew: num(loss.sinceTurn?.crew), morale: num(loss.sinceTurn?.morale) }
        }
    });
    if (ship.getFlag("dark-heresy", "evasion")) await ship.unsetFlag("dark-heresy", "evasion");

    const finished = [];
    for (const comp of (ship.shipComponents ?? [])) {
        const left = num(comp.system.repairTurns);
        if (left <= 0) continue;
        if (left > 1) {
            await comp.update({ "system.repairTurns": left - 1 });
            continue;
        }
        const update = { "system.repairTurns": 0, "system.depressurised": false };
        if (["damaged", "unpowered"].includes(comp.system.status)) update["system.status"] = "intact";
        await comp.update(update);
        finished.push(comp.name);
    }

    // Пожары (стр. 223). Огонь, переживший целый ход корабля, пожирает отсек и
    // перекидывается дальше. Возраст считается по началам хода: загоревшийся
    // между ходами получает свой ход на тушение.
    const fireNotes = [];
    const burning = (ship.shipComponents ?? []).filter(c => c.system.onFire);
    for (const comp of burning) {
        const age = num(comp.getFlag("dark-heresy", "fireAge"));
        if (age < 1) {
            await comp.setFlag("dark-heresy", "fireAge", age + 1);
            continue;
        }
        const consumed = { "system.onFire": false, "flags.dark-heresy.fireAge": 0, "flags.dark-heresy.burnedOut": true };
        if (comp.system.status !== "destroyed") consumed["system.status"] = "damaged";
        await comp.update(consumed);

        const candidates = (ship.shipComponents ?? []).filter(c => c.id !== comp.id && !c.system.onFire
            && c.system.status !== "destroyed" && !c.getFlag("dark-heresy", "burnedOut"));
        if (!candidates.length) {
            // Выгорело всё — корабль превращён в обугленный остов.
            fireNotes.push(game.i18n.format("SHIP.FIRE.BURNED_OUT", { from: comp.name }));
            continue;
        }
        // Куда перекинется огонь, книга оставляет ведущему — «из разумных
        // вариантов». Система тянет жребий среди нетронутых отсеков и называет
        // выбор в карточке, чтобы ведущий мог переиграть его рукой.
        const next = candidates[Math.floor(Math.random() * candidates.length)];
        fireNotes.push(game.i18n.format("SHIP.FIRE.SPREAD", { from: comp.name, to: next.name }));
        await igniteShipComponent(ship, next);
    }

    const notes = [...fireNotes];
    if (finished.length) notes.push(game.i18n.format("SHIP.TURN.REPAIRED", { names: finished.join(", ") }));
    if (ship.system.halfTurns) notes.push(game.i18n.localize("SHIP.TURN.HALF_TURNS"));
    if (notes.length) await _postConditionCard(ship, combatant, "SHIP.TURN.START", { notes });
}

/**
 * Спросить, кто выполняет корабельное действие, и бросить.
 *
 * @param {Actor} ship
 * @param {string} key
 */
async function shipActionDialog(ship, key) {
    const def = Dh.shipActions[key];
    if (!ship || !def) return;
    const skills = def.skillChoice ?? [def.skill];

    const performers = game.actors
        .filter(a => ["acolyte", "heretic", "npc"].includes(a.type) && a.isOwner)
        .map(a => {
            const values = skills.map(sk => _shipPerformerSkill(a, sk));
            return { id: a.id, name: a.name, values: values.map(v => v ?? "—").join(" / "), any: values.some(v => v !== null) };
        })
        .filter(p => p.any)
        .sort((a, b) => a.name.localeCompare(b.name));

    const componentChoices = key === "emergencyRepairs"
        ? (ship.shipComponents ?? [])
            .filter(c => c.system.status !== "destroyed"
                && (["damaged", "unpowered"].includes(c.system.status) || c.system.depressurised))
            .map(c => ({ id: c.id, name: c.name }))
        : key === "fightFire"
            ? (ship.shipComponents ?? []).filter(c => c.system.onFire).map(c => ({ id: c.id, name: c.name }))
            : [];

    const preselected = [...(game.user.targets ?? [])]
        .map(t => t.actor).find(a => a?.type === "voidship")?.id ?? null;
    const targets = def.needsTarget
        ? game.actors.filter(a => a.type === "voidship" && a.id !== ship.id)
            .map(a => ({ id: a.id, name: a.name, selected: a.id === preselected }))
        : [];
    // Защищающуюся сторону ведёт кто угодно, не только свои: это чужой
    // командир или вожак мятежа, и бросает за него обычно ведущий.
    const defenders = def.defender
        ? game.actors.filter(a => ["acolyte", "heretic", "npc"].includes(a.type))
            .map(a => ({ id: a.id, name: a.name, value: _shipPerformerSkill(a, skills[0]) }))
            .filter(entry => entry.value !== null)
            .sort((a, b) => a.name.localeCompare(b.name))
        : [];

    const d = Number(def.difficulty) || 0;
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/dark-heresy/template/dialog/ship-action.hbs", {
            hint: def.hint,
            crewRating: Number(ship.system.crewRating) || 0,
            performers,
            skillLabel: Dh.shipSkillLabels[skills[0]],
            skillChoice: def.skillChoice ? def.skillChoice.map(sk => ({ key: sk, label: Dh.shipSkillLabels[sk] })) : null,
            statChoice: key === "aidMachineSpirit",
            hasComponentChoice: ["emergencyRepairs", "fightFire"].includes(key),
            componentChoices,
            componentEmpty: key === "fightFire" ? "SHIP.DIALOG.NO_BURNING" : "SHIP.DIALOG.NO_REPAIRABLE",
            needsTarget: !!def.needsTarget,
            targets,
            hasDefender: !!def.defender,
            defenderDefault: def.defender ?? null,
            defenders,
            stat: def.stat === "detection" ? "SHIP.DETECTION" : (def.stat === "manoeuvrability" ? "SHIP.MANOEUVRABILITY" : null),
            diffText: d > 0 ? `+${d}` : (d < 0 ? `−${Math.abs(d)}` : "+0")
        });

    dhDialog({
        title: `${ship.name} — ${game.i18n.localize(def.label)}`,
        content,
        buttons: {
            roll: {
                label: game.i18n.localize("SHIP.DIALOG.ROLL"),
                callback: async html => {
                    await rollShipAction(ship, key, {
                        performer: game.actors.get(html.find("#shipPerformer").val()) ?? null,
                        modifier: Number(html.find("#shipActionModifier").val()) || 0,
                        choice: {
                            skill: html.find("#shipActionSkill").val(),
                            stat: html.find("#shipActionStat").val(),
                            componentId: html.find("#shipActionComponent").val(),
                            targetId: html.find("#shipActionTarget").val(),
                            defenderId: html.find("#shipDefender").val()
                        }
                    });
                }
            },
            cancel: { label: game.i18n.localize("DIALOG.CANCEL") }
        },
        default: "roll"
    }).render(true);
}

/**
 * Бросить формулу и вернуть итог.
 * @param {string} formula
 * @returns {Promise<number>}
 */
async function _rollTotal(formula) {
    const roll = new Roll(formula);
    await roll.evaluate();
    return roll.total;
}

/**
 * Списать людей и Дух, не трогая корпус.
 *
 * Пожар, вентиляция отсека, абордажная резня и подавленный мятеж бьют по
 * команде напрямую. Потери записываются так же, как у урона корпуса, — их
 * потом ищут Триаж и «Стоять насмерть!».
 *
 * @param {Actor} ship
 * @param {number} crew
 * @param {number} morale
 * @returns {Promise<{crew: number, morale: number}>} сколько ушло на деле
 */
async function _loseCrewAndMorale(ship, crew, morale) {
    const num = v => Number(v) || 0;
    const was = { crew: num(ship._source.system.crew?.value), morale: num(ship._source.system.morale?.value) };
    const now = {
        crew: Math.max(0, was.crew - num(crew)),
        morale: Math.max(0, was.morale - num(morale))
    };
    const loss = foundry.utils.duplicate(ship.getFlag("dark-heresy", "shipLoss") ?? {});
    loss.sinceTurn = {
        crew: num(loss.sinceTurn?.crew) + (was.crew - now.crew),
        morale: num(loss.sinceTurn?.morale) + (was.morale - now.morale)
    };
    await ship.update({
        "system.crew.value": now.crew,
        "system.morale.value": now.morale,
        "flags.dark-heresy.shipLoss": loss
    });
    return { crew: was.crew - now.crew, morale: was.morale - now.morale };
}

/**
 * Поджечь компонент (стр. 223).
 *
 * Огонь сразу стоит 1d5 Команды и 1d10 Духа — «мало что пугает сильнее
 * пожара на борту». Возраст пожара обнуляется: у команды есть ход, чтобы его
 * потушить, прежде чем он сожрёт отсек.
 *
 * @param {Actor} ship
 * @param {Item} comp
 */
async function igniteShipComponent(ship, comp) {
    if (!ship || !comp || comp.system.onFire) return null;
    await comp.update({ "system.onFire": true, "flags.dark-heresy.fireAge": 0 });
    const lost = await _loseCrewAndMorale(ship, await _rollTotal("1d5"), await _rollTotal("1d10"));
    await _postConditionCard(ship, null, "SHIP.FIRE.IGNITED", {
        figures: [
            { n: lost.crew, cap: game.i18n.localize("SHIP.CREW") },
            { n: lost.morale, cap: game.i18n.localize("SHIP.MORALE"), lead: true }
        ],
        notes: [game.i18n.format("SHIP.FIRE.IGNITED_NOTE", { name: comp.name })]
    });
    return lost;
}

/**
 * Стравить горящий отсек в пустоту (стр. 223).
 *
 * Огонь гаснет сразу, но отсек разгерметизирован. Вместо обычного урона от
 * пожара — 1d5 Команды (люди уже бежали) и 2d10 Духа: смотреть, как своих
 * выбрасывает в пустоту, никому не нравится.
 *
 * @param {Actor} ship
 * @param {Item} comp
 */
async function ventShipComponent(ship, comp) {
    if (!ship || !comp || !comp.system.onFire) return null;
    await comp.update({ "system.onFire": false, "system.depressurised": true, "flags.dark-heresy.fireAge": 0 });
    const lost = await _loseCrewAndMorale(ship, await _rollTotal("1d5"), await _rollTotal("2d10"));
    await _postConditionCard(ship, null, "SHIP.FIRE.VENTED", {
        figures: [
            { n: lost.crew, cap: game.i18n.localize("SHIP.CREW") },
            { n: lost.morale, cap: game.i18n.localize("SHIP.MORALE"), lead: true }
        ],
        notes: [game.i18n.format("SHIP.FIRE.VENTED_NOTE", { name: comp.name })]
    });
    return lost;
}

/**
 * Разгерметизировать компонент (стр. 223): 1d10 Команды и 1d5 Духа.
 *
 * Компонент от этого не становится повреждённым и работает дальше — если
 * расчёт в пустотных скафандрах.
 *
 * @param {Actor} ship
 * @param {Item} comp
 */
async function depressuriseShipComponent(ship, comp) {
    if (!ship || !comp || comp.system.depressurised) return null;
    await comp.update({ "system.depressurised": true });
    const lost = await _loseCrewAndMorale(ship, await _rollTotal("1d10"), await _rollTotal("1d5"));
    await _postConditionCard(ship, null, "SHIP.FIRE.DEPRESSURISED", {
        figures: [
            { n: lost.crew, cap: game.i18n.localize("SHIP.CREW"), lead: true },
            { n: lost.morale, cap: game.i18n.localize("SHIP.MORALE") }
        ],
        notes: [game.i18n.format("SHIP.FIRE.DEPRESSURISED_NOTE", { name: comp.name })]
    });
    return lost;
}

/**
 * Бросок одной стороны противопоставленного теста.
 * @param {object} side
 * @returns {Promise<object>}
 */
async function _shipRollSide({ label, performerName = null, skillLabel, base, parts = [] }) {
    const clean = parts.filter(part => part.value);
    const totalMod = clean.reduce((sum, part) => sum + part.value, 0);
    const target = Math.max(0, base + totalMod);
    const result = await _rollTotal("1d100");
    const success = result <= target;
    return {
        label, performerName, skillLabel, base, parts: clean, totalMod, target, result, success,
        degrees: success ? _shipDegrees(target, result) : 0,
        failDegrees: success ? 0 : _shipDegrees(result, target),
        isWinner: false
    };
}

/**
 * Кто выиграл противопоставленный тест и на сколько ступеней.
 *
 * Выигрывает прошедший тест; из двух прошедших — у кого больше ступеней, и
 * разница их и есть перевес. Прошедший против проваленного выигрывает на свои
 * ступени, но не меньше чем на одну: успех над провалом не может ничего не
 * стоить. Два провала и равные ступени — ничья.
 *
 * @param {object} a
 * @param {object} b
 * @returns {{winner: "a"|"b"|null, margin: number}}
 */
function _shipOpposed(a, b) {
    if (!a.success && !b.success) return { winner: null, margin: 0 };
    if (a.success && !b.success) return { winner: "a", margin: Math.max(1, a.degrees) };
    if (!a.success && b.success) return { winner: "b", margin: Math.max(1, b.degrees) };
    if (a.degrees === b.degrees) return { winner: null, margin: 0 };
    return a.degrees > b.degrees
        ? { winner: "a", margin: a.degrees - b.degrees }
        : { winner: "b", margin: b.degrees - a.degrees };
}

async function _renderShipOpposed(view) {
    // Одинаковые строки подряд схлопываются в одну с «×N»: когда у проигравших
    // уже нечего отнимать, десяток одинаковых «−0» только растягивал карточку.
    const logGroups = [];
    for (const text of (view.log ?? [])) {
        const last = logGroups.at(-1);
        if (last && last.text === text) {
            last.count += 1;
            last.many = true;
        } else {
            logGroups.push({ text, count: 1, many: false });
        }
    }
    return foundry.applications.handlebars.renderTemplate(
        "systems/dark-heresy/template/chat/ship-opposed.hbs", { ...view, logGroups });
}

/**
 * Выложить карточку противопоставленного теста. Разбор кладётся во флаг
 * сообщения: карточка абордажа живая, по ней тратят ступени перевеса.
 */
async function _postShipOpposedCard(ship, view) {
    return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: ship }),
        content: await _renderShipOpposed(view),
        flags: { "dark-heresy": { shipOpposed: view } }
    });
}

async function _updateShipOpposedCard(message, view) {
    await message.update({ content: await _renderShipOpposed(view), "flags.dark-heresy.shipOpposed": view });
}

/** Сцепить два корабля абордажем. */
async function _setBoarding(ship, target) {
    await ship.setFlag("dark-heresy", "boarding", { with: target.id, boarder: true });
    try {
        await target.setFlag("dark-heresy", "boarding", { with: ship.id, boarder: false });
    } catch (err) {
        ui.notifications.warn(game.i18n.format("SHIP.BOARDING.NO_PERMISSION", { name: target.name }));
    }
}

/** Расцепить корабль и того, с кем он был сцеплен. */
async function _clearBoarding(ship) {
    const state = ship.getFlag("dark-heresy", "boarding");
    if (state) await ship.unsetFlag("dark-heresy", "boarding");
    const other = game.actors.get(state?.with);
    if (other?.getFlag("dark-heresy", "boarding")?.with === ship.id) {
        try { await other.unsetFlag("dark-heresy", "boarding"); } catch (err) { /* чужой корабль — снимет ведущий */ }
    }
}

/**
 * Таран (стр. 215).
 *
 * Бьёт бронёй носа плюс кубиком по классу корпуса. Щиты его не держат, а броня
 * цели держит как обычно: исключение книга делает только для щитов. Таранящий
 * получает в ответ броню цели плюс 1d5 — против собственной брони носа.
 *
 * @param {Actor} ship
 * @param {Actor} target
 */
async function _resolveRam(ship, target) {
    const num = v => Number(v) || 0;
    const hull = Dh.shipHullTypes[ship.system.hullType];
    const view = {
        shipId: ship.id, shipName: ship.name, targetId: target.id, targetName: target.name,
        notes: ["SHIP.RAM.IGNORES_SHIELDS"], noHull: !hull
    };
    if (!hull) {
        view.notes = ["SHIP.RAM.NO_HULL_TYPE"];
    } else {
        const die = await _rollTotal(hull.ram);
        const recoil = await _rollTotal("1d5");
        const ownArmour = num(ship.system.armour);
        const theirArmour = num(target.system.armour);
        const impact = die + ownArmour;
        const back = theirArmour + recoil;
        view.impact = { formula: hull.ram, die, armour: ownArmour, against: theirArmour, hull: Math.max(0, impact - theirArmour) };
        view.recoil = { die: recoil, armour: theirArmour, against: ownArmour, hull: Math.max(0, back - ownArmour) };
        // Обездвиженный корабль берёт крит с любого урона сверх брони.
        if (target.system.crippled && view.impact.hull > 0) {
            view.impact.critical = await _lookupShipCritical(view.impact.hull);
            await _enrichShipCritical(view.impact.critical);
        }
        if (ship.system.crippled && view.recoil.hull > 0) {
            view.recoil.critical = await _lookupShipCritical(view.recoil.hull);
            await _enrichShipCritical(view.recoil.critical);
        }
    }
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/dark-heresy/template/chat/ship-ram.hbs", view);
    await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor: ship }), content });
    return view;
}

/**
 * Ход абордажного боя: противопоставленное Командование (стр. 215).
 *
 * Большая команда даёт +10 за каждые полные 10 разницы, крепче корпус — так
 * же, турели — +10 за очко своей стороне. Защищающимся помогает «Готовься
 * отражать абордаж!», сорвавшим попытку вырваться мешают −20. Победитель
 * тратит ступени перевеса кнопками карточки, проигравший затем бросает Дух.
 *
 * @param {Actor} ship
 * @param {object} [options]
 */
async function rollBoardingAction(ship, { performer = null, defender = null, modifier = 0, post = true } = {}) {
    const num = v => Number(v) || 0;
    const state = ship.getFlag("dark-heresy", "boarding");
    const enemy = game.actors.get(state?.with);
    if (!state || !enemy) {
        ui.notifications.warn(game.i18n.localize("SHIP.BOARDING.NOT_BOARDED"));
        return null;
    }
    // Сцепленные корабли ходят одновременно, и тест Командования за раунд один
    // на двоих (стр. 215). Кнопка боя есть на мостике у обоих кораблей, и без
    // этой отметки абордаж шёл бы дважды за раунд — по разу с каждого борта.
    const roundKey = _shipCombatRound(ship);
    const enemyState = enemy.getFlag("dark-heresy", "boarding") ?? {};
    if (roundKey !== "none" && (state.foughtRound === roundKey || enemyState.foughtRound === roundKey)) {
        ui.notifications.warn(game.i18n.localize("SHIP.BOARDING.ALREADY_FOUGHT"));
        return null;
    }

    const sideParts = (me, other) => {
        const mine = me.getFlag("dark-heresy", "boarding") ?? {};
        const parts = [];
        const crewDiff = num(me.system.crew?.value) - num(other.system.crew?.value);
        if (crewDiff >= 10) parts.push({ label: "SHIP.BOARDING.CREW_ADVANTAGE", value: 10 * Math.floor(crewDiff / 10) });
        // В книге здесь опечатка: бонус «за Целостность корпуса» отмерен за
        // разницу в Команде. Считается по Целостности — иначе строка просто
        // повторяла бы предыдущую.
        const hullDiff = num(me.system.hullIntegrity?.value) - num(other.system.hullIntegrity?.value);
        if (hullDiff >= 10) parts.push({ label: "SHIP.BOARDING.HULL_ADVANTAGE", value: 10 * Math.floor(hullDiff / 10) });
        parts.push({ label: "SHIP.TURRET_RATING", value: 10 * num(me.system.turretRating) });
        parts.push({ label: "SHIP.MOD.COMMAND", value: num(me.system.mods?.command) });
        parts.push({ label: "SHIP.MOD.SHIPBOARD_ACTIONS", value: num(me.system.mods?.shipboardActions) });
        if (!mine.boarder) parts.push({ label: "SHIP.ACTION.PREPARE_TO_REPEL", value: num(me.getFlag("dark-heresy", "repelBonus")) });
        parts.push({ label: "SHIP.ACTION.BREAK_FREE", value: num(me.getFlag("dark-heresy", "breakFreePenalty")) });
        return parts;
    };

    const a = await _shipRollSide({
        label: ship.name, performerName: performer?.name ?? null, skillLabel: "SHIP.SKILL.COMMAND",
        base: _shipPerformerSkill(performer, "command") ?? num(ship.system.crewRating),
        parts: [...sideParts(ship, enemy), { label: "DIALOG.MODIFIER", value: num(modifier) }]
    });
    const b = await _shipRollSide({
        label: enemy.name, performerName: defender?.name ?? null, skillLabel: "SHIP.SKILL.COMMAND",
        base: _shipPerformerSkill(defender, "command") ?? num(enemy.system.crewRating),
        parts: sideParts(enemy, ship)
    });
    if (roundKey !== "none") {
        await ship.setFlag("dark-heresy", "boarding", { ...state, foughtRound: roundKey });
        try {
            await enemy.setFlag("dark-heresy", "boarding", { ...enemyState, foughtRound: roundKey });
        } catch (err) { /* чужой корабль — отметки хватит и на этом */ }
    }

    // Штраф за сорванную попытку вырваться действует на один тест.
    for (const side of [ship, enemy]) {
        if (!side.getFlag("dark-heresy", "breakFreePenalty")) continue;
        try { await side.unsetFlag("dark-heresy", "breakFreePenalty"); } catch (err) { /* чужой корабль */ }
    }

    const outcome = _shipOpposed(a, b);
    a.isWinner = outcome.winner === "a";
    b.isWinner = outcome.winner === "b";
    const winner = a.isWinner ? ship : (b.isWinner ? enemy : null);
    const loser = a.isWinner ? enemy : (b.isWinner ? ship : null);
    const view = {
        mode: "boarding", title: "SHIP.BOARDING.TITLE", shipId: ship.id, sides: [a, b],
        winnerId: winner?.id ?? null, loserId: loser?.id ?? null,
        outcomeText: winner
            ? game.i18n.format("SHIP.OPPOSED.WINNER", { name: winner.name, n: outcome.margin })
            : game.i18n.localize("SHIP.BOARDING.STALEMATE"),
        remaining: winner ? outcome.margin : 0,
        canSpend: !!winner, canMorale: false,
        log: [], notes: ["SHIP.BOARDING.SIMULTANEOUS"],
        verdictClass: winner ? "is-success" : "is-neutral"
    };
    if (post) await _postShipOpposedCard(ship, view);
    return view;
}

/**
 * Потратить ступень перевеса в абордаже или бросить Дух проигравшего.
 *
 * За каждую ступень победитель выбирает: резня (1d5 Команды и 1d5 Духа) или
 * подрыв (1 очко Целостности, а с ним, как всегда, и люди). Когда ступени
 * кончились, проигравший бросает d100 против Духа: выше — команда сдаётся.
 *
 * @param {ChatMessage} message
 * @param {"raid"|"sabotage"|"morale"} how
 */
async function _spendBoardingDegree(message, how) {
    const view = foundry.utils.duplicate(message.getFlag("dark-heresy", "shipOpposed") ?? {});
    const loser = game.actors.get(view.loserId);
    if (!loser) return ui.notifications.warn(game.i18n.localize("SHIP.CHAT.NO_TARGET"));
    view.log = view.log ?? [];

    if (how === "morale") {
        if (view.moraleRoll) return;
        const roll = await _rollTotal("1d100");
        const morale = Number(loser.system.morale?.value) || 0;
        view.moraleRoll = roll;
        view.surrendered = roll > morale;
        // Бросок Духа — итог всей абордажной схватки, а не ещё одна строка
        // журнала: карточка показывает его отдельной плашкой.
        view.moraleText = game.i18n.format(view.surrendered ? "SHIP.BOARDING.SURRENDERS" : "SHIP.BOARDING.HOLDS",
            { roll, morale, name: loser.name });
        if (view.surrendered) await _clearBoarding(loser);
    } else {
        if ((view.remaining ?? 0) <= 0) return;
        if (how === "raid") {
            const lost = await _loseCrewAndMorale(loser, await _rollTotal("1d5"), await _rollTotal("1d5"));
            view.log.push(game.i18n.format("SHIP.BOARDING.RAID_LOG", lost));
        } else {
            const lost = await applyShipDamage(loser, 1);
            view.log.push(game.i18n.format("SHIP.BOARDING.SABOTAGE_LOG", lost));
        }
        view.remaining -= 1;
    }
    view.canSpend = view.remaining > 0;
    view.canMorale = !view.canSpend && !view.moraleRoll;
    await _updateShipOpposedCard(message, view);
}

/**
 * Налёт: противопоставленное Обычное (+10) Командование с командиром солдат
 * на борту цели (стр. 218).
 *
 * Победа налётчиков — два броска 1d5 по таблице критов, ведущий выбирает один,
 * и корпус теряет очко за каждую ступень успеха. Ничья — налётчики уходят ни с
 * чем: книга требует от них победы.
 *
 * @param {Actor} ship
 * @param {Actor} target
 * @param {object} [options]
 */
async function _rollHitAndRunRaid(ship, target, { performer = null, defender = null } = {}) {
    const num = v => Number(v) || 0;
    const a = await _shipRollSide({
        label: ship.name, performerName: performer?.name ?? null, skillLabel: "SHIP.SKILL.COMMAND",
        base: _shipPerformerSkill(performer, "command") ?? num(ship.system.crewRating),
        parts: [
            { label: "SHIP.ACTION_PART.DIFFICULTY", value: 10 },
            { label: "SHIP.MOD.COMMAND", value: num(ship.system.mods?.command) }
        ]
    });
    const b = await _shipRollSide({
        label: target.name, performerName: defender?.name ?? null, skillLabel: "SHIP.SKILL.COMMAND",
        base: _shipPerformerSkill(defender, "command") ?? num(target.system.crewRating),
        parts: [
            { label: "SHIP.ACTION_PART.DIFFICULTY", value: 10 },
            { label: "SHIP.MOD.COMMAND", value: num(target.system.mods?.command) },
            // Отражение налёта — из тех тестов, по которым бьёт таблица Команды.
            { label: "SHIP.MOD.SHIPBOARD_ACTIONS", value: num(target.system.mods?.shipboardActions) },
            { label: "SHIP.ACTION.PREPARE_TO_REPEL", value: num(target.getFlag("dark-heresy", "repelBonus")) }
        ]
    });
    const outcome = _shipOpposed(a, b);
    a.isWinner = outcome.winner === "a";
    b.isWinner = outcome.winner === "b";

    const view = {
        mode: "hitAndRun", title: "SHIP.HIT_AND_RUN.TITLE", shipId: ship.id, targetId: target.id,
        sides: [a, b], notes: [], log: [], crits: [], hullDamage: 0
    };
    if (a.isWinner) {
        for (let i = 0; i < 2; i++) {
            const die = await _rollTotal("1d5");
            const row = await _lookupShipCritical(die);
            if (!row) continue;
            await _enrichShipCritical(row);
            view.crits.push({ ...row, roll: die });
        }
        if (!view.crits.length) view.notes.push("SHIP.NOTE.CRIT_NO_TABLE");
        view.hullDamage = a.degrees;
        view.outcomeText = game.i18n.format("SHIP.HIT_AND_RUN.WIN", { n: a.degrees });
        view.verdictClass = "is-success";
    } else {
        view.outcomeText = game.i18n.localize("SHIP.HIT_AND_RUN.LOSE");
        view.verdictClass = "is-failure";
    }
    view.canApply = view.hullDamage > 0;
    await _postShipOpposedCard(ship, view);
    return view;
}

/**
 * Подавить мятеж (стр. 225): противопоставленный тест с вожаком.
 *
 * Навык выбирают игроки, и от него зависит цена победы: Командование — 1d5
 * Команды и 1d5 Духа, Обаяние — 1d10 Духа, Устрашение — 1 Команды и 1d10
 * Духа. Мятежники, выигравшие на три ступени и больше, забирают корабль;
 * выигравшие меньше — борьба продолжается.
 *
 * @param {Actor} ship
 * @param {object} [options]
 */
async function _rollMutinySuppression(ship, { performer = null, defender = null, skill = "command", modifier = 0, post = true } = {}) {
    const num = v => Number(v) || 0;
    const sk = ["command", "charm", "intimidate"].includes(skill) ? skill : "command";
    const a = await _shipRollSide({
        label: ship.name, performerName: performer?.name ?? null, skillLabel: Dh.shipSkillLabels[sk],
        base: _shipPerformerSkill(performer, sk) ?? num(ship.system.crewRating),
        parts: [
            // Пример книги: капитан и в борьбе с мятежом несёт штраф Духа к Командованию.
            { label: "SHIP.MOD.COMMAND", value: sk === "command" ? num(ship.system.mods?.command) : 0 },
            { label: "DIALOG.MODIFIER", value: num(modifier) }
        ]
    });
    const b = await _shipRollSide({
        label: game.i18n.localize("SHIP.DIALOG.MUTINEERS"), performerName: defender?.name ?? null,
        skillLabel: Dh.shipSkillLabels[sk],
        base: _shipPerformerSkill(defender, sk) ?? num(ship.system.crewRating)
    });
    const outcome = _shipOpposed(a, b);
    a.isWinner = outcome.winner === "a";
    b.isWinner = outcome.winner === "b";

    const view = { mode: "mutiny", title: "SHIP.MUTINY.TITLE", shipId: ship.id, sides: [a, b], notes: [], log: [], buttons: [] };
    if (a.isWinner) {
        let crew = 0;
        let morale = 0;
        if (sk === "command") { crew = await _rollTotal("1d5"); morale = await _rollTotal("1d5"); }
        else if (sk === "charm") { morale = await _rollTotal("1d10"); }
        else { crew = 1; morale = await _rollTotal("1d10"); }
        await ship.unsetFlag("dark-heresy", "mutiny");
        const lost = await _loseCrewAndMorale(ship, crew, morale);
        view.outcomeText = game.i18n.format(`SHIP.MUTINY.ENDS_${sk.toUpperCase()}`, lost);
        view.verdictClass = "is-success";
    } else if (b.isWinner && outcome.margin >= 3) {
        await ship.setFlag("dark-heresy", "mutiny", "lost");
        view.outcomeText = game.i18n.localize("SHIP.MUTINY.LOST");
        view.verdictClass = "is-failure";
    } else {
        view.outcomeText = game.i18n.localize("SHIP.MUTINY.CONTINUES");
        view.verdictClass = "is-neutral";
        view.buttons.push({ cls: "ship-mutiny-suppress", label: "SHIP.MUTINY.SUPPRESS" });
    }
    if (post) await _postShipOpposedCard(ship, view);
    return view;
}

/**
 * Карточка угрозы мятежа с кнопкой проверки.
 * @param {Actor} ship
 * @param {number[]|null} crossed пройденные пороги; null — проверка после боя
 */
async function _postMutinyWarning(ship, crossed) {
    const note = crossed
        ? game.i18n.format("SHIP.MUTINY.CROSSED", { thresholds: crossed.join(", ") })
        : game.i18n.localize("SHIP.MUTINY.AFTER_COMBAT");
    await _postConditionCard(ship, null, "SHIP.MUTINY.WARNING", {
        notes: [note],
        extra: `<div class="dh-actions ship-btn-row"><button type="button" class="ship-btn ship-mutiny-test" data-ship-id="${ship.id}">${game.i18n.localize("SHIP.MUTINY.TEST")}</button></div>`
    });
}

/**
 * Спросить поправки и выстрелить.
 *
 * Цель подставляется из наведённой мишени, если она наведена: в пустотном бою
 * целятся токенами так же, как и в наземном, и заставлять выбирать её второй
 * раз в списке незачем.
 *
 * @param {Actor} ship
 * @param {Item} weapon
 */
async function shipAttackDialog(ship, weapon) {
    const targeted = [...(game.user.targets ?? [])]
        .map(t => t.actor).filter(a => a?.type === "voidship");
    const preselected = targeted[0]?.id ?? null;

    const targets = game.actors
        .filter(a => a.type === "voidship" && a.id !== ship.id)
        .map(a => ({ id: a.id, name: a.name, selected: a.id === preselected }));

    // В наводчики годится всякий, кем игрок может бросать: правила не требуют
    // от него ни должности, ни навыка, только Меткости.
    const gunners = game.actors
        .filter(a => ["acolyte", "heretic", "npc"].includes(a.type) && a.isOwner)
        .map(a => ({
            id: a.id, name: a.name,
            bs: a.characteristics?.ballisticSkill?.displayTotal
                ?? a.characteristics?.ballisticSkill?.total ?? 0
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/dark-heresy/template/dialog/ship-attack.hbs", {
            targets, gunners,
            crewRating: Number(ship.system.crewRating) || 0,
            strength: weapon.system.strengthEffective ?? weapon.system.strength,
            critRating: weapon.system.critRating,
            damage: weapon.system.damage
        });

    dhDialog({
        title: `${weapon.name} — ${game.i18n.localize("SHIP.DIALOG.FIRE")}`,
        content,
        buttons: {
            fire: {
                label: game.i18n.localize("SHIP.DIALOG.FIRE"),
                callback: async html => {
                    const num = sel => Number(html.find(sel).val()) || 0;
                    await rollShipAttack({
                        ship, weapon,
                        target: game.actors.get(html.find("#shipTarget").val()) ?? null,
                        gunner: game.actors.get(html.find("#shipGunner").val()) ?? null,
                        rangeBand: html.find("#shipRange").val() || "normal",
                        surprised: html.find("#shipSurprised").is(":checked"),
                        modifier: num("#shipModifier")
                    });
                }
            },
            cancel: { label: game.i18n.localize("DIALOG.CANCEL") }
        },
        default: "fire"
    }).render(true);
}

/**
 * Спросить, какие макробатареи свести в залп, и дать его.
 *
 * Тот же диалог, что у одиночного выстрела, плюс список стволов. Лэнсов в нём
 * нет: объединять книга разрешает только макробатареи.
 *
 * @param {Actor} ship
 */
async function shipSalvoDialog(ship) {
    const macros = (ship.shipWeapons ?? []).filter(w => w.system.weaponType !== "lance");
    if (macros.length < 2) {
        return ui.notifications.warn(game.i18n.localize("SHIP.DIALOG.SALVO_NEEDS_TWO"));
    }

    const preselected = [...(game.user.targets ?? [])]
        .map(t => t.actor).find(a => a?.type === "voidship")?.id ?? null;
    const targets = game.actors
        .filter(a => a.type === "voidship" && a.id !== ship.id)
        .map(a => ({ id: a.id, name: a.name, selected: a.id === preselected }));
    const gunners = game.actors
        .filter(a => ["acolyte", "heretic", "npc"].includes(a.type) && a.isOwner)
        .map(a => ({
            id: a.id, name: a.name,
            bs: a.characteristics?.ballisticSkill?.displayTotal
                ?? a.characteristics?.ballisticSkill?.total ?? 0
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/dark-heresy/template/dialog/ship-attack.hbs", {
            targets, gunners,
            crewRating: Number(ship.system.crewRating) || 0,
            salvoWeapons: macros.map(w => ({
                id: w.id, name: w.name, damage: w.system.damage,
                strength: w.system.strengthEffective ?? w.system.strength
            }))
        });

    dhDialog({
        title: `${ship.name} — ${game.i18n.localize("SHIP.DIALOG.SALVO")}`,
        content,
        buttons: {
            fire: {
                label: game.i18n.localize("SHIP.DIALOG.SALVO"),
                callback: async html => {
                    const num = sel => Number(html.find(sel).val()) || 0;
                    const weapons = html.find(".dh-salvo-weapon:checked").toArray()
                        .map(el => ship.items.get(el.dataset.weaponId)).filter(Boolean);
                    if (weapons.length < 2) {
                        return ui.notifications.warn(game.i18n.localize("SHIP.DIALOG.SALVO_NEEDS_TWO"));
                    }
                    await rollShipSalvo({
                        ship, weapons,
                        target: game.actors.get(html.find("#shipTarget").val()) ?? null,
                        gunner: game.actors.get(html.find("#shipGunner").val()) ?? null,
                        rangeBand: html.find("#shipRange").val() || "normal",
                        surprised: html.find("#shipSurprised").is(":checked"),
                        modifier: num("#shipModifier")
                    });
                }
            },
            cancel: { label: game.i18n.localize("DIALOG.CANCEL") }
        },
        default: "fire"
    }).render(true);
}

/**
 * Кнопка «применить» на карточке выстрела.
 *
 * Урон в пустотном бою не списывается сам: слишком многое здесь решается за
 * столом — и какой компонент выбрал атакующий, и стоит ли вообще засчитывать
 * попадание. Поэтому карточка считает всё до конца и ждёт нажатия.
 */
function _activateShipChatListeners(html, message = null) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    const loc = k => game.i18n.localize(k);
    const applied = new Set(message?.getFlag?.("dark-heresy", "appliedButtons") ?? []);

    for (const button of root.querySelectorAll(".ship-damage-apply")) {
        const card = button.closest(".ship-attack-card, .ship-salvo-card, .ship-ram-card, .ship-opposed-card");
        const applyKey = button.dataset.applyKey || "hull";
        // Отметка живёт на сообщении: после перерисовки чата кнопка иначе ожила
        // бы, и тот же залп списали бы второй раз.
        if (applied.has(applyKey)) button.disabled = true;
        button.addEventListener("click", async ev => {
            const btn = ev.currentTarget;
            const target = game.actors.get(btn.dataset.targetId || card?.dataset.targetId);
            const amount = Number(btn.dataset.hullDamage ?? card?.dataset.hullDamage) || 0;
            if (!target) return ui.notifications.warn(loc("SHIP.CHAT.NO_TARGET"));
            if (!target.isOwner) return ui.notifications.warn(loc("SHIP.CHAT.NOT_OWNER"));

            btn.disabled = true;
            const result = await applyShipDamage(target, amount);
            btn.textContent = game.i18n.format("SHIP.CHAT.APPLIED",
                { hull: result.hull, crew: result.crew, morale: result.morale });
            if (message && (game.user.isGM || message.isAuthor)) {
                await message.setFlag("dark-heresy", "appliedButtons", [...applied, applyKey]);
            }
        });
    }

    for (const button of root.querySelectorAll(".ship-board-raid, .ship-board-sabotage, .ship-board-morale")) {
        button.addEventListener("click", async ev => {
            ev.preventDefault();
            if (!message?.getFlag?.("dark-heresy", "shipOpposed")) return;
            if (!(game.user.isGM || message.isAuthor)) return ui.notifications.warn(loc("SHIP.CHAT.NOT_OWNER"));
            const cls = ev.currentTarget.classList;
            ev.currentTarget.disabled = true;
            await _spendBoardingDegree(message,
                cls.contains("ship-board-raid") ? "raid" : (cls.contains("ship-board-sabotage") ? "sabotage" : "morale"));
        });
    }

    for (const button of root.querySelectorAll(".ship-mutiny-test, .ship-mutiny-suppress")) {
        button.addEventListener("click", ev => {
            ev.preventDefault();
            const ship = game.actors.get(ev.currentTarget.dataset.shipId);
            if (!ship) return ui.notifications.warn(loc("SHIP.CHAT.NO_TARGET"));
            shipActionDialog(ship, ev.currentTarget.classList.contains("ship-mutiny-test") ? "mutinyTest" : "suppressMutiny");
        });
    }
}

class VoidshipSheet extends DarkHeresySheet {

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "actor", "voidship"],
            template: "systems/dark-heresy/template/sheet/actor/voidship.hbs",
            width: DarkHeresySheet.DESIGN_WIDTH + DarkHeresySheet.CONTENT_PADDING
                + DarkHeresySheet.SCROLLBAR_ALLOWANCE,
            height: 860,
            resizable: true,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "profile" }]
        });
    }

    async getData() {
        const data = await foundry.appv1.sheets.ActorSheet.prototype.getData.call(this);
        data.system = sheetSystem(this.document);
        data.source = this.actor._source.system;
        data.config = {
            locations: Dh.shipLocations,
            weaponTypes: Dh.shipWeaponTypes,
            hullTypes: Dh.shipHullTypes,
            crewRatings: Dh.shipCrewRatings,
            componentStatus: Dh.shipComponentStatus,
            componentCategories: Dh.shipComponentCategories
        };
        data.weapons = this.actor.shipWeapons ?? [];
        data.components = this.actor.shipComponents ?? [];
        data.canSalvo = data.weapons.filter(w => w.system.weaponType !== "lance").length >= 2;

        // Мостик: что уже сделано за ход и что сейчас висит на корабле.
        const loc = k => game.i18n.localize(k);
        const turnFlag = this.actor.getFlag("dark-heresy", "shipTurn") ?? {};
        const evasionFlag = this.actor.getFlag("dark-heresy", "evasion");
        const repel = Number(this.actor.getFlag("dark-heresy", "repelBonus")) || 0;
        const chips = [];
        if (evasionFlag?.value) chips.push({ kind: "good", text: `${loc("SHIP.ACTION.EVASIVE")} −${evasionFlag.value}` });
        if (turnFlag.bsPenalty) chips.push({ kind: "crippled", text: `${loc("SHIP.ACTION.COME_TO_NEW_HEADING")} ${turnFlag.bsPenalty}` });
        if (turnFlag.lockOn) chips.push({ kind: "good", text: `${loc("SHIP.ACTION.LOCK_ON_TARGET")} +${turnFlag.lockOn}` });
        if (turnFlag.aid?.value) chips.push({ kind: "good", text: `${loc("SHIP.ACTION.AID_MACHINE_SPIRIT")} +${turnFlag.aid.value} ${loc(turnFlag.aid.stat === "detection" ? "SHIP.DETECTION" : "SHIP.MANOEUVRABILITY")}` });
        if (turnFlag.backs) chips.push({ kind: "good", text: `${loc("SHIP.ACTION.PUT_BACKS_INTO_IT")} ×${turnFlag.backs}` });
        if (repel) chips.push({ kind: "good", text: `${loc("SHIP.ACTION.PREPARE_TO_REPEL")} +${repel}` });
        if (turnFlag.noFire) chips.push({ kind: "crippled", text: loc("SHIP.BRIDGE.NO_FIRE") });
        const boardingFlag = this.actor.getFlag("dark-heresy", "boarding");
        const mutinyFlag = this.actor.getFlag("dark-heresy", "mutiny");
        const visible = def => (!def.boardedOnly || !!boardingFlag)
            && (!def.unboardedOnly || !boardingFlag)
            && (!def.mutinyOnly || mutinyFlag === true);
        if (boardingFlag) {
            const other = game.actors.get(boardingFlag.with);
            chips.push({ kind: "warn", text: game.i18n.format("SHIP.BRIDGE.BOARDED", { name: other?.name ?? "?" }) });
        }
        if (mutinyFlag === true) chips.push({ kind: "crippled", text: loc("SHIP.BRIDGE.MUTINY") });
        if (mutinyFlag === "lost") chips.push({ kind: "crippled", text: loc("SHIP.BRIDGE.MUTINY_LOST") });
        if (this.actor.getFlag("dark-heresy", "mutinyPending")) chips.push({ kind: "warn", text: loc("SHIP.BRIDGE.MUTINY_PENDING") });
        const actionList = group => Object.entries(Dh.shipActions)
            .filter(([, def]) => def.group === group && visible(def))
            .map(([key, def]) => {
                const d = Number(def.difficulty) || 0;
                return {
                    key, label: def.label, hint: def.hint,
                    diffText: d > 0 ? `+${d}` : (d < 0 ? `−${Math.abs(d)}` : "+0"),
                    done: group === "manoeuvre" && turnFlag.manoeuvre === key
                };
            });
        data.bridge = {
            manoeuvre: turnFlag.manoeuvre ? Dh.shipActions[turnFlag.manoeuvre]?.label : null,
            shot: !!turnFlag.shot,
            chips,
            repel,
            silentRunning: !!this.actor.system.silentRunning,
            initiativeBonus: this.actor.system.detectionBonus ?? 0,
            manoeuvres: actionList("manoeuvre"),
            extended: actionList("extended"),
            assault: actionList("assault"),
            crew: actionList("crew")
        };
        const enrich = html => foundry.applications.ux.TextEditor.implementation
            .enrichHTML(html ?? "", { async: true, relativeTo: this.actor });
        data.enrichment = {
            notes: await enrich(this.actor.system.notes),
            essentialComponents: await enrich(this.actor.system.essentialComponents),
            supplementalComponents: await enrich(this.actor.system.supplementalComponents),
            complications: await enrich(this.actor.system.complications),
            gmNotes: await enrich(this.actor.system.gmNotes)
        };
        data.effects = this.organizeEffects(data);
        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);
        if (!this.isEditable) return;
        html.find(".ship-weapon-create").click(ev => this._onShipWeaponCreate(ev));
        html.find(".ship-component-create").click(ev => this._onShipComponentCreate(ev));
        html.find(".ship-weapon-fire").click(ev => this._onShipWeaponFire(ev));
        html.find(".ship-salvo-fire").click(ev => {
            ev.preventDefault();
            shipSalvoDialog(this.actor);
        });
        html.find(".ship-action").click(ev => {
            ev.preventDefault();
            shipActionDialog(this.actor, ev.currentTarget.dataset.action);
        });
        html.find(".ship-silent-running").click(async ev => {
            ev.preventDefault();
            const on = !!this.actor.getFlag("dark-heresy", "silentRunning");
            await this.actor.setFlag("dark-heresy", "silentRunning", !on);
        });
        // Вне боевого трекера ход никто не начнёт сам — для этого кнопка.
        html.find(".ship-turn-reset").click(ev => {
            ev.preventDefault();
            _onShipTurnStart(this.actor, null);
        });
        html.find(".ship-clear-repel").click(async ev => {
            ev.preventDefault();
            await this.actor.unsetFlag("dark-heresy", "repelBonus");
        });
        // Бедствия компонента — с последствиями для людей, а не просто флажок.
        html.find(".ship-comp-ignite").click(async ev => {
            ev.preventDefault();
            const comp = this._shipItemFromEvent(ev);
            if (comp) await igniteShipComponent(this.actor, comp);
        });
        html.find(".ship-comp-vent").click(async ev => {
            ev.preventDefault();
            const comp = this._shipItemFromEvent(ev);
            if (comp) await ventShipComponent(this.actor, comp);
        });
        html.find(".ship-comp-depressurise").click(async ev => {
            ev.preventDefault();
            const comp = this._shipItemFromEvent(ev);
            if (comp) await depressuriseShipComponent(this.actor, comp);
        });
        html.find(".item-edit").click(ev => this._onShipItemEdit(ev));
        html.find(".item-delete").click(ev => this._onShipItemDelete(ev));
    }

    async _onShipWeaponCreate(event) {
        event.preventDefault();
        const name = game.i18n.format("DOCUMENT.New",
            { type: game.i18n.localize("TYPES.Item.shipWeapon") });
        await this.actor.createEmbeddedDocuments("Item", [{ name, type: "shipWeapon" }]);
    }

    /**
     * Завести компонент в том списке, из которого нажали.
     *
     * Список сам говорит свою категорию, поэтому спрашивать её ещё раз в
     * диалоге незачем: нажали в «Существенных» — значит существенный.
     */
    async _onShipComponentCreate(event) {
        event.preventDefault();
        const category = event.currentTarget.dataset.category || "essential";
        const name = game.i18n.format("DOCUMENT.New",
            { type: game.i18n.localize("TYPES.Item.shipComponent") });
        await this.actor.createEmbeddedDocuments("Item",
            [{ name, type: "shipComponent", system: { category } }]);
    }

    /**
     * Выстрелить из орудия, на котором нажали.
     */
    async _onShipWeaponFire(event) {
        event.preventDefault();
        event.stopPropagation();
        const weapon = this._shipItemFromEvent(event);
        if (weapon) await shipAttackDialog(this.actor, weapon);
    }

    _shipItemFromEvent(event) {
        const row = event.currentTarget.closest("[data-item-id]");
        return row ? this.actor.items.get(row.dataset.itemId) : null;
    }

    _onShipItemEdit(event) {
        event.preventDefault();
        this._shipItemFromEvent(event)?.sheet.render(true);
    }

    async _onShipItemDelete(event) {
        event.preventDefault();
        await this._shipItemFromEvent(event)?.delete();
    }
}

/**
 * Каталог особых качеств оружия — ровно то, что понимает
 * extractWeaponTraits. Список нужен окну выбора у поля «Особые
 * качества»: раньше строку набирали руками, и опечатка тихо выключала
 * автоматику, не сказав об этом никому.
 *
 * name    — каноническая английская запись, которую разбирает система;
 * value   — качество с числом в скобках ("number") или со свободным
 *           значением ("text"), либо ничего, если скобок не бывает;
 * aliases — как качество могли записать раньше, включая русские книги:
 *           по ним окно узнаёт уже проставленные свойства.
 */
const DH_WEAPON_TRAITS = [
    { key: "accurate", name: "Accurate", aliases: ["accurate", "точное"] },
    { key: "balanced", name: "Balanced", aliases: ["balanced", "сбалансированное"] },
    { key: "blast", name: "Blast", value: "number", default: 3, aliases: ["blast", "взрыв", "взрывное"] },
    { key: "concussive", name: "Concussive", value: "number", default: 1, aliases: ["concussive", "оглушающее"] },
    { key: "crippling", name: "Crippling", value: "text", default: "1", aliases: ["crippling", "калечащее"] },
    { key: "defensive", name: "Defensive", aliases: ["defensive", "защитное"] },
    { key: "corrosive", name: "Corrosive", aliases: ["коррозийное", "corrosive", "едкое", "разъедающее"] },
    { key: "devastating", name: "Devastating", value: "number", default: 1, aliases: ["devastating", "опустошительное"] },
    { key: "felling", name: "Felling", value: "number", default: 1, aliases: ["felling", "валящее", "разящее"] },
    { key: "flame", name: "Flame", aliases: ["flame", "пламя", "огненное", "зажигательное"] },
    { key: "flexible", name: "Flexible", aliases: ["flexible", "гибкое"] },
    { key: "force", name: "Force", aliases: ["force", "психосиловое", "психосиловой"] },
    { key: "gyroStabilised", name: "Gyro-Stabilised", aliases: ["gyro-stabilised", "gyro-stabilized", "gyro stabilised", "гиростабилизированное"] },
    { key: "hallucinogenic", name: "Hallucinogenic", value: "number", default: 1, aliases: ["hallucinogenic", "галлюциногенное"] },
    { key: "haywire", name: "Haywire", value: "number", default: 1, aliases: ["электромагнитное", "haywire", "помехи", "эми"] },
    { key: "inaccurate", name: "Inaccurate", aliases: ["inaccurate", "неточное"] },
    { key: "lasSetting", name: "Las Weapon Setting", aliases: ["las weapon setting", "las setting", "смена режима лазерного оружия", "смена режима"] },
    { key: "maximal", name: "Maximal", aliases: ["maximal", "максимальный", "максимальное"] },
    { key: "melta", name: "Melta", aliases: ["melta", "мельта"] },
    { key: "overheats", name: "Overheats", aliases: ["overheats", "overheat", "overheating", "перегревающееся"] },
    { key: "powerField", name: "Power Field", aliases: ["power field", "силовое поле"] },
    { key: "primitive", name: "Primitive", value: "number", default: 7, aliases: ["primitive", "примитивное"] },
    { key: "proven", name: "Proven", value: "number", default: 3, aliases: ["proven", "проверенное"] },
    { key: "razorSharp", name: "Razor Sharp", aliases: ["razor sharp", "razor-sharp", "бритвенно-острое", "бритвенной остроты", "острое как бритва"] },
    { key: "recharge", name: "Recharge", aliases: ["накачка", "recharge", "подзарядка"] },
    { key: "reliable", name: "Reliable", aliases: ["reliable", "надёжное", "надежное"] },
    { key: "sanctified", name: "Sanctified", aliases: ["sanctified", "освящённое", "освященное"] },
    { key: "scatter", name: "Scatter", aliases: ["scatter", "разброс", "разлёт", "разлет"] },
    { key: "shock", name: "Shock", aliases: ["shock", "шоковое"] },
    { key: "smoke", name: "Smoke", value: "number", default: 5, aliases: ["smoke", "дым", "дымовое"] },
    { key: "snare", name: "Snare", value: "number", default: 1, aliases: ["snare", "опутывающее", "обездвиживающее"] },
    { key: "spray", name: "Spray", aliases: ["spray", "распыление", "распыляющее"] },
    { key: "storm", name: "Storm", aliases: ["шквальное", "storm", "шторм", "штормовое"] },
    { key: "tainted", name: "Tainted", aliases: ["tainted", "осквернённое", "оскверненное"] },
    { key: "tearing", name: "Tearing", aliases: ["tearing", "разрывающее", "разрывное"] },
    { key: "toxic", name: "Toxic", value: "number", default: 1, aliases: ["отравленное", "toxic", "токсичное"] },
    { key: "twinLinked", name: "Twin-Linked", aliases: ["спаренное", "twin-linked", "twin linked", "twinlinked", "спаренные", "сдвоенное"] },
    { key: "twinLinkedBonus", name: "Twin-Linked (+10)", aliases: ["спаренное (+10)", "twin-linked (+10)", "twin linked (+10)", "спаренные (+10)"] },
    { key: "unbalanced", name: "Unbalanced", aliases: ["unbalanced", "несбалансированное"] },
    { key: "unreliable", name: "Unreliable", aliases: ["unreliable", "ненадёжное", "ненадежное"] },
    { key: "unwieldy", name: "Unwieldy", aliases: ["unwieldy", "громоздкое"] },
    { key: "vengeful", name: "Vengeful", value: "number", default: 9, aliases: ["vengeful", "мстительное", "отмщающее"] },
    { key: "warpWeapon", name: "Warp Weapon", aliases: ["warp weapon", "оружие варпа", "варп-оружие"] },
];

/**
 * Разбить строку особых качеств на отдельные записи.
 *
 * Запятая внутри скобок не разделяет: «Blast (3), Toxic (1)» — это две записи,
 * а не четыре.
 *
 * @param {string} text содержимое поля «Особые качества»
 * @returns {string[]}
 */
function _splitSpecialEntries(text) {
    const entries = [];
    let depth = 0;
    let current = "";
    for (const ch of String(text ?? "")) {
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(depth - 1, 0);
        if (ch === "," && depth === 0) {
            entries.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    entries.push(current);
    return entries.map(entry => entry.trim()).filter(Boolean);
}

/**
 * Узнать качество в записи из поля.
 *
 * Сначала пробуем строку целиком — «Twin-Linked (+10)» это отдельная запись
 * каталога, а не «Twin-Linked» со значением, — и лишь потом имя без скобок.
 *
 * @param {string} entry одна запись
 * @returns {{trait: object|null, value: string|null, raw: string}}
 */
function _matchSpecialEntry(entry) {
    const raw = entry.trim();
    const value = /\(([^)]*)\)/.exec(raw)?.[1]?.trim() ?? null;
    const whole = raw.replace(/\s+/g, " ").toLowerCase();
    const base = raw.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const trait = DH_WEAPON_TRAITS.find(t => t.aliases.includes(whole))
        || DH_WEAPON_TRAITS.find(t => t.aliases.includes(base));
    return { trait: trait ?? null, value, raw };
}

/**
 * Данные для окна выбора качеств.
 * @param {string} special текущее содержимое поля
 * @returns {{traits: object[], unknown: string}}
 */
function _buildTraitPickerData(special) {
    const chosen = new Map();
    const unknown = [];
    for (const parsed of _splitSpecialEntries(special).map(_matchSpecialEntry)) {
        if (parsed.trait) chosen.set(parsed.trait.key, parsed.value);
        else unknown.push(parsed.raw);
    }

    const traits = DH_WEAPON_TRAITS.map(trait => ({
        key: trait.key,
        label: game.i18n.localize(`WEAPON.QUALITY.${trait.key}`),
        hint: game.i18n.localize(`WEAPON.QUALITY_HINT.${trait.key}`),
        hasValue: !!trait.value,
        checked: chosen.has(trait.key),
        value: chosen.get(trait.key) ?? (trait.default ?? "")
    }));

    return { traits, unknown: unknown.join(", ") };
}

/**
 * Собрать строку поля обратно из окна.
 *
 * Неизвестные записи дописываются в конец: система их не понимает, но это не
 * повод стереть чужой текст.
 *
 * @param {jQuery} html содержимое окна
 * @param {string} unknown записи, которые каталог не опознал
 * @returns {string}
 */
function _serialiseTraitPicker(html, unknown) {
    const parts = [];
    for (const row of html.find(".dh-trait-row")) {
        const box = row.querySelector("input[type='checkbox']");
        if (!box?.checked) continue;
        const trait = DH_WEAPON_TRAITS.find(t => t.key === box.dataset.key);
        if (!trait) continue;
        const value = row.querySelector(".dh-trait-value")?.value?.trim() ?? "";
        parts.push(trait.value && value ? `${trait.name} (${value})` : trait.name);
    }
    if (unknown) parts.push(unknown);
    return parts.join(", ");
}

/**
 * Открыть окно выбора особых качеств для предмета.
 *
 * Поле «Особые качества» — это то, из чего система вычитает всю автоматику
 * оружия, но заполнялось оно свободным текстом: опечатка молча выключала
 * свойство, и заметить это можно было только по неправильному броску.
 *
 * @param {Item} item оружие или машинное орудие
 */
async function openWeaponTraitPicker(item) {
    if (!item) return;
    const data = _buildTraitPickerData(item.system?.special);
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/dark-heresy/template/dialog/weapon-traits.hbs", data);

    const dialog = dhDialog({
        title: game.i18n.localize("WEAPON.QUALITY_PICKER"),
        content,
        buttons: {
            apply: {
                icon: '<i class="fas fa-check"></i>',
                label: game.i18n.localize("BUTTON.APPLY"),
                callback: async html => {
                    await item.update({ "system.special": _serialiseTraitPicker(html, data.unknown) });
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: game.i18n.localize("BUTTON.CANCEL")
            }
        },
        default: "apply",
        render: html => {
            // Поле значения живёт вместе со своей галочкой: снятая галочка не
            // должна оставлять на экране активное поле, которое никуда не идёт.
            html.find(".dh-trait-row input[type='checkbox']").on("change", event => {
                const row = event.currentTarget.closest(".dh-trait-row");
                const field = row?.querySelector(".dh-trait-value");
                if (field) field.disabled = !event.currentTarget.checked;
            });

            // Качеств больше сорока, поэтому строка отбора: она прячет ряды, но
            // не трогает галочки — уже выбранное не теряется при фильтрации.
            html.find(".dh-trait-filter").on("input", event => {
                const needle = event.currentTarget.value.trim().toLowerCase();
                for (const row of html.find(".dh-trait-row")) {
                    const name = row.querySelector(".dh-trait-name span")?.textContent?.toLowerCase() ?? "";
                    row.style.display = !needle || name.includes(needle) ? "" : "none";
                }
            });
        }
    }, { width: 560 });
    dialog.render(true);
}

async function openStructuredTraitEditor(item) {
    if (!item?.isOwner || !["weapon", "vehicleWeapon", "psychicPower"].includes(item.type)) return;
    const source = item._source.system;
    const before = structuredClone(source.traitOverrides ?? {});
    const special = item.type === "psychicPower" ? source.damage?.special : source.special;
    const inherited = DarkHeresyUtil.extractWeaponTraits(special);
    const localize = key => game.i18n.localize(key);
    const aliases = {rfFace:"vengeful", skipAttackRoll:"spray", overheating:"overheats"};
    const rows = Object.entries(WEAPON_TRAIT_TYPES).map(([key,type]) => {
        const labelKey = aliases[key] ?? key;
        const catalog = DH_WEAPON_TRAITS.find(trait => trait.key === labelKey);
        const mode = !Object.hasOwn(before,key) ? "inherit" : before[key] === false ? "off" : "value";
        const base = inherited[key];
        return {key, label:localize(`WEAPON.QUALITY.${labelKey}`), hint:localize(`WEAPON.QUALITY_HINT.${labelKey}`),
            mode, hasValue:type !== "boolean", numeric:type === "number", editable:mode === "value",
            value:mode === "value" ? before[key] : base !== false && base !== undefined ? base : catalog?.default ?? "",
            inherited:base === true ? localize("WEAPON.TRAIT_ON") : base === false || base === undefined ? localize("WEAPON.TRAIT_OFF") : base};
    });
    const content = await foundry.applications.handlebars.renderTemplate(
        "systems/dark-heresy/template/dialog/trait-overrides.hbs", {rows, special,
            modes:{inherit:"WEAPON.TRAIT_INHERIT",off:"WEAPON.TRAIT_OFF",value:"WEAPON.TRAIT_EXPLICIT"}});
    const dialog = new foundry.applications.api.DialogV2({
        window:{title:`${item.name} — ${localize("WEAPON.TRAIT_EDITOR")}`, resizable:true},
        classes:["dark-heresy-dialog"], position:{width:640}, content,
        form:{closeOnSubmit:false},
        buttons:[{action:"save", label:localize("BUTTON.APPLY"), icon:"fas fa-check", default:true,
            callback:async (_event, button, instance) => {
                try {
                    if (!item.isOwner) throw new Error(localize("WEAPON.TRAIT_NO_PERMISSION"));
                    const after = traitOverridesFromRows(Array.from(button.form.querySelectorAll(".dh-override-row"),row => ({
                        key:row.dataset.key, mode:row.querySelector("select").value, value:row.querySelector("input")?.value
                    })));
                    const patch = traitOverridePatch(before, after, item._source.system.traitOverrides ?? {});
                    if (Object.keys(patch).length) await item.update(patch);
                    await instance.close();
                } catch (error) { ui.notifications.error(error.message); }
            }},
            {action:"cancel",label:localize("BUTTON.CANCEL"),callback:(_event,_button,instance)=>instance.close()}]
    });
    dialog.addEventListener("render", () => {
        const root = dialog.element;
        root.querySelector(".dh-override-filter").addEventListener("input", event => {
            const query = event.target.value.trim().toLocaleLowerCase();
            for (const row of root.querySelectorAll(".dh-override-row")) row.hidden = !row.textContent.toLocaleLowerCase().includes(query);
        });
        for (const row of root.querySelectorAll(".dh-override-row")) {
            row.querySelector("select").addEventListener("change", event => {
                const input = row.querySelector("input");
                if (input) { input.disabled = event.target.value !== "value"; input.required = !input.disabled; }
            });
        }
    }, {once:true});
    await dialog.render(true);
    return dialog;
}

class DarkHeresyItemSheet extends foundry.appv1.sheets.ItemSheet {
    // Every subclass sets its own `classes` array, and mergeObject replaces arrays
    // rather than concatenating them, so there was no single hook to style all 19
    // item sheets through. This marker gives the stylesheet one.
    constructor(...args) {
        super(...args);
        if (!this.options.classes.includes("dh-item-sheet")) {
            this.options.classes.push("dh-item-sheet");
        }
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find("input").focusin(ev => this._onFocusIn(ev));

        // Выбор особых качеств списком вместо ручного набора строки.
        html.find(".trait-picker").click(() => openWeaponTraitPicker(this.item));
        
        // Effects listeners
        html.find(".list-create[data-type='effect']").click(ev => this._onEffectCreate(ev));
        html.find(".list-toggle").click(ev => this._onListToggle(ev));
        html.find(".list-restart").click(ev => { ev.preventDefault(); return restartEffect(this._getDocument(ev)); });
        html.find(".list-delete").click(ev => this._onListDelete(ev));
        html.find(".list-edit").click(ev => this._onListEdit(ev));
        
        // Sync cost changes to actor sheet (for talents and psychic powers)
        if (this.item.type === "talent" || this.item.type === "psychicPower") {
            html.find("input[name='system.cost']").on("change", async (ev) => {
                // Update the item
                await this.item.update({"system.cost": ev.target.value});
                // Refresh actor sheet if it's open
                if (this.item.actor?.sheet?.rendered) {
                    this.item.actor.sheet.render(false);
                }
            });
        }
    }

    async getData() {
        const data = await super.getData();
        data.enrichment = await this._handleEnrichment();
        data.system = sheetSystem(this.document);
        
        // Prepare effects list for template
        // In Foundry VTT, item.effects is a Collection (read-only), convert it to array for template
        // We create a new property instead of overwriting the read-only one
        if (this.item && this.item.effects) {
            data.item.effectsList = Array.from(this.item.effects.values(), effectView);
        } else {
            data.item.effectsList = [];
        }
        // Лист предмета предлагал одну группу, «пассивную», и временный эффект с
        // него было не создать ни при каком выборе. Обработчик читает категорию
        // с кнопки и всегда читал её верно — выбора просто не предлагали.
        data.item.effectsPassive = data.item.effectsList.filter(view => !view.temporary);
        data.item.effectsTemporary = data.item.effectsList.filter(view => view.temporary);
        
        return data;
    }

    async _handleEnrichment() {
        let enrichment ={};
        enrichment["system.description"] = await foundry.applications.ux.TextEditor.implementation.enrichHTML(this.item.system.description);
        enrichment["system.effect"] = await foundry.applications.ux.TextEditor.implementation.enrichHTML(this.item.system.effect);
        return foundry.utils.expandObject(enrichment);
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        if (this.item.isOwner && ["weapon", "vehicleWeapon", "psychicPower"].includes(this.item.type)) {
            buttons.unshift({label:game.i18n.localize("WEAPON.TRAIT_EDITOR"), class:"trait-overrides",
                icon:"fas fa-sliders", onclick:() => openStructuredTraitEditor(this.item)});
        }
        buttons = [
            {
                label: game.i18n.localize("BUTTON.POST_ITEM"),
                class: "item-post",
                icon: "fas fa-comment",
                onclick: ev => this.item.sendToChat()
            }
        ].concat(buttons);
        return buttons;
    }

    _onFocusIn(event) {
        $(event.currentTarget).select();
    }

    // ============================================
    // Effects Handlers
    // ============================================

    _getDocument(event) {
        // Try both .list-item and .effect.item selectors
        const li = $(event.currentTarget).closest(".list-item, .effect.item");
        const collection = this._getCollection(event);
        const id = li.data("id");
        
        if (!id) return null;

        if (collection === "effects") {
            return this.item.effects.get(id);
        }
        
        return null;
    }

    _getCollection(event) {
        // Try both .list-item and .effect.item selectors
        const li = $(event.currentTarget).closest(".list-item, .effect.item");
        return li.data("collection") || "effects";
    }

    _getId(event) {
        // Try both .list-item and .effect.item selectors
        const li = $(event.currentTarget).closest(".list-item, .effect.item");
        return li.data("id");
    }

    async _onEffectCreate(ev) {
        ev.preventDefault();
        
        let effectData = {
            name: this.item.name || game.i18n.localize("EFFECTS.TITLE"),
            img: "icons/svg/aura.svg"
        };

        const effects = await this.item.createEmbeddedDocuments("ActiveEffect", [effectData]);
        if (effects.length > 0) {
            effects[0].sheet.render(true);
        }
    }

    async _onListToggle(event) {
        event.preventDefault();
        const document = this._getDocument(event);
        
        if (!document) return;

        await document.update({ disabled: !document.disabled });
    }

    async _onListDelete(event) {
        event.preventDefault();
        const document = this._getDocument(event);
        
        if (!document) return;

        await foundry.applications.api.DialogV2.confirm({
            window: {title: game.i18n.localize("DeleteActiveEffect")},
            // Confirmations went straight to DialogV2 without the system class, so
            // they were the one kind of dialog still wearing core's chrome.
            classes: ["dark-heresy-dialog"],
            content: `<div class="dh-dialog"><p class="dh-dialog-prose">${game.i18n.localize("DeleteActiveEffectConfirmation")}</p></div>`,
            yes: {
                default: true,
                callback: () => document.delete()
            }
        });
    }

    async _onListEdit(event) {
        event.preventDefault();
        event.stopPropagation();
        
        const document = this._getDocument(event);
        
        if (document) {
            document.sheet.render(true);
        }
    }
}

class VehicleWeaponSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "vehicle-weapon"],
            template: "systems/dark-heresy/template/sheet/vehicle-weapon.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
        });
    }

    async getData() {
        const data = await super.getData();
        data.mounts = Object.fromEntries(Object.entries(Dh.vehicleMounts).map(([k, v]) => [k, v.label]));
        data.facings = Dh.vehicleFacings;
        data.damageTypes = Dh.damageTypes;
        data.weaponClass = Dh.weaponClass;
        data.weaponType = Dh.weaponType;
        return data;
    }
}

class VehicleTraitSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "vehicle-trait"],
            template: "systems/dark-heresy/template/sheet/vehicle-trait.hbs",
            width: 560,
            height: 480,
            resizable: true,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
        });
    }
}

class ShipWeaponSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "ship-weapon"],
            template: "systems/dark-heresy/template/sheet/ship-weapon.hbs",
            width: 560,
            height: 520,
            resizable: true,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
        });
    }

    async getData() {
        const data = await super.getData();
        data.locations = Dh.shipLocations;
        data.weaponTypes = Dh.shipWeaponTypes;
        return data;
    }
}

class ShipComponentSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "ship-component"],
            template: "systems/dark-heresy/template/sheet/ship-component.hbs",
            width: 560,
            height: 540,
            resizable: true,
            tabs: [{ navSelector: ".sheet-tabs", contentSelector: ".sheet-body", initial: "stats" }]
        });
    }

    async getData() {
        const data = await super.getData();
        data.categories = Dh.shipComponentCategories;
        data.statuses = Dh.shipComponentStatus;
        data.qualities = Dh.shipQualities;
        return data;
    }
}

class WeaponSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "weapon"],
            template: "systems/dark-heresy/template/sheet/weapon.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    async getData() {
        const data = await super.getData();

        // Поля листа привязаны к system.* по имени, а _applyWeaponModifications
        // меняет system прямо на подготовленных данных. При закрытии Foundry
        // отправляет форму — и в источник ложились уже изменённые значения.
        // Следующий пересчёт прибавлял бонус поверх прибавленного: каждое
        // открытие листа необратимо раздувало профиль ствола (1d10 → 1d10+2 →
        // 1d10+2+2). Поэтому в форму отдаём исходный профиль, а посчитанный
        // с модами показываем отдельно.
        const source = this.item._source?.system;
        const owner = this.item.actor;
        const hasMods = !!owner && owner.items.some(i =>
            i.type === "weaponModification" && i.system?.installed && i.system?.weaponId === this.item.id);
        if (source && hasMods) {
            data.modified = {
                damage: data.system.damage,
                penetration: data.system.penetration,
                attack: data.system.attack,
                range: data.system.range,
                clipMax: data.system.clip?.max,
                special: data.system.special
            };
            data.system = foundry.utils.deepClone(data.system);
            for (const key of ["damage", "penetration", "attack", "range", "special", "availability"]) {
                if (source[key] !== undefined) data.system[key] = source[key];
            }
            if (data.system.clip && source.clip?.max !== undefined) data.system.clip.max = source.clip.max;
        }

        // Get ammunition items from actor's inventory for the select dropdown
        data.ammunitionOptions = [];
        const actor = this.item.actor || this.actor;
        const currentAmmunitionId = this.item.system.ammo || "";
        
        if (actor && actor.items) {
            const ammunitionItems = actor.items.filter(item => item.isAmmunition);
            data.ammunitionOptions = ammunitionItems.map(item => {
                const quantity = Number(item.system.quantity) || 0;
                const displayName = quantity > 0 
                    ? `${item.name} (${quantity})` 
                    : item.name;
                return {
                    id: item.id,
                    name: displayName,
                    selected: item.id === currentAmmunitionId
                };
            });
        }
        
        // Add empty option at the beginning
        data.ammunitionOptions.unshift({
            id: "",
            name: game.i18n.localize("WEAPON.AMMUNITION_NONE") || "None",
            selected: !currentAmmunitionId || currentAmmunitionId === ""
        });
        
        return data;
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class AmmunitionSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "ammunition"],
            template: "systems/dark-heresy/template/sheet/ammunition.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    /**
     * Совместимость патрона задаётся галками, а не multiple-select.
     *
     * Форма отдаёт набор одноимённых чекбоксов как одно значение (строку, если
     * отмечен один, и ничего, если не отмечен ни один), поэтому массивы
     * собираются здесь вручную — иначе список из одного типа превращался бы
     * в строку и проверка совместимости ломалась.
     */
    async _updateObject(event, formData) {
        const form = this.form;
        for (const field of ["system.weaponTypes", "system.weaponClasses"]) {
            const boxes = form?.querySelectorAll(`input[name="${field}"]`);
            if (!boxes?.length) continue;
            formData[field] = Array.from(boxes)
                .filter(box => box.checked)
                .map(box => box.value);
        }
        return super._updateObject(event, formData);
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class WeaponModificationSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "weapon-modification"],
            template: "systems/dark-heresy/template/sheet/weapon-modification.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    /**
     * Список стволов, на которые этот мод можно навесить.
     *
     * Только оружие того же владельца и только подходящее по типу и классу,
     * если мод их перечисляет: пистолетную рукоять некуда ставить на меч.
     * У мода в компендиуме владельца нет — тогда списка нет вовсе, и поле
     * не показывается.
     * @returns {Promise<object>}
     */
    async getData() {
        const data = await super.getData();
        const owner = this.item.actor;
        if (!owner) return data;

        const types = this.item.system?.weaponTypes || [];
        const classes = this.item.system?.weaponClasses || [];
        data.hostWeapons = owner.items
            .filter(item => item.type === "weapon")
            .filter(weapon => !types.length || types.includes(weapon.system?.type))
            .filter(weapon => !classes.length || classes.includes(weapon.system?.class))
            .map(weapon => ({
                id: weapon.id,
                name: weapon.name,
                selected: weapon.id === this.item.system?.weaponId
            }));
        return data;
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class ArmourSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "armour"],
            template: "systems/dark-heresy/template/sheet/armour.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class ForceFieldSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "force-field"],
            template: "systems/dark-heresy/template/sheet/force-field.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class CyberneticSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "cybernetic"],
            template: "systems/dark-heresy/template/sheet/cybernetic.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class DrugSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "drug"],
            template: "systems/dark-heresy/template/sheet/drug.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class GearSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "gear"],
            template: "systems/dark-heresy/template/sheet/gear.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class ToolSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "tool"],
            template: "systems/dark-heresy/template/sheet/tool.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class CriticalInjurySheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "critical-injury"],
            template: "systems/dark-heresy/template/sheet/critical-injury.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class MalignancySheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "malignancy"],
            template: "systems/dark-heresy/template/sheet/malignancy.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class MentalDisorderSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "mental-disorder"],
            template: "systems/dark-heresy/template/sheet/mental-disorder.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class MutationSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "mutation"],
            template: "systems/dark-heresy/template/sheet/mutation.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class PsychicPowerSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "psychic-power"],
            template: "systems/dark-heresy/template/sheet/psychic-power.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class TalentSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "talent"],
            template: "systems/dark-heresy/template/sheet/talent.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class SpecialAbilitySheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "special-ability"],
            template: "systems/dark-heresy/template/sheet/special-ability.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class TraitSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "trait"],
            template: "systems/dark-heresy/template/sheet/trait.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }

    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons = [].concat(buttons);
        return buttons;
    }

    activateListeners(html) {
        super.activateListeners(html);
    }
}

class AptitudeSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "aptitude"],
            template: "systems/dark-heresy/template/sheet/aptitude.hbs",
            width: 620,
            height: 560,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "stats"
                }
            ]
        });
    }
}

class OriginSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "origin"],
            template: "systems/dark-heresy/template/sheet/origin.hbs",
            width: 620,
            height: 720,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "data"
                }
            ]
        });
    }

    /**
     * Выдачи и найденные в них ошибки — только для чтения. Правят их в исходниках
     * книги (packs-src/origins): руками здесь легко разойтись с текстом книги, а
     * сверить потом нечем.
     */
    async getData() {
        const data = await super.getData();
        data.grantSummary = grantSummaryLines(this.item.system);
        data.problems = validateOrigin(this.item.system);
        return data;
    }
}

class RaceSheet extends DarkHeresyItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["dark-heresy", "sheet", "race"],
            template: "systems/dark-heresy/template/sheet/race.hbs",
            width: 700,
            height: 800,
            resizable: true,
            tabs: [
                {
                    navSelector: ".sheet-tabs",
                    contentSelector: ".sheet-body",
                    initial: "data"
                }
            ]
        });
    }
    
    _canDragDrop(selector) {
        // Allow drag and drop on our custom drop zones
        return true;
    }

    activateListeners(html) {
        super.activateListeners(html);
        
        // Delete buttons
        html.find(".skill-delete").click(ev => this._onSkillDelete(ev));
        html.find(".item-delete").click(ev => this._onItemDelete(ev));
        
        // Drag and drop handlers - attach to all list containers and sections
        // Smart routing: items will be automatically sorted by type
        const dropTargets = html.find(".items-list, .skills-list, .race-section");
        
        // Prevent default drag behavior on the form
        html.find("form").on("dragover", ev => {
            // Only prevent if we're over our drop zones
            const target = $(ev.target);
            if (target.closest(".items-list, .skills-list, .race-section").length > 0) {
                ev.preventDefault();
                ev.stopPropagation();
            }
        });
        
        dropTargets.on("dragover", ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const originalEvent = ev.originalEvent || ev;
            if (originalEvent.dataTransfer) {
                originalEvent.dataTransfer.dropEffect = "move";
            }
        });
        
        dropTargets.on("drop", ev => {
            ev.preventDefault();
            ev.stopPropagation();
            this._onDrop(ev);
            return false;
        });
        
        // Visual feedback - highlight the entire section when dragging over
        dropTargets.on("dragenter", ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const target = $(ev.currentTarget);
            const section = target.closest(".race-section");
            if (section.length) {
                section.addClass("drag-over");
                section.css("border-color", "#4a9eff");
                section.css("background-color", "rgba(74, 158, 255, 0.1)");
            }
        });
        
        dropTargets.on("dragleave", ev => {
            ev.stopPropagation();
            const target = $(ev.currentTarget);
            const section = target.closest(".race-section");
            if (section.length) {
                section.removeClass("drag-over");
                section.css("border-color", "");
                section.css("background-color", "");
            }
        });
        
    }

    async _onSkillDelete(event) {
        event.preventDefault();
        const skillKey = $(event.currentTarget).closest(".skill-item").data("skill-key");
        const updateData = {};
        updateData[`system.startingSkills.-=${skillKey}`] = null;
        await this.item.update(updateData);
    }

    async _onItemDelete(event) {
        event.preventDefault();
        const itemId = $(event.currentTarget).closest(".item-entry").data("item-id");
        const dropZone = $(event.currentTarget).closest(".items-list");
        const dropType = dropZone.data("drop-type");
        
        let updatePath = "";
        if (dropType === "talent") {
            updatePath = "system.startingTalents";
        } else if (dropType === "trait") {
            updatePath = "system.startingTraits";
        } else if (dropType === "equipment") {
            updatePath = "system.startingEquipment";
        }
        
        if (updatePath) {
            const currentList = foundry.utils.getProperty(this.item.system, updatePath) || [];
            const newList = currentList.filter(entry => {
                if (typeof entry === "string") return entry !== itemId;
                return entry.id !== itemId;
            });
            const updateData = {};
            updateData[updatePath] = newList;
            await this.item.update(updateData);
        }
    }

    _onDragOver(event) {
        event.preventDefault();
        const originalEvent = event.originalEvent || event;
        if (originalEvent.dataTransfer) {
            originalEvent.dataTransfer.dropEffect = "move";
        }
    }

    async _onDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        
        // In jQuery events, dataTransfer is in originalEvent
        const originalEvent = event.originalEvent || event;
        const dataTransfer = originalEvent.dataTransfer;
        
        if (!dataTransfer) {
            console.warn("RaceSheet: No dataTransfer in event", event);
            return;
        }
        
        const target = $(event.currentTarget);
        target.removeClass("drag-over");
        target.css("background-color", "");
        
        try {
            // Get drop data - Foundry VTT stores it in dataTransfer
            let data;
            try {
                const dragData = dataTransfer.getData("text/plain");
                if (!dragData) {
                    console.warn("RaceSheet: No drop data in dataTransfer");
                    return;
                }
                data = JSON.parse(dragData);
            } catch (e) {
                console.error("RaceSheet: Error parsing drop data", e);
                return;
            }
            
            // Handle Item drops - automatically determine where to add based on item type
            if (data.type === "Item") {
                let item = null;
                
                // Get item from drop data using Foundry's standard method
                if (data.uuid) {
                    try {
                        item = await fromUuid(data.uuid);
                    } catch (e) {
                        console.error("RaceSheet: Error resolving UUID", e);
                    }
                }
                
                if (!item && data.id) {
                    // Try to find item in world
                    item = game.items.get(data.id);
                }
                
                if (!item) {
                    console.warn("RaceSheet: Could not resolve item from drop data", data);
                    ui.notifications.warn(game.i18n.localize("UI.COULD_NOT_FIND_THE_ITEM_TO_ADD"));
                    return;
                }
                
                // Smart routing: automatically determine target based on item type
                if (item.type === "talent") {
                    await this._handleItemDrop(item, "startingTalents");
                    ui.notifications.info(game.i18n.format("NOTIFICATION.STARTING_TALENT_ADDED", {name:item.name}));
                } else if (item.type === "trait") {
                    await this._handleItemDrop(item, "startingTraits");
                    ui.notifications.info(game.i18n.format("NOTIFICATION.STARTING_TRAIT_ADDED", {name:item.name}));
                } else if (["weapon", "gear", "tool", "ammunition", "armour", "forceField", "cybernetic", "drug", "weaponModification"].includes(item.type)) {
                    await this._handleItemDrop(item, "startingEquipment");
                    ui.notifications.info(game.i18n.format("NOTIFICATION.STARTING_EQUIPMENT_ADDED", {name:item.name}));
                } else {
                    ui.notifications.warn(game.i18n.format("NOTIFICATION.RACE_ITEM_REJECTED", {name:item.name,type:game.i18n.localize(`TYPES.Item.${item.type}`)}));
                }
            } else if (data.type === "Skill" || data.type === "skill") {
                // Handle skill drops (from actor sheet)
                await this._handleSkillDrop(data);
                ui.notifications.info(game.i18n.localize("UI.ADDED_SKILL_TO_STARTING_SKILLS"));
            } else {
            }
        } catch (err) {
            console.error("RaceSheet: Error handling drop:", err);
            ui.notifications.error(game.i18n.format("NOTIFICATION.ITEM_ADD_ERROR", {error:err.message}));
        }
    }

    async _handleSkillDrop(data) {
        // Skills are stored by key in system.skills
        // We need to extract the skill key from the drop data
        let skillKey = null;
        
        if (data.uuid) {
            // Try to get skill from UUID (from actor sheet)
            const parts = data.uuid.split(".");
            if (parts.length > 0) {
                // Skill key might be in the UUID or we need to get it from the actor
                const actorId = parts[parts.length - 2];
                const skillId = parts[parts.length - 1];
                const actor = game.actors.get(actorId);
                if (actor) {
                    // Find skill by matching the skill structure
                    for (const [key, skill] of Object.entries(actor.system.skills || {})) {
                        if (skill.label === skillId || key === skillId) {
                            skillKey = key;
                            break;
                        }
                    }
                }
            }
        } else if (data.id) {
            skillKey = data.id;
        }
        
        if (skillKey) {
            const currentSkills = this.item.system.startingSkills || {};
            // Get skill label from config or use key
            const skillConfig = game.darkHeresy?.config?.skills?.[skillKey];
            const skillLabel = skillConfig?.label || skillKey;
            
            const updateData = {
                [`system.startingSkills.${skillKey}`]: {
                    label: skillLabel,
                    advance: 3 // "Known" by default (value 3)
                }
            };
            await this.item.update(updateData);
        }
    }

    async _handleItemDrop(item, targetPath) {
        if (!item) {
            console.warn("RaceSheet: _handleItemDrop called with null item");
            return;
        }
        
        
        // Store item reference - use UUID for compendium items, id for world items
        let itemRef = null;
        let itemName = item.name;
        
        if (item.uuid && item.uuid.includes("Compendium")) {
            // Compendium item - store UUID
            itemRef = item.uuid;
        } else {
            // World item - store id
            itemRef = item.id;
        }
        
        const currentList = foundry.utils.getProperty(this.item.system, targetPath) || [];
        
        // Check if already exists
        const exists = currentList.some(entry => {
            if (typeof entry === "string") {
                return entry === itemRef || entry === item.id || entry === item.uuid;
            }
            return entry.id === itemRef || entry.id === item.id || entry.uuid === item.uuid || 
                   (entry.id && item.id && entry.id === item.id);
        });
        
        if (exists) {
            ui.notifications.info(game.i18n.format("NOTIFICATION.ITEM_ALREADY_LISTED", {name:item.name}));
            return;
        }
        
        // Store as object with id/uuid and name for better display
        const itemData = { 
            id: item.id || itemRef,
            uuid: item.uuid || null,
            name: itemName 
        };
        const newList = [...currentList, itemData];
        
        const updateData = {};
        updateData[`system.${targetPath}`] = newList;
        
        try {
            await this.item.update(updateData);
            // Refresh the sheet to show the new item
            this.render(false);
        } catch (err) {
            console.error("RaceSheet: Error updating item", err);
            ui.notifications.error(game.i18n.format("NOTIFICATION.RACE_UPDATE_ERROR", {error:err.message}));
        }
    }
}

const initializeHandlebars = () => {
    registerHandlebarsHelpers();
    preloadHandlebarsTemplates();
};

/**
 * Define a set of template paths to pre-load. Pre-loaded templates are compiled and cached for fast access when
 * rendering. These paths will also be available as Handlebars partials by using the file name.
 * @returns {Promise}
 */
function preloadHandlebarsTemplates() {
    const templatePaths = [
        // Каркас листа персонажа и его сменные части: анкета книги, полосы показателей
        // и вкладки. Партиал, который подставляется по имени из контекста, обязан быть
        // загружен заранее — иначе Handlebars его не найдёт.
        "systems/dark-heresy/template/sheet/actor/character.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/portrait.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/bio-dark-heresy.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/bio-only-war.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/bio-black-crusade.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/bio-rogue-trader.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/bio-deathwatch.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/vital-wounds.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/vital-fatigue.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/vital-fate.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/vital-infamy.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/vital-profit-factor.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/allegiance.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/squad.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/deathwatch.hbs",
        "systems/dark-heresy/template/sheet/actor/npc.hbs",
        "systems/dark-heresy/template/sheet/actor/vehicle.hbs",
        "systems/dark-heresy/template/sheet/vehicle-weapon.hbs",
        "systems/dark-heresy/template/sheet/vehicle-trait.hbs",
        "systems/dark-heresy/template/sheet/actor/voidship.hbs",
        "systems/dark-heresy/template/sheet/ship-weapon.hbs",
        "systems/dark-heresy/template/sheet/actor/limited-sheet.hbs",

        "systems/dark-heresy/template/sheet/actor/tab/abilities.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/combat.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/effects.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/gear.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/notes.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/npc-notes.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/npc-stats.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/progression.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/psychic-powers.hbs",
        "systems/dark-heresy/template/sheet/actor/partial/psychic-powers-list.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/stats.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/vehicle-profile.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/vehicle-weapons.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/vehicle-traits.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/voidship-profile.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/voidship-components.hbs",
        "systems/dark-heresy/template/sheet/ship-component.hbs",
        "systems/dark-heresy/template/chat/ship-attack.hbs",
        "systems/dark-heresy/template/dialog/ship-attack.hbs",
        "systems/dark-heresy/template/chat/ship-salvo.hbs",
        "systems/dark-heresy/template/chat/ship-action.hbs",
        "systems/dark-heresy/template/dialog/ship-action.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/voidship-bridge.hbs",
        "systems/dark-heresy/template/chat/ship-opposed.hbs",
        "systems/dark-heresy/template/chat/ship-ram.hbs",
        "systems/dark-heresy/template/sheet/actor/tab/voidship-weapons.hbs",

        "systems/dark-heresy/template/sheet/mental-disorder.hbs",
        "systems/dark-heresy/template/sheet/aptitude.hbs",
        "systems/dark-heresy/template/sheet/malignancy.hbs",
        "systems/dark-heresy/template/sheet/mutation.hbs",
        "systems/dark-heresy/template/sheet/talent.hbs",
        "systems/dark-heresy/template/sheet/trait.hbs",
        "systems/dark-heresy/template/sheet/special-ability.hbs",
        "systems/dark-heresy/template/sheet/race.hbs",
        "systems/dark-heresy/template/sheet/origin.hbs",
        "systems/dark-heresy/template/apps/character-wizard.hbs",
        "systems/dark-heresy/template/sheet/psychic-power.hbs",
        "systems/dark-heresy/template/sheet/critical-injury.hbs",
        "systems/dark-heresy/template/sheet/weapon.hbs",
        "systems/dark-heresy/template/sheet/armour.hbs",
        "systems/dark-heresy/template/sheet/gear.hbs",
        "systems/dark-heresy/template/sheet/drug.hbs",
        "systems/dark-heresy/template/sheet/tool.hbs",
        "systems/dark-heresy/template/sheet/cybernetic.hbs",
        "systems/dark-heresy/template/sheet/weapon-modification.hbs",
        "systems/dark-heresy/template/sheet/ammunition.hbs",
        "systems/dark-heresy/template/sheet/force-field.hbs",

        "systems/dark-heresy/template/sheet/item/effects.hbs",
        "systems/dark-heresy/template/sheet/item/effect-group.hbs",

        "systems/dark-heresy/template/sheet/characteristics/information.hbs",
        "systems/dark-heresy/template/sheet/characteristics/left.hbs",
        "systems/dark-heresy/template/sheet/characteristics/name.hbs",
        "systems/dark-heresy/template/sheet/characteristics/right.hbs",
        "systems/dark-heresy/template/sheet/characteristics/total.hbs",

        "systems/dark-heresy/template/chat/item.hbs",
        "systems/dark-heresy/template/chat/roll.hbs",
        "systems/dark-heresy/template/chat/damage.hbs",
        "systems/dark-heresy/template/chat/damage-mass.hbs",
        "systems/dark-heresy/template/chat/critical.hbs",
        "systems/dark-heresy/template/chat/evasion.hbs",
        "systems/dark-heresy/template/chat/evasion-mass.hbs",
        "systems/dark-heresy/template/chat/suppression.hbs",
        "systems/dark-heresy/template/chat/emptyMag.hbs",

        "systems/dark-heresy/template/dialog/common-roll.hbs",
        "systems/dark-heresy/template/dialog/combat-roll.hbs",
        "systems/dark-heresy/template/dialog/psychic-power-roll.hbs"
    ];
    return foundry.applications.handlebars.loadTemplates(templatePaths);
}

/**
 * Add custom Handlerbars helpers.
 */
function registerHandlebarsHelpers() {
    Handlebars.registerHelper("ruleText", (value, book, field) => ruleText(value, book, game.i18n.lang,
        typeof field === "string" ? field : ""));
    Handlebars.registerHelper("removeMarkup", function(text) {
        const markup = /<(.*?)>/gi;
        return text.replace(markup, "");
    });

    Handlebars.registerHelper("stripHtmlKeepBreaks", function(text) {
        if (text === null || text === undefined) return "";
        let value = String(text);
        // Convert common block/line tags to newlines before stripping markup.
        value = value.replace(/<\s*br\s*\/?>/gi, "\n");
        value = value.replace(/<\/\s*p\s*>/gi, "\n");
        value = value.replace(/<\s*p\s*>/gi, "");
        value = value.replace(/<\/\s*li\s*>/gi, "\n");
        value = value.replace(/<\s*li\s*>/gi, "- ");
        const markup = /<(.*?)>/gi;
        return value.replace(markup, "");
    });

    Handlebars.registerHelper("nl2br", function(text) {
        if (text === null || text === undefined) return "";
        const value = String(text).replace(/\r\n/g, "\n");
        const normalized = value.replace(/\n{3,}/g, "\n\n");
        return normalized.replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>");
    });

    /** Numeric comparison for templates; Handlebars has no operators. */
    Handlebars.registerHelper("gt", (a, b) => Number(a) > Number(b));

    /**
     * Turn a 0-100 percentage into ten booleans, one per notch.
     * Handlebars has no arithmetic, so the scale is built here rather than in markup.
     */
    Handlebars.registerHelper("pipScale", function(percent) {
        const filled = Math.round((Number(percent) || 0) / 10);
        return Array.from({length: 10}, (_, i) => i < filled);
    });

    Handlebars.registerHelper("damageTypeLong", function(damageType) {
        damageType = (damageType || "i").toLowerCase();
        switch (damageType) {
            case "e":
            case "energy":
                return game.i18n.localize("DAMAGE_TYPE.ENERGY");
            case "i":
            case "impact":
                return game.i18n.localize("DAMAGE_TYPE.IMPACT");
            case "r":
            case "rending":
                return game.i18n.localize("DAMAGE_TYPE.RENDING");
            case "x":
            case "explosive":
                return game.i18n.localize("DAMAGE_TYPE.EXPLOSIVE");
            default:
                return game.i18n.localize("DAMAGE_TYPE.IMPACT");
        }
    });


    Handlebars.registerHelper("damageTypeShort", function(damageType) {
        switch (damageType) {
            case "energy":
                return game.i18n.localize("DAMAGE_TYPE.ENERGY_SHORT");
            case "impact":
                return game.i18n.localize("DAMAGE_TYPE.IMPACT_SHORT");
            case "rending":
                return game.i18n.localize("DAMAGE_TYPE.RENDING_SHORT");
            case "explosive":
                return game.i18n.localize("DAMAGE_TYPE.EXPLOSIVE_SHORT");
            default:
                return game.i18n.localize("DAMAGE_TYPE.IMPACT_SHORT");
        }
    });

    Handlebars.registerHelper("config", function(key) {
        return game.darkHeresy.config[key];
    });

    Handlebars.registerHelper("signed", function(value) {
        const num = Number(value) || 0;
        if (num > 0) return `+${num}`;
        if (num < 0) return `${num}`;
        return "0";
    });

    Handlebars.registerHelper("safeLocalize", function(key) {
        if (!key) return "";
        const localized = game.i18n.localize(key);
        // If localization returns the same value (key not found), return the key as-is
        // This allows custom skills to use their label directly
        return localized === key ? key : localized;
    });

    /**
     * Текст без разметки — для узких сводных ячеек листа.
     *
     * Поля вроде `benefit` задумывались однострочными и на листе живут в ячейке,
     * обрезанной до двух строк. Если в них попадает HTML (а он попадает: описания
     * компендиума размечены, да и МИ может вставить что угодно), двойные скобки
     * покажут разметку как есть, а тройные развалят вёрстку блочными тегами
     * внутри клампа. Поэтому здесь именно снятие тегов, а не отрисовка.
     *
     * Полный размеченный текст никуда не девается — он раскрывается ниже, в
     * блоке заметок, где для него есть место.
     */
    Handlebars.registerHelper("stripHtml", function(value) {
        if (value === null || value === undefined) return "";
        // Блочные теги — это границы предложений. Без пробела на их месте
        // `<p>…presence.</p><p>This talent…</p>` слипается в «presence.This».
        const text = String(value).replace(/<\/(p|div|li|tr|h[1-6])>|<br\s*\/?>/gi, " ");
        // Дальше разбираем как разметку, а не режем регуляркой: так уцелеет
        // текст сущностей (&amp; остаётся амперсандом, а не «amp»).
        const parsed = new DOMParser().parseFromString(text, "text/html");
        return (parsed.body.textContent || "").replace(/\s+/g, " ").trim();
    });

    /**
     * Есть ли значение в списке — для галок, отмечающих выбранное из набора.
     * Handlebars своего `includes` не имеет, а `lookup` для массива значений
     * не годится: он ищет по индексу, а не по содержимому.
     */
    Handlebars.registerHelper("includes", function(list, value) {
        return Array.isArray(list) && list.includes(value);
    });

    Handlebars.registerHelper("isNpc", function(actor) {
        return actor?.type === "npc";
    });

}

const migrateWorld = async () => {
    const schemaVersion = 16;
    if (game.user !== game.users.activeGM) return;
    const previous = Number(game.settings.get("dark-heresy", "worldSchemaVersion"));
    if (previous > schemaVersion) throw new Error("World schema is newer than this system; migration refused.");
    if (previous === schemaVersion) return;
    ui.notifications.info(game.i18n.localize("UI.UPGRADING_THE_WORLD_PLEASE_WAIT"));
    try {
        for (const actor of game.actors.contents) await migrateActorDocument(actor, previous);
        // Synthetic Actors have independent deltas even when they share a base Actor.
        for (const scene of game.scenes.values()) {
            for (const token of scene.tokens.values()) {
                if (!token.actorLink && token.actor) await migrateActorDocument(token.actor, previous);
            }
        }
        for (const item of game.items.contents) {
            const update = migrateItemData(item);
            if (!foundry.utils.isEmpty(update)) await item.update(update);
        }
        for (const pack of game.packs.filter(p => (p.metadata.packageType === "world" || p.metadata.package === "world")
            && ["Actor", "Item"].includes(p.documentName ?? p.metadata.type))) {
            await migrateCompendium(pack, previous);
        }
        await game.settings.set("dark-heresy", "worldSchemaVersion", schemaVersion);
        ui.notifications.info(game.i18n.localize("UI.UPGRADE_COMPLETE"));
    } catch (error) {
        ui.notifications.error(game.i18n.localize("UI.WORLD_UPGRADE_FAILED"));
        throw error;
    }
};

async function migrateActorDocument(actor, version) {
    // Import old textual aptitudes before deleting their source. Retrying cannot duplicate items.
    const oldAptitudes = actor._source?.system?.aptitudes ?? actor._source?.system?.legacyData?.aptitudes;
    if (version < 4 && oldAptitudes) {
        const existing = new Set(Array.from(actor.items).filter(i => i.type === "aptitude").map(i => ruleName(i)));
        const items = [];
        for (const aptitude of Object.values(oldAptitudes)) {
            const name = ruleName(aptitude).trim();
            if (!name || existing.has(name)) continue;
            items.push({name, type: "aptitude", img: "systems/dark-heresy/assets/icons/generic.webp"});
            existing.add(name);
        }
        if (items.length) await actor.createEmbeddedDocuments("Item", items);
    }
    const update = migrateActorData(actor, version);
    if (!foundry.utils.isEmpty(update)) await actor.update(update);
    // Both migrations are idempotent; also repair documents missed by schema 13's world-only traversal.
    await migrateActorEffects(actor);
    await migrateActorItems(actor);
}

/**
 * Move condition metadata on an actor's ActiveEffects into flags (world schema 7).
 *
 * Conditions used to be tagged with a top-level `key` and with `system.key`/`system.type`. Neither
 * exists in the v14 ActiveEffect schema, so both are dropped the moment the world is opened. What
 * does survive is `statuses`, which this system has always populated with the condition key, so the
 * key is recovered from there.
 *
 * @param {Actor} actor   The actor to migrate.
 * @returns {Promise<void>}
 */
const migrateActorEffects = async (actor) => {
    const updates = [];
    for (const effect of actor.effects) {
        if (_effectConditionKey(effect)) continue;
        const [statusKey] = _effectStatuses(effect);
        if (!statusKey) continue;
        updates.push({
            _id: effect.id,
            "flags.dark-heresy.key": statusKey,
            "flags.dark-heresy.type": effect.flags?.["dark-heresy"]?.type ?? "minor"
        });
    }
    if (updates.length) {
        await actor.updateEmbeddedDocuments("ActiveEffect", updates);
    }
};

/**
 * Привести предметы актёра к схеме 13.
 *
 * Отдельная функция, а не ветка в migrateActorData: тот собирает один патч по
 * самому актёру, а здесь нужно обновить встроенные документы, и делается это
 * другим вызовом.
 *
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
const migrateActorItems = async (actor) => {
    const updates = actor.items.contents
        .map(item => migrateItemData(item))
        .filter(update => !foundry.utils.isEmpty(update));
    if (updates.length) {
        await actor.updateEmbeddedDocuments("Item", updates);
    }
};

/**
 * Патч одного предмета до схемы 13.
 *
 * Схема 13 добавила покровителя порче, машиночитаемую совместимость патронов и
 * поля эффекта модификациям. Пустой патч означает «этот предмет и так в порядке»:
 * дописываем только недостающее, чтобы не затирать уже заполненное вручную.
 *
 * @param {Item} item
 * @returns {object} патч с `_id` или пустой объект
 */
const migrateItemData = (item) => {
    const update = {};
    const source = item._source?.system ?? {};

    // Порча: до сих пор мутации и расстройства не знали, чей это дар. Все
    // существующие записываем Неделимому — угадывать бога по тексту нельзя,
    // а книга и сама начинает всех с него.
    if (["mutation", "mentalDisorder", "malignancy"].includes(item.type)) {
        if (source.patron === undefined) update["system.patron"] = "undivided";
    }

    // Боеприпас: пустые списки означают «подходит всему», то есть ровно то
    // поведение, которое было до появления проверки. Ничего не ломается.
    if (item.type === "ammunition") {
        if (!Array.isArray(source.weaponTypes)) update["system.weaponTypes"] = [];
        if (!Array.isArray(source.weaponClasses)) update["system.weaponClasses"] = [];
        if (source.effect?.removeSpecial === undefined) update["system.effect.removeSpecial"] = "";
    }

    // Модификация: раньше её эффект был описанием для мастера, теперь полями.
    // Нули и единицы — это «мод пока ничего не делает», как и было.
    if (item.type === "weaponModification") {
        if (source.weaponId === undefined) update["system.weaponId"] = "";
        if (!Array.isArray(source.weaponTypes)) update["system.weaponTypes"] = [];
        if (!Array.isArray(source.weaponClasses)) update["system.weaponClasses"] = [];
        if (source.effect === undefined) {
            update["system.effect"] = {
                damageBonus: 0, penetrationBonus: 0, attackBonus: 0,
                rangeMultiplier: 1, clipMultiplier: 1, availabilityShift: 1,
                addTraits: "", removeTraits: ""
            };
        } else if (source.effect.availabilityShift === undefined) {
            update["system.effect.availabilityShift"] = 1;
        }
    }

    return foundry.utils.isEmpty(update) ? {} : { _id: item.id, ...update };
};

/**
 * Строки анкеты, которые лист успел размножить (схема 16).
 *
 * Нрав и Comrade стояли в форме листа дважды — в анкете и на вкладке заметок, —
 * а два поля с одним именем уходят массивом и ложатся в строку как «X,X». Каждое
 * сохранение удваивало прежнее. Здесь значение возвращается к тому, что вводили.
 *
 * @param {Actor} actor
 * @returns {object} патч для actor.update; пустой, если чинить нечего
 */
function repeatedBioPatch(actor) {
    const update = {};
    const bio = actor?._source?.system?.bio;
    if (!bio) return update;
    for (const field of ["demeanour", "comrade", "comradeDemeanour"]) {
        const repaired = collapseRepeatedText(bio[field]);
        if (repaired !== bio[field]) update[`system.bio.${field}`] = repaired;
    }
    return update;
}

const migrateActorData = (actor, worldSchemaVersion) => {
    const update = {};
    if (worldSchemaVersion < 16) Object.assign(update, repeatedBioPatch(actor));
    if (worldSchemaVersion < 12 && actor.type === "heretic") {
        // Покровитель раньше был свободной строкой в bio.background, а теперь от
        // него зависят цены улучшений, поэтому он стал выбором из пяти. Угадывать
        // написанное не берёмся — все начинают непристроившимися, как в книге;
        // строка остаётся на месте, её видно на вкладке заметок.
        if (actor.system?.patron === undefined) update["system.patron"] = "undivided";
        if (actor.system?.alignment === undefined) {
            update["system.alignment"] = { khorne: 0, nurgle: 0, slaanesh: 0, tzeentch: 0 };
        }
        if (actor.system?.aspiration === undefined) update["system.aspiration"] = "";
        if (actor.system?.pride === undefined) update["system.pride"] = "";
        if (actor.system?.vice === undefined) update["system.vice"] = "";
    }
    if (worldSchemaVersion < 11 && actor.type === "vehicle") {
        // У машин появилась своя иконка. Переставляем её только тем, кто до сих
        // пор носит старый общий портрет: выбранный вручную трогать нельзя.
        if (actor.img === "systems/dark-heresy/assets/tokens/unknown.webp") {
            update.img = "systems/dark-heresy/assets/icons/vehicle.svg";
        }
    }
    if (worldSchemaVersion < 10 && actor.type === "vehicle") {
        // Машины, созданные до этого выпуска, не знают ни режима хода, ни списка
        // экипажа. Оба поля читаются из template.json как значения по умолчанию,
        // но записать их в актёра надо явно: без этого первое же обращение к
        // system.crew.members на старой машине уходит в undefined.
        const source = actor._source?.system ?? {};
        if (source.speed?.mode === undefined) update["system.speed.mode"] = "tactical";
        if (!Array.isArray(source.crew?.members)) update["system.crew.members"] = [];
        if (source.conditions?.wrecked === undefined) update["system.conditions.wrecked"] = false;
        if (source.fire?.rounds === undefined) update["system.fire.rounds"] = 0;
    }
    if (worldSchemaVersion < 9) {
        // Some actors carry arrays where the schema says a number - wounds.value
        // stored as [8, 8] instead of 8. A number input rejects "8,8" outright, so
        // the field renders blank and every Number() guard downstream reads 0.
        // Collapse to the first usable figure.
        // A "8,8" string is the same corruption seen through String(), so split on
        // the separator too. Returning undefined for anything unreadable leaves the
        // stored figure alone rather than zeroing a character's wounds.
        const flatten = value => {
            if (typeof value === "number" || value === null || value === undefined) return undefined;
            const parts = Array.isArray(value) ? value.flat(Infinity) : String(value).split(",");
            const first = parts.map(Number).find(n => Number.isFinite(n));
            return Number.isFinite(first) ? first : undefined;
        };
        for (const [track, fields] of Object.entries({
            wounds: ["value", "max", "critical", "regeneration"],
            fatigue: ["value", "max"],
            fate: ["value", "max"],
            psy: ["rating", "sustained"]
        })) {
            for (const field of fields) {
                // Read the stored figure, not the prepared one: prepareData coerces
                // these through Number() and would hand us a NaN to "repair".
                const flat = flatten(actor._source?.system?.[track]?.[field]);
                if (flat !== undefined) update[`system.${track}.${field}`] = flat;
            }
        }
    }
    if (worldSchemaVersion < 8) {
        // Actors created before this release baked in a portrait path that never
        // existed: assets/actors/unknown.webp, under a directory the system does not
        // ship. Fixing CONFIG only helps new actors, so repoint the stored value.
        if (actor.img === "systems/dark-heresy/assets/actors/unknown.webp") {
            update.img = "systems/dark-heresy/assets/tokens/unknown.webp";
        }
    }
    const source = actor._source?.system ?? {};
    if (worldSchemaVersion < 1 && ["acolyte", "npc"].includes(actor.type)) {
        update["system.skills.psyniscience.characteristics"] = ["Per", "WP"];
    }
    if (worldSchemaVersion < 2 && ["acolyte", "npc"].includes(actor.type)) {
        for (const [key, label] of Object.entries({officioAssassinorum:"Officio Assassinorum", pirates:"Pirates",
            psykers:"Psykers", theWarp:"The Warp", xenos:"Xenos"})) {
            if (source.skills?.forbiddenLore?.specialities?.[key] !== undefined) continue;
            update["system.skills.forbiddenLore.specialities." + key] = {label, isKnown:false, advance:-20, cost:0};
        }
    }
    if (worldSchemaVersion < 4 && source.aptitudes) {
        update["system.-=aptitudes"] = null;
        update["system.legacyData.-=aptitudes"] = null;
    }
    if (worldSchemaVersion < 5 && source.experience?.totalspent !== undefined) {
        const value = Number(source.experience.value || 0) + Number(source.experience.totalspent);
        if (Number.isFinite(value)) {
            update["system.experience.value"] = value;
            // Consumed source field makes a partially completed migration safe to retry.
            update["system.experience.-=totalspent"] = null;
            update["system.legacyData.experience.-=totalspent"] = null;
        }
    }
    if (worldSchemaVersion < 6 && actor.type === "npc" && source.bio?.notes && !source.notes) {
        update["system.notes"] = source.bio.notes;
    }


    return update;
};

/**
 * Migrate Data in Compendiums
 * @param {CompendiumCollection} pack
 * @param {number} worldSchemaVersion
 * @returns {Promise<void>}
 */
const migrateCompendium = async function(pack, worldSchemaVersion) {
    const type = pack.documentName ?? pack.metadata.type;
    if (!["Actor", "Item"].includes(type)) return;
    const locked = pack.locked;
    if (locked) await pack.configure({locked:false});
    try {
        for (const doc of await pack.getDocuments()) {
            if (type === "Actor") await migrateActorDocument(doc, worldSchemaVersion);
            else {
                const update = migrateItemData(doc);
                if (!foundry.utils.isEmpty(update)) await doc.update(update);
            }
        }
    } finally {
        if (locked) await pack.configure({locked:true});
    }
};

/**
 * Delegate a DOM event on a container to handlers keyed by selector.
 *
 * Replaces jQuery's `html.on(type, selector, handler)`. Native listeners set `event.currentTarget`
 * to the container rather than the matched element, so it is shadowed with the matched element -
 * every downstream handler reads `ev.currentTarget` and would otherwise receive the whole chat log.
 *
 * @param {HTMLElement} container   Element to bind the listener on
 * @param {string} type             DOM event type
 * @param {Record<string, Function>} handlers  Map of CSS selector to handler
 */
function _delegate(container, type, handlers) {
    container.addEventListener(type, event => {
        for (const [selector, handler] of Object.entries(handlers)) {
            const match = event.target.closest?.(selector);
            if (!match || !container.contains(match)) continue;
            Object.defineProperty(event, "currentTarget", {value: match, configurable: true});
            handler(event);
            return;
        }
    });
}

/**
 * Listeners for Chatmessages
 * @param {HTMLElement} html    The rendered ChatLog element
 */
function chatListeners(html) {
    if (!html || html.dataset.dhChatListeners === "true") return;
    html.dataset.dhChatListeners = "true";

    _delegate(html, "click", {
        ".invoke-test": onTestClick,
        ".invoke-damage": onDamageClick,
        ".invoke-suppression": onSuppressionClick,
        ".dh-chat-target": onChatTargetClick,
        ".manual-damage-undo": onManualDamageUndoClick,
        ".roll-willpower-test": onFireWillpowerTestClick,
        ".roll-blood-loss": onBloodLossRollClick,
        ".extinguish-fire": onExtinguishFireClick,
        ".pinning-escape": onPinningEscapeClick,
        ".roll-toxic-test": onToxicTestClick,
        ".dh-apply-roll": onApplyRollClick,
        ".counter-attack": onCounterAttackClick
    });

    _delegate(html, "dblclick", {
        ".dark-heresy.chat.roll>.background.border": onChatRollClick,
        ".dark-heresy.chat.damage-card .roll-card-background": onDamageCardClick
    });
}

/**
 * This function is used to hook into the Chat Log context menu to add additional options to each message
 * These options make it easy to conveniently apply damage to controlled tokens based on the value of a Roll
 *
 * Bound to the v13+ `getChatMessageContextOptions` hook, which passes the ChatLog application and
 * builds its ContextMenu with `jQuery: false` - every `li` below is a plain HTMLElement.
 *
 * @param {Application} application The ChatLog application
 * @param {Array} options           The Array of Context Menu options
 *
 * @returns {Array}                 The extended options Array including new context choices
 */
const addChatMessageContextOptions = function(application, options) {
    let canApply = li => {
        const message = game.messages.get(li.dataset.messageId);
        return message.getRollData()?.flags.isDamageRoll
            && message.isContentVisible
            && canvas.tokens.controlled.length;
    };
    options.push(
        {
            name: game.i18n.localize("CHAT.CONTEXT.APPLY_DAMAGE"),
            icon: '<i class="fas fa-user-minus"></i>',
            condition: canApply,
            callback: li => applyChatCardDamage(li)
        }
    );

    /**
     * Можно ли переброс за очко Тёмной славы.
     *
     * Аколита это не касается — у него судьба и свои правила. Еретику переброс
     * открывается только со второго уровня способностей (21+ Порчи, таблица 9-9),
     * а преданному Нурглу не открывается вовсе: его строка в таблице 9-10 меняет
     * переброс на всегда-максимальное лечение.
     * @param {Actor} actor
     * @returns {boolean}
     */
    const _canRerollForInfamy = actor => {
        if (actor.type !== "heretic") return true;
        const rules = Dh.infamyPatronRules[actor.system.patron] ?? {};
        if ((rules.deny ?? []).includes("reroll")) return false;
        return Dh.getInfamyLevel(actor.corruption) >= 2;
    };

    let canReroll = li => {
        const message = game.messages.get(li.dataset.messageId);
        // Судьбу платит тот, кто бросал: на карточке уклонения это цель, а не
        // владелец карточки. Раньше право на переброс проверялось у атакующего.
        let actor = _fateActorFor(message.getRollData());
        return message.isRoll
            && !message.getRollData()?.flags.isDamageRoll
            && message.isContentVisible
            && actor?.fate.value > 0
            && _canRerollForInfamy(actor);
    };

    options.push(
        {
            name: game.i18n.localize("CHAT.CONTEXT.REROLL"),
            icon: '<i class="fa-solid fa-repeat"></i>',
            condition: canReroll,
            callback: li => {
                const message = game.messages.get(li.dataset.messageId);
                rerollTest(message.getRollData());
            }
        }
    );

    const canBlast = li => {
        if (!game.user.isGM) return false;
        const message = game.messages.get(li.dataset.messageId);
        return message?.isContentVisible
            && message.getRollData()?.flags?.isMassEvasion;
    };
    options.push(
        {
            name: game.i18n.localize("MASS_DAMAGE_MODE.BLAST"),
            icon: '<i class="fas fa-bomb"></i>',
            condition: canBlast,
            callback: li => {
                const message = game.messages.get(li.dataset.messageId);
                applyBlastFromMassEvasion(message);
            }
        }
    );
    return options;
};

/**
 * Apply rolled dice damage to the token or tokens which are currently controlled.
 * This allows for damage to be scaled by a multiplier to account for healing, critical hits, or resistance
 *
 * @param {HTMLElement} roll    The chat entry which contains the roll data
 * @param {number} multiplier   A damage multiplier to apply to the rolled damage.
 * @returns {Promise}
 */
function applyChatCardDamage(roll, multiplier) {
    // Get the damage data, get them as arrays in case of multiple hits
    const amount = roll.querySelectorAll(".damage-total");
    const location = roll.querySelectorAll(".damage-location");
    const penetration = roll.querySelectorAll(".damage-penetration");
    const type = roll.querySelectorAll(".damage-type");
    const righteousFury = roll.querySelectorAll(".damage-righteous-fury");

    // Put the data from different hits together
    const damages = [];
    for (let i = 0; i < amount.length; i++) {
        // Parse penetration value, removing any whitespace and converting to number
        const penetrationText = penetration[i]?.textContent.trim();
        const penetrationValue = penetrationText ? Number(penetrationText) : 0;

        damages.push({
            amount: amount[i]?.textContent,
            location: location[i]?.dataset.location,
            penetration: penetrationValue,
            type: type[i]?.textContent,
            righteousFury: righteousFury[i]?.textContent
        });
    }

    // Apply to any selected actors
    return Promise.all(canvas.tokens.controlled.map(t => {
        const a = t.actor;
        return a.applyDamage(damages);
    }));
}

// Serialise document mutations on this client; the elected GM owns socket execution.
const _dhOperationQueues = new Map();
function _queueDocumentOperation(key, task) {
    const previous = _dhOperationQueues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    _dhOperationQueues.set(key, current);
    const cleanup = () => { if (_dhOperationQueues.get(key) === current) _dhOperationQueues.delete(key); };
    current.then(cleanup, cleanup);
    return current;
}

function _damageEntriesFromRoll(rollData) {
    const damages = (rollData.damages || []).map(damage => ({
        amount: Number(damage.total) || 0,
        location: damage.location,
        // Сторона и зона считаются в момент броска по положению фишек на сцене и
        // здесь должны пережить пересборку: без стороны машина защищается лбом
        // от чего угодно, включая выстрел в корму.
        ...(damage.zone ? { zone: damage.zone } : {}),
        ...(damage.facing ? { facing: damage.facing } : {}),
        penetration: Number(damage.penetration) || 0,
        type: rollData.weapon?.damageType,
            righteousFury: damage.righteousFury,
            attackDos: rollData.attackDos,
            weaponClass: rollData.weapon?.weaponClass,
            weaponType: rollData.weapon?.weaponType,
            weaponTraits: damage.weaponTraits || rollData.weapon?.traits || {}, // Pass weapon traits for trait-based checks (prefer from damage object)
            devastating: rollData.weapon?.traits?.devastating // Pass devastating value for horde reduction
    }));

    return damages;
}

/**
 * Надетое силовое поле цели, если оно есть и ещё работает.
 * @param {Actor} actor
 * @returns {Item|null}
 */
function _wornForceField(actor) {
    return (actor?.items ?? []).find?.(item => item.type === "forceField" && item.system?.equipped === true) ?? null;
}

/**
 * Расстояние между стрелком и целью в единицах сцены, когда оба на холсте.
 * Полоса дальности («в упор») тут не годится: она шире метра, а Силовое поле
 * отказывает именно на метре.
 * @returns {number|null} null — если измерить нечем
 */
function _metresBetween(rollData, targetToken) {
    try {
        const attacker = canvas?.tokens?.get?.(rollData?.tokenId);
        if (!attacker || !targetToken || !canvas?.grid) return null;
        const path = canvas.grid.measurePath([attacker.center, targetToken.center]);
        const distance = Number(path?.distance);
        return Number.isFinite(distance) ? distance : null;
    } catch {
        return null;
    }
}

/**
 * Поставить атаку против силового поля цели.
 *
 * Поле отводит атаку целиком, а не снижает её, поэтому бросок делается до брони
 * и Стойкости (DH2, стр. 169). Тот же бросок решает, не выгорело ли поле.
 *
 * @returns {Promise<{blocked: boolean, overloaded: boolean, roll: number, name: string}|null>}
 */
async function _forceFieldIntercept(actor, rollData, targetToken) {
    const item = _wornForceField(actor);
    if (!item) return null;

    const roll = new Roll("1d100");
    await roll.evaluate();

    const isMelee = rollData?.weapon?.weaponClass === "melee" || rollData?.weapon?.class === "melee";
    const outcome = fieldProtects({
        field: {
            name: item.name,
            protectionRating: item.system?.protectionRating,
            overloadChance: item.system?.overloadChance,
            craftsmanship: item.system?.craftsmanship,
            overloaded: !!item.getFlag?.("dark-heresy", "overloaded")
        },
        roll: roll.total,
        isMelee,
        rangeMetres: _metresBetween(rollData, targetToken)
    });

    // Выгоревшее поле молчит до починки Очень трудной (−30) проверкой Технологий.
    if (outcome.overloaded && !item.getFlag?.("dark-heresy", "overloaded")) {
        await item.setFlag("dark-heresy", "overloaded", true);
    }
    return {...outcome, roll: roll.total, name: item.name};
}

/**
 * Сказать столу, что поле сработало. Молчаливое спасение неотличимо от бага —
 * именно поэтому неработающие поля так долго никто и не замечал.
 */
async function _announceForceField(actor, intercept) {
    const verdict = intercept.overloaded
        ? game.i18n.localize("FORCE_FIELD.BLOCKED_AND_OVERLOADED")
        : game.i18n.localize("FORCE_FIELD.BLOCKED");
    await ChatMessage.create({
        content: `<div class="dark-heresy chat roll"><div class="dh-card is-success">
            <div class="dh-card-h"><span class="who">${actor.name}</span>
            <span class="verdict">${verdict}</span></div>
            <div class="dh-card-b"><dl class="dh-kv">
                <dt>${game.i18n.localize("FORCE_FIELD.NAME")}</dt><dd>${intercept.name}</dd>
                <dt>${game.i18n.localize("FORCE_FIELD.PROTECTION_RATING")}</dt><dd>${intercept.roll}</dd>
            </dl></div></div></div>`
    });
}

async function applyAutoDamageToTarget(rollData, message) {
    const target = rollData?.targets?.[0];
    if (!target || !message) return;
    const gm = game.users.activeGM;
    if (!gm) {
        ui.notifications.warn(game.i18n.localize("UI.DAMAGE_WAS_NOT_APPLIED_NO_ACTIVE_GAMEMASTER"));
        return;
    }
    const payload = {sceneId: target.sceneId, tokenId: target.tokenId, messageId: message.id};
    if (game.user !== gm) {
        game.socket.emit("system.dark-heresy", {type: "autoDamage", payload});
        return;
    }
    return applyAutoDamageFromSocket(payload);
}

async function applyAutoDamageFromSocket(payload) {
    if (game.user !== game.users.activeGM || !game.user?.isGM) return;
    if (!payload?.sceneId || !payload.tokenId || !payload.messageId) return;
    const message = game.messages.get(payload.messageId);
    const rollData = message?.getRollData?.();
    // A socket request names a recorded operation, never supplies its damage or destination.
    if (!rollData?.flags?.isDamageRoll || !rollData.targets?.some(target =>
        target.sceneId === payload.sceneId && target.tokenId === payload.tokenId)) return;
    const targetToken = game.scenes.get(payload.sceneId)?.tokens.get(payload.tokenId);
    const actor = targetToken?.actor;
    if (!actor) return;

    // Силовое поле отводит атаку целиком, поэтому спрашивается раньше брони и
    // Стойкости. Десять полей в компендиуме несли рейтинг от 25 до 80, и не
    // читал его никто: Розарий, который должен гасить половину, гасил ноль.
    const field = await _forceFieldIntercept(actor, rollData, targetToken?.object);
    if (field?.blocked) {
        await _announceForceField(actor, field);
        await message.setFlag("dark-heresy", "appliedDamage", {forceField: field.name, blocked: true});
        return;
    }

    const damages = _damageEntriesFromRoll(rollData);
    if (!damages.length || damages.some(d => !Number.isFinite(d.amount) || d.amount < 0
        || !Number.isFinite(d.penetration) || d.penetration < 0)) return;
    return _queueDocumentOperation(actor.uuid, async () => {
        const operation = message.getFlag("dark-heresy", "damageOperation");
        if (operation || message.getFlag("dark-heresy", "appliedDamage")) return operation;
        // Persist intent before changing an Actor. Interrupted/partial execution is never replayed blindly.
        const requestId = message.id + ":" + payload.sceneId + ":" + payload.tokenId;
        const before = _damageSnapshot(actor);
        const preview = actor.previewDamage(damages);
        await message.setFlag("dark-heresy", "damageOperation", {requestId, status: "processing", before});
        actor._damageSourceMessageId = message.id;
        actor._suppressCritChat = true;
        try {
            await actor.applyDamage(damages);
            const after = _damageSnapshot(actor);
            const applied = {actorUuid: actor.uuid, tokenId: payload.tokenId, sceneId: payload.sceneId,
                woundsDelta: after.wounds - before.wounds, criticalDelta: after.critical - before.critical,
                woundsBefore: before.wounds, woundsAfter: after.wounds,
                criticalBefore: before.critical, criticalAfter: after.critical,
                hordeBefore: before.horde, hordeAfter: after.horde};
            await message.setFlag("dark-heresy", "appliedDamage", applied);
            await message.setFlag("dark-heresy", "damageOperation", {requestId, status: "applied", before, after});
            _recordAppliedDamage(rollData, preview, before, after);
            await message.setFlag("dark-heresy", "rollData", rollData);
            rollData.rfLabel = _righteousFuryLabel(rollData);
            const content = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/damage.hbs", rollData);
            await message.update({content});
            return applied;
        } catch (error) {
            const completed = message.getFlag("dark-heresy", "appliedDamage");
            await message.setFlag("dark-heresy", "damageOperation", {requestId,
                status: completed ? "applied" : "needsReview", before, error: String(error.message || error)});
            throw error;
        } finally {
            delete actor._damageSourceMessageId;
            delete actor._suppressCritChat;
        }
    });
}

/**
 * Чьё очко Судьбы тратится на этот бросок.
 *
 * Карточку уклонения создаёт атакующий, а уклоняется цель, поэтому владелец
 * карточки и владелец очка — разные люди. Списывать Судьбу у атакующего за
 * чужой переброс нельзя, и до сих пор списывалась именно она.
 *
 * @param {object} rollData
 * @returns {Actor|null}
 */
function _fateActorFor(rollData) {
    const ownerId = fateOwnerId(rollData);
    if (!ownerId) return null;
    if (ownerId === rollData?.ownerId) return _actorFromRollData(rollData);
    return game.actors.get(ownerId) ?? null;
}

/**
 * Rerolls the Test using the same Data as the initial Roll while reducing an actors fate
 * @param {object} rollData
 * @returns {Promise}
 */
function rerollTest(rollData) {
    let actor = _fateActorFor(rollData);
    if (!actor) return;
    actor.update({ "system.fate.value": actor.fate.value -1 });
    delete rollData.damages; // Reset so no old data is shown on failure

    rollData.flags.isReRoll = true;
    if (rollData.flags.isCombatRoll) {
    // All the regexes in this are broken once retrieved from the chatmessage
    // No idea why this happens so we need to fetch them again so the roll works correctly
        rollData.attributeBoni = actor.attributeBoni;
        return combatRoll(rollData);
    } else {
        return commonRoll(rollData);
    }
}

/**
 * Rolls a Test for the Selected Actor
 * @param {Event} ev
 */
function onTestClick(ev) {
    let id = $(ev.currentTarget).parents(".message").attr("data-message-id");
    let msg = game.messages.get(id);
    let rollData = msg.getRollData();
    if (rollData?.flags?.isAttack && rollData?.flags?.isSuccess === false) return;
    rollData.sourceMessageId = id;
    const currentTargets = DarkHeresyUtil.getCurrentTargets();
    const fallbackTargets = Array.isArray(rollData?.targets) ? rollData.targets : [];
    if (game.user.isGM && currentTargets.length > 1) {
        rollData.targets = currentTargets;
        rollData.massEvasionResults = [];
        rollData.massEvasion = rollData.massEvasion || { selected: "dodge", modifier: 0 };
        rollData.massEvasion.modifier = Number(rollData.evasionModifier) || 0;
        return prepareMassEvasionRoll(rollData);
    }
    // For non-GM players: always use their own actor unless they have permission for target
    // This way players don't need to think about targeting - it just works
    let actor = game.macro.getActor(); // Default to player's own actor
    
    // Only use target if:
    // 1. Target exists and is valid
    // 2. User is GM OR user owns the target actor
    // Silently fall back to player's actor if no permission (no warnings)
    const targets = currentTargets.length ? currentTargets : fallbackTargets;
    const target = targets.length ? targets[0] : null;
    
    if (target && canvas?.ready) {
        // Silently check if target is in current scene (no warning if different scene)
        const isSameScene = !target.sceneId || canvas.scene?.id === target.sceneId;
        if (isSameScene) {
            try {
                const targetActor = canvas.tokens.get(target.tokenId)?.actor || null;
                // Only use target actor if user has permission (GM or owner)
                // If no permission, silently use player's actor instead
                if (targetActor && (game.user.isGM || targetActor.isOwner)) {
                    actor = targetActor;
                    rollData.targets = [target];
                }
            } catch (e) {
                // Silently ignore any errors (e.g., permission issues) and use player's actor
            }
        }
    }
    
    // If no valid target was found, clear targets so it uses player's actor
    // (rollData.targets is only set if we successfully used a target)
    if (!rollData.targets) {
        rollData.targets = undefined;
    }

    if (!actor) {
        ui.notifications.warn(`${game.i18n.localize("NOTIFICATION.MACRO_ACTOR_NOT_FOUND")}`);
        return;
    }
    // Машины не Уклоняются: у них своя реакция — Вираж, и бросает её оператор
    // своим Управлением. Парировать умеют только шагоходы, да и то руками,
    // поэтому пункт остаётся, но выбором по умолчанию не становится.
    if (actor.type === "vehicle") {
        // Вираж — это манёвр: развалина и застрявшая машина увернуться не могут
        // ни при каком броске, и предлагать его бессмысленно.
        if (!actor.system.can?.swerve) {
            ui.notifications.warn(game.i18n.localize(actor.system.conditions?.wrecked
                ? "VEHICLE.NO_SWERVE_WRECKED" : "VEHICLE.NO_SWERVE_IMMOBILE"));
            return;
        }
        const operator = game.actors.get(actor.system.operatorId);
        if (!operator) {
            ui.notifications.warn(game.i18n.localize("VEHICLE.NO_OPERATOR"));
            return;
        }
        const swerve = DarkHeresyUtil.createSkillRollData(operator, "operate");
        rollData.evasions = {
            dodge: swerve,
            parry: actor.system.vehicleType === "walker"
                ? DarkHeresyUtil.createSkillRollData(operator, "parry")
                : swerve,
            selected: "dodge"
        };
        rollData.evasionsAreVehicle = true;
        // Вираж катится со штрафом, равным Размеру машины, и со всеми обычными
        // поправками к Управлению: Маневренностью, шасси и повреждениями.
        rollData.target.modifier = (Number(rollData.evasionModifier) || 0)
            - (Number(actor.system.size) || 0)
            + (Number(actor.system.operateModifier) || 0);
        rollData.flags.isEvasion = true;
        rollData.flags.isAttack = false;
        rollData.flags.isDamageRoll = false;
        rollData.flags.isCombatRoll = false;
        return prepareCommonRoll(rollData, operator);
    }
    // Парирование у Rogue Trader — не навык, а проверка Владения оружием: в
    // Таблице 3-1 (стр. 76) такого навыка нет вовсе. Без этой развилки лист
    // исследователя парировал бы спрятанным навыком, необученным и оттого
    // вполовину характеристики, — то есть заметно хуже, чем велит книга.
    const parryIsSkill = !(Dh.rulesetFor(actor).skills?.absent ?? []).includes("parry");
    let evasions = {
        dodge: DarkHeresyUtil.createSkillRollData(actor, "dodge"),
        parry: parryIsSkill
            ? DarkHeresyUtil.createSkillRollData(actor, "parry")
            : DarkHeresyUtil.createCharacteristicRollData(actor, "weaponSkill"),
        deny: DarkHeresyUtil.createCharacteristicRollData(actor, "willpower"),
        willpower: DarkHeresyUtil.createCharacteristicRollData(actor, "willpower"),
        toughness: DarkHeresyUtil.createCharacteristicRollData(actor, "toughness"),
        agility: DarkHeresyUtil.createCharacteristicRollData(actor, "agility"),
        strength: DarkHeresyUtil.createCharacteristicRollData(actor, "strength"),
        selected: "dodge"
    };
    rollData.evasions = evasions;
    rollData.target.modifier = (Number(rollData.evasionModifier) || 0)
        + _burningCrewModifier(actor);
    rollData.flags.isEvasion = true;
    rollData.flags.isAttack = false;
    rollData.flags.isDamageRoll = false;
    rollData.flags.isCombatRoll = false;
    if (rollData.psy) rollData.psy.display = false;
    rollData.evasionActor = actor.name;
    // Set token and scene IDs from target if available, otherwise from actor's token
    const targetTokenId = rollData?.targets?.[0]?.tokenId;
    const targetSceneId = rollData?.targets?.[0]?.sceneId;
    
    if (targetTokenId) {
        rollData.evasionActorTokenId = targetTokenId;
    } else if (actor?.token?.id) {
        rollData.evasionActorTokenId = actor.token.id;
    }
    
    if (targetSceneId) {
        rollData.evasionActorSceneId = targetSceneId;
    } else if (actor?.token?.scene?.id) {
        rollData.evasionActorSceneId = actor.token.scene.id;
    }
    rollData.name = `${game.i18n.localize("DIALOG.EVASION")}: ${actor.name}`;
    prepareCommonRoll(rollData);
}

async function onSuppressionClick(ev) {
    let id = $(ev.currentTarget).parents(".message").attr("data-message-id");
    let msg = game.messages.get(id);
    let attackRollData = msg.getRollData();
    const currentTargets = DarkHeresyUtil.getCurrentTargets();
    let actor = null;
    if (currentTargets.length) {
        const target = currentTargets[0];
        if (!target.sceneId || canvas.scene?.id === target.sceneId) {
            actor = canvas.tokens.get(target.tokenId)?.actor || null;
        }
    }
    if (!actor) {
        actor = game.macro.getActor();
    }
    if (!actor) {
        ui.notifications.warn(`${game.i18n.localize("NOTIFICATION.MACRO_ACTOR_NOT_FOUND")}`);
            return;
        }

    let rollData = DarkHeresyUtil.createFearTestRolldata(actor);
    rollData.target.modifier = "";
    if (attackRollData.suppressionLength === "full") {
        rollData.suppressionModifier = -20;
    } else {
        rollData.suppressionModifier = -10;
    }
    rollData.name = game.i18n.localize("SUPPRESSION.HEADER");
    rollData.flags = {
        isAttack: false,
        isDamageRoll: false,
        isCombatRoll: false,
        isSuppressionTest: true
    };

    const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/dialog/common-roll.hbs", rollData);
    let dialog = dhDialog({
        title: game.i18n.localize("SUPPRESSION.HEADER"),
        content: html,
        buttons: {
            roll: {
                icon: '<i class="fas fa-check"></i>',
                label: game.i18n.localize("BUTTON.ROLL"),
                callback: async html => {
                    const baseModifier = parseInt(html.find("#modifier")[0]?.value, 10) || 0;
                    const suppressionModifier = Number(rollData.suppressionModifier) || 0;
                    rollData.target.modifier = baseModifier + suppressionModifier;
                    await _computeCommonTarget(rollData);
                    await _rollTarget(rollData);
                    rollData.target.modifier = baseModifier;
                    if (!rollData.flags.isSuccess) {
                        await applySuppressionPinning(actor);
                    }
                    await _sendSuppressionToChat(rollData, actor.name);
}
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: game.i18n.localize("BUTTON.CANCEL"),
                callback: () => {}
            }
        },
        default: "roll",
        close: () => {},
        render: html => {
            const sel = html.find("select[name=characteristic");
            const target = html.find("#target");
            sel.change(() => {
                target.val(sel.val());
            });
        }
    }, { width: 200 });
    dialog.render(true);
}

/**
 * Придавить цель, провалившую проверку при подавляющем огне.
 *
 * DH2, стр. 225: «All targets within the kill zone must make a Difficult (−10)
 * Pinning test or become Pinned as per page 230.» Стр. 231 уточняет, что
 * Придавленность — это проверка Силы Воли, и провал даёт именно её.
 *
 * Раньше здесь вешался Страх. Модификаторы (−10 за очередь, −20 за полную) были
 * верны с самого начала — неверным было само состояние, а Страх в этих правилах
 * не участвует вовсе и тянет за собой чужие последствия.
 *
 * @param {Actor} actor цель в зоне обстрела
 */
async function applySuppressionPinning(actor) {
    if (!actor.getActiveTokens().length) {
        ui.notifications.warn(game.i18n.localize("SUPPRESSION.NO_TOKEN_FOUND"));
        return;
    }
    // Ставим состояние, а не переключаем: переключатель снял бы Придавленность
    // с того, кого прижали предыдущей очередью.
    if (actor.hasCondition("pinned")) return;
    await actor.addCondition("pinned", { type: "minor" });
    ui.notifications.info(`${actor.name} ${game.i18n.localize("SUPPRESSION.PINNED_ADDED")}`);
}

async function _sendSuppressionToChat(rollData, targetName) {
    let speaker = ChatMessage.getSpeaker();
    let chatData = {
        user: game.user.id,
        rollMode: game.settings.get("core", "rollMode"),
        speaker: speaker,
        flags: {
            "dark-heresy.rollData": rollData
        }
    };
    if (rollData.rollObject) {
        rollData.render = await rollData.rollObject.render();
        chatData.rolls = [rollData.rollObject];
}
    const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/suppression.hbs", {
        ...rollData,
        targetName: targetName,
        hasFear: !rollData.flags.isSuccess
    });
    chatData.content = html;
    if (["gmroll", "blindroll"].includes(chatData.rollMode)) {
        chatData.whisper = ChatMessage.getWhisperRecipients("GM");
    } else if (chatData.rollMode === "selfroll") {
        chatData.whisper = [game.user];
    }
    ChatMessage.create(chatData);
}

async function prepareMassEvasionRoll(rollData) {
    if (!game.user.isGM) return;
    rollData.massEvasion = rollData.massEvasion || { selected: "dodge", modifier: 0 };
    const options = [
        { value: "dodge", label: "SKILL.DODGE" },
        { value: "parry", label: "SKILL.PARRY" },
        { value: "deny", label: "DIALOG.DENY_THE_WITCH" },
        { value: "toughness", label: "CHARACTERISTIC.TOUGHNESS" },
        { value: "willpower", label: "CHARACTERISTIC.WILLPOWER" },
        { value: "strength", label: "CHARACTERISTIC.STRENGTH" },
        { value: "agility", label: "CHARACTERISTIC.AGILITY" }
    ];
    const selectOptions = options
        .map(opt => {
            const label = game.i18n.localize(opt.label);
            const selected = opt.value === rollData.massEvasion.selected ? "selected" : "";
            return `<option value="${opt.value}" ${selected}>${label}</option>`;
        })
        .join("");
    const content = `
        <div class="dh-dialog">
            <div class="dh-dialog-row">
                <label for="massEvasion">${game.i18n.localize("CHAT.DEFENSE")}</label>
                <select id="massEvasion">${selectOptions}</select>
            </div>
        </div>
    `;
    const dialog = dhDialog({
        title: game.i18n.localize("CHAT.MASS_EVASION_RESULTS"),
        content,
        buttons: {
            roll: {
                icon: '<i class="fas fa-check"></i>',
                label: game.i18n.localize("BUTTON.ROLL"),
                callback: async dlgHtml => {
                    rollData.massEvasion.selected = dlgHtml.find("#massEvasion")[0]?.value || "dodge";
                    await massEvasionRoll(rollData);
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: game.i18n.localize("BUTTON.CANCEL"),
                callback: () => {}
            }
        },
        default: "roll"
    }, { width: 260 });
    dialog.render(true);
}

async function massEvasionRoll(rollData) {
    if (!game.user.isGM) return;
    let targets = Array.isArray(rollData.targets) ? rollData.targets : [];
    if (!targets.length || !canvas?.ready) return;
    const selected = rollData.massEvasion?.selected || "dodge";
    const modifier = Number(rollData.massEvasion?.modifier) || 0;
    const results = [];
    const selectedValues = [];

    for (const target of targets) {
        if (target.sceneId && canvas.scene?.id !== target.sceneId) continue;
        const token = canvas.tokens.get(target.tokenId);
        const actor = token?.actor;
        if (!actor) continue;

        let perRollData;
        if (selected === "dodge" || selected === "parry") {
            if (!actor.skills?.[selected]) {
                results.push({ target, error: true });
                continue;
            }
            perRollData = DarkHeresyUtil.createSkillRollData(actor, selected);
            const skillTotal = actor.skills?.[selected]?.total;
            if (Number.isFinite(skillTotal)) selectedValues.push(skillTotal);
        } else if (selected === "willpower" || selected === "toughness" || selected === "strength" || selected === "agility") {
            if (!actor.characteristics?.[selected]) {
                results.push({ target, error: true });
                continue;
            }
            perRollData = DarkHeresyUtil.createCharacteristicRollData(actor, selected);
            const charTotal = actor.characteristics?.[selected]?.total;
            if (Number.isFinite(charTotal)) selectedValues.push(charTotal);
        } else if (selected === "deny") {
            if (!actor.characteristics?.willpower) {
                results.push({ target, error: true });
                continue;
            }
            perRollData = DarkHeresyUtil.createCharacteristicRollData(actor, "willpower");
            const charTotal = actor.characteristics?.willpower?.total;
            if (Number.isFinite(charTotal)) selectedValues.push(charTotal);
        } else {
            if (!actor.skills?.dodge) {
                results.push({ target, error: true });
                continue;
            }
            perRollData = DarkHeresyUtil.createSkillRollData(actor, "dodge");
            const skillTotal = actor.skills?.dodge?.total;
            if (Number.isFinite(skillTotal)) selectedValues.push(skillTotal);
        }

        perRollData.target.modifier = modifier;
        await _computeCommonTarget(perRollData);
        await _rollTarget(perRollData);

        results.push({
            target,
            result: perRollData.result,
            isSuccess: perRollData.flags.isSuccess,
            dos: perRollData.dos || 0,
            dof: perRollData.dof || 0,
            targetBase: perRollData.target.base,
            targetModifier: perRollData.target.modifier,
            targetFinal: perRollData.target.final
        });
    }

    rollData.massEvasionResults = results;
    rollData.flags.isEvasion = true;
    rollData.flags.isMassEvasion = true;
    const evasionKey = {
        dodge: "SKILL.DODGE",
        parry: "SKILL.PARRY",
        deny: "DIALOG.DENY_THE_WITCH",
        toughness: "CHARACTERISTIC.TOUGHNESS",
        willpower: "CHARACTERISTIC.WILLPOWER",
        strength: "CHARACTERISTIC.STRENGTH",
        agility: "CHARACTERISTIC.AGILITY"
    }[selected] || selected;
    rollData.massEvasionLabel = game.i18n.localize(evasionKey);
    rollData.massEvasionModifier = modifier;
    rollData.name = game.i18n.localize("CHAT.MASS_EVASION_RESULTS");

    await sendMassEvasionToChat(rollData);
}

async function sendMassEvasionToChat(rollData) {
    let speaker = ChatMessage.getSpeaker();
    let chatData = {
        user: game.user.id,
        rollMode: game.settings.get("core", "rollMode"),
        speaker: speaker,
        flags: {
            "dark-heresy.rollData": rollData
        }
    };
    if (speaker.token) {
        rollData.tokenId = speaker.token;
    }
    const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/evasion-mass.hbs", rollData);
    chatData.content = html;
    if (["gmroll", "blindroll"].includes(chatData.rollMode)) {
        chatData.whisper = ChatMessage.getWhisperRecipients("GM");
    } else if (chatData.rollMode === "selfroll") {
        chatData.whisper = [game.user];
    }
    ChatMessage.create(chatData);
}

async function sendMassDamageToChat(rollData) {
    let speaker = ChatMessage.getSpeaker();
    // canRevert is now checked dynamically in renderChatMessage hook based on current user
    let chatData = {
        user: game.user.id,
        rollMode: game.settings.get("core", "rollMode"),
        speaker: speaker,
        flags: {
            "dark-heresy.rollData": rollData
        }
    };
    if (speaker.token) {
        rollData.tokenId = speaker.token;
    }
    
    // Normalize damage type like in sendDamageToChat
    // Get actor from token on canvas if available, otherwise from collection
    const actor = rollData.ownerId ? _getActorFromTokenOrCollection(rollData.ownerId, rollData.tokenId) : null;
    const item = actor?.items?.get(rollData.itemId);
    if (!rollData.weapon) rollData.weapon = {};
    if (!rollData.weapon.damageType || rollData.weapon.damageType === "none") {
        const fallbackType = item?.damageType
            || item?.system?.damageType
            || item?.system?.damage?.type;
        rollData.weapon.damageType = _normalizeDamageType(fallbackType);
    } else {
        rollData.weapon.damageType = _normalizeDamageType(rollData.weapon.damageType);
    }
    
    chatData.rolls = rollData.multiDamages
        .flatMap(entry => entry.damages || [])
        .flatMap(r => r.damageRoll || []);
    rollData.rfLabel = _righteousFuryLabel(rollData);
    const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/damage-mass.hbs", rollData);
    chatData.content = html;
    if (["gmroll", "blindroll"].includes(chatData.rollMode)) {
        chatData.whisper = ChatMessage.getWhisperRecipients("GM");
    } else if (chatData.rollMode === "selfroll") {
        chatData.whisper = [game.user];
    }
    return ChatMessage.create(chatData);
}

async function applyBlastFromMassEvasion(message) {
    if (!game.user.isGM || !message) return;
    const rollData = message.getRollData?.();
    const results = Array.isArray(rollData?.massEvasionResults) ? rollData.massEvasionResults : [];
    if (!results.length || !canvas?.ready) return;
    const failed = results.filter(result => !result.isSuccess && result.target?.tokenId);
    if (!failed.length) {
        ui.notifications.info(game.i18n.localize("CHAT.NO_DAMAGE") || "No damage.");
        return;
                    }

    const hordeBonusDice = _getHordeDamageBonusDiceFromActor(_actorFromRollData(rollData));
    const blastRollData = {
                        ownerId: rollData.ownerId,
                        itemId: rollData.itemId,
                        weapon: rollData.weapon,
                        attackDos: rollData.attackDos,
                        aim: rollData.aim,
                        attackResult: rollData.attackResult,
        hordeDamageBonusDice: hordeBonusDice,
        hordeBonusApplied: hordeBonusDice > 0,
        multiDamages: [],
        massDamageModeLabel: game.i18n.localize("MASS_DAMAGE_MODE.BLAST")
    };

    const appliedEntries = [];
    for (const entry of failed) {
        const target = entry.target;
        if (target.sceneId && canvas.scene?.id !== target.sceneId) continue;
        const token = canvas.tokens.get(target.tokenId);
        if (!token?.actor) continue;

        const perTargetRollData = {
            ownerId: blastRollData.ownerId,
            weapon: blastRollData.weapon,
            attackDos: blastRollData.attackDos,
            aim: blastRollData.aim,
            numberOfHits: 1,
            attackResult: blastRollData.attackResult,
            hordeDamageBonusDice: blastRollData.hordeDamageBonusDice,
            hordeBonusApplied: blastRollData.hordeBonusApplied
        };
        await _rollDamage(perTargetRollData);

        // Check if damages were generated
        if (!perTargetRollData.damages || !perTargetRollData.damages.length) {
            console.warn("Dark Heresy: No damages generated for blast target", target);
            continue;
        }

        const damages = (perTargetRollData.damages || []).map(damage => ({
            amount: Number(damage.total) || 0,
            location: damage.location,
            penetration: Number(damage.penetration) || 0,
            type: blastRollData.weapon?.damageType,
            righteousFury: damage.righteousFury,
            attackDos: blastRollData.attackDos,
            weaponClass: blastRollData.weapon?.weaponClass,
            weaponType: blastRollData.weapon?.weaponType,
            weaponTraits: blastRollData.weapon?.traits || {}, // Pass weapon traits for trait-based checks
            devastating: blastRollData.weapon?.traits?.devastating // Pass devastating value for horde reduction
        }));
        const preview = token.actor.previewDamage(damages);

        const before = _damageSnapshot(token.actor);
        token.actor._suppressCritChat = true;
        try {
            await token.actor.applyDamage(damages);
        } finally {
            token.actor._suppressCritChat = false;
        }
        const after = _damageSnapshot(token.actor);

        const appliedDetails = (preview.damageTaken || []).map(detail => ({
            ...detail,
            armour: token.actor._getArmourTotal(detail.location)
        }));

        const entry = {
            target,
            numberOfHits: 1,
            damages: perTargetRollData.damages
        };
        _recordAppliedDamage(entry, { damageTaken: appliedDetails }, before, after);
        blastRollData.multiDamages.push(entry);

        appliedEntries.push({
            tokenId: target.tokenId,
            sceneId: target.sceneId,
            woundsDelta: after.wounds - before.wounds,
            criticalDelta: after.critical - before.critical,
            woundsBefore: before.wounds,
            woundsAfter: after.wounds,
            criticalBefore: before.critical,
            criticalAfter: after.critical,
            hordeBefore: before.horde,
            hordeAfter: after.horde
        });
    }

    if (!blastRollData.multiDamages.length) return;
    const damageMessage = await sendMassDamageToChat(blastRollData);
    if (appliedEntries.length) {
        await damageMessage.setFlag("dark-heresy", "appliedDamage", appliedEntries);
    }
}

/**
 * Rolls an Evasion chat for the currently selected character from the chatcard
 * @param {Event} ev
 * @returns {Promise}
 */
function onDamageClick(ev) {
    let id = $(ev.currentTarget).parents(".message").attr("data-message-id");
    let msg = game.messages.get(id);
    let rollData = msg.getRollData();
    if (rollData?.flags?.isEvasion && rollData?.flags?.isSuccess) {
        const hits = Number(rollData?.numberOfHits) || 0;
        if (hits <= 0) return;
    }
    if (rollData?.flags?.isAttack && rollData?.flags?.isSuccess === false) return;
    rollData.sourceMessageId = id;
    if (rollData?.flags?.isEvasion) {
        const manualCountTypes = new Set(["semi_auto", "full_auto", "barrage", "storm", "lightning", "swift"]);
        const isManualCountMode = manualCountTypes.has(rollData?.attackType?.name);
        const hits = Number(rollData?.numberOfHits) || 0;
        if (!isManualCountMode && hits <= 0) {
            ui.notifications.warn(game.i18n.localize("CHAT.NO_DAMAGE") || "No damage.");
                        return;
                    }
    }
    if (_isHordeTarget(rollData)) {
        const target = _getCurrentTargetForDamage(rollData);
        if (target) {
            rollData.targets = [target];
                }
        rollData.flags.isEvasion = false;
        rollData.flags.isCombatRoll = false;
        rollData.flags.isDamageRoll = true;
        return damageRoll(rollData);
        }
    rollData.flags.isEvasion = false;
    rollData.flags.isCombatRoll = false;
    rollData.flags.isDamageRoll = true;
    return damageRoll(rollData);
}


function _isHordeTarget(rollData) {
        const target = _getCurrentTargetForDamage(rollData);
    if (!target || !canvas?.ready) return false;
    if (target.sceneId && canvas.scene?.id !== target.sceneId) return false;
    const token = canvas.tokens.get(target.tokenId);
    // Use getter to get horde value from token actor (actual instance on canvas)
    const hordeValue = Number(token?.actor?.horde) || 0;
    return hordeValue > 0;
}

function _getCurrentTargetForDamage(rollData) {
    const currentTargets = DarkHeresyUtil.getCurrentTargets();
    if (currentTargets.length) return currentTargets[0];
    const targets = Array.isArray(rollData?.targets) ? rollData.targets : [];
    return targets[0] || null;
}



/**
 * Show/hide dice rolls when a chat message is clicked.
 * @param {Event} event
 */
function onChatRollClick(event) {
    event.preventDefault();
    let roll = $(event.currentTarget.parentElement);
    let tip = roll.find(".dice-rolls");
    if ( !tip.is(":visible") ) tip.slideDown(200);
    else tip.slideUp(200);
}

function onDamageCardClick(event) {
    event.preventDefault();
    let card = $(event.currentTarget.closest(".damage-card"));
    let tip = card.find(".dice-rolls");
    if ( !tip.is(":visible") ) tip.slideDown(200);
    else tip.slideUp(200);
}

/**
 * Снять счётчики здоровья цели до и после урона.
 *
 * У машины нет ран: её раны — это целостность, а Критический Урон живёт в
 * отдельном поле. Карточки урона и сокет считают дельту одинаково для всех,
 * поэтому разница в схеме прячется здесь, а не в шести местах вызова.
 * @param {Actor} actor
 * @returns {{wounds: number, critical: number}}
 */
function _damageSnapshot(actor) {
    if (actor?.type === "vehicle") {
        const integrity = actor.system.integrity ?? {};
        return { wounds: Number(integrity.value) || 0, critical: Number(integrity.critical) || 0 };
    }
    // Величина нужна снимку наравне с ранами: у орды убыло именно её, и карточка
    // считает потери по разнице до и после.
    return { wounds: actor.wounds.value, critical: actor.wounds.critical, horde: Number(actor.horde) || 0 };
}

/**
 * Записать в rollData то, что на самом деле убыло у цели.
 *
 * Орда теряет величину и не получает ни ран, ни критов, поэтому разбор урона по
 * локациям для неё пуст — иначе карточка рассказывала бы про раны, которых никто
 * не получал, и умалчивала о единственном случившемся.
 * @param {object} rollData
 * @param {object} preview
 * @param {object} before
 * @param {object} after
 */
function _recordAppliedDamage(rollData, preview, before, after) {
    if (before.horde > 0) {
        rollData.appliedDetails = [];
        delete rollData.applied;
        rollData.appliedHorde = {
            before: before.horde,
            after: after.horde,
            kills: before.horde - after.horde
        };
        return;
    }
    delete rollData.appliedHorde;
    rollData.appliedDetails = preview.damageTaken || [];
    rollData.applied = { wounds: after.wounds, critical: after.critical };
}

function _showWoundsFloat(actor, delta, options = {}) {
    if (!canvas?.ready) return;
    if (!Number.isFinite(delta) || delta === 0) return;
    const tokens = actor?.getActiveTokens?.(true) || [];
    if (!tokens.length) return;
    const effectiveDelta = options.invert ? -delta : delta;
    const isDamage = effectiveDelta > 0;
    const amount = Math.abs(effectiveDelta);
    let text = isDamage ? `-${amount}` : `+${amount}`;
    let color = isDamage ? 0xe74c3c : 0x2ecc71;
    let fontSize = 28;
    let duration = 2500;
    let strokeThickness = 4;
    if (options.effect === "regen") {
        text = `+${amount} REGEN`;
        color = 0x00ffb0;
        fontSize = 36;
        duration = 3200;
        strokeThickness = 6;
    }
    for (const token of tokens) {
        const center = token.center || token.getCenter();
        const distance = token.h || 30;
        canvas.interface?.createScrollingText(center, text, {
            anchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
            direction: CONST.TEXT_ANCHOR_POINTS.TOP,
            distance,
            duration,
            fontSize,
            fill: color,
            stroke: 0x000000,
            strokeThickness
        });
    }
}

function _canManageDamageRevert() {
    return !!(game.user?.isGM || game.user?.role >= CONST.USER_ROLES.ASSISTANT);
}

Hooks.on("preUpdateActor", (actor, changes) => {
    // Огонь потушили — счётчик раундов горения обнуляется вместе с ним: он
    // копит вероятность детонации, и тащить его в следующий пожар нельзя.
    if (actor?.type === "vehicle"
        && foundry.utils.getProperty(changes, "system.conditions.onFire") === false) {
        foundry.utils.setProperty(changes, "system.fire.rounds", 0);
    }
    if (actor?._suppressWoundsFloat) return;
    const hasWounds = foundry.utils.getProperty(changes, "system.wounds.value") !== undefined
        || foundry.utils.getProperty(changes, "system.wounds.critical") !== undefined;
    const hasHorde = foundry.utils.getProperty(changes, "system.horde") !== undefined;
    if (!hasWounds && !hasHorde) return;
    
    // Get actor from token on canvas if available (for actual horde value)
    let tokenActor = actor;
    if (canvas?.ready && actor.id) {
        const tokens = canvas.tokens.placeables.filter(t => t.actor?.id === actor.id);
        if (tokens.length > 0) {
            tokenActor = tokens[0].actor; // Use token actor (actual instance on canvas)
        }
    }
    
    actor._woundsFloatPrev = {
        wounds: Number(tokenActor.system?.wounds?.value) || 0,
        critical: Number(tokenActor.system?.wounds?.critical) || 0,
        horde: Number(tokenActor.horde) || 0 // Use getter to get horde from token if available
    };
});

Hooks.on("updateActor", (actor, changes) => {
    if (actor?._suppressWoundsFloat) return;
    const prev = actor._woundsFloatPrev;
    delete actor._woundsFloatPrev;
    if (!prev) return;
    const hasWounds = foundry.utils.getProperty(changes, "system.wounds.value") !== undefined
        || foundry.utils.getProperty(changes, "system.wounds.critical") !== undefined;
    const hasHorde = foundry.utils.getProperty(changes, "system.horde") !== undefined;
    if (hasWounds) {
        const newTotal = (Number(actor.system?.wounds?.value) || 0) + (Number(actor.system?.wounds?.critical) || 0);
        const oldTotal = (Number(prev.wounds) || 0) + (Number(prev.critical) || 0);
        _showWoundsFloat(actor, newTotal - oldTotal);
    }
    if (hasHorde) {
        // Get actor from token on canvas if available (for actual horde value)
        let tokenActor = actor;
        if (canvas?.ready && actor.id) {
            const tokens = canvas.tokens.placeables.filter(t => t.actor?.id === actor.id);
            if (tokens.length > 0) {
                tokenActor = tokens[0].actor; // Use token actor (actual instance on canvas)
            }
        }
        const newHorde = Number(tokenActor.horde) || 0; // Use getter to get horde from token if available
        const oldHorde = Number(prev.horde) || 0;
        _showWoundsFloat(tokenActor, newHorde - oldHorde, { invert: true });
    }
});

async function onManualDamageUndoClick(event) {
    event.preventDefault();
    if (!_canManageDamageRevert()) return;
    const button = $(event.currentTarget);
    const messageId = button.closest(".message").data("messageId");
    const message = game.messages.get(messageId);
    if (!message) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: {title: game.i18n.localize("CHAT.MANUAL_DAMAGE")},
        classes: ["dark-heresy-dialog"],
        content: `<div class="dh-dialog"><p class="dh-dialog-prose">${game.i18n.localize("CHAT.CONFIRM_REVERT")}</p></div>`
    });
    if (!confirmed) return;

    const applied = message.getFlag("dark-heresy", "appliedDamage");
    if (!applied) {
        ui.notifications.warn(game.i18n.localize("UI.NO_APPLIED_DAMAGE_TO_REVERT"));
        return;
    }
    const entries = Array.isArray(applied) ? applied : [applied];
    let revertedAny = false;

    for (const entry of entries) {
        if (entry.reverted) continue;
        const actor = entry.actorUuid ? await fromUuid(entry.actorUuid)
            : game.scenes.get(entry.sceneId)?.tokens.get(entry.tokenId)?.actor;
        if (!actor) continue;
        const current = _damageSnapshot(actor);
        const expected = Number(entry.hordeBefore) > 0
            ? [[current.horde, entry.hordeAfter]]
            : [[current.wounds, entry.woundsAfter], [current.critical, entry.criticalAfter]];
        if (expected.some(([actual, after]) => !Number.isFinite(Number(after)) || Number(actual) !== Number(after))) {
            ui.notifications.warn(game.i18n.localize("UI.DAMAGE_UNDO_CONFLICT"));
            continue;
        }
        if (actor.type === "vehicle") {
            await actor.update({"system.integrity.value": entry.woundsBefore, "system.integrity.critical": entry.criticalBefore});
            entry.reverted = true;
            revertedAny = true;
            continue;
        }

        // Орде возвращают павших: ран она не получала, и правка ран ей ничего не
        // вернёт. Величина восстанавливается до записанной в снимке.
        const hordeBefore = Number(entry.hordeBefore) || 0;
        if (hordeBefore > 0) {
            const hordeAfter = Number(entry.hordeAfter) || 0;
            actor._suppressWoundsFloat = true;
            try {
                await actor.update({ "system.horde": hordeBefore });
            } finally {
                delete actor._suppressWoundsFloat;
            }
            _showWoundsFloat(actor, hordeBefore - hordeAfter, { invert: true });
            entry.reverted = true;
            revertedAny = true;
            continue;
        }

        const beforeTotal = (Number(actor.wounds.value) || 0) + (Number(actor.wounds.critical) || 0);
        const newWounds = Math.max(actor.wounds.value - (entry.woundsDelta || 0), 0);
        const criticalDelta = Number(entry.criticalDelta) || 0;
        const criticalBefore = Number(entry.criticalBefore);
        const criticalAfter = Number(entry.criticalAfter);
        const hasCritical = Number.isFinite(criticalAfter) && Number.isFinite(criticalBefore)
            ? criticalAfter > criticalBefore
            : criticalDelta > 0;
        const newCritical = hasCritical
            ? (Number.isFinite(criticalBefore) ? criticalBefore : Math.max(actor.wounds.critical - criticalDelta, 0))
            : actor.wounds.critical;
        actor._suppressWoundsFloat = true;
        try {
            await actor.update({
                "system.wounds.value": newWounds,
                "system.wounds.critical": newCritical
            });
        } finally {
            delete actor._suppressWoundsFloat;
        }
        const afterTotal = (Number(newWounds) || 0) + (Number(newCritical) || 0);
        _showWoundsFloat(actor, afterTotal - beforeTotal);
        entry.reverted = true;
        revertedAny = true;
    }

    if (!revertedAny) {
        ui.notifications.warn(game.i18n.localize("UI.NO_APPLIED_DAMAGE_TO_REVERT"));
        return;
    }

    await message.setFlag("dark-heresy", "appliedDamage", Array.isArray(applied) ? entries : entries[0]);

    const rollData = message.getRollData?.();
    const sourceMessageId = rollData?.sourceMessageId;
    if (sourceMessageId) {
        const sourceMessage = game.messages.get(sourceMessageId);
        if (sourceMessage) {
            const sourceRollData = sourceMessage.getRollData?.();
            if (sourceRollData) {
                delete sourceRollData.hitsRemaining;
                await sourceMessage.setFlag("dark-heresy", "rollData", sourceRollData);
            }
        }
    }

    await message.setFlag("dark-heresy", "damageReverted", entries.every(entry => entry.reverted));
}


/**
 * Pan and zoom to a targeted token from the chat message.
 * @param {Event} event
 */
function onChatTargetClick(event) {
    event.preventDefault();
    const target = $(event.currentTarget);
    const tokenId = target.data("tokenId");
    const sceneId = target.data("sceneId");

    if (!canvas?.ready) return;
    if (sceneId && canvas.scene?.id !== sceneId) {
        ui.notifications.warn(game.i18n.localize("NOTIFICATION.TARGET_DIFFERENT_SCENE") || "Target is in another scene.");
        return;
    }

    const token = canvas.tokens.get(tokenId);
    if (!token) return;

    token.control({releaseOthers: true});
    const currentScale = canvas.stage?.scale?.x || 1;
    canvas.animatePan({x: token.center.x, y: token.center.y, scale: currentScale});
}

/* ═══════════════════════════════════════════════════════════════════════════
   АВТОМАТИЗАЦИЯ ПРАВИЛ: КРИТИЧЕСКИЙ УРОН, СМЕРТЬ, УСТАЛОСТЬ, ДЛИТЕЛЬНОСТИ

   Dark Heresy 2e / Black Crusade считают повреждения в два уровня. Пока раны не
   исчерпаны, урон только уменьшает их запас. Как только запас на нуле, весь
   дальнейший урон становится критическим, и каждое его очко даёт эффект по
   таблице — свой для каждого типа урона и попадания в конкретную часть тела.

   Таблица ниже — СЖАТАЯ. Полные таблицы книги — это шесть частей тела на четыре
   типа урона на десять уровней тяжести, и дословно они здесь не воспроизводятся.
   Взяты повторяющиеся механические исходы каждого уровня: усталость, оглушение,
   падение, кровотечение, ослепление, возгорание, потеря сознания и смерть. Ряды
   помечены `text`, чтобы ведущий видел, что именно применилось, и мог заменить
   эффект точной строкой из книги.

   Порог смерти взят по правилу накопленного критического урона: боец погибает,
   когда критический урон достигает двойного бонуса стойкости.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Бонус стойкости.
 *
 * Усталость на характеристики больше не влияет (штраф живёт на проверках), так
 * что здесь достаточно обычного бонуса.
 *
 * @param {Actor} actor
 * @returns {number}
 */
function _toughnessBonus(actor) {
    const t = actor?.characteristics?.toughness;
    if (!t) return 1;
    return Math.max(Math.floor((Number(t.total) || 0) / 10) + (Number(t.unnatural) || 0), 1);
}

/**
 * Постоянный идентификатор документа для состояния.
 *
 * Одно состояние одного вида на актёра — это правило, и надёжнее всего его
 * держит сама база: у эффекта фиксированный _id, выведенный из ключа, поэтому
 * повторное создание того же состояния не проходит вовсе. Это защита от второго
 * источника вообще, а не от гонки внутри одного клиента: дубли приходили с
 * другого подключённого клиента, где тот же хук отрабатывал своей копией.
 *
 * Foundry требует ровно шестнадцать буквенно-цифровых знаков.
 *
 * @param {string} key ключ состояния
 * @returns {string}
 */
function _conditionDocId(key) {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const tail = h.toString(36).padStart(6, "0").slice(0, 6);
    const head = key.replace(/[^a-zA-Z0-9]/g, "").padEnd(10, "0").slice(0, 10);
    return (head + tail).slice(0, 16);
}

/**
 * Оповестить о критическом попадании и проверить смертельный порог.
 *
 * Таблица критических эффектов сюда пока не подключена: ведущий бросает по ней
 * сам, а система только говорит, что бросок нужен, и подсказывает нужный ряд —
 * тип урона, часть тела и накопленный критический урон. Когда таблица появится,
 * подключать её здесь же.
 *
 * Единственное, что применяется автоматически, — гибель по накопленному
 * критическому урону: он смертелен при двойном бонусе стойкости.
 *
 * @param {Actor} actor          кто получил урон
 * @param {object[]} damageTaken записи из applyDamage
 * @returns {Promise<object|null>} данные для карточки, либо null если крита нет
 */
async function applyCriticalRules(actor, damageTaken = []) {
    const crits = damageTaken.filter(d => /Critical/i.test(d.source || ""));
    if (!crits.length) return null;

    const total = Number(actor.wounds.critical) || 0;
    if (total <= 0) return null;

    const last = crits[crits.length - 1];
    const tb = _toughnessBonus(actor);
    const lethal = total >= tb * 2;

    if (lethal) await actor.addCondition("dead", { type: "major" });

    return {
        total,
        type: last.type || "impact",
        location: last.location || "ARMOUR.BODY",
        threshold: tb * 2,
        lethal
    };
}

/**
 * Добавить усталость и привести состояние в соответствие правилам.
 *
 * Предел усталости — бонус стойкости плюс бонус силы воли (его и считает
 * _computeCharacteristics). Пока усталость выше нуля, все проверки идут с −10;
 * стоит ей превысить предел, боец теряет сознание.
 *
 * @param {Actor} actor
 * @param {number} amount сколько уровней добавить (может быть отрицательным)
 */
async function addFatigue(actor, amount) {
    const cur = Number(actor.system.fatigue?.value) || 0;
    const next = Math.max(cur + Number(amount || 0), 0);
    // Синхронизацию состояния не вызываем здесь: она уже висит на изменении актёра.
    // Двойной путь давал гонку, и «без сознания» навешивалось по нескольку раз.
    return actor.update({ "system.fatigue.value": next });
}

/**
 * Сверить бессознательное состояние с усталостью.
 *
 * Превышение предела валит с ног на 10 − бонус стойкости минут. Раунд в системе
 * пять секунд, поэтому длительность переводится в раунды: минута — двенадцать
 * раундов. Для обычного боя это «до конца схватки», чего правило и добивается.
 *
 * @param {Actor} actor
 */
async function syncFatigueState(actor) {
    if (!actor) return;
    const f = actor.system.fatigue || {};
    const value = Number(f.value) || 0;
    const max = Number(f.max) || 0;
    const over = value > max;
    const has = !!actor.hasCondition("unconscious");

    // Счётчик и значок были двумя несвязанными представлениями одного и того же:
    // штрафы всегда считались от system.fatigue.value, а состояние «Утомлён»
    // ставилось только вручную и не значило ничего. Держим их в согласии.
    const fatigued = !!actor.hasCondition("fatigued");
    if (value > 0 && !fatigued) await actor.addCondition("fatigued", { type: "minor" });
    else if (value === 0 && fatigued) await actor.removeCondition("fatigued");

    // Dark Heresy 2 (стр. 233): усталость свыше двойного порога — смерть. В Black
    // Crusade такого правила нет, там персонаж просто лежит.
    if (Dh.rulesetFor(actor).fatigue.deathAtDoubleThreshold && max > 0 && value > max * 2) {
        if (!actor.hasCondition("dead")) {
            await actor.addCondition("dead", { type: "major" });
            await ChatMessage.create({
                content: `<div class="dark-heresy chat roll"><div class="dh-card is-fail">
                    <div class="dh-card-h"><span class="who">${actor.name}</span>
                    <span class="verdict">${game.i18n.localize("COLLAPSE.EXHAUSTED_TO_DEATH")}</span></div>
                    <div class="dh-card-b"><dl class="dh-kv">
                        <dt>${game.i18n.localize("TITLE.FATIGUE")}</dt><dd>${value} / ${max}</dd>
                    </dl></div></div></div>`
            });
        }
        return;
    }

    if (over && !has) {
        const tb = Number(actor.characteristics.toughness.bonus) || 0;
        const minutes = Math.max(10 - tb, 1);
        await actor.addCondition("unconscious", {}, {duration: {value: minutes, units: "minutes"}});
        // Отметка нужна, чтобы при пробуждении откатить усталость до предела
        // (BC, стр. 246). Обморок от крита или иной причины откатывать нечего.
        await actor.setFlag("dark-heresy", "fatigueCollapse", true);
        await ChatMessage.create({
            content: `<div class="dark-heresy chat roll"><div class="dh-card is-fail">
                <div class="dh-card-h"><span class="who">${actor.name}</span>
                <span class="verdict">${game.i18n.localize("COLLAPSE.HEADER")}</span></div>
                <div class="dh-card-b"><dl class="dh-kv">
                    <dt>${game.i18n.localize("TITLE.FATIGUE")}</dt><dd>${value} / ${max}</dd>
                    <dt>${game.i18n.localize("COLLAPSE.DURATION")}</dt><dd>${minutes} ${game.i18n.localize("COLLAPSE.MINUTES")}</dd>
                </dl></div></div></div>`
        });
    } else if (!over && has && actor.getFlag("dark-heresy", "fatigueCollapse")) {
        // Усталость упала до предела — сознание возвращается.
        await actor.removeCondition("unconscious");
        if (actor.getFlag("dark-heresy", "fatigueCollapse")) {
            await actor.unsetFlag("dark-heresy", "fatigueCollapse");
        }
    }
}

/**
 * Прогнать огонь по всем горящим машинам боя — раз в конце раунда.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
async function burnVehicles(combat) {
    if (!combat) return;
    const burning = new Set();
    for (const combatant of combat.combatants) {
        const actor = combatant.actor;
        if (actor?.type === "vehicle" && actor.system.conditions?.onFire && !burning.has(actor.id)) {
            burning.add(actor.id);
            await _burnVehicle(actor);
        }
    }
}

/**
 * Всё, что происходит на смене раунда.
 *
 * Живёт в хуке, а не в nextTurn: раунд крутят и кнопкой «Следующий раунд», и
 * стрелками трекера, и макросами — все они меняют combat.round, но через
 * nextTurn не проходят. Пока это лежало там, кнопка трекера молча пропускала и
 * пожар, и сброс хода, и снятие истёкших состояний.
 *
 * Хук, в отличие от nextTurn, отрабатывает у каждого клиента, поэтому вызывающая
 * сторона обязана выбрать единственного исполнителя — иначе в мире с двумя МИ
 * всё случится дважды.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
async function onCombatRoundAdvanced(combat) {
    await burnVehicles(combat);
    await rollOverVehicleMovement(combat);
}

/**
 * Перенести пройденное за раунд в «прошлый раунд» и обнулить счётчик.
 *
 * По нему считается штраф стрельбе с борта, а он нужен весь следующий раунд,
 * поэтому число переезжает на актёра, а счётчик на фишке начинает с нуля.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
async function rollOverVehicleMovement(combat) {
    const updates = [];
    for (const c of combat.combatants) {
        if (c.actor?.type !== "vehicle" || !c.token) continue;
        const moved = Number(c.token.getFlag("dark-heresy", "movedThisRound")) || 0;
        await c.actor.setFlag("dark-heresy", "movedLastRound", moved);
        if (moved) updates.push({ _id: c.token.id, "flags.dark-heresy.movedThisRound": 0 });
    }
    if (updates.length) await combat.scene?.updateEmbeddedDocuments("Token", updates);
}

/**
 * Один раунд горения.
 *
 * Бросок 1d10 растёт на единицу за каждый раунд, что машина уже горит: рано или
 * поздно огонь доберётся до боекомплекта. На десятке что-то детонирует — восемь
 * очков Критического Урона в корпус, и это, разумеется, достаётся и экипажу.
 * Взрывоопасная машина ловит детонацию и на девятке.
 *
 * Само пламя машину не грызёт: страшна не она, а то, что рванёт внутри.
 * @param {Actor} vehicle
 * @returns {Promise<void>}
 */
async function _burnVehicle(vehicle) {
    const rounds = Number(vehicle.system.fire?.rounds) || 0;
    const roll = await new Roll(`1d10 + ${rounds}`).evaluate();
    const threshold = vehicle.system.explosive ? 9 : 10;
    const detonates = roll.total >= threshold;

    await vehicle.update({ "system.fire.rounds": rounds + 1 });

    const notes = [game.i18n.format("VEHICLE.CHAT.FIRE_ROLL", {
        roll: roll.total, rounds: rounds + 1, threshold
    })];

    if (detonates) {
        // Детонация идёт мимо брони и мимо целостности: рвануло внутри, и книга
        // прямо называет это восемью очками Критического Урона (Табл. 8-32).
        // Что при этом достаётся экипажу, читает МИ по строке таблицы корпуса.
        await vehicle.applyDamage([{
            amount: 8,
            location: "hull",
            zone: "hull",
            facing: "front",
            penetration: 0,
            type: "explosive",
            righteousFury: 0,
            directCritical: true
        }]);
        notes.push(game.i18n.localize(vehicle.system.explosive
            ? "VEHICLE.CHAT.DETONATION_EXPLOSIVE" : "VEHICLE.CHAT.DETONATION"));
    }

    await ChatMessage.create({
        content: `<div class="dark-heresy chat roll"><div class="dh-card ${detonates ? "is-fail" : "is-neutral"}">
            <div class="dh-card-h"><span class="who">${vehicle.name}</span>
            <span class="verdict">${game.i18n.localize("VEHICLE.CONDITION.ON_FIRE")}</span></div>
            <div class="dh-card-b">${notes.map(n => `<p class="dh-note">${n}</p>`).join("")}</div>
            </div></div>`
    });
}

/**
 * Оповестить о критическом попадании.
 *
 * Коротко: сколько крита накоплено, куда попало и каким типом — этого хватает,
 * чтобы найти ряд в таблице и бросить. Никаких перечислений эффектов: их пока
 * применяет ведущий.
 *
 * @param {Actor} actor
 * @param {object} crit результат applyCriticalRules
 */
async function _showCriticalEffectsCard(actor, crit) {
    const loc = game.i18n.localize(crit.location);
    const type = game.i18n.localize(`DAMAGE_TYPE.${String(crit.type).toUpperCase()}`);
    const verdict = game.i18n.localize(crit.lethal ? "CRIT.SLAIN_SHORT" : "CRIT.HEADER");
    const note = crit.lethal
        ? game.i18n.format("CRIT.SLAIN", { crit: crit.total, threshold: crit.threshold })
        : game.i18n.localize("CRIT.ROLL_ON_TABLE");

    await ChatMessage.create({
        content: `<div class="dark-heresy chat roll"><div class="dh-card ${crit.lethal ? "is-fail" : "is-neutral"}">
            <div class="dh-card-h">
                <span class="who">${actor.name}</span>
                <span class="verdict">${verdict}</span>
            </div>
            <div class="dh-card-b">
                <div class="dh-figures">
                    <div class="dh-fig lead"><span class="n">${crit.total}</span>
                        <span class="dh-cap">${game.i18n.localize("WOUND.CRITICAL")}</span></div>
                    <div class="dh-fig"><span class="n dh-word">${loc}</span>
                        <span class="dh-cap">${game.i18n.localize("CHAT.HIT_LOCATION")}</span></div>
                    <div class="dh-fig"><span class="n dh-word">${type}</span>
                        <span class="dh-cap">${game.i18n.localize("CHAT.DAMAGE_TYPE")}</span></div>
                </div>
                <p class="dh-note">${note}</p>
            </div></div></div>`
    });
}

/**
 * Карточка урона по машине.
 *
 * Читается она иначе, чем ранение человека: важны не локация тела, а сторона и
 * зона, и то, сколько урона ушло сверх целостности — именно по нему бросается
 * таблица Критических Эффектов Машин. Строку система читает из компендиума.
 * @param {Actor} actor
 * @param {object[]} damageTaken
 * @param {number} integrity
 * @param {number} critical
 */
async function _showVehicleDamageCard(actor, damageTaken, integrity, critical) {
    const zoneOf = d => game.i18n.localize(Dh.vehicleHitZones[d.location] ?? Dh.vehicleHitZones.hull);
    const facingOf = d => game.i18n.localize(Dh.vehicleFacings[d.facing] ?? Dh.vehicleFacings.front);
    const critHits = damageTaken.filter(d => d.source === "Vehicle Critical");
    const rfHits = damageTaken.filter(d => d.source === "Vehicle Critical Effect (RF)");
    const dealt = damageTaken
        .filter(d => d.source === "Integrity" || d.source === "Vehicle Critical")
        .reduce((sum, d) => sum + (Number(d.damage) || 0), 0);
    const head = damageTaken[0] ?? {};

    // Заметка может нести строку из таблицы критов: сама заметка говорит,
    // откуда взялся номер, текст под ней — что стало с машиной.
    const notes = [];
    const chartRow = (zone, value) => _lookupTableRow(
        Dh.vehicleCriticalCharts[zone] ?? Dh.vehicleCriticalCharts.hull, value);
    // Критический Урон накопительный: читается строка, равная всему урону сверх
    // целостности, по таблице зоны, куда пришёлся удар; всё выше 10 — последняя
    // строка. Нет таблицы в компендиуме — карточка лишь называет номер.
    if (critHits.length) {
        const hit = critHits.at(-1);
        const row = await chartRow(hit.location, critical);
        notes.push({
            text: game.i18n.format(row ? "VEHICLE.CHAT.CRIT_EFFECT" : "VEHICLE.CHAT.CRIT_TAKEN", {
                total: critical,
                zone: zoneOf(hit)
            }),
            effect: row?.text
        });
    }
    // Праведный гнев бросает 1d5 по той же таблице, но с накопленным уроном
    // не складывается.
    if (rfHits.length) {
        const hit = rfHits.at(-1);
        const roll = await new Roll("1d5").evaluate();
        const row = await chartRow(hit.location, roll.total);
        notes.push({
            text: game.i18n.format(row ? "VEHICLE.CHAT.RF_EFFECT" : "VEHICLE.CHAT.RIGHTEOUS_FURY", {
                roll: roll.total,
                zone: zoneOf(hit)
            }),
            effect: row?.text
        });
    }
    if (!dealt && !rfHits.length) notes.push({ text: game.i18n.localize("VEHICLE.CHAT.NO_DAMAGE") });

    const state = game.i18n.localize(Dh.vehicleDamageStates[actor.system.integrity.state]);
    await ChatMessage.create({
        content: `<div class="dark-heresy chat roll"><div class="dh-card ${critHits.length ? "is-fail" : "is-neutral"}">
            <div class="dh-card-h">
                <span class="who">${actor.name}</span>
                <span class="verdict">${state}</span>
            </div>
            <div class="dh-card-b">
                <div class="dh-figures">
                    <div class="dh-fig lead"><span class="n">${dealt}</span>
                        <span class="dh-cap">${game.i18n.localize("VEHICLE.CHAT.DAMAGE")}</span></div>
                    <div class="dh-fig"><span class="n dh-word">${facingOf(head)}</span>
                        <span class="dh-cap">${game.i18n.localize("VEHICLE.FACING_LABEL")}</span></div>
                    <div class="dh-fig"><span class="n dh-word">${zoneOf(head)}</span>
                        <span class="dh-cap">${game.i18n.localize("VEHICLE.ZONE_LABEL")}</span></div>
                    <div class="dh-fig"><span class="n">${integrity}</span>
                        <span class="dh-cap">${game.i18n.localize("VEHICLE.INTEGRITY")}</span></div>
                    ${critical > 0 ? `<div class="dh-fig"><span class="n">${critical}</span>
                        <span class="dh-cap">${game.i18n.localize("VEHICLE.CRITICAL_DAMAGE")}</span></div>` : ""}
                </div>
                ${notes.map(n => `<p class="dh-note">${n.text}</p>${n.effect
                    ? `<p class="vehicle-crit-text">${n.effect}</p>` : ""}`).join("")}
            </div></div></div>`
    });
}

class DhMacroUtil {

    static async createMacro(data, slot)
    {
    // Create item macro if rollable item - weapon, spell, prayer, trait, or skill
        let document = await fromUuid(data.uuid);
        let macro;
        if (document.documentName === "Item") {
            let command = `game.macro.rollAttack("${document.name}", "${document.type}");`;
            macro = game.macros.contents.find(m => (m.name === document.name) && (m.command === command));
            if (!macro) {
                macro = await Macro.create({
                    name: document.name,
                    type: "script",
                    img: document.img,
                    command: command
                }, { displaySheet: false });
            }
        }
        else if (document.documentName === "Actor") {
            macro = await Macro.create({
                name: document.name,
                type: "script",
                img: document.img,
                command: `game.actors.get("${document.id}").sheet.render(true)`
            }, { displaySheet: false });
        }
        if (macro) game.user.assignHotbarMacro(macro, slot);
    }

    static rollAttack(itemName, itemType) {
        let actor = this.getActor();

        if (!actor) return ui.notifications.warn(`${game.i18n.localize("NOTIFICATION.MACRO_ACTOR_NOT_FOUND")}`);

        let item = actor.items.find(i => i.name === itemName && i.type === itemType);

        if (!item) return ui.notifications.warn(`${game.i18n.localize("NOTIFICATION.MACRO_ITEM_NOT_FOUND")} ${itemName}`);

        if (item.isPsychicPower) {
            this.rollPsychicPower(actor, item);
        }
        if (item.isWeapon) {
            this.rollWeapon(actor, item);
        }
    }

    static rollTest(name, type, specialty) {
        let actor = this.getActor();

        if (!actor) return ui.notifications.warn(`${game.i18n.localize("NOTIFICATION.MACRO_ACTOR_NOT_FOUND")}`);

        let rollData;

        if (specialty) {
            rollData = DarkHeresyUtil.createSpecialtyRollData(actor, name, specialty);
        } else if (type === "skill") {
            rollData = DarkHeresyUtil.createSkillRollData(actor, name);
        } else if (name === "fear") {
            rollData = DarkHeresyUtil.createFearTestRolldata(actor);
        } else if (name === "malignancy") {
            // Рудименты — механика Dark Heresy 2; в Black Crusade Порча тратится
            // на порогах Даров, и проверки такой нет.
            if (Dh.rulesetFor(actor).corruption.track !== "malignancy") {
                ui.notifications.info(game.i18n.localize("GIFT.NO_MALIGNANCY"));
                return;
            }
            rollData = DarkHeresyUtil.createMalignancyTestRolldata(actor);
        } else if (name === "trauma") {
            // Травма считается от накопленных очков безумия. У еретика они
            // неизменны, поэтому проверка вырождается и в BC не применяется.
            if (!Dh.rulesetFor(actor).insanity.traumaTest) {
                ui.notifications.info(game.i18n.localize("INSANITY.NO_TRAUMA"));
                return;
            }
            rollData = DarkHeresyUtil.createTraumaTestRolldata(actor);
        } else {
            rollData = DarkHeresyUtil.createCharacteristicRollData(actor, name);
        }
        prepareCommonRoll(rollData);
    }

    static rollPsychicPower(actor, item) {
        let rollData = DarkHeresyUtil.createPsychicRollData(actor, item);
        preparePsychicPowerRoll(rollData);
    }

    static rollWeapon(actor, item) {
        let rollData = DarkHeresyUtil.createWeaponRollData(actor, item);
        prepareCombatRoll(rollData);
    }

    static getActor() {
        const speaker = ChatMessage.getSpeaker();
        let actor;

        if (speaker.token) actor = game.actors.tokens[speaker.token];
        if (!actor) actor = game.actors.get(speaker.actor);

        return actor;
    }
}

let Dh = {};

/**
 * Таблица 8-14: Путь Порчи (Dark Heresy 2e, компендиум «Страх, Сумасшествие и
 * Проклятие» → «Порча»).
 *
 * Проверка на Рудименты делается за каждые полученные 10 ОП — бросок Силы Воли
 * с указанным здесь модификатором; провал даёт Рудимент по Таблице 8-15.
 * Мутация — отдельный трек: за каждые 30 ОП две проверки характеристик на выбор,
 * и повторять одну и ту же характеристику нельзя.
 *
 * На 100+ ОП персонаж Проклят и выбывает из игры, проверок больше нет; модификатор
 * оставлен от предыдущей ступени, чтобы кнопка не выдавала бессмысленный ноль,
 * если МИ всё-таки бросает.
 */
/**
 * Профили правил: чем Dark Heresy 2 отличается от Black Crusade.
 *
 * Система обслуживает обе игры одним кодом, но правила у них расходятся не в
 * мелочах, а в моделях. Усталость: BC даёт плоские −10 за любой её уровень и
 * порог в бонус Стойкости, DH2 — порог из Стойкости и Воли, половинную
 * характеристику вместо штрафа и смерть за двойным порогом. Психика: в BC
 * важен использованный рейтинг (+5 за очко) и уровни Fettered/Unfettered/Push,
 * в DH2 — отклонение от базового рейтинга (±10 за очко), а феномен ловится
 * дублем, при проталкивании же — наоборот, всем, кроме дубля.
 *
 * Поэтому развилки собраны в один профиль, а не рассыпаны тернарниками по коду:
 * добавляя правило, его пишут здесь, и оба листа получают своё.
 */
Dh.rulesets = {
    dh2: {
        id: "dh2",
        label: "RULESET.DH2",
        fatigue: { threshold: "tbwb", penalty: "halveCharacteristic", deathAtDoubleThreshold: true },
        psychic: { ratingBonus: "deviation", phenomena: "dh2", fetteredHalving: false,
                   phenomenaTable: "Psychic Phenomena", perilsTable: "Perils of the Warp" },
        corruption: { track: "malignancy", malignancyEveryCp: 10, mutationEveryCp: 30 },
        insanity: { track: "points", traumaTest: true },
        bloodLoss: { lethal: false, fatiguePerRound: 1, staunch: -10 },
        toxic: { timing: "endOfTurn" },
        // Одно правило, разные имена: DH2 зовёт это Праведной яростью,
        // Black Crusade — Ревностной ненавистью (BC, стр. 245).
        righteousFury: { label: "CHAT.RIGHTEOUS_FURY" }
    },
    bc: {
        id: "bc",
        label: "RULESET.BC",
        fatigue: { threshold: "tb", penalty: "flat10", deathAtDoubleThreshold: false },
        psychic: { ratingBonus: "perPoint", phenomena: "bc", fetteredHalving: true,
                   phenomenaTable: "Psychic Phenomena", perilsTable: "Perils of the Warp" },
        corruption: { track: "gifts" },
        // Еретик Black Crusade считается уже сошедшим с ума и очков безумия не
        // копит (стр. 279): вместо них он со временем набирает Расстройства.
        insanity: { track: "fixed", traumaTest: false },
        bloodLoss: { lethal: true, deathChance: 10, staunch: -10, staunchStrenuous: -30 },
        toxic: { timing: "onHit" },
        righteousFury: { label: "CHAT.ZEALOUS_HATRED" }
    }
};

// Only War has not been audited rule by rule yet, so it inherits the Dark Heresy
// mechanics and differs only in identity. It is registered all the same: a character
// can name its book today, and the audit later changes one profile instead of hunting
// down actor-type checks scattered through the system.
Dh.rulesets.ow = { ...structuredClone(Dh.rulesets.dh2), id: "ow", label: "RULESET.OW" };

/**
 * Rogue Trader. Общая механика та же, что у Dark Heresy, но лист персонажа книги
 * (стр. 398-399) расходится с ним в четырёх местах, и все четыре здесь.
 *
 * Характеристик девять: Влиятельности у Rogue Trader нет, её место занимает
 * Profit Factor — но это ресурс династии, а не характеристика персонажа, и живёт
 * он своим полем со Стартовым, Текущим значением и Невзгодами.
 *
 * Лестница продвижений короче на ступень, и цену задаёт сама характеристика, а не
 * склонности: склонностей в книге нет.
 *
 * Навыки делятся на базовые и продвинутые (стр. 76), и это меняет не список, а
 * то, что делать без обучения (стр. 231).
 */
Dh.rulesets.rt = {
    ...structuredClone(Dh.rulesets.dh2),
    id: "rt",
    label: "RULESET.RT",
    characteristics: { absent: [...RT_ABSENT_CHARACTERISTICS] },
    // Усталость считается по-первому: порог — бонус Стойкости, любой уровень даёт
    // плоские −10 ко всем проверкам, а за порогом не смерть, а беспамятство на
    // 10−TB минут (стр. 252). Dark Heresy 2 делает всё три раза иначе.
    fatigue: { threshold: "tb", penalty: "flat10", deathAtDoubleThreshold: false },
    // Кровопотеря здесь убивает: 10% за раунд, пока её не остановят Медициной
    // на −10, а в движении — на −30 (стр. 261). У аколита она лишь утомляет.
    bloodLoss: { lethal: true, deathChance: 10, staunch: -10, staunchStrenuous: -30 },
    // Токсичное проверяется сразу по попаданию, и штраф растёт от прошедшего
    // урона: −5 за каждое очко, а не −10 за очко рейтинга (стр. 118).
    toxic: { timing: "onHit", penalty: "perDamage", step: -5 },
    resource: { profitFactor: true },
    advances: { tiers: RT_ADVANCE_TIERS.length, costs: RT_CHARACTERISTIC_COSTS, aptitudes: false },
    skills: { model: "basicAdvanced", absent: [...RT_ABSENT_SKILLS] },
    // Праведная ярость у Rogue Trader не даёт крита: она требует второго броска
    // атаки и, при попадании, добавляет кости урона (стр. 245).
    righteousFury: { label: "CHAT.RIGHTEOUS_FURY", mode: EXTRA_DAMAGE },
    // Психика у Rogue Trader — правила первого поколения, а не Dark Heresy 2:
    // рейтинг даёт +5 за каждое использованное очко, Fettered режет рейтинг вдвое
    // с округлением ВВЕРХ и феноменов не знает вовсе, Unfettered ловит их дублем
    // (даже на проваленной проверке), Push — всегда (стр. 158). Проверка с 91 и
    // выше проваливается при любом рейтинге — то же правило, что у Deathwatch.
    psychic: { ratingBonus: "perPoint", phenomena: "bc", fetteredHalving: true,
               focusAutoFail: FOCUS_AUTO_FAIL,
               phenomenaTable: "Psychic Phenomena", perilsTable: "Perils of the Warp" }
};

/**
 * Deathwatch. Своя книга, а не копия Dark Heresy: брат Караула Смерти считается
 * иначе почти во всём, что копится.
 *
 * Психика ближе к Black Crusade — рейтинг даёт +5 за очко, Fettered режет рейтинг
 * вдвое и феноменов не знает вовсе, Unfettered ловит их дублем, Push — всегда
 * (стр. 185-186). Своего здесь два: 91-00 на Сосредоточении проваливается при
 * любом рейтинге, а дубль на Push стоит уровня усталости.
 *
 * Порча не делает с ним ничего до самой сотни: у него Порог Чистоты, а не дорожка
 * Рудиментов (стр. 282). Безумие идёт по таблице 9-8 с Проклятием примарха, и его
 * порог проверки другой, чем в Dark Heresy (стр. 278). Кровопотери он не знает
 * вообще — за него это делает орган Ларрамана (стр. 36).
 */
Dh.rulesets.dw = {
    id: "dw",
    label: "RULESET.DW",
    // Любой уровень усталости — плоские −10, порог в бонус Стойкости, а за порогом
    // не смерть, а беспамятство на 10−TB минут (стр. 251).
    fatigue: { threshold: "tb", penalty: "flat10", deathAtDoubleThreshold: false },
    psychic: { ratingBonus: "perPoint", phenomena: "dw", fetteredHalving: true,
               focusAutoFail: FOCUS_AUTO_FAIL, pushFatigueOnDouble: true,
               unnaturalWillpowerToRating: true,
               // У книги свои таблицы 6-1 и 6-2, и карточка должна называть именно их.
               phenomenaTable: "Psychic Phenomena (Deathwatch)",
               perilsTable: "Perils of the Warp (Deathwatch)" },
    corruption: { track: "purity", purityThreshold: PURITY_THRESHOLD },
    insanity: { track: "points", traumaTest: true, traumaTable: "dw", fearGivesInsanity: false },
    bloodLoss: { lethal: true, deathChance: 10, staunch: -10, staunchStrenuous: -30,
                 spaceMarineImmune: true },
    toxic: { timing: "endOfTurn" },
    righteousFury: { label: "CHAT.RIGHTEOUS_FURY" }
};


// Only War fills the same three sheet fields with a regiment and a speciality.
Dh.rulesets.ow.bioLabels = {homeWorld: "BIO.HOME_WORLD", background: "ORIGIN.STAGE.REGIMENT", role: "ORIGIN.STAGE.SPECIALITY"};

// Only War counts characteristic advances on a four-step ladder, not five (Table 3-14, p. 102).
// Row 0 is the free starting value; columns are [two, one, no matching aptitudes].
Dh.rulesets.ow.characteristicCosts = [[0, 0, 0], [100, 250, 500], [250, 500, 750], [500, 750, 1000], [750, 1000, 2500]];

/**
 * По каким правилам живёт этот актёр.
 *
 * Персонаж называет свою книгу сам (system.ruleset), и это важнее типа листа: тип
 * различает только Dark Heresy и Black Crusade, а книг пять. Персонаж Rogue Trader,
 * Only War или Deathwatch — тоже аколит, и считаться по DH2 только из-за типа листа
 * он не должен. Пустое значение означает «как решит тип листа».
 * У НИП и техники своего листа правил нет, они идут за настройкой мира: в кампании
 * по BC вражеский псайкер должен считаться по BC.
 *
 * @param {Actor|object|null} actor
 * @returns {object} профиль из Dh.rulesets
 */
/** Листы персонажа по книгам. Ключ — то же id, что у профиля правил. */
Dh.bookSheets = {
    dh2: DarkHeresy2Sheet,
    ow: OnlyWarSheet,
    bc: BlackCrusadeSheet,
    rt: RogueTraderSheet,
    dw: DeathwatchSheet
};

/**
 * Каким листом открывать этого персонажа.
 *
 * Решает книга, а не тип документа: тип в Foundry не меняется, и требовать «заведите
 * еретика» значило бы пересоздавать персонажа из-за строчки в анкете. Персонаж без
 * книги идёт за своим типом — так лист не меняется у тех, кто заведён раньше.
 *
 * @param {Actor|object|null} actor
 * @returns {string} имя класса листа, как его знает Foundry
 */
Dh.sheetFor = function(actor) {
    const own = actor?.system?.ruleset;
    if (own && Dh.bookSheets[own]) return Dh.bookSheets[own].name;
    return actor?.type === "heretic" ? BlackCrusadeSheet.name : DarkHeresy2Sheet.name;
};

Dh.rulesetFor = function(actor) {
    // Лист называет игру сам — и у персонажа, и у НИП. В смешанной кампании один и тот
    // же тип листа держит и еретика Black Crusade, и тварь из Dark Heresy.
    const own = actor?.system?.ruleset;
    if (own && Dh.rulesets[own]) return Dh.rulesets[own];
    if (actor?.type === "heretic") return Dh.rulesets.bc;
    if (actor?.type === "acolyte") return Dh.rulesets.dh2;
    let world = "dh2";
    try {
        world = game.settings.get("dark-heresy", "ruleset") || "dh2";
    } catch (err) {
        // Настройки ещё не зарегистрированы (ранняя подготовка данных) — берём DH2.
    }
    return Dh.rulesets[world] ?? Dh.rulesets.dh2;
};

/**
 * Путь Порчи Dark Heresy 2 (таблица 8-14, стр. 290).
 *
 * Ступень задаёт штраф к проверке на Рудименты и номер проверки на мутацию.
 * Названия ступеней раньше были взяты из первой редакции — модификаторы совпадали,
 * а подписи шли со сдвигом.
 */
Dh.corruptionPath = [
    { max: 30, degree: "CORRUPTION.DEGREE.TAINTED", malignancyModifier: 0 },
    { max: 60, degree: "CORRUPTION.DEGREE.SOILED", malignancyModifier: -10 },
    { max: 90, degree: "CORRUPTION.DEGREE.DEBASED", malignancyModifier: -20 },
    { max: 99, degree: "CORRUPTION.DEGREE.PROFANE", malignancyModifier: -30 },
    { max: Infinity, degree: "CORRUPTION.DEGREE.DAMNED", malignancyModifier: -30 }
];

/**
 * Пороги Даров Богов в Black Crusade (стр. 289).
 *
 * У Ученика Хаоса и Легионера-предателя они разные: легионер создан крепче и
 * платит реже. Ступеней Порчи и проверок на Рудименты в BC нет вовсе — вместо
 * них на каждом пороге бросают по таблице Даров.
 */
Dh.giftThresholds = {
    disciple: [10, 20, 40, 60, 80],
    legionnaire: [10, 30, 60, 90]
};

/**
 * Ступень Пути Порчи для набранных очков. Ниже нуля не бывает, поэтому всё,
 * что меньше первой границы, попадает в первую ступень.
 * @param {number} corruption
 * @returns {{max: number, degree: string, malignancyModifier: number}}
 */
Dh.getCorruptionStep = function(corruption) {
    const points = Number(corruption) || 0;
    return Dh.corruptionPath.find(step => points <= step.max) ?? Dh.corruptionPath.at(-1);
};

/**
 * Покровители Чёрного Крестового Похода (Black Crusade, стр. 74–75).
 *
 * Персонаж начинает непристроившимся — то есть принадлежащим Хаосу Неделимому,
 * и это не «нет бога», а полноценная строка в таблицах: у Неделимого свои
 * умения, свои таланты и свои отношения с остальной четвёркой.
 */
Dh.chaosPatrons = {
    undivided: "PATRON.UNDIVIDED",
    khorne: "PATRON.KHORNE",
    nurgle: "PATRON.NURGLE",
    slaanesh: "PATRON.SLAANESH",
    tzeentch: "PATRON.TZEENTCH"
};

/**
 * Таблица 9-9: способности, даваемые Тёмной славой (Black Crusade, стр. 309).
 *
 * Уровень открывается накопленной Порчей, а не опытом или рангом: 0–20 — первый,
 * 21–60 — второй, 61–100 — третий. Более слабым уровнем можно пользоваться всегда,
 * поэтому список фильтруется по «не выше моего», а не «ровно мой».
 */
Dh.infamyLevels = [
    { max: 20, level: 1 },
    { max: 60, level: 2 },
    { max: Infinity, level: 3 }
];

/**
 * Уровень способностей Тёмной славы для набранных очков Порчи.
 * @param {number} corruption
 * @returns {number}
 */
Dh.getInfamyLevel = function(corruption) {
    const points = Number(corruption) || 0;
    return (Dh.infamyLevels.find(step => points <= step.max) ?? Dh.infamyLevels.at(-1)).level;
};

/**
 * Способности, которые еретик покупает за очко Тёмной славы.
 *
 * `level` — с какого уровня доступна. `resolves` говорит, доводит ли система дело
 * до конца сама: усталость, лечение, инициативу и оглушение она умеет применить, а
 * «+10 к следующей проверке» или «добавь ступень успеха» — это уговор за столом,
 * и карточка их только объявляет, как это уже сделано с критами.
 */
Dh.infamyAbilities = [
    { id: "fatigue", level: 1, label: "INFAMY.ABILITY.FATIGUE", resolves: true },
    { id: "heal", level: 1, label: "INFAMY.ABILITY.HEAL", resolves: true },
    { id: "bonus", level: 1, label: "INFAMY.ABILITY.BONUS", resolves: false },
    { id: "degree", level: 2, label: "INFAMY.ABILITY.DEGREE", resolves: false },
    { id: "initiative", level: 3, label: "INFAMY.ABILITY.INITIATIVE", resolves: true },
    { id: "stun", level: 3, label: "INFAMY.ABILITY.STUN", resolves: true }
];

/**
 * Таблица 9-10: Тёмная слава и Тёмные боги (Black Crusade, стр. 309).
 *
 * Каждый покровитель одну способность усиливает, а другую отнимает. Переброс
 * проваленной проверки живёт не здесь, а в контекстном меню чата, поэтому Нургл
 * запрещает его там же — здесь он только назван в `deny`.
 */
Dh.infamyPatronRules = {
    undivided: {},
    nurgle: { deny: ["reroll"], healMaximised: true },
    khorne: { healPenalty: 2, grant: [{ id: "autoHit", level: 2, label: "INFAMY.ABILITY.AUTO_HIT", resolves: false }] },
    slaanesh: { deny: ["bonus"], grant: [{ id: "ignoreCrit", level: 2, label: "INFAMY.ABILITY.IGNORE_CRIT", resolves: false }] },
    // У Тзинча ступень успеха открывается на уровень раньше, а со второго
    // уровня их становится 1к5 — это та же строка таблицы, только щедрее.
    tzeentch: { deny: ["stun"], degreeLevel: 1, degreeDiceLevel: 2 }
};

/**
 * Архетипы Чёрного Крестового Похода (Black Crusade, стр. 53–69).
 *
 * Архетип — третий шаг создания: он раздаёт стартовые умения, таланты,
 * снаряжение, число ран и одну особую способность. Всё выданное архетипом
 * не считается улучшением при определении принадлежности (стр. 76), поэтому
 * раздача проставляет `starter` везде, где схема это умеет.
 *
 * Названия талантов, особенностей и снаряжения записаны так, как они звучат
 * в книге: это ключи поиска по компендиуму, а не подписи интерфейса. Не нашлось
 * — заведём заготовку с тем же именем, чтобы МИ увидел, что дозаполнить.
 *
 * `choose` — это «или» из книги, спрашивается у игрока при раздаче.
 * `specialist` — умение со специализацией: сама специализация вписывается
 * руками, потому что книга говорит «одно любое».
 */

/**
 * Таблица 2-4: союзники и враги (Black Crusade, стр. 75).
 *
 * Строка — покровитель персонажа, ключ — бог, с которым связано улучшение.
 * Непристроившемуся всё обходится по цене союзника, включая улучшения самого
 * Хаоса Неделимого: своей цены у него нет ни для кого.
 */
Dh.patronRelations = PATRON_RELATIONS;

/**
 * Таблицы 2-6, 2-7 и 2-9: цены улучшений (Black Crusade, стр. 77–78).
 *
 * Аптитьюдов в Чёрном Крестовом Походе нет вовсе: цену задаёт бог, которому
 * принадлежит улучшение, и то, как он относится к покровителю персонажа.
 * Уровни идут подряд и оплачиваются накопительно — перескочить через ступень
 * нельзя, поэтому цена улучшения складывается из всех предыдущих.
 */
Dh.bcCharacteristicCosts = BC_CHARACTERISTIC_COSTS;

Dh.bcSkillCosts = BC_SKILL_COSTS;

Dh.bcTalentCosts = BC_TALENT_COSTS;

/**
 * Тёмная слава живёт вне таблицы: каждое улучшение на +5 стоит 500 ОО при любом
 * покровителе, покупать его можно сколько угодно раз, но только пока показатель
 * ниже 40 — дальше славу зарабатывают деяниями (стр. 77).
 */
Dh.bcInfamyAdvanceCost = BC_INFAMY_ADVANCE.cost;
Dh.bcInfamyAdvanceCap = BC_INFAMY_ADVANCE.cap;

/**
 * Таблица 2-5: к какому богу относится характеристика (Black Crusade, стр. 76).
 *
 * Покровители есть только у Силы, Выносливости, Силы воли и Общительности;
 * всё остальное, включая Тёмную славу, принадлежит Хаосу Неделимому.
 */
Dh.bcCharacteristicPatrons = BC_CHARACTERISTIC_PATRONS;

/**
 * Таблица 2-8: умения и боги (Black Crusade, стр. 78).
 *
 * Здесь только те, у кого покровитель не Хаос Неделимый — остальные добираются
 * по умолчанию, и список не приходится держать в двух местах.
 */
Dh.bcSkillPatrons = BC_SKILL_PATRONS;

/**
 * Таблица 9-11: модификаторы проверки Приобретения (Black Crusade, стр. 310).
 *
 * Своя таблица, а не общая с Dark Heresy: у еретика вещь не покупается за трон,
 * а выбивается репутацией, и шаг доступности тут крупнее имперского. Ключи
 * повторяют `Dh.availability` и `Dh.craftmanship`, чтобы доступность предмета,
 * записанная в карточке, читалась отсюда без перевода.
 */
Dh.acquisitionAvailability = {
    ubiquitous: 70,
    abundant: 50,
    plentiful: 30,
    common: 20,
    average: 10,
    scarce: 0,
    rare: -10,
    "very-rare": -20,
    "extremely-rare": -30,
    "near-unique": -50,
    unique: -70
};

Dh.acquisitionQuantity = {
    single: 10,
    handful: 0,
    many: -10,
    "very-many": -20,
    legion: -40,
    impossible: -60
};

Dh.acquisitionQuality = {
    poor: 10,
    common: 0,
    good: -10,
    best: -20
};

Dh.attackType = {};

Dh.attackTypeRanged = {
    none: "ATTACK_TYPE.NONE",
    standard: "ATTACK_TYPE.STANDARD",
    semi_auto: "ATTACK_TYPE.SEMI_AUTO",
    full_auto: "ATTACK_TYPE.FULL_AUTO",
    wide_auto: "ATTACK_TYPE.WIDE_AUTO",
    suppression: "ATTACK_TYPE.SUPPRESSION",
    called_shot: "ATTACK_TYPE.CALLED_SHOT"
};

Dh.attackTypeMelee = {
    none: "ATTACK_TYPE.NONE",
    standard: "ATTACK_TYPE.STANDARD",
    charge: "ATTACK_TYPE.CHARGE",
    swift: "ATTACK_TYPE.SWIFT",
    lightning: "ATTACK_TYPE.LIGHTNING",
    allOut: "ATTACK_TYPE.ALLOUT",
    called_shot: "ATTACK_TYPE.CALLED_SHOT"
};

Dh.attackTypePsy = {
    none: "ATTACK_TYPE.NONE",
    bolt: "PSYCHIC_POWER.BOLT",
    barrage: "PSYCHIC_POWER.BARRAGE",
    storm: "PSYCHIC_POWER.STORM",
    blast: "PSYCHIC_POWER.BLAST"
};

Dh.ranges = {
    0: "RANGE.NONE",
    30: "RANGE.POINT_BLANK",
    10: "RANGE.SHORT",
    "-10": "RANGE.LONG",
    "-30": "RANGE.EXTREME"
};

Dh.damageTypes = {
    energy: "DAMAGE_TYPE.ENERGY",
    impact: "DAMAGE_TYPE.IMPACT",
    rending: "DAMAGE_TYPE.RENDING",
    explosive: "DAMAGE_TYPE.EXPLOSIVE"
};


Dh.aimModes = {
    0: "AIMING.NONE",
    10: "AIMING.HALF",
    20: "AIMING.FULL"
};

Dh.difficulties = {
    60: "DIFFICULTY.TRIVIAL",
    50: "DIFFICULTY.ELEMENTARY",
    40: "DIFFICULTY.SIMPLE",
    30: "DIFFICULTY.EASY",
    20: "DIFFICULTY.ROUTINE",
    10: "DIFFICULTY.ORDINARY",
    0: "DIFFICULTY.CHALLENGING",
    "-10": "DIFFICULTY.DIFFICULT",
    "-20": "DIFFICULTY.HARD",
    "-30": "DIFFICULTY.VERY_HARD",
    "-40": "DIFFICULTY.ARDUOUS",
    "-50": "DIFFICULTY.PUNISHING",
    "-60": "DIFFICULTY.HELLISH"
};

Dh.evasions = {
    dodge: "SKILL.DODGE",
    parry: "SKILL.PARRY",
    deny: "DIALOG.DENY_THE_WITCH",
    willpower: "CHARACTERISTIC.WILLPOWER",
    toughness: "CHARACTERISTIC.TOUGHNESS",
    agility: "CHARACTERISTIC.AGILITY",
    strength: "CHARACTERISTIC.STRENGTH"
};

Dh.craftmanship = {
    poor: "CRAFTSMANSHIP.POOR",
    common: "CRAFTSMANSHIP.COMMON",
    good: "CRAFTSMANSHIP.GOOD",
    best: "CRAFTSMANSHIP.BEST"
};

Dh.availability = {
    ubiquitous: "AVAILABILITY.UBIQUITOUS",
    abundant: "AVAILABILITY.ABUNDANT",
    plentiful: "AVAILABILITY.PLENTIFUL",
    common: "AVAILABILITY.COMMON",
    average: "AVAILABILITY.AVERAGE",
    scarce: "AVAILABILITY.SCARCE",
    rare: "AVAILABILITY.RARE",
    "very-rare": "AVAILABILITY.VERY_RARE",
    "extremely-rare": "AVAILABILITY.EXTREMELY_RARE",
    "near-unique": "AVAILABILITY.NEAR_UNIQUE",
    unique: "AVAILABILITY.UNIQUE"
};

/* Режим Deathwatch, в котором работает особая способность (стр. 213).
   Пусто — способность не из Караула Смерти и ни к какому режиму не привязана. */
Dh.abilityModes = {
    "": "MODE.NONE",
    solo: "MODE.SOLO",
    squad: "MODE.SQUAD"
};

/* Ранг Известности Deathwatch, с которого предмет можно затребовать из арсенала.
   «none» — ограничения нет, так помечены и предметы других книг. */
Dh.renown = {
    none: "RENOWN.NONE",
    respected: "RENOWN.RESPECTED",
    distinguished: "RENOWN.DISTINGUISHED",
    famed: "RENOWN.FAMED",
    hero: "RENOWN.HERO"
};

// Пять книг, по которым может играться персонаж. Тот же список читает селектор
// на листе и, позже, предметы Происхождения.
Dh.originRulesets = {
    dh2: "RULESET.DH2",
    rt: "RULESET.RT",
    ow: "RULESET.OW",
    bc: "RULESET.BC",
    dw: "RULESET.DW"
};

// Шаги создания всех пяти книг одним словарём — список для выпадающего списка на
// листе Происхождения. Какие из них есть у конкретной книги, знает
// script/creation/origin-data.mjs (STAGES), а не этот справочник.
/* Как книга называет поля анкеты под портретом. */
Dh.bioLabels = {
    dh2: {homeWorld: "BIO.HOME_WORLD", background: "BIO.BACKGROUND", role: "BIO.ROLE"},
    ow: {homeWorld: "BIO.HOME_WORLD", background: "ORIGIN.STAGE.REGIMENT", role: "ORIGIN.STAGE.SPECIALITY"}
};

Dh.originStages = {
    homeWorld: "ORIGIN.STAGE.HOME_WORLD",
    background: "ORIGIN.STAGE.BACKGROUND",
    role: "ORIGIN.STAGE.ROLE",
    divination: "ORIGIN.STAGE.DIVINATION",
    birthright: "ORIGIN.STAGE.BIRTHRIGHT",
    lure: "ORIGIN.STAGE.LURE",
    trials: "ORIGIN.STAGE.TRIALS",
    motivation: "ORIGIN.STAGE.MOTIVATION",
    career: "ORIGIN.STAGE.CAREER",
    regiment: "ORIGIN.STAGE.REGIMENT",
    regimentOrigin: "ORIGIN.STAGE.REGIMENT_ORIGIN",
    regimentCommander: "ORIGIN.STAGE.REGIMENT_COMMANDER",
    regimentType: "ORIGIN.STAGE.REGIMENT_TYPE",
    doctrine: "ORIGIN.STAGE.DOCTRINE",
    equipmentDoctrine: "ORIGIN.STAGE.EQUIPMENT_DOCTRINE",
    standardKit: "ORIGIN.STAGE.STANDARD_KIT",
    speciality: "ORIGIN.STAGE.SPECIALITY",
    race: "ORIGIN.STAGE.RACE",
    archetype: "ORIGIN.STAGE.ARCHETYPE",
    pride: "ORIGIN.STAGE.PRIDE",
    disgrace: "ORIGIN.STAGE.DISGRACE",
    chapter: "ORIGIN.STAGE.CHAPTER"
};


Dh.armourTypes = {
    basic: "ARMOUR_TYPE.BASIC",
    flak: "ARMOUR_TYPE.FLAK",
    mesh: "ARMOUR_TYPE.MESH",
    carapace: "ARMOUR_TYPE.CARAPACE",
    power: "ARMOUR_TYPE.POWER"
};

Dh.weaponType = {
    las: "WEAPON.LAS",
    solidprojectile: "WEAPON.SOLIDPROJECTILE",
    bolt: "WEAPON.BOLT",
    melta: "WEAPON.MELTA",
    plasma: "WEAPON.PLASMA",
    flame: "WEAPON.FLAME",
    lowtech: "WEAPON.LOWTECH",
    launcher: "WEAPON.LAUNCHER",
    explosive: "WEAPON.EXPLOSIVE",
    exotic: "WEAPON.EXOTIC",
    chain: "WEAPON.CHAIN",
    power: "WEAPON.POWER",
    shock: "WEAPON.SHOCK",
    force: "WEAPON.FORCE"
};

Dh.weaponClass = {
    melee: "WEAPON.MELEE",
    thrown: "WEAPON.THROWN",
    pistol: "WEAPON.PISTOL",
    basic: "WEAPON.BASIC",
    heavy: "WEAPON.HEAVY",
    launched: "WEAPON.LAUNCHED",
    placed: "WEAPON.PLACED",
    vehicle: "WEAPON.VEHICLE"
};

Dh.psykerClass = {
    bound: "PSYCHIC_POWER.BOUND",
    unbound: "PSYCHIC_POWER.UNBOUND",
    daemonic: "PSYCHIC_POWER.DAEMONIC"
};

Dh.advanceStagesCharacteristics = {
    0: "ADVANCE.NONE",
    5: "ADVANCE.SIMPLE",
    10: "ADVANCE.INTERMEDIATE",
    15: "ADVANCE.TRAINED",
    20: "ADVANCE.PROFICIENT",
    25: "ADVANCE.EXPERT"
};

Dh.advanceStagesSkills = {
    "-20": "ADVANCE.UNTRAINED",
    0: "ADVANCE.KNOWN",
    10: "ADVANCE.TRAINED",
    20: "ADVANCE.EXPERIENCED",
    30: "ADVANCE.VETERAN"
};

Dh.characteristicCosts = [
    [0, 0, 0],
    [100, 250, 500],
    [250, 500, 750],
    [500, 750, 1000],
    [750, 1000, 1500],
    [1250, 1500, 2500]];

Dh.talentCosts = [[200, 300, 600], [300, 450, 900], [400, 600, 1200]];

/** Локация попадания → ключ брони актёра. В броске локация хранится ключом подписи. */
const DH_ARMOUR_KEYS = {
    "ARMOUR.HEAD": "head",
    "ARMOUR.LEFT_ARM": "leftArm",
    "ARMOUR.RIGHT_ARM": "rightArm",
    "ARMOUR.BODY": "body",
    "ARMOUR.LEFT_LEG": "leftLeg",
    "ARMOUR.RIGHT_LEG": "rightLeg"
};

Dh.hitLocations = {
    head: "ARMOUR.HEAD",
    leftArm: "ARMOUR.LEFT_ARM",
    rightArm: "ARMOUR.RIGHT_ARM",
    body: "ARMOUR.BODY",
    leftLeg: "ARMOUR.LEFT_LEG",
    rightLeg: "ARMOUR.RIGHT_LEG"
};

/* ── ТЕХНИКА ────────────────────────────────────────────────────────────────
   Шасси решает, как машина ходит и что с ней случается вместо потери
   управления: колёсные и гусеничные становятся Неуправляемыми, глиссеры терпят
   Крушение, шагоходы Опрокидываются. */
Dh.vehicleTypes = {
    tracked: "VEHICLE.TYPE.TRACKED",
    wheeled: "VEHICLE.TYPE.WHEELED",
    skimmer: "VEHICLE.TYPE.SKIMMER",
    walker: "VEHICLE.TYPE.WALKER",
    aircraft: "VEHICLE.TYPE.AIRCRAFT",
    spacecraft: "VEHICLE.TYPE.SPACECRAFT"
};

/* Четыре стороны под углом 90°. Атака сверху или снизу считается по корме. */
Dh.vehicleFacings = {
    front: "VEHICLE.FACING.FRONT",
    leftSide: "VEHICLE.FACING.LEFT",
    rightSide: "VEHICLE.FACING.RIGHT",
    rear: "VEHICLE.FACING.REAR"
};

/* Середина сектора обстрела в градусах от носа машины — по часовой стрелке,
   как отсчитываются стороны при попадании. */
Dh.vehicleFacingAngles = {
    front: 0,
    rightSide: 90,
    rear: 180,
    leftSide: 270
};

/* Зоны попадания машины — у каждой своя таблица критических эффектов. */
Dh.vehicleHitZones = {
    hull: "VEHICLE.ZONE.HULL",
    motive: "VEHICLE.ZONE.MOTIVE",
    weapon: "VEHICLE.ZONE.WEAPON",
    turret: "VEHICLE.ZONE.TURRET"
};

/* Таблицы критов машин в компендиуме «Black Crusade Tables» по зонам попадания. */
Dh.vehicleCriticalCharts = {
    hull: "Hull Critical Hit Chart",
    motive: "Motive Systems Critical Hit Chart",
    weapon: "Weapon Critical Hit Chart",
    turret: "Turret Critical Hit Chart"
};

/* Крепление задаёт сектор обстрела; угол по умолчанию берётся отсюда же.
   Попадание в башню считается попаданием в лоб — у неё своя толстая броня. */
Dh.vehicleMounts = {
    fixed:   { label: "VEHICLE.MOUNT.FIXED",   arc: 0 },
    hull:    { label: "VEHICLE.MOUNT.HULL",    arc: 45 },
    turret:  { label: "VEHICLE.MOUNT.TURRET",  arc: 360 },
    sponson: { label: "VEHICLE.MOUNT.SPONSON", arc: 180 },
    pintle:  { label: "VEHICLE.MOUNT.PINTLE",  arc: 360 }
};

/* Состояние по доле потерянной целостности: до половины — легко повреждена,
   от половины — тяжело, ноль и ниже — груда покорёженного металла. */
Dh.vehicleDamageStates = {
    intact:   "VEHICLE.STATE.INTACT",
    light:    "VEHICLE.STATE.LIGHT",
    heavy:    "VEHICLE.STATE.HEAVY",
    critical: "VEHICLE.STATE.CRITICAL",
    wrecked:  "VEHICLE.STATE.WRECKED"
};

/* Действия оператора в бою на машине. Все полные, все катятся оператором.
   `unmanageableOn` — со скольких степеней провала машина становится
   Неуправляемой; разыгрывает это МИ, система только называет. */
Dh.vehicleManoeuvres = {
    evasive: {
        label: "VEHICLE.ACTION.EVASIVE",
        difficulty: 0,
        penaltyPerDos: -10,
        unmanageableOn: 5
    },
    floorIt: {
        label: "VEHICLE.ACTION.FLOOR_IT",
        difficulty: -10,
        penalty: -20,
        extraMovePerDos: 5,
        unmanageableOn: 5,
        noWalker: true
    },
    hitAndRun: {
        label: "VEHICLE.ACTION.HIT_AND_RUN",
        difficulty: -10,
        skill: "weaponSkill",
        unmanageableOn: 3,
        noWalker: true,
        needsOpen: true
    }
};

/* Позиции корабельных орудий — те же пять, что и на бумажном листе. */
Dh.shipLocations = {
    dorsal:    "SHIP.LOCATION.DORSAL",
    prow:      "SHIP.LOCATION.PROW",
    keel:      "SHIP.LOCATION.KEEL",
    port:      "SHIP.LOCATION.PORT",
    starboard: "SHIP.LOCATION.STARBOARD"
};

/* Классы корпуса, которые называет книга (стр. 215 и 216). От класса зависят
   ровно две вещи, и обе оттуда: насколько круто корабль поворачивает и какой
   кубик бросает при таране. Печатное название корпуса живёт отдельным полем —
   «Sword-class Frigate» стол пишет как хочет, а считаем мы по этому ключу. */
Dh.shipHullTypes = {
    transport:    { label: "SHIP.HULL_TYPE.TRANSPORT",    ram: "1d5",  turn: 90 },
    raider:       { label: "SHIP.HULL_TYPE.RAIDER",       ram: "1d5",  turn: 90 },
    frigate:      { label: "SHIP.HULL_TYPE.FRIGATE",      ram: "1d10", turn: 90 },
    lightCruiser: { label: "SHIP.HULL_TYPE.LIGHT_CRUISER", ram: "2d5", turn: 45 },
    cruiser:      { label: "SHIP.HULL_TYPE.CRUISER",      ram: "2d10", turn: 45 }
};

/* Выучка команды (табл. 8-9). Значение — та самая цифра, которой НИП-экипаж
   бросает всё подряд, когда действие поручено не игроку. Десятки этой цифры
   заодно говорят, сколько действий за раунд команда потянет. */
/* Массив, а не объект с числовыми ключами: Handlebars отдаёт ключи объекта
   строками, и сравнение «40» с записанным числом 40 в шаблоне не сходится —
   выбранный пункт списка тихо переставал быть выбранным. */
Dh.shipCrewRatings = [
    { value: 20, label: "SHIP.CREW_RATING.INCOMPETENT" },
    { value: 30, label: "SHIP.CREW_RATING.COMPETENT" },
    { value: 40, label: "SHIP.CREW_RATING.CRACK" },
    { value: 50, label: "SHIP.CREW_RATING.VETERAN" },
    { value: 60, label: "SHIP.CREW_RATING.ELITE" }
];

/* Компоненты делятся надвое (стр. 196): существенные держат корабль на ходу,
   дополнительные его усиливают. */
Dh.shipComponentCategories = {
    essential:    "SHIP.COMPONENT.ESSENTIAL",
    supplemental: "SHIP.COMPONENT.SUPPLEMENTAL"
};

/* Четыре состояния компонента (стр. 222-223). Пожар и разгерметизация сюда не
   входят: они независимы, компонент может гореть, оставаясь целым. */
Dh.shipComponentStatus = {
    intact:    "SHIP.COMPONENT.STATUS.INTACT",
    unpowered: "SHIP.COMPONENT.STATUS.UNPOWERED",
    damaged:   "SHIP.COMPONENT.STATUS.DAMAGED",
    destroyed: "SHIP.COMPONENT.STATUS.DESTROYED"
};

/* Качество компонента. На механику само по себе не влияет — влияют профили
   конкретных компонентов, — но в списке его держать надо. */
Dh.shipQualities = {
    poor:   "SHIP.QUALITY.POOR",
    common: "SHIP.QUALITY.COMMON",
    good:   "SHIP.QUALITY.GOOD",
    best:   "SHIP.QUALITY.BEST"
};

/* Действия пустотного боя (стр. 213-218, табл. 8-10 и 8-11).

   skill — чем бросает исполнитель; stat — характеристика корабля, которая
   прибавляется к навыку в комбинированном тесте; shipboard — тест из тех, по
   которым бьёт таблица Команды (ремонт, пожары, абордаж); aidedByBacks —
   тест, которому помогает «Навались!»; needsTarget — действие против другого
   корабля; defender — противопоставленный тест, и это подпись защищающейся
   стороны. Hail the Enemy книга целиком отдаёт на усмотрение ведущего,
   бросать там нечего. */
Dh.shipActions = {
    adjustBearing:      { group: "manoeuvre", code: "ADJUST_BEARING",       skill: "pilot", stat: "manoeuvrability", difficulty: 0 },
    adjustSpeed:        { group: "manoeuvre", code: "ADJUST_SPEED",         skill: "pilot", stat: "manoeuvrability", difficulty: 0 },
    adjustSpeedBearing: { group: "manoeuvre", code: "ADJUST_SPEED_BEARING", skill: "pilot", stat: "manoeuvrability", difficulty: -20 },
    comeToNewHeading:   { group: "manoeuvre", code: "COME_TO_NEW_HEADING",  skill: "pilot", stat: "manoeuvrability", difficulty: -10 },
    disengage:          { group: "manoeuvre", code: "DISENGAGE",            skill: "pilot", stat: "manoeuvrability", difficulty: 0 },
    evasive:            { group: "manoeuvre", code: "EVASIVE",              skill: "pilot", stat: "manoeuvrability", difficulty: -10 },

    activeAugury:     { group: "extended", code: "ACTIVE_AUGURY",       skill: "scrutiny", stat: "detection", difficulty: 0 },
    aidMachineSpirit: { group: "extended", code: "AID_MACHINE_SPIRIT",  skill: "techUse", difficulty: 0 },
    disinformation:   { group: "extended", code: "DISINFORMATION",      skill: "deceive", difficulty: -10 },
    emergencyRepairs: { group: "extended", code: "EMERGENCY_REPAIRS",   skill: "techUse", difficulty: -10, shipboard: true, aidedByBacks: true },
    flankSpeed:       { group: "extended", code: "FLANK_SPEED",         skill: "techUse", difficulty: 0 },
    focusedAugury:    { group: "extended", code: "FOCUSED_AUGURY",      skill: "scrutiny", stat: "detection", difficulty: 0 },
    holdFast:         { group: "extended", code: "HOLD_FAST",           skill: "willpower", difficulty: 0 },
    jamComms:         { group: "extended", code: "JAM_COMMUNICATIONS",  skill: "techUse", difficulty: -10 },
    lockOn:           { group: "extended", code: "LOCK_ON_TARGET",      skill: "scrutiny", stat: "detection", difficulty: 0 },
    prepareRepel:     { group: "extended", code: "PREPARE_TO_REPEL",    skill: "command", difficulty: 0 },
    putBacks:         { group: "extended", code: "PUT_BACKS_INTO_IT",   skill: "intimidate", skillChoice: ["intimidate", "charm"], difficulty: 0 },
    triage:           { group: "extended", code: "TRIAGE",              skill: "medicae", difficulty: -10 },
    fightFire:        { group: "extended", code: "FIGHT_FIRE",          skill: "command", difficulty: -10, shipboard: true, aidedByBacks: true },

    // Абордаж и таран (стр. 215), налёт (стр. 218).
    board:          { group: "assault", code: "BOARD",          skill: "pilot", stat: "manoeuvrability", difficulty: -20, needsTarget: true, unboardedOnly: true },
    ram:            { group: "assault", code: "RAM",            skill: "pilot", stat: "manoeuvrability", difficulty: -20, needsTarget: true, unboardedOnly: true },
    hitAndRun:      { group: "assault", code: "HIT_AND_RUN",    skill: "pilot", difficulty: 0, needsTarget: true, defender: "SHIP.DIALOG.THEIR_CREW" },
    boardingRound:  { group: "assault", code: "BOARDING_ROUND", skill: "command", difficulty: 0, defender: "SHIP.DIALOG.THEIR_CREW", boardedOnly: true },
    breakFree:      { group: "assault", code: "BREAK_FREE",     skill: "pilot", stat: "manoeuvrability", difficulty: -20, boardedOnly: true },

    // Мятеж (стр. 224-225).
    mutinyTest:     { group: "crew", code: "MUTINY_TEST",     skill: "command", difficulty: 0 },
    suppressMutiny: { group: "crew", code: "SUPPRESS_MUTINY", skill: "command", skillChoice: ["command", "charm", "intimidate"], difficulty: 0, defender: "SHIP.DIALOG.MUTINEERS", mutinyOnly: true }
};
for (const def of Object.values(Dh.shipActions)) {
    def.label = `SHIP.ACTION.${def.code}`;
    def.hint = `SHIP.ACTION_HINT.${def.code}`;
}

/* Подписи навыков, которыми бросают корабельные действия. Пилотирование в
   Rogue Trader зовётся Pilot (Space Craft); в листах этой системы ему
   соответствует Operate (Voidship). */
Dh.shipSkillLabels = {
    pilot: "SHIP.SKILL.PILOT",
    scrutiny: "SHIP.SKILL.SCRUTINY",
    techUse: "SHIP.SKILL.TECH_USE",
    command: "SHIP.SKILL.COMMAND",
    charm: "SHIP.SKILL.CHARM",
    intimidate: "SHIP.SKILL.INTIMIDATE",
    deceive: "SHIP.SKILL.DECEIVE",
    medicae: "SHIP.SKILL.MEDICAE",
    willpower: "SHIP.SKILL.WILLPOWER"
};

/* Тип корабельного орудия: на листе это переключатель у каждой строки. */
Dh.shipWeaponTypes = {
    macrobattery: "SHIP.WEAPON_TYPE.MACROBATTERY",
    lance:        "SHIP.WEAPON_TYPE.LANCE"
};

/* Сколько машина проходит за свой ход: ничего, половина Тактической Скорости
   или вся она. Крейсерская скорость меряет марш и режимом хода не является. */
Dh.vehicleSpeedModes = {
    halted:   "VEHICLE.SPEED_MODE.HALTED",
    half:     "VEHICLE.SPEED_MODE.HALF",
    tactical: "VEHICLE.SPEED_MODE.TACTICAL"
};

/**
 * Register all attribute keys for Active Effects in dark-heresy system
 * This allows effects to modify any actor or item attribute
 */
function registerActiveEffectAttributeKeys() {
    const attributeKeys = {};
    
    // ============================================
    // Actor Core Attributes
    // ============================================
    
    // Characteristics - only modifiable attributes (computed ones are removed)
    // total, bonus, displayTotal, displayBonus are computed and cannot be modified directly
    const characteristics = ["weaponSkill", "ballisticSkill", "strength", "toughness", "agility", "intelligence", "perception", "willpower", "fellowship"];
    characteristics.forEach(char => {
        attributeKeys[`system.characteristics.${char}.base`] = { label: `CHARACTERISTIC.${char.toUpperCase()}.BASE`, type: "Number" };
        attributeKeys[`system.characteristics.${char}.advance`] = { label: `CHARACTERISTIC.${char.toUpperCase()}.ADVANCE`, type: "Number" };
        // total, bonus, displayTotal, displayBonus are computed - removed
        attributeKeys[`system.characteristics.${char}.tempModifier`] = { label: `CHARACTERISTIC.${char.toUpperCase()}.TEMP_MODIFIER`, type: "Number" };
        attributeKeys[`system.characteristics.${char}.unnatural`] = { label: `CHARACTERISTIC.${char.toUpperCase()}.UNNATURAL`, type: "Number" };
        attributeKeys[`system.characteristics.${char}.cost`] = { label: `CHARACTERISTIC.${char.toUpperCase()}.COST`, type: "Number" };
    });
    
    // Wounds
    attributeKeys["system.wounds.value"] = { label: "WOUNDS.VALUE", type: "Number" };
    attributeKeys["system.wounds.max"] = { label: "WOUNDS.MAX", type: "Number" };
    attributeKeys["system.wounds.critical"] = { label: "WOUNDS.CRITICAL", type: "Number" };
    attributeKeys["system.wounds.regeneration"] = { label: "WOUNDS.REGENERATION", type: "Number" };
    
    // Fatigue
    attributeKeys["system.fatigue.value"] = { label: "FATIGUE", type: "Number" };
    attributeKeys["system.fatigue.max"] = { label: "FATIGUE_MAX", type: "Number" };
    
    // Fate
    attributeKeys["system.fate.value"] = { label: "FATE", type: "Number" };
    attributeKeys["system.fate.max"] = { label: "FATE_MAX", type: "Number" };
    
    // Psy
    attributeKeys["system.psy.rating"] = { label: "PSY.RATING", type: "Number" };
    attributeKeys["system.psy.sustained"] = { label: "PSY.SUSTAINED", type: "Number" };
    // currentRating is computed - removed
    attributeKeys["system.psy.cost"] = { label: "PSY.COST", type: "Number" };
    attributeKeys["system.psy.class"] = { label: "PSY.CLASS", type: "String" };
    
    // Insanity & Corruption
    attributeKeys["system.insanity"] = { label: "INSANITY", type: "Number" };
    // insanityBonus is computed - removed
    attributeKeys["system.corruption"] = { label: "CORRUPTION", type: "Number" };
    // corruptionBonus is computed - removed
    
    // Initiative
    // initiative.base holds a dice formula ("1d10"), not a number - offering it as a
    // Number invited arithmetic that could never work. Override it with another formula.
    attributeKeys["system.initiative.base"] = { label: "INITIATIVE", type: "String" };
    // initiative.bonus is computed - removed
    attributeKeys["system.initiative.characteristic"] = { label: "INITIATIVE_CHARACTERISTIC", type: "String" };
    
    // Armour - all locations (only modifiable attributes)
    const armourLocations = ["head", "leftArm", "rightArm", "body", "leftLeg", "rightLeg"];
    armourLocations.forEach(loc => {
        attributeKeys[`system.armour.${loc}.value`] = { label: `ARMOUR.${loc.toUpperCase()}.VALUE`, type: "Number" };
        // total and toughnessBonus are computed - removed
        attributeKeys[`system.armour.${loc}.tempModifier`] = { label: `ARMOUR.${loc.toUpperCase()}.TEMP_MODIFIER`, type: "Number" };
    });
    
    // Movement
    // No walk figure is computed - half/full/charge/run are the four the system has -
    // so this key had nothing to point at.
    attributeKeys["system.movement.run"] = { label: "MOVEMENT.RUN", type: "Number" };
    attributeKeys["system.movement.charge"] = { label: "MOVEMENT.CHARGE", type: "Number" };
    attributeKeys["system.movement.half"] = { label: "MOVEMENT.HALF", type: "Number" };
    attributeKeys["system.movement.full"] = { label: "MOVEMENT.FULL", type: "Number" };
    // movementBonus is a group of four fields, not a number of its own.
    attributeKeys["system.movementBonus.half"] = { label: "MOVEMENT_BONUS.HALF", type: "Number" };
    attributeKeys["system.movementBonus.full"] = { label: "MOVEMENT_BONUS.FULL", type: "Number" };
    attributeKeys["system.movementBonus.charge"] = { label: "MOVEMENT_BONUS.CHARGE", type: "Number" };
    attributeKeys["system.movementBonus.run"] = { label: "MOVEMENT_BONUS.RUN", type: "Number" };
    
    // Encumbrance
    attributeKeys["system.encumbrance.value"] = { label: "ENCUMBRANCE.VALUE", type: "Number" };
    attributeKeys["system.encumbrance.max"] = { label: "ENCUMBRANCE.MAX", type: "Number" };
    
    // Experience (only modifiable attributes)
    attributeKeys["system.experience.value"] = { label: "EXPERIENCE.VALUE", type: "Number" };
    // totalSpent and remaining are computed - removed
    attributeKeys["system.experience.spentCharacteristics"] = { label: "EXPERIENCE.SPENT_CHARACTERISTICS", type: "Number" };
    attributeKeys["system.experience.spentSkills"] = { label: "EXPERIENCE.SPENT_SKILLS", type: "Number" };
    attributeKeys["system.experience.spentTalents"] = { label: "EXPERIENCE.SPENT_TALENTS", type: "Number" };
    attributeKeys["system.experience.spentPsychicPowers"] = { label: "EXPERIENCE.SPENT_PSYCHIC_POWERS", type: "Number" };
    attributeKeys["system.experience.spentOther"] = { label: "EXPERIENCE.SPENT_OTHER", type: "Number" };
    
    // NPC specific
    attributeKeys["system.horde"] = { label: "HORDE", type: "Number" };
    attributeKeys["system.threatLevel"] = { label: "THREAT_LEVEL", type: "Number" };
    attributeKeys["system.size"] = { label: "SIZE", type: "Number" };
    attributeKeys["system.faction"] = { label: "FACTION", type: "String" };
    attributeKeys["system.subfaction"] = { label: "SUBFACTION", type: "String" };
    attributeKeys["system.type"] = { label: "TYPE", type: "String" };
    
    // Bio fields (Character biography)
    attributeKeys["system.bio.homeWorld"] = { label: "BIO.HOMEWORLD", type: "String" };
    attributeKeys["system.bio.role"] = { label: "BIO.ROLE", type: "String" };
    attributeKeys["system.bio.background"] = { label: "BIO.BACKGROUND", type: "String" };
    attributeKeys["system.bio.elite"] = { label: "BIO.ELITE", type: "String" };
    attributeKeys["system.bio.gender"] = { label: "BIO.GENDER", type: "String" };
    attributeKeys["system.bio.age"] = { label: "BIO.AGE", type: "String" };
    attributeKeys["system.bio.build"] = { label: "BIO.BUILD", type: "String" };
    attributeKeys["system.bio.complexion"] = { label: "BIO.COMPLEXION", type: "String" };
    attributeKeys["system.bio.hair"] = { label: "BIO.HAIR", type: "String" };
    attributeKeys["system.bio.divination"] = { label: "BIO.DIVINATION", type: "String" };
    attributeKeys["system.bio.quirks"] = { label: "BIO.QUIRKS", type: "String" };
    attributeKeys["system.bio.superstition"] = { label: "BIO.SUPERSTITION", type: "String" };
    attributeKeys["system.bio.momentos"] = { label: "BIO.MOMENTOS", type: "String" };
    attributeKeys["system.bio.notes"] = { label: "BIO.NOTES", type: "String" };
    
    // Skills - common skills that might be modified (only advance, total is computed)
    const commonSkills = ["acrobatics", "athletics", "awareness", "charm", "command", "commerce", "deceive", "dodge", 
                          "inquiry", "intimidate", "logic", "medicae", "performer", "psyniscience", "scrutiny", 
                          "security", "sleightOfHand", "stealth", "survival", "techUse", "forbiddenLore", "commonLore",
                          "scholasticLore", "trade", "operate"];
    commonSkills.forEach(skill => {
        attributeKeys[`system.skills.${skill}.advance`] = { label: `SKILL.${skill.toUpperCase()}.ADVANCE`, type: "Number" };
        attributeKeys[`system.skills.${skill}.cost`] = { label: `SKILL.${skill.toUpperCase()}.COST`, type: "Number" };
        attributeKeys[`system.skills.${skill}.starter`] = { label: `SKILL.${skill.toUpperCase()}.STARTER`, type: "Boolean" };
        // total is computed - removed
        // Specialities - dynamic, but we can add pattern for common ones
        // Note: Specialities are dynamic, so effects would need to target specific ones
        // Pattern: system.skills.{skill}.specialities.{speciality}.advance
        // Pattern: system.skills.{skill}.specialities.{speciality}.cost
        // Pattern: system.skills.{skill}.specialities.{speciality}.starter
    });
    
    // Note: Skill specialities are dynamic and user-defined, so they cannot be pre-registered.
    // Users can manually add effects targeting specific specialities using the pattern:
    // system.skills.{skillName}.specialities.{specialityName}.advance
    // system.skills.{skillName}.specialities.{specialityName}.cost
    // system.skills.{skillName}.specialities.{specialityName}.starter
    
    // ============================================
    // Item Attributes
    // ============================================
    
    // Weapon attributes
    attributeKeys["system.damage"] = { label: "WEAPON.DAMAGE", type: "String" };
    attributeKeys["system.damageType"] = { label: "WEAPON.DAMAGE_TYPE", type: "String" };
    attributeKeys["system.penetration"] = { label: "WEAPON.PENETRATION", type: "Number" };
    attributeKeys["system.range"] = { label: "WEAPON.RANGE", type: "String" };
    attributeKeys["system.rateOfFire"] = { label: "WEAPON.RATE_OF_FIRE", type: "String" };
    attributeKeys["system.reload"] = { label: "WEAPON.RELOAD", type: "String" };
    attributeKeys["system.class"] = { label: "WEAPON.CLASS", type: "String" };
    attributeKeys["system.type"] = { label: "WEAPON.TYPE", type: "String" };
    attributeKeys["system.craftsmanship"] = { label: "WEAPON.CRAFTSMANSHIP", type: "String" };
    attributeKeys["system.availability"] = { label: "WEAPON.AVAILABILITY", type: "String" };
    attributeKeys["system.weight"] = { label: "WEAPON.WEIGHT", type: "Number" };
    attributeKeys["system.special"] = { label: "WEAPON.SPECIAL", type: "String" };
    attributeKeys["system.attack"] = { label: "WEAPON.ATTACK", type: "String" };

    // Модификация оружия: эффект полями, поэтому и эффекты могут его править.
    attributeKeys["system.effect.damageBonus"] = { label: "WEAPON_MODIFICATION.DAMAGE_BONUS", type: "Number" };
    attributeKeys["system.effect.penetrationBonus"] = { label: "WEAPON_MODIFICATION.PENETRATION_BONUS", type: "Number" };
    attributeKeys["system.effect.attackBonus"] = { label: "WEAPON_MODIFICATION.ATTACK_BONUS", type: "Number" };
    attributeKeys["system.effect.rangeMultiplier"] = { label: "WEAPON_MODIFICATION.RANGE_MULTIPLIER", type: "Number" };
    attributeKeys["system.effect.clipMultiplier"] = { label: "WEAPON_MODIFICATION.CLIP_MULTIPLIER", type: "Number" };
    attributeKeys["system.effect.availabilityShift"] = { label: "WEAPON_MODIFICATION.AVAILABILITY_SHIFT", type: "Number" };
    attributeKeys["system.effect.addTraits"] = { label: "WEAPON_MODIFICATION.ADD_TRAITS", type: "String" };
    attributeKeys["system.effect.removeTraits"] = { label: "WEAPON_MODIFICATION.REMOVE_TRAITS", type: "String" };

    // Предметы, которые вдобавок защищают или бьют.
    attributeKeys["system.grantsArmour.enabled"] = { label: "EQUIPMENT.GRANTS_ARMOUR", type: "Boolean" };
    attributeKeys["system.grantsArmour.isAdditive"] = { label: "ARMOUR.ADDITIVE", type: "Boolean" };
    for (const location of ["head", "leftArm", "rightArm", "body", "leftLeg", "rightLeg"]) {
        attributeKeys[`system.grantsArmour.part.${location}`] = { label: Dh.hitLocations[location], type: "Number" };
    }
    attributeKeys["system.grantsAttack.enabled"] = { label: "EQUIPMENT.GRANTS_ATTACK", type: "Boolean" };
    attributeKeys["system.grantsAttack.damage"] = { label: "WEAPON.DAMAGE", type: "String" };
    attributeKeys["system.grantsAttack.penetration"] = { label: "WEAPON.PENETRATION", type: "String" };
    attributeKeys["system.grantsAttack.special"] = { label: "WEAPON.SPECIAL", type: "String" };

    // Покровитель у порчи: от него зависит фильтрация даров и расстройств.
    attributeKeys["system.patron"] = { label: "BIO.PATRON", type: "String" };
    
    // Armour item attributes
    attributeKeys["system.locations.head"] = { label: "ARMOUR_ITEM.HEAD", type: "Boolean" };
    attributeKeys["system.locations.leftArm"] = { label: "ARMOUR_ITEM.LEFT_ARM", type: "Boolean" };
    attributeKeys["system.locations.rightArm"] = { label: "ARMOUR_ITEM.RIGHT_ARM", type: "Boolean" };
    attributeKeys["system.locations.body"] = { label: "ARMOUR_ITEM.BODY", type: "Boolean" };
    attributeKeys["system.locations.leftLeg"] = { label: "ARMOUR_ITEM.LEFT_LEG", type: "Boolean" };
    attributeKeys["system.locations.rightLeg"] = { label: "ARMOUR_ITEM.RIGHT_LEG", type: "Boolean" };
    attributeKeys["system.armourValue"] = { label: "ARMOUR_ITEM.VALUE", type: "Number" };
    
    // Psychic Power attributes
    attributeKeys["system.focusPower.test"] = { label: "PSYCHIC_POWER.FOCUS_POWER_TEST", type: "String" };
    attributeKeys["system.focusPower.modifier"] = { label: "PSYCHIC_POWER.FOCUS_POWER_MODIFIER", type: "Number" };
    attributeKeys["system.focusPower.difficulty"] = { label: "PSYCHIC_POWER.FOCUS_POWER_DIFFICULTY", type: "String" };
    attributeKeys["system.range"] = { label: "PSYCHIC_POWER.RANGE", type: "String" };
    attributeKeys["system.sustained"] = { label: "PSYCHIC_POWER.SUSTAINED", type: "Boolean" };
    attributeKeys["system.action"] = { label: "PSYCHIC_POWER.ACTION", type: "String" };
    attributeKeys["system.opposed"] = { label: "PSYCHIC_POWER.OPPOSED", type: "String" };
    attributeKeys["system.overbleed"] = { label: "PSYCHIC_POWER.OVERBLEED", type: "Number" };
    attributeKeys["system.damage"] = { label: "PSYCHIC_POWER.DAMAGE", type: "String" };
    attributeKeys["system.penetration"] = { label: "PSYCHIC_POWER.PENETRATION", type: "Number" };
    attributeKeys["system.subtype"] = { label: "PSYCHIC_POWER.TYPE", type: "String" };
    attributeKeys["system.prerequisite"] = { label: "PSYCHIC_POWER.PREREQUISITE", type: "String" };
    
    // Talent attributes
    attributeKeys["system.tier"] = { label: "TALENT.TIER", type: "Number" };
    attributeKeys["system.aptitudes"] = { label: "TALENT.APTITUDES", type: "String" };
    attributeKeys["system.cost"] = { label: "TALENT.COST", type: "Number" };
    attributeKeys["system.starter"] = { label: "TALENT.STARTER", type: "Boolean" };
    attributeKeys["system.benefit"] = { label: "TALENT.BENEFIT", type: "String" };
    attributeKeys["system.prerequisites"] = { label: "TALENT.PREREQUISITES", type: "String" };
    attributeKeys["system.prerequisite"] = { label: "TALENT.PREREQUISITE", type: "String" };
    
    // Ammunition attributes
    attributeKeys["system.damage"] = { label: "AMMUNITION.DAMAGE", type: "String" };
    attributeKeys["system.penetration"] = { label: "AMMUNITION.PENETRATION", type: "Number" };
    attributeKeys["system.attack"] = { label: "AMMUNITION.ATTACK", type: "String" };
    attributeKeys["system.availability"] = { label: "AMMUNITION.AVAILABILITY", type: "String" };
    attributeKeys["system.craftsmanship"] = { label: "AMMUNITION.CRAFTSMANSHIP", type: "String" };
    attributeKeys["system.weight"] = { label: "AMMUNITION.WEIGHT", type: "Number" };
    attributeKeys["system.cost"] = { label: "AMMUNITION.COST", type: "Number" };
    
    // Force Field attributes
    attributeKeys["system.rating"] = { label: "FORCE_FIELD.RATING", type: "Number" };
    attributeKeys["system.overload"] = { label: "FORCE_FIELD.OVERLOAD", type: "Number" };
    attributeKeys["system.overloadChance"] = { label: "FORCE_FIELD.OVERLOAD_CHANCE", type: "Number" };
    attributeKeys["system.availability"] = { label: "FORCE_FIELD.AVAILABILITY", type: "String" };
    attributeKeys["system.craftsmanship"] = { label: "FORCE_FIELD.CRAFTSMANSHIP", type: "String" };
    attributeKeys["system.weight"] = { label: "FORCE_FIELD.WEIGHT", type: "Number" };
    attributeKeys["system.cost"] = { label: "FORCE_FIELD.COST", type: "Number" };
    
    // Cybernetic attributes
    attributeKeys["system.availability"] = { label: "CYBERNETIC.AVAILABILITY", type: "String" };
    attributeKeys["system.craftsmanship"] = { label: "CYBERNETIC.CRAFTSMANSHIP", type: "String" };
    attributeKeys["system.weight"] = { label: "CYBERNETIC.WEIGHT", type: "Number" };
    attributeKeys["system.cost"] = { label: "CYBERNETIC.COST", type: "Number" };
    attributeKeys["system.effect"] = { label: "CYBERNETIC.EFFECT", type: "String" };
    
    // Drug attributes
    attributeKeys["system.availability"] = { label: "DRUG.AVAILABILITY", type: "String" };
    attributeKeys["system.craftsmanship"] = { label: "DRUG.CRAFTSMANSHIP", type: "String" };
    attributeKeys["system.weight"] = { label: "DRUG.WEIGHT", type: "Number" };
    attributeKeys["system.cost"] = { label: "DRUG.COST", type: "Number" };
    attributeKeys["system.effect"] = { label: "DRUG.EFFECT", type: "String" };
    
    // Gear attributes
    attributeKeys["system.availability"] = { label: "GEAR.AVAILABILITY", type: "String" };
    attributeKeys["system.craftsmanship"] = { label: "GEAR.CRAFTSMANSHIP", type: "String" };
    attributeKeys["system.weight"] = { label: "GEAR.WEIGHT", type: "Number" };
    attributeKeys["system.cost"] = { label: "GEAR.COST", type: "Number" };
    attributeKeys["system.effect"] = { label: "GEAR.EFFECT", type: "String" };
    
    // Tool attributes
    attributeKeys["system.availability"] = { label: "TOOL.AVAILABILITY", type: "String" };
    attributeKeys["system.craftsmanship"] = { label: "TOOL.CRAFTSMANSHIP", type: "String" };
    attributeKeys["system.weight"] = { label: "TOOL.WEIGHT", type: "Number" };
    attributeKeys["system.cost"] = { label: "TOOL.COST", type: "Number" };
    attributeKeys["system.effect"] = { label: "TOOL.EFFECT", type: "String" };
    
    // Weapon Modification attributes
    attributeKeys["system.availability"] = { label: "WEAPON_MODIFICATION.AVAILABILITY", type: "String" };
    attributeKeys["system.craftsmanship"] = { label: "WEAPON_MODIFICATION.CRAFTSMANSHIP", type: "String" };
    attributeKeys["system.weight"] = { label: "WEAPON_MODIFICATION.WEIGHT", type: "Number" };
    attributeKeys["system.cost"] = { label: "WEAPON_MODIFICATION.COST", type: "Number" };
    attributeKeys["system.effect"] = { label: "WEAPON_MODIFICATION.EFFECT", type: "String" };
    
    // Generic item attributes (common to all items)
    attributeKeys["system.quantity"] = { label: "ITEM.QUANTITY", type: "Number" };
    attributeKeys["system.weight"] = { label: "ITEM.WEIGHT", type: "Number" };
    attributeKeys["system.availability"] = { label: "ITEM.AVAILABILITY", type: "String" };
    attributeKeys["system.craftsmanship"] = { label: "ITEM.CRAFTSMANSHIP", type: "String" };
    attributeKeys["system.cost"] = { label: "ITEM.COST", type: "Number" };
    attributeKeys["system.effect"] = { label: "ITEM.EFFECT", type: "String" };
    attributeKeys["system.upgrades"] = { label: "ITEM.UPGRADES", type: "String" };
    attributeKeys["system.subtype"] = { label: "ITEM.SUBTYPE", type: "String" };
    attributeKeys["system.type"] = { label: "ITEM.TYPE", type: "String" };
    
    // ============================================
    // Module Compatibility (Health Estimate)
    // ============================================
    attributeKeys["system.attributes.hp.value"] = { label: "ATTRIBUTES.HP.VALUE", type: "Number" };
    attributeKeys["system.attributes.hp.max"] = { label: "ATTRIBUTES.HP.MAX", type: "Number" };
    attributeKeys["system.attributes.hp.min"] = { label: "ATTRIBUTES.HP.MIN", type: "Number" };
    
    // Register the attribute keys
    if (CONFIG.ActiveEffect) {
        CONFIG.ActiveEffect.attributeKeys = foundry.utils.mergeObject(
            CONFIG.ActiveEffect.attributeKeys || {},
            attributeKeys
        );
    }
}

/**
 * Status effects replacing the core set.
 *
 * CONFIG.statusEffects is a Proxy in v14: writes go through a trap that also indexes each entry by
 * its id, which is how Actor#toggleStatusEffect(statusId) looks statuses up. Assigning a plain array
 * over it would drop the Proxy and break every condition toggle, so the existing array is emptied
 * and repopulated in place instead.
 * @type {object[]}
 */
const DH_STATUS_EFFECTS = [
    {
        id: "bleeding",
        name: "CONDITION.BLEEDING",
        img: "systems/dark-heresy/assets/icons/conditions/bleeding-minor.svg",
        imgMajor: "systems/dark-heresy/assets/icons/conditions/bleeding-major.svg",
        statuses: ["bleeding"]
    },
    {
        id: "blinded",
        name: "CONDITION.BLINDED",
        img: "systems/dark-heresy/assets/icons/conditions/blinded.svg",
        statuses: ["blinded"]
    },
    {
        id: "deafened",
        name: "CONDITION.DEAFEND",
        img: "systems/dark-heresy/assets/icons/conditions/deafened.svg",
        statuses: ["deafened"]
    },
    {
        id: "fear",
        name: "CONDITION.FEAR",
        img: "systems/dark-heresy/assets/icons/conditions/frightened-minor.svg",
        imgMajor: "systems/dark-heresy/assets/icons/conditions/frightened-major.svg",
        statuses: ["fear"]
    },
    {
        id: "fire",
        name: "CONDITION.FIRE",
        img: "systems/dark-heresy/assets/icons/conditions/ablaze-minor.svg",
        imgMajor: "systems/dark-heresy/assets/icons/conditions/ablaze-major.svg",
        statuses: ["fire"]
    },
    {
        id: "grappled",
        name: "CONDITION.GRAPPLED",
        img: "systems/dark-heresy/assets/icons/conditions/restrained-minor.svg",
        imgMajor: "systems/dark-heresy/assets/icons/conditions/restrained-major.svg",
        statuses: ["grappled"]
    },
    {
        id: "hidden",
        name: "CONDITION.HIDDEN",
        img: "systems/dark-heresy/assets/icons/conditions/hidden.svg",
        statuses: ["hidden"]
    },
    {
        id: "pinned",
        name: "CONDITION.PINNED",
        img: "systems/dark-heresy/assets/icons/conditions/pinned.svg",
        statuses: ["pinned"]
    },
    {
        id: "poisond",
        name: "CONDITION.POISONED",
        img: "systems/dark-heresy/assets/icons/conditions/poisoned-minor.svg",
        imgMajor: "systems/dark-heresy/assets/icons/conditions/poisoned-major.svg",
        statuses: ["poisond"]
    },
    {
        id: "prone",
        name: "CONDITION.PRONE",
        img: "systems/dark-heresy/assets/icons/conditions/prone.svg",
        statuses: ["prone"]
    },
    {
        id: "stunned",
        name: "CONDITION.STUNNED",
        img: "systems/dark-heresy/assets/icons/conditions/stunned-minor.svg",
        imgMajor: "systems/dark-heresy/assets/icons/conditions/stunned-major.svg",
        statuses: ["stunned"]
    },
    {
        id: "fatigued",
        name: "CONDITION.FATIGUED",
        img: "systems/dark-heresy/assets/icons/conditions/fatigued-minor.svg",
        imgMajor: "systems/dark-heresy/assets/icons/conditions/fatigued-major.svg",
        statuses: ["fatigued"]
    },
    {
        id: "suffocating",
        name: "CONDITION.SUFFOCATING",
        img: "systems/dark-heresy/assets/icons/conditions/fatigued-minor.svg",
        statuses: ["suffocating"]
    },
    {
        id: "vacuum",
        name: "CONDITION.VACUUM",
        img: "systems/dark-heresy/assets/icons/conditions/ablaze-minor.svg",
        statuses: ["vacuum"]
    },
    {
        id: "unconscious",
        name: "CONDITION.UNCONSCIOUS",
        img: "systems/dark-heresy/assets/icons/conditions/unconscious.svg",
        statuses: ["unconscious"]
    },
    {
        id: "dead",
        name: "EFFECT.StatusDead", // Foundry Default Text Key
        img: "systems/dark-heresy/assets/icons/conditions/dead.svg",
        statuses: ["dead"]
    }
];

CONFIG.statusEffects.length = 0;
for (const effect of DH_STATUS_EFFECTS) CONFIG.statusEffects.push(effect);

function updateTokenHordeLabel(token) {
    if (!token?.actor) return;
    const actor = token.actor;
    if (actor.type !== "npc") {
        if (token.hordeLabel) {
            token.hordeLabel.destroy();
            token.hordeLabel = null;
        }
        return;
    }

    // Use getter to get horde value from token actor (actual instance on canvas)
    const hordeValue = Number(actor.horde);
    const shouldShow = Number.isFinite(hordeValue) && hordeValue > 0;
    if (!shouldShow) {
        if (token.hordeLabel) token.hordeLabel.visible = false;
        return;
    }

    const labelText = `${hordeValue}`;
    if (!token.hordeLabel) {
        const style = new PIXI.TextStyle({
            fontFamily: "Signika",
            fontSize: 18,
            fill: "#ffffff",
            stroke: "#000000",
            strokeThickness: 3
        });
        token.hordeLabel = new PIXI.Text(labelText, style);
        token.hordeLabel.anchor.set(0.5, 1);
        token.addChild(token.hordeLabel);
    } else {
        token.hordeLabel.text = labelText;
        token.hordeLabel.visible = true;
    }

    token.hordeLabel.position.set(token.w / 2, -2);
}

Hooks.once("init", async function() {
    // Load template.json for accessing skill specialities
    let templateData = {};
    try {
        const response = await fetch("systems/dark-heresy/template.json");
        templateData = await response.json();
    } catch (e) {
        console.warn("Dark Heresy: Could not load template.json", e);
    }
    
    const dataModels = createDataModels(templateData, foundry);
    Object.assign(CONFIG.Actor.dataModels, dataModels.Actor);
    Object.assign(CONFIG.Item.dataModels, dataModels.Item);

    CONFIG.Combat.initiative = { formula: "@initiative.base + @initiative.bonus", decimals: 0 };
    CONFIG.Combat.documentClass = DarkHeresyCombat;
    CONFIG.specialStatusEffects.DEFEATED = "dead";
    CONFIG.ActiveEffect.documentClass = DarkHeresyActiveEffect;
    CONFIG.Actor.documentClass = DarkHeresyActor;
    CONFIG.Token.documentClass = woundsTokenDocument(CONFIG.Token.documentClass,actor=>Dh.rulesetFor(actor));
    CONFIG.Item.documentClass = DarkHeresyItem;
    
    // Register default icons for actors
    CONFIG.Actor.defaultIcons = CONFIG.Actor.defaultIcons || {};
    CONFIG.Actor.defaultIcons.acolyte = "systems/dark-heresy/assets/tokens/unknown.webp";
    CONFIG.Actor.defaultIcons.heretic = "systems/dark-heresy/assets/tokens/unknown.webp";
    CONFIG.Actor.defaultIcons.npc = "systems/dark-heresy/assets/tokens/unknown.webp";
    CONFIG.Actor.defaultIcons.vehicle = "systems/dark-heresy/assets/icons/vehicle.svg";
    CONFIG.Actor.defaultIcons.voidship = "systems/dark-heresy/assets/icons/ship.svg";
    
    // Token bar attributes come from primaryTokenAttribute/secondaryTokenAttribute in system.json.
    // CONFIG.Token.attributeBars and CONFIG.Token.defaults do not exist in v14.

    // Register default icons for items
    CONFIG.Item.defaultIcons = CONFIG.Item.defaultIcons || {};
    CONFIG.Item.defaultIcons.weapon = "systems/dark-heresy/assets/icons/armoury/melee_weapons/sword.webp";
    CONFIG.Item.defaultIcons.ammunition = "systems/dark-heresy/assets/icons/armoury/ammunition/standard_ammo.webp";
    CONFIG.Item.defaultIcons.weaponModification = "systems/dark-heresy/assets/icons/armoury/modifications/modification.webp";
    CONFIG.Item.defaultIcons.armour = "systems/dark-heresy/assets/icons/armoury/protective_gear/full_armor.webp";
    CONFIG.Item.defaultIcons.forceField = "systems/dark-heresy/assets/icons/armoury/protective_gear/force_field.webp";
    CONFIG.Item.defaultIcons.cybernetic = "systems/dark-heresy/assets/icons/armoury/cybernetics/cybernetics.webp";
    CONFIG.Item.defaultIcons.drug = "systems/dark-heresy/assets/icons/armoury/drugs_and_consumables/medicine.webp";
    CONFIG.Item.defaultIcons.gear = "systems/dark-heresy/assets/icons/armoury/misc/box.webp";
    CONFIG.Item.defaultIcons.tool = "systems/dark-heresy/assets/icons/armoury/tools_and_gear/combi-tool.webp";
    CONFIG.Item.defaultIcons.criticalInjury = "systems/dark-heresy/assets/icons/body_parts/blood.webp";
    CONFIG.Item.defaultIcons.malignancy = "systems/dark-heresy/assets/icons/misc/chaos.webp";
    CONFIG.Item.defaultIcons.mentalDisorder = "systems/dark-heresy/assets/icons/conditions/mentally_ill.webp";
    CONFIG.Item.defaultIcons.mutation = "systems/dark-heresy/assets/icons/mutations/scales.webp";
    CONFIG.Item.defaultIcons.psychicPower = "systems/dark-heresy/assets/icons/psyhic_powers/bolt.webp";
    CONFIG.Item.defaultIcons.talent = "systems/dark-heresy/assets/icons/aptitudes/general.webp";
    CONFIG.Item.defaultIcons.specialAbility = "systems/dark-heresy/assets/icons/misc/aquila.webp";
    CONFIG.Item.defaultIcons.trait = "systems/dark-heresy/assets/icons/aptitudes/toughness.webp";
    CONFIG.Item.defaultIcons.vehicleWeapon = "systems/dark-heresy/assets/icons/armoury/ranged_weapons/heavy.webp";
    CONFIG.Item.defaultIcons.vehicleTrait = "systems/dark-heresy/assets/icons/aptitudes/toughness.webp";
    CONFIG.Item.defaultIcons.shipWeapon = "systems/dark-heresy/assets/icons/armoury/ranged_weapons/heavy.webp";
    CONFIG.Item.defaultIcons.aptitude = "systems/dark-heresy/assets/icons/aptitudes/general.webp";
    CONFIG.Item.defaultIcons.race = "systems/dark-heresy/assets/icons/misc/inquisition.webp";
    CONFIG.Item.defaultIcons.origin = "systems/dark-heresy/assets/icons/misc/inquisition.webp";
    
    // Register item types from template.json
    if (templateData?.Item?.types) {
        CONFIG.Item.typeLabels = {};
        templateData.Item.types.forEach(type => {
            const key = `TYPES.Item.${type.toLowerCase()}`;
            CONFIG.Item.typeLabels[type] = game.i18n.localize(key) || type;
        });
    }
    
    
    // Register Active Effect attribute keys for dark-heresy system
    registerActiveEffectAttributeKeys();
    game.darkHeresy = {
        api: createDarkHeresyAPI(),
        localization: Object.freeze({
            characteristicTerm: (actor,key) => characteristicTerm(actor,key,{localize:k=>game.i18n.localize(k),language:game.i18n.lang,ruleset:Dh.rulesetFor(actor).id}),
            ruleTerm: (value, book = "ow", field = "") => ruleTerm(value, book, game.i18n.lang, field),
            ruleText: (value, book = "ow", field = "") => ruleText(value, book, game.i18n.lang, field)
        }),
        config: Dh,
        templateData: templateData,
        // Разбор свойств оружия пригождается в макросах и в консоли: проверить,
        // как система прочитала строку Special, иначе можно только выстрелом.
        util: DarkHeresyUtil,
        // Сторона и зона машины пригодны и в макросах: МИ иногда назначает
        // попадание рукой — например, при огне с закрытых позиций.
        vehicle: {
            getFacing: _getVehicleFacing,
            getZone: _getVehicleZone
        },
        // Мастер создания — макросом и из шапки листа.
        openCharacterWizard: openCharacterWizard,
        startCharacterCreation: startCharacterCreation,
        CharacterWizard: CharacterWizard,
        // Окно окружения — макросом и из панели сцены.
        openEnvironment: openEnvironment,
        // Падение — разовое событие, а не состояние: вешать его на фишку нечем,
        // и высоту знает только стол. Поэтому оно открыто макросом:
        // game.darkHeresy.applyFallingDamage(actor, 12)
        applyFallingDamage: applyFallingDamage,
        // Разовая починка стволов, раздутых багом листа модификаций до 1.3.1.
        // Без аргументов — только отчёт: game.darkHeresy.repairModifiedWeapons()
        // Починить: game.darkHeresy.repairModifiedWeapons({ apply: true })
        repairModifiedWeapons: repairModifiedWeapons,
        // Пустотный бой. Диалог не открывается, всё принимается параметрами —
        // так правила можно прогнать сценарием, не кликая мышью.
        ship: {
            attack: rollShipAttack,
            salvo: rollShipSalvo,
            action: rollShipAction,
            startTurn: _onShipTurnStart,
            boarding: rollBoardingAction,
            ram: _resolveRam,
            ignite: igniteShipComponent,
            vent: ventShipComponent,
            depressurise: depressuriseShipComponent,
            applyDamage: applyShipDamage
        },
        // Проверка принадлежности обычно идёт сама, на очередных десяти очках
        // Порчи. Здесь она открыта макросам: МИ иногда правит Порчу задним
        // числом, и тогда сверку нужно позвать руками.
        heretic: {
            checkAllegiance: checkHereticAllegiance,
            acquisition: prepareAcquisition
        },
        testInit: {
            prepareCommonRoll,
            prepareCombatRoll,
            preparePsychicPowerRoll
        },
        tests: {
            fateSnapshotVersion: 1,
            commonRoll,
            combatRoll,
            // Урон — отдельный шаг: по карточке его запускает кнопка. Чтобы
            // прогонять бой скриптом, нужен тот же вход без карточки.
            damageRoll
        }
    };
    game.macro = DhMacroUtil;
    foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
    // Все пять листов доступны обоим типам персонажа: книгу выбирают в анкете, а не
    // при заведении актора. По умолчанию тип открывается своим привычным листом.
    for (const [id, sheet] of Object.entries(Dh.bookSheets))
        foundry.documents.collections.Actors.registerSheet("dark-heresy", sheet, {
            types: ["acolyte", "heretic"],
            makeDefault: id === "dh2",
            label: game.i18n?.localize(Dh.rulesets[id]?.label ?? id) ?? id
        });
    foundry.documents.collections.Actors.registerSheet("dark-heresy", NpcSheet, { types: ["npc"], makeDefault: true });
    foundry.documents.collections.Actors.registerSheet("dark-heresy", VehicleSheet, { types: ["vehicle"], makeDefault: true });
    foundry.documents.collections.Actors.registerSheet("dark-heresy", VoidshipSheet, { types: ["voidship"], makeDefault: true });
    foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
    foundry.documents.collections.Items.registerSheet("dark-heresy", WeaponSheet, { types: ["weapon"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", VehicleWeaponSheet, { types: ["vehicleWeapon"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", VehicleTraitSheet, { types: ["vehicleTrait"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", ShipWeaponSheet, { types: ["shipWeapon"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", ShipComponentSheet, { types: ["shipComponent"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", AmmunitionSheet, { types: ["ammunition"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", WeaponModificationSheet, { types: ["weaponModification"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", ArmourSheet, { types: ["armour"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", ForceFieldSheet, { types: ["forceField"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", CyberneticSheet, { types: ["cybernetic"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", DrugSheet, { types: ["drug"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", GearSheet, { types: ["gear"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", ToolSheet, { types: ["tool"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", CriticalInjurySheet, { types: ["criticalInjury"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", MalignancySheet, { types: ["malignancy"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", MentalDisorderSheet, { types: ["mentalDisorder"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", MutationSheet, { types: ["mutation"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", PsychicPowerSheet, { types: ["psychicPower"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", TalentSheet, { types: ["talent"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", SpecialAbilitySheet, { types: ["specialAbility"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", TraitSheet, { types: ["trait"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", AptitudeSheet, { types: ["aptitude"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", RaceSheet, { types: ["race"], makeDefault: true });
    foundry.documents.collections.Items.registerSheet("dark-heresy", OriginSheet, { types: ["origin"], makeDefault: true });


    initializeHandlebars();

    registerSystemSettings();

});

Hooks.once("ready", async function() {
    applyAtmosphereSetting(game.settings.get("dark-heresy", "atmosphericEffects"));
    game.darkHeresy.ready = migrateWorld();
    await game.darkHeresy.ready;

    game.socket.on("system.dark-heresy", data => {
        if (data?.type === "autoDamage") {
            applyAutoDamageFromSocket(data.payload).catch(error => {
                console.error("dark-heresy | Damage operation", error);
                ui.notifications.error(game.i18n.localize("UI.DAMAGE_NEEDS_REVIEW"));
            });
        }
        // Игрок без права создавать Акторов просит Ведущего завести ему лист.
        if (data?.type === "startCharacter") handleStartCharacterRequest(data.userId);
        if (data?.type === "characterStarted") handleCharacterStarted(data);
        // Игрок бросил сам — кнопку с карточки снимает ведущий: обновить чужое
        // сообщение может только он.
        if (data?.type === "resolvePendingRoll" && game.users.activeGM === game.user) {
            _clearPendingRollButtons(data.payload?.messageId);
        }
    });
    CONFIG.ChatMessage.documentClass.prototype.getRollData = function() {
        return this.getFlag("dark-heresy", "rollData");
    };


});


/* -------------------------------------------- */
/*  Other Hooks                                 */
/* -------------------------------------------- */

/**
 * Не дать машине проехать больше, чем позволяет объявленный режим хода.
 *
 * Пройденное копится за раунд: машину редко тащат одним движением, а лимит
 * считается на весь ход. Счётчик обнуляется на смене раунда вместе с прочим.
 * Строгость поведения выбирается настройкой мира — фишку двигают и просто
 * чтобы поправить её положение на карте.
 */
/**
 * Тихо копить, сколько машина прошла за раунд.
 *
 * Нужно ровно для одного: правило смотрит, шла ли машина в прошлом раунде и как
 * быстро. Поэтому здесь только счёт — ни предупреждений, ни запретов. Фишку
 * двигают и просто чтобы поправить её положение, и ругаться на это незачем.
 */
Hooks.on("preUpdateToken", (tokenDoc, changes) => {
    if (tokenDoc.actor?.type !== "vehicle") return;
    if (changes.x === undefined && changes.y === undefined) return;
    // Счётчик выставляют этим же обновлением — значит, так и задумано (перенос
    // на новом раунде, расстановка сцены). Своё значение не навязываем.
    if (foundry.utils.getProperty(changes, "flags.dark-heresy.movedThisRound") !== undefined) return;

    const grid = tokenDoc.parent?.grid;
    if (!grid?.size) return;
    const dx = (changes.x ?? tokenDoc.x) - tokenDoc.x;
    const dy = (changes.y ?? tokenDoc.y) - tokenDoc.y;
    const metres = Math.hypot(dx, dy) / grid.size * (grid.distance || 1);
    if (metres <= 0) return;

    const already = Number(tokenDoc.getFlag("dark-heresy", "movedThisRound")) || 0;
    foundry.utils.setProperty(changes, "flags.dark-heresy.movedThisRound", already + metres);
});

/*
 * Мятеж (стр. 224). Всякий раз, когда Дух падает ниже 70, 40 и 10, капитан
 * проверяет Командование. В бою проверка ждёт конца боя, и сколько бы порогов
 * ни прошли за бой, проверка одна.
 *
 * Старое значение запоминает клиент, который правит корабль, — у остальных его
 * нет, поэтому карточка появится ровно один раз.
 */
Hooks.on("preUpdateActor", (actor, changes) => {
    if (actor?.type !== "voidship") return;
    if (foundry.utils.getProperty(changes, "system.morale.value") === undefined) return;
    actor._dhMoralePrev = Number(actor._source.system.morale?.value) || 0;
});

Hooks.on("updateActor", async (actor, changes, options, userId) => {
    if (actor?.type !== "voidship") return;
    const prev = actor._dhMoralePrev;
    delete actor._dhMoralePrev;
    if (prev === undefined || userId !== game.user.id) return;
    const now = Number(actor._source.system.morale?.value) || 0;
    const crossed = [70, 40, 10].filter(t => prev >= t && now < t);
    if (!crossed.length) return;
    const inCombat = game.combats.some(c => c.started && c.combatants.some(cb => cb.actor?.id === actor.id));
    if (inCombat) {
        await actor.setFlag("dark-heresy", "mutinyPending", true);
        return;
    }
    await _postMutinyWarning(actor, crossed);
});

Hooks.on("deleteCombat", async combat => {
    if (game.users.activeGM !== game.user) return;
    const seen = new Set();
    for (const cb of combat.combatants) {
        const ship = cb.actor;
        if (ship?.type !== "voidship" || seen.has(ship.id)) continue;
        seen.add(ship.id);
        if (!ship.getFlag("dark-heresy", "mutinyPending")) continue;
        await ship.unsetFlag("dark-heresy", "mutinyPending");
        await _postMutinyWarning(ship, null);
    }
});

Hooks.on("refreshToken", (token) => {
    updateTokenHordeLabel(token);
});

/**
 * Книга спрашивается там, где заводят персонажа.
 *
 * Раньше её выбирали на самом листе, под портретом. Но книга — это не свойство,
 * которое правят по ходу игры: от неё зависят и лист, и цены, и шаги Мастера.
 * Поэтому спрашиваем один раз, при создании, а на листе строки больше нет.
 *
 * Диалог создания складывает поля формы прямо в данные документа, поэтому хватает
 * добавить в форму <select name="system.ruleset"> — ничего перехватывать не нужно.
 */
Hooks.on("renderDialogV2", (dialog, element) => {
    const form = element.querySelector?.("form") ?? element;
    const typeSelect = form?.querySelector?.('select[name="type"]');
    // Тот ли это диалог: создание Актёра узнаётся по типам, которые он предлагает.
    if (!typeSelect || !typeSelect.querySelector('option[value="acolyte"]')) return;
    if (form.querySelector('select[name="system.ruleset"]')) return;

    // Еретик остаётся типом ради заведённых раньше персонажей, но заводить новых им
    // незачем: Чёрный Крестовый Поход — это теперь выбор книги, а не типа документа.
    typeSelect.querySelector('option[value="heretic"]')?.remove();

    const group = document.createElement("div");
    group.className = "form-group";
    const label = document.createElement("label");
    label.textContent = game.i18n.localize("RULESET.CHARACTER_BOOK");
    const fields = document.createElement("div");
    fields.className = "form-fields";
    const select = document.createElement("select");
    select.name = "system.ruleset";
    for (const id of Object.keys(Dh.rulesets)) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = game.i18n.localize(Dh.rulesets[id].label);
        select.append(option);
    }
    fields.append(select);
    group.append(label, fields);

    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = game.i18n.localize("RULESET.CHARACTER_BOOK_HINT");
    group.append(hint);

    typeSelect.closest(".form-group").after(group);

    // Книга есть только у персонажа: у НИП, техники и корабля её не спрашиваем.
    const sync = () => { group.hidden = !["acolyte", "heretic"].includes(typeSelect.value); };
    typeSelect.addEventListener("change", sync);
    sync();
});

/**
 * Персонаж открывается листом своей книги сразу, а не после первой правки.
 */
Hooks.on("preCreateActor", (actor, data) => {
    if (!["acolyte", "heretic"].includes(data?.type)) return;
    const sheet = `dark-heresy.${Dh.sheetFor(data)}`;
    if (foundry.utils.getProperty(data, "flags.core.sheetClass") === sheet) return;
    actor.updateSource({"flags.core.sheetClass": sheet});
});

/**
 * Назвал книгу — получил её лист.
 *
 * Лист выбирается флагом core.sheetClass, который Foundry читает при открытии окна.
 * Ставим его тут, а не при рендере: окно уже открытого листа иначе осталось бы
 * прежним до перезахода, и игрок решил бы, что выбор книги ничего не сделал.
 */
Hooks.on("updateActor", async (actor, changes) => {
    // И наоборот: лист, выбранный вручную через настройку окна, называет книгу. Иначе
    // персонаж открывался бы листом Only War, а считался бы по Dark Heresy.
    const chosenSheet = foundry.utils.getProperty(changes, "flags.core.sheetClass");
    if (chosenSheet && actor.isOwner) {
        const book = Object.entries(Dh.bookSheets).find(([, sheet]) => chosenSheet.endsWith(sheet.name))?.[0];
        if (book && actor.system.ruleset !== book) await actor.update({"system.ruleset": book});
        return;
    }
    if (foundry.utils.getProperty(changes, "system.ruleset") === undefined) return;
    if (!["acolyte", "heretic"].includes(actor?.type)) return;
    const wanted = `dark-heresy.${Dh.sheetFor(actor)}`;
    if (actor.getFlag("core", "sheetClass") === wanted) return;
    // Меняет владелец: флаг живёт на документе, и чужой клиент его записать не может.
    if (!actor.isOwner) return;
    const open = actor.sheet?.rendered;
    await actor.setFlag("core", "sheetClass", wanted);
    // Класс листа меняется только при пересоздании окна, поэтому открытое закрываем
    // и открываем снова — уже нужным.
    if (open) { await actor.sheet.close(); actor.sheet.render(true); }
});

Hooks.on("updateActor", async (actor, changes) => {
    if (actor?.type === "npc") {
    const tokens = actor.getActiveTokens(true);
    for (const token of tokens) {
        updateTokenHordeLabel(token);
    }
    }

    // Усталость правит бессознательным состоянием: превысила предел — боец падает,
    // вернулась в предел — поднимается. Правило одно и то же, откуда бы усталость
    // ни пришла: от критического урона, от огня, от проталкивания психосилы или
    // прямой правки на листе, — поэтому проверка висит на изменении актёра.
    if (foundry.utils.getProperty(changes, "system.fatigue.value") !== undefined
        || foundry.utils.getProperty(changes, "system.fatigue.max") !== undefined) {
        // Хук отрабатывает у каждого подключённого клиента, поэтому проверку ведёт
        // только назначенный GM: иначе при двух ведущих за столом обморок печатает
        // две одинаковые карточки — по одной с каждого клиента.
        if (game.users.activeGM === game.user) await syncFatigueState(actor);
    }

    // Проверка принадлежности делается на каждых очередных 10 очках Порчи
    // (Black Crusade, стр. 75). Считает её тот же назначенный GM: иначе за столом
    // с двумя ведущими бог сменится дважды и объявит об этом двумя карточками.
    if (Dh.rulesetFor(actor).id === "bc"
        && foundry.utils.getProperty(changes, "system.corruption") !== undefined
        && game.users.activeGM === game.user) {
        await checkHereticAllegiance(actor);
        if (Dh.rulesetFor(actor).corruption.track === "gifts") await checkGiftThresholds(actor);
    }
});

/**
 * Сменить покровителя, если счёт улучшений это требует (Black Crusade, стр. 75).
 *
 * Порог пересекают только вверх: Порча не убывает, а правка задним числом не
 * должна гонять бога туда-сюда. Смена не спрашивает — по книге она обязательна,
 * — но объявляется карточкой, потому что меняет цены всех дальнейших улучшений.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
/**
 * Объявить о пересечении порога Даров Богов (Black Crusade, стр. 289).
 *
 * Дар выдаётся не за каждые N очков, а на именованных порогах, и у Легионера-
 * предателя они свои. Пройденный максимум держим на флаге: Порча может и упасть
 * (или её поправят руками), а один и тот же порог не должен срабатывать дважды.
 *
 * Сам бросок не делается — таблица Даров лежит в компендиуме, и результат
 * выбирает ведущий: часть Даров требует его решения.
 *
 * @param {Actor} actor
 */
async function checkGiftThresholds(actor) {
    const points = Number(actor.corruption) || 0;
    const legionnaire = !!actor.getFlag("dark-heresy", "spaceMarine");
    const thresholds = legionnaire ? Dh.giftThresholds.legionnaire : Dh.giftThresholds.disciple;
    const reached = thresholds.filter(t => points >= t);
    if (!reached.length) return;

    const highest = reached[reached.length - 1];
    const seen = Number(actor.getFlag("dark-heresy", "giftThreshold")) || 0;
    if (highest <= seen) return;
    await actor.setFlag("dark-heresy", "giftThreshold", highest);

    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="dark-heresy chat roll"><div class="dh-card is-neutral">
            <div class="dh-card-h"><span class="who">${actor.name}</span>
            <span class="verdict">${game.i18n.localize("GIFT.THRESHOLD")}</span></div>
            <div class="dh-card-b"><dl class="dh-kv">
                <dt>${game.i18n.localize("TITLE.CORRUPTION")}</dt><dd>${points}</dd>
                <dt>${game.i18n.localize("GIFT.REACHED")}</dt><dd>${highest}</dd>
                <dd class="full">${game.i18n.localize("GIFT.ROLL_HINT")}</dd>
            </dl></div></div></div>`
    });
}

async function checkHereticAllegiance(actor) {
    const decade = Math.floor((Number(actor.corruption) || 0) / 10);
    const seen = Number(actor.getFlag("dark-heresy", "allegianceDecade")) || 0;
    if (decade <= seen) return;
    await actor.setFlag("dark-heresy", "allegianceDecade", decade);

    const leader = actor.system.alignmentLeader || "undivided";
    const patron = actor.system.patron || "undivided";
    if (leader === patron) return;

    await actor.update({ "system.patron": leader });
    await ChatMessage.create({
        user: game.user.id,
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="dark-heresy chat roll">
            <div class="dh-card is-neutral">
                <div class="dh-card-h">
                    <span class="who">${actor.name}</span>
                    <span class="verdict">${game.i18n.localize("ALLEGIANCE.CHANGED")}</span>
                </div>
                <div class="dh-card-b">
                    <p class="dh-note">${game.i18n.localize(Dh.chaosPatrons[patron])}
                        → <b>${game.i18n.localize(Dh.chaosPatrons[leader])}</b></p>
                </div>
            </div>
        </div>`
    });
}


/**
 * Check if a token/actor has a specific condition
 * @param {Token|Actor} tokenOrActor
 * @param {string} conditionId
 * @returns {boolean}
 */
function _hasCondition(tokenOrActor, conditionId) {
    const actor = tokenOrActor?.actor ?? tokenOrActor;
    return !!actor?.hasCondition?.(conditionId);
}

/**
 * Get condition modifier for attacks (Stunned gives +20)
 * @param {Object} rollData
 * @returns {number}
 */
function _getTargetConditionModifier(rollData) {
    if (!rollData?.flags?.isAttack || !rollData?.targets?.length) return 0;
    
    const target = rollData.targets[0];
    if (!target || !canvas?.ready) return 0;
    if (target.sceneId && canvas.scene?.id !== target.sceneId) return 0;
    
    const token = canvas.tokens.get(target.tokenId);
    if (!token) return 0;
    
    const isMelee = rollData?.weapon?.weaponClass === "melee" || rollData?.weapon?.class === "melee";
    let modifier = 0;

    // Which condition earned the modifier, in the same shape the attacker's own
    // conditions already use. The roll card used to label this total "Stunned"
    // whatever caused it, so a prone target read as Stunned (-10) and a grappled
    // one as Stunned (+20). The numbers were right; only the name was wrong.
    const sources = [];
    const note = (key, value) => {
        modifier += value;
        sources.push(`${game.i18n.localize(key)} (${value > 0 ? "+" : ""}${value})`);
    };

    // Stunned gives +20 to all attacks (melee and ranged)
    if (_hasCondition(token, "stunned")) {
        note("CONDITION.STUNNED", 20);
    }

    // Беспомощного бьют почти наверняка: без сознания или мёртв.
    // "Мёртв" берёт ключ ядра: своей строки CONDITION.* у него нет.
    if (_hasCondition(token, "unconscious")) {
        note("CONDITION.UNCONSCIOUS", 30);
    } else if (_hasCondition(token, "dead")) {
        note("EFFECT.StatusDead", 30);
    }

    // Лежачего в ближнем бою добивать легче, а вот попасть в него издалека труднее:
    // он представляет меньшую цель.
    if (_hasCondition(token, "prone")) {
        note("CONDITION.PRONE", isMelee ? 10 : -10);
    }

    // По схваченному Владением оружия бьют с +20: ему не до защиты
    // (BC, стр. 236).
    if (isMelee && _hasCondition(token, "grappled")) {
        note("CONDITION.GRAPPLED", 20);
    }

    rollData.targetConditionSources = sources.join(", ");
    return modifier;
}

/**
 * Get target size modifier for ranged attacks
 * @param {object} rollData
 * @returns {number}
 */
function _getTargetSizeModifier(rollData) {
    // Only apply to ranged attacks
    if (!rollData?.flags?.isAttack || !rollData?.weapon?.isRange) return 0;
    
    // Get target
    if (!rollData?.targets?.length) return 0;
    const target = rollData.targets[0];
    if (!target || !canvas?.ready) return 0;
    if (target.sceneId && canvas.scene?.id !== target.sceneId) return 0;
    
    const token = canvas.tokens.get(target.tokenId);
    if (!token || !token.actor) return 0;
    
    // Чёрный Панцирь, терминаторская броня и сама величина — одно правило, и живёт
    // оно в size-rules.mjs, где его видно целиком.
    return targetSizeModifier({
        size: token.actor.system?.size,
        spaceMarine: !!token.actor.getFlag("dark-heresy", "spaceMarine"),
        armour: armourSizeModifier(token.actor.items ?? [])
    });
}

/**
 * Подпись к поправке за величину: «Hulking», «Hulking, Black Carapace»,
 * «Hulking, Black Carapace, armour +10». Число стоит рядом в самой карточке.
 *
 * @param {object} rollData
 * @returns {string} пустая строка, если цели нет или правило неприменимо
 */
function _targetSizeLabel(rollData) {
    if (!rollData?.flags?.isAttack || !rollData?.weapon?.isRange) return "";
    const target = rollData?.targets?.[0];
    if (!target || !canvas?.ready) return "";
    if (target.sceneId && canvas.scene?.id !== target.sceneId) return "";
    const actor = canvas.tokens.get(target.tokenId)?.actor;
    if (!actor) return "";

    const parts = describeTargetSize({
        size: actor.system?.size,
        spaceMarine: !!actor.getFlag("dark-heresy", "spaceMarine"),
        armour: armourSizeModifier(actor.items ?? [])
    });
    const words = [game.i18n.localize(`SIZE_STEP.${parts.sizeName.toUpperCase()}`)];
    if (parts.carapace) words.push(game.i18n.localize("BLACK_CARAPACE"));
    if (parts.armour) words.push(game.i18n.format("SIZE_FROM_ARMOUR", {value: parts.armour > 0 ? `+${parts.armour}` : parts.armour}));
    return words.join(", ");
}

/**
 * Горит ли машина, в которой сидит этот боец.
 *
 * По книге экипаж и пассажиры горящей машины получают −20 ко всем без разбора
 * проверкам, пока пламя не собьют. Отдельного состояния бойцу не вешаем: он
 * страдает ровно до тех пор, пока горит машина, и снимать флажок вручную
 * пришлось бы каждому. Проверка стоит дёшево — машин в мире единицы.
 * @param {Actor} actor
 * @returns {Actor|null} машина, если она горит и боец внутри
 */
function _burningVehicleFor(actor) {
    if (!actor?.id || !game.actors) return null;
    for (const vehicle of game.actors) {
        if (vehicle.type !== "vehicle" || !vehicle.system?.conditions?.onFire) continue;
        const members = vehicle.system.crew?.members;
        if (Array.isArray(members) && members.some(m => m?.actorId === actor.id)) return vehicle;
    }
    return null;
}

/**
 * Штраф бойцу за то, что он находится внутри горящей машины.
 * @param {Actor} actor
 * @returns {number} −20, пока машина горит, иначе 0
 */
function _burningCrewModifier(actor) {
    return _burningVehicleFor(actor) ? -20 : 0;
}

/**
 * Поправка за величину цели.
 *
 * Одна и та же цифра работает в две стороны: крупную машину легче подстрелить и
 * ей же труднее вильнуть из-под выстрела, поэтому таблица живёт отдельно.
 * @param {number} size  Ступень величины, 1..10; по умолчанию 4 — обычная
 * @returns {number}     Поправка к попаданию: −30 у крошечной, +60 у титанической
 */
function _sizeModifier(size) {
    return sizeToHitModifier(size);
}

/**
 * Get condition modifier for all rolls
 * @param {Actor} actor
 * @param {object} rollData - Optional: roll data to check attack type
 * @returns {number}
 */
/**
 * Навыки, в которых слух обычно решает. Обе книги оставляют перечень на
 * усмотрение ведущего, поэтому это подсказка на карточке, а не автопровал.
 */
const DH_HEARING_SKILLS = [
    "SKILL.AWARENESS", "SKILL.SCRUTINY", "SKILL.CHARM", "SKILL.COMMAND",
    "SKILL.DECEIVE", "SKILL.INQUIRY", "SKILL.INTERROGATION", "SKILL.INTIMIDATE"
];

function _getActorConditionModifier(actor, rollData = null) {
    if (!actor) return 0;

    let modifier = 0;
    // Из чего сложился штраф — карточка броска раньше подписывала его «Страх»
    // вслепую, каким бы ни была причина.
    const sources = [];
    const note = (key, value) => {
        modifier += value;
        sources.push(`${game.i18n.localize(key)} (${value > 0 ? "+" : ""}${value})`);
    };

    // Усталость наказывает по-разному в двух играх, и обе модели живут здесь —
    // это поправка к броску, а не к характеристике, поэтому Стойкость, бонусы и
    // всё производное от них остаются нетронутыми.
    const fatigueLevel = Number(actor.system?.fatigue?.value) || 0;
    if (fatigueLevel > 0) {
        const fatigueRule = Dh.rulesetFor(actor).fatigue.penalty;
        if (fatigueRule === "flat10") {
            // Black Crusade (стр. 246): любой уровень усталости — −10 ко всем проверкам.
            note("CONDITION.FATIGUED", -10);
        } else {
            // Dark Heresy 2 (стр. 233): характеристика, чей бонус ниже уровня усталости,
            // считается «уставшей» и в структурном времени идёт за половину (округляя
            // вверх). Половина выражена вычитаемым, чтобы лечь в общий счёт поправок:
            // ceil(t/2) − t равно −floor(t/2).
            const key = rollData?.characteristicKey;
            const characteristic = key ? actor.characteristics?.[key] : null;
            if (characteristic && Number(characteristic.bonus) < fatigueLevel) {
                const total = Number(characteristic.total) || 0;
                if (total > 0) note("CONDITION.FATIGUED", -Math.floor(total / 2));
            }
        }
    }

    const tokens = actor.getActiveTokens(true);
    const token = tokens[0];

    // Fear gives -10 to everything
    if (token && _hasCondition(token, "fear")) {
        note("CONDITION.FEAR", -10);
    }
    
    const isMelee = rollData?.weapon?.weaponClass === "melee" || rollData?.weapon?.class === "melee";
    const isRanged = !!rollData?.weapon && !isMelee;

    // Глухота (BC, стр. 256; DH2, стр. 243): автопровал любой проверки, которая
    // опирается на слух. Какие это проверки, обе книги оставляют на усмотрение
    // ведущего, поэтому система не проваливает бросок молча, а помечает его —
    // решение остаётся за столом.
    // Навык опознаём по его метке: rollData.name у навыков — это ключ вида
    // SKILL.AWARENESS, отдельного поля с именем навыка в броске нет.
    if (token && _hasCondition(token, "deafened") && DH_HEARING_SKILLS.includes(rollData?.name)) {
        rollData.deafenedWarning = true;
    }

    // Слепота: −30 к Владению оружием и прочим проверкам, опирающимся на зрение.
    // Автопровал Меткости живёт не здесь — это не поправка, а блокировка броска.
    if (token && _hasCondition(token, "blinded")
        && (isMelee || rollData?.characteristicKey === "weaponSkill")) {
        note("CONDITION.BLINDED", -30);
    }

    // Лежачий бьёт хуже и уворачивается ещё хуже: −10 к Владению оружием и
    // −20 к уклонению (BC, стр. 245). Стрельбе лёжа правила не мешают.
    if (token && _hasCondition(token, "prone")) {
        if (rollData?.flags?.isEvasion) note("CONDITION.PRONE", -20);
        else if (isMelee) note("CONDITION.PRONE", -10);
    }

    // Придавленный огнём не может целиться: −20 к стрельбе.
    if (token && isRanged && _hasCondition(token, "pinned")) {
        note("CONDITION.PINNED", -20);
    }

    // Захват (BC, стр. 236; DH2, стр. 221). Штрафа к броскам самого схваченного
    // правила не дают — раньше здесь стояли выдуманные −20. Что даёт захват:
    // участники не могут пользоваться реакциями, а бьют по ним легче. Реакция
    // блокируется ниже, в подготовке уклонения; бонус атакующему — в поправках
    // за состояние цели.

    if (rollData) rollData.actorConditionSources = sources.join(", ");
    return modifier;
}


/**
 * Add Event Listeners for Buttons on chat boxes.
 * ChatLog is an ApplicationV2 since v13: the hook passes an HTMLElement and may fire more than once
 * (sidebar tab plus popout), so chatListeners() guards against binding twice.
 */
Hooks.on("renderChatLog", (chat, html) => {
    chatListeners(html);
});


/** Add Options to context Menu of chatmessages */
Hooks.on("getChatMessageContextOptions", addChatMessageContextOptions);

/**
 * Create a macro when dropping an entity on the hotbar
 * Item      - open roll dialog for item
 */
Hooks.on("hotbarDrop", (bar, data, slot) => {
    if (data.type === "Item" || data.type === "Actor")
    {
        DhMacroUtil.createMacro(data, slot);
        return false;
    }
});

Hooks.on("renderDarkHeresySheet", (sheet, html, data) => {
    html.find("input.cost").prop("disabled", game.settings.get("dark-heresy", "autoCalcXPCosts"));
    // item-cost fields for talents and psychic powers are always disabled (read-only)
    // Cost is edited in item sheet settings, not in progression tab
    html.find("input.item-cost").prop("disabled", true);
});

/**
 * Register Health Estimate provider for Dark Heresy system
 * This allows Health Estimate module to properly calculate health fractions
 */
// Hook to update actor sheets when effects are updated (for conditions synchronization)
async function _onFatigueEffectExpired(effect) {
    if (game.user !== game.users.activeGM || !effect.statuses?.has("unconscious")) return;
    const actor = effect.actor ?? effect.parent;
    if (!actor?.getFlag("dark-heresy", "fatigueCollapse")) return;
    await actor.unsetFlag("dark-heresy", "fatigueCollapse");
    await actor.update({"system.fatigue.value": Number(actor.system.fatigue?.max) || 0});
}

Hooks.on("updateActiveEffect", async (effect, changes) => {
    if (foundry.utils.getProperty(changes, "duration.expired") === true) await _onFatigueEffectExpired(effect);
});
Hooks.on("deleteActiveEffect", _onFatigueEffectExpired);

Hooks.on("updateActiveEffect", (effect, updateData, options, userId) => {
    // Update all open sheets for this actor
    if (effect.parent && effect.parent.sheet?.rendered) {
        effect.parent.sheet.render(false);
    }
});

Hooks.on("createActiveEffect", (effect, options, userId) => {
    // Update all open sheets for this actor
    if (effect.parent && effect.parent.sheet?.rendered) {
        effect.parent.sheet.render(false);
    }
});

Hooks.on("deleteActiveEffect", (effect, options, userId) => {
    // Update all open sheets for this actor
    if (effect.parent && effect.parent.sheet?.rendered) {
        effect.parent.sheet.render(false);
    }
});

/**
 * Trap for the effects that keep vanishing.
 *
 * Effects have disappeared from actors twice without anyone deleting them through the
 * sheet. Migration, the conditions markup and the sheet's own delete handlers have each
 * been ruled out, so the cause is still unknown - and an intermittent bug that leaves no
 * trace cannot be chased by re-reading the code.
 *
 * This records who deleted what, and from where. The call stack is the point: it names
 * the code path, which is the one thing the symptom never told us. Deletions made
 * through the sheet are the expected case and are marked as such rather than hidden, so
 * the log stays readable while still showing everything.
 *
 * Turn it off with the "Log effect deletions" setting once the cause is found.
 */
Hooks.on("preDeleteActiveEffect", (effect, options, userId) => {
    if (!game.settings.get("dark-heresy", "logEffectDeletions")) return;
    const stack = (new Error().stack || "").split("\n").slice(2, 10).join("\n");
    console.warn(
        `[dark-heresy] ActiveEffect deleted: "${effect.name}"\n` +
        `  parent:    ${effect.parent?.documentName} "${effect.parent?.name}"\n` +
        `  user:      ${game.users.get(userId)?.name ?? userId}\n` +
        `  condition: ${effect.flags?.["dark-heresy"]?.key ?? "—"}\n` +
        `  statuses:  ${[...(effect.statuses ?? [])].join(", ") || "—"}\n` +
        `  changes:   ${(effect.changes ?? []).map(c => `${c.key} mode=${c.mode} ${c.value}`).join(" | ") || "—"}\n` +
        `  options:   ${JSON.stringify(options)}\n` +
        `  stack:\n${stack}`
    );
});

// Fire effect is now handled in Combat.prototype.nextTurn override above
// This ensures it fires at the START of the player's turn, BEFORE the turn ends

/**
 * Отдать бросок игроку вместо автоматики?
 *
 * Настройка мира плюс наличие живого владельца: у чисто ведущих персонажей
 * просить некого, там всё как раньше — бросает система.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
/**
 * Показывать ли вход в Мастер создания.
 *
 * Настройка может быть ещё не зарегистрирована в момент, когда лист рисует шапку,
 * и тогда чтение бросается. При любой неясности кнопка остаётся скрытой: скрыть
 * недоделанное безопаснее, чем показать его по ошибке.
 * @returns {boolean}
 */
function _creationWizardVisible() {
    try { return !!game.settings.get("dark-heresy", "showCreationWizard"); }
    catch (err) { return false; }
}

function _shouldPromptPlayerRoll(actor) {
    if (!actor?.hasPlayerOwner) return false;
    try {
        return !!game.settings.get("dark-heresy", "promptPlayerRolls");
    } catch (err) {
        return false;
    }
}

/**
 * Данные теста силы воли против горения — один источник для автоброска и для
 * кнопки в чате, чтобы сложность и подпись не разъезжались.
 * @param {Actor} actor
 * @returns {object}
 */
function _createFireWillpowerRollData(actor) {
    const rollData = DarkHeresyUtil.createCharacteristicRollData(actor, "willpower");
    rollData.name = "CONDITION.FIRE_WILLPOWER_TEST";
    rollData.flags = rollData.flags || {};
    rollData.flags.isFireEffect = true;
    // Серьёзная проверка = Challenging (+0)
    rollData.difficulty = { value: 0, text: game.i18n.localize("DIFFICULTY.CHALLENGING") };
    return rollData;
}

/**
 * Снять кнопку с карточки состояния после того, как бросок сделан.
 *
 * Чужое сообщение правит только ведущий, поэтому игрок сюда не ходит напрямую:
 * он шлёт событие в сокет, а вызов происходит уже на стороне ведущего.
 *
 * @param {string} messageId
 */
async function _clearPendingRollButtons(messageId) {
    const message = game.messages.get(messageId);
    if (!message) return;
    const content = message.content.replace(/<div class="effect-buttons">[\s\S]*?<\/div>/g, "");
    if (content !== message.content) await message.update({ content });
}

/**
 * Пометить карточку как отработанную — из-под игрока через ведущего.
 * @param {HTMLElement} button
 */
function _resolvePendingCard(button) {
    const messageId = button?.closest?.("[data-message-id]")?.dataset?.messageId;
    if (!messageId) return;
    if (game.user.isGM) _clearPendingRollButtons(messageId);
    else game.socket.emit("system.dark-heresy", { type: "resolvePendingRoll", payload: { messageId } });
}

/**
 * Бросок кровопотери руками игрока: та же механика, что и в автоматике —
 * d100, смерть на 90 и выше, — но кости кидает владелец персонажа.
 * @param {Event} event
 */
/**
 * Попытка сбить пламя.
 *
 * По обеим книгам (BC, стр. 257; DH2, стр. 243) это полное действие: упасть ничком
 * и пройти Трудную (−20) проверку Ловкости. Правило одинаково, поэтому развилки по
 * играм здесь нет. «Ничком» вешаем сразу — персонаж падает независимо от исхода.
 *
 * @param {Event} event
 */
async function onExtinguishFireClick(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const actor = await _getActorFromOwnerId(button.dataset.actorId, button.dataset.tokenId);
    if (!actor) return;

    if (!actor.hasCondition("prone")) await actor.addCondition("prone", { type: "minor" });

    const rollData = DarkHeresyUtil.createCharacteristicRollData(actor, "agility");
    rollData.name = "EFFECTS.EXTINGUISH";
    rollData.target.modifier = -20;
    await _computeCommonTarget(rollData);
    await _rollTarget(rollData);
    if (rollData.flags.isSuccess) await actor.removeCondition("fire");
    await _sendRollToChat(rollData);
    if (rollData.flags.isSuccess) {
        ui.notifications.info(game.i18n.format("EFFECTS.FIRE_OUT", { name: actor.name }));
    }
}

/**
 * Порог смерти от кровопотери на броске 1d100.
 *
 * Обычно это 10 процентов (Black Crusade, стр. 247). У десантника Хаоса свёртывание
 * крови делает орган Ларрамана, и шанс вдвое меньше (стр. 50) — карточку имплантов
 * ему выдаёт создание персонажа, она же и считается.
 */
/**
 * Течёт ли у него кровь вообще.
 *
 * У десантника Караула Смерти орган Ларрамана свёртывает кровь мгновенно, и
 * Кровопотери он не знает ни в каком виде (Deathwatch, стр. 36). Это не половина
 * шанса, как у десантника Хаоса, а полное отсутствие правила.
 */
function suffersBloodLoss(actor) {
    const rules = Dh.rulesetFor(actor).bloodLoss;
    if (!rules?.spaceMarineImmune) return true;
    return !actor?.getFlag?.("dark-heresy", "spaceMarine");
}

function bloodLossDeathThreshold(actor) {
    const rules = Dh.rulesetFor(actor).bloodLoss;
    const chance = Number(rules?.deathChance) || 10;
    const halved = (actor?.items ?? []).some(item =>
        item?.type === "trait" && /Chaos Space Marine Implants/i.test(ruleName(item)));
    return 100 - (halved ? Math.floor(chance / 2) : chance) + 1;
}

async function resolveBloodLoss(actor, rollResult) {
    const isDead = Number(rollResult) >= bloodLossDeathThreshold(actor);
    if (isDead) await actor.addCondition("dead", {type: "minor"});
    return {lethal: true, rollResult, isDead};
}

async function onBloodLossRollClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const actorId = button.dataset.actorId;
    const actor = await _getActorFromOwnerId(button.dataset.actorUuid || actorId, button.dataset.tokenId);
    if (!actor?.isOwner || button.disabled) return;

    button.disabled = true;

    const deathRoll = new Roll("1d100");
    await deathRoll.evaluate();
    const rollResult = deathRoll.total;
    const {isDead} = await resolveBloodLoss(actor, rollResult);

    const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/bleeding-effect.hbs", {
        actorName: actor.name,
        actorId: actor.id,
        tokenId: button.dataset.tokenId,
        rollResult,
        isDead,
        pendingRoll: false,
        lethal: true,
        actorUuid: actor.uuid,
            ownerId: actor.id
    });

    await ChatMessage.create({
        content: html,
        speaker: ChatMessage.getSpeaker({ actor }),
        flags: { "dark-heresy": { type: "bleeding-effect", actorId: actor.id } }
    });
    _resolvePendingCard(button);
}

/**
 * Apply On Fire effect: damage, fatigue, and willpower test
 */
async function _applyFireEffect(actor, combatant) {
    // Roll 1d10 damage (energy, to Body). Fire ignores armour, but NOT Toughness:
    // the Toughness Bonus is still subtracted before anything reaches the wounds.
    const damageRoll = new Roll("1d10");
    await damageRoll.evaluate();
    const rawDamage = damageRoll.total;
    const toughnessBonus = _toughnessBonus(actor);
    const damageAmount = Math.max(rawDamage - toughnessBonus, 0);
    
    // Apply 1 level of Fatigue
    const currentFatigue = Number(actor.fatigue.value) || 0;
    const maxFatigue = Number(actor.fatigue.max) || 0;
    // Обрезать по пределу нельзя: именно превышение предела роняет персонажа
    // без сознания (BC, стр. 246). С обрезкой горящий тлел бы вечно.
    const newFatigue = currentFatigue + 1;
    await actor.update({ "system.fatigue.value": newFatigue });
    
    // Create Willpower test roll data (серьёзная проверка, +0)
    const willpowerRollData = _createFireWillpowerRollData(actor);

    // Бросает либо автоматика, либо сам игрок — по настройке.
    const pendingRoll = _shouldPromptPlayerRoll(actor);
    if (!pendingRoll) {
        // Roll willpower test immediately (no dialog)
        await _computeCommonTarget(willpowerRollData);
        await _rollTarget(willpowerRollData);
        // _rollTarget already computes the result (isSuccess, dos, dof)
    }
    
    // Apply damage directly to wounds (energy, to Body).
    // Fire bypasses armour only — Toughness was already deducted above.
    const currentWounds = Number(actor.wounds.value) || 0;
    const maxWounds = Number(actor.wounds.max) || 0;
    const currentCritical = Number(actor.wounds.critical) || 0;
    
    let newWounds = currentWounds;
    let newCritical = currentCritical;
    
    if (currentWounds >= maxWounds) {
        // All damage goes to critical wounds
        newCritical += damageAmount;
    } else if (currentWounds + damageAmount > maxWounds) {
        // Some damage to wounds, rest to critical
        const woundsToAdd = maxWounds - currentWounds;
        newWounds = maxWounds;
        newCritical += (damageAmount - woundsToAdd);
    } else {
        newWounds += damageAmount;
    }
    
    await actor.update({
        "system.wounds.value": newWounds,
        "system.wounds.critical": newCritical
    });
    
    // Create and send chat message with all results
    const templateData = {
        actorName: actor.name,
        actorId: actor.id,
        tokenId: combatant?.token?.id,
        damageAmount: damageAmount,
        rawDamage: rawDamage,
        toughnessBonus: toughnessBonus,
        pendingRoll: pendingRoll,
        fatigueApplied: 1,
        newFatigue: newFatigue,
        maxFatigue: maxFatigue,
        // Willpower test results
        name: willpowerRollData.name,
        result: willpowerRollData.result,
        target: willpowerRollData.target,
        flags: willpowerRollData.flags,
        dos: willpowerRollData.dos,
        dof: willpowerRollData.dof,
        difficulty: willpowerRollData.difficulty,
        rolledWith: willpowerRollData.rolledWith || game.i18n.localize("CHARACTERISTIC.WILLPOWER"),
        actorUuid: actor.uuid,
            ownerId: actor.id
    };
    
    const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/fire-effect.hbs", templateData);
    
    await ChatMessage.create({
        content: html,
        speaker: ChatMessage.getSpeaker({ actor: actor, token: combatant?.token }),
        flags: {
            "dark-heresy": {
                type: "fire-effect",
                actorId: actor.id
            }
        }
    });
}

/**
 * Apply Bleeding effect: death chance roll
 */
/**
 * Начислить урон прямо в раны, минуя броню и — по требованию — Стойкость.
 *
 * Огонь, вакуум и падение бьют в обход брони, но про Стойкость у каждого своя
 * оговорка, поэтому её вычитание вынесено параметром. Перелив в критический
 * урон одинаков для всех, и живёт он здесь, а не тремя копиями.
 *
 * @param {Actor} actor
 * @param {number} raw сырой бросок урона
 * @param {boolean} ignoreToughness вычитать ли бонус Стойкости
 * @returns {Promise<number>} сколько ран легло на самом деле
 */
async function _applyDirectDamage(actor, raw, ignoreToughness = false) {
    const tb = ignoreToughness ? 0 : _toughnessBonus(actor);
    const amount = Math.max(Number(raw) - tb, 0);
    if (amount <= 0) return 0;

    const next = woundsAfterDamage({
        wounds: actor.wounds.value,
        critical: actor.wounds.critical,
        max: actor.wounds.max,
        amount
    });
    await actor.update({ "system.wounds.value": next.wounds, "system.wounds.critical": next.critical });
    return amount;
}

/**
 * Залечить раны напрямую. Критические снимаются первыми: именно они держат
 * персонажа у порога смерти, и заживают они последними.
 *
 * @param {Actor} actor
 * @param {number} raw сколько очков восстановить
 * @returns {Promise<number>} сколько в итоге снято
 */
async function _applyDirectHealing(actor, raw) {
    const amount = Math.max(Number(raw) || 0, 0);
    if (amount <= 0) return 0;

    const before = (Number(actor.wounds.value) || 0) + (Number(actor.wounds.critical) || 0);
    const next = woundsAfterHealing({
        wounds: actor.wounds.value,
        critical: actor.wounds.critical,
        amount
    });
    await actor.update({ "system.wounds.value": next.wounds, "system.wounds.critical": next.critical });
    return before - (next.wounds + next.critical);
}

/**
 * Общая карточка состояния: заголовок, строки и необязательный подвал с кнопками.
 *
 * @param {Actor} actor
 * @param {object} combatant
 * @param {string} titleKey
 * @param {string[]} lines
 * @param {string} extra
 */
async function _postConditionCard(actor, combatant, titleKey, { figures = [], notes = [], extra = "" } = {}) {
    // Цифры идут блоками, как в карточке броска: крупное число в рамке и
    // трафаретная подпись под ним. Пояснения — отдельной строкой снизу, чтобы
    // взгляд сначала цеплял значения, а не абзац текста.
    let body = "";
    if (figures.length) {
        const cells = figures.map(f =>
            '<div class="dh-fig' + (f.lead ? " lead" : "") + '">'
            + '<span class="n">' + f.n + "</span>"
            + '<span class="dh-cap">' + f.cap + "</span></div>").join("");
        const width = figures.length === 2 ? " two" : (figures.length === 1 ? " one" : "");
        body += '<div class="dh-figures' + width + '">' + cells + "</div>";
    }
    if (notes.length) {
        body += '<dl class="dh-kv">'
            + notes.map(t => '<dd class="full">' + t + "</dd>").join("")
            + "</dl>";
    }
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor, token: combatant?.token }),
        content: '<div class="dark-heresy chat roll"><div class="dh-card is-neutral">'
            + '<div class="dh-card-h"><span class="who">' + actor.name + "</span>"
            + '<span class="verdict">' + game.i18n.localize(titleKey) + "</span></div>"
            + '<div class="dh-card-b">' + body + extra + "</div></div></div>"
    });
}

/**
 * Удушье на ходу (BC, стр. 256; DH2, стр. 244 — правило одно и то же).
 *
 * В структурном времени дыхания хватает на удвоенный бонус Стойкости раундов, и
 * каждый из них требует проверки Стойкости: провал — уровень усталости. Когда
 * запас вышел, боец теряет сознание независимо от усталости, а без воздуха
 * умирает ещё через бонус Стойкости раундов.
 *
 * @param {Actor} actor
 * @param {object} combatant
 */
/**
 * Разрешить отложенное Токсичное (Dark Heresy 2, стр. 152).
 *
 * Правило говорит «в конце хода»; система разбирает это в начале следующего
 * хода отравленного — раньше в нашей раскладке ходов зацепиться не за что.
 * Разница в один промежуток между ходами, зато проверка не теряется.
 *
 * @param {Actor} actor
 * @param {object} combatant
 */
async function _applyToxicEffect(actor, combatant) {
    const pending = actor.getFlag("dark-heresy", "toxic");
    const value = Number(pending?.value) || 0;
    // Отметка без данных — состояние навесили руками; тогда разбирает стол.
    if (!value) {
        await _postConditionCard(actor, combatant, "CONDITION.POISONED", {
            notes: [game.i18n.localize("WEAPON.TRAIT.TOXIC_MANUAL")]
        });
        return;
    }

    // Проверку за игрока система делает только если стол так настроен. Иначе
    // кости кидает владелец: раньше бросок уходил мимо него всегда, хотя тот же
    // выбор уже соблюдался для горения и кровопотери.
    if (_shouldPromptPlayerRoll(actor)) {
        const label = `${game.i18n.localize("WEAPON.TRAIT.TOXIC")} (${value})`;
        await _postConditionCard(actor, combatant, "CONDITION.POISONED", {
            notes: [game.i18n.format("WEAPON.TRAIT.TOXIC_PROMPT", { test: label })],
            extra: `<button type="button" class="roll-toxic-test" data-actor-id="${actor.id}"`
                + ` data-token-id="${combatant?.tokenId ?? ""}">`
                + game.i18n.localize("WEAPON.TRAIT.TOXIC_ROLL") + "</button>"
        });
        return;
    }

    await _resolveToxicTest(actor, combatant, value);
}

/**
 * Разрешить отравление: проверка Стойкости со штрафом −10×X, при провале ещё
 * 1d10 урона, который не снижают ни броня, ни стойкость.
 *
 * Вынесено отдельно, потому что вызывать это могут двое: автоматика на ходу
 * отравленного и кнопка в карточке, когда бросок оставлен игроку.
 *
 * @param {Actor} actor
 * @param {object|null} combatant
 * @param {number} value значение свойства Токсичное
 */
async function _resolveToxicTest(actor, combatant, value) {
    const test = await _rollWeaponEffectTest(actor, "toughness", -10 * value,
        `${game.i18n.localize("WEAPON.TRAIT.TOXIC")} (${value})`);
    let taken = 0;
    if (test && !test.success) {
        const extra = new Roll("1d10");
        await extra.evaluate();
        // Ни броня, ни стойкость этот урон не снижают.
        taken = await _applyDirectDamage(actor, extra.total, true);
    }
    await actor.unsetFlag("dark-heresy", "toxic");
    if (actor.hasCondition("poisond")) await actor.removeCondition("poisond");

    await _postConditionCard(actor, combatant, "CONDITION.POISONED", {
        figures: [{ n: taken, cap: game.i18n.localize("CHAT.DAMAGE"), lead: taken > 0 }],
        notes: [game.i18n.localize("WEAPON.TRAIT.TOXIC_RESOLVED")]
    });
}

/**
 * Бросок против отравления руками игрока. Механика та же, что в автоматике.
 * @param {Event} event
 */
async function onToxicTestClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const actor = await _getActorFromOwnerId(button.dataset.actorId, button.dataset.tokenId || null);
    if (!actor) return;

    const value = Number(actor.getFlag("dark-heresy", "toxic")?.value) || 0;
    if (!value) return;

    button.disabled = true;
    _resolvePendingCard(button);
    await _resolveToxicTest(actor, null, value);
}

async function _applySuffocationEffect(actor, combatant) {
    const tb = _toughnessBonus(actor);
    const held = (Number(actor.getFlag("dark-heresy", "suffocationRounds")) || 0) + 1;
    await actor.setFlag("dark-heresy", "suffocationRounds", held);

    const limit = Math.max(tb * 2, 1);
    const figures = [];
    const notes = [];

    if (actor.hasCondition("unconscious")) {
        // Без сознания и без воздуха — счёт идёт до смерти.
        const deadline = Math.max(tb, 1);
        const dying = (Number(actor.getFlag("dark-heresy", "suffocationDying")) || 0) + 1;
        await actor.setFlag("dark-heresy", "suffocationDying", dying);
        figures.push({ n: dying + " / " + deadline, cap: game.i18n.localize("EFFECTS.SUFFOCATION_DYING"), lead: true });
        if (dying >= deadline && !actor.hasCondition("dead")) {
            await actor.addCondition("dead", { type: "major" });
            notes.push(game.i18n.localize("EFFECTS.YOU_DIED"));
        }
    } else if (held > limit) {
        // Запас вышел: сознание теряется, сколько бы усталости ни оставалось.
        await actor.addCondition("unconscious", {});
        figures.push({ n: held + " / " + limit, cap: game.i18n.localize("EFFECTS.SUFFOCATION_BREATH"), lead: true });
        notes.push(game.i18n.localize("EFFECTS.SUFFOCATION_OUT_OF_AIR"));
    } else {
        const rollData = DarkHeresyUtil.createCharacteristicRollData(actor, "toughness");
        rollData.name = "CONDITION.SUFFOCATING";
        await _computeCommonTarget(rollData);
        await _rollTarget(rollData);
        let gained = 0;
        if (!rollData.flags.isSuccess) {
            const current = Number(actor.system?.fatigue?.value) || 0;
            await actor.update({ "system.fatigue.value": current + 1 });
            gained = 1;
        }
        figures.push({ n: rollData.result, cap: game.i18n.localize("CHAT.ROLL") });
        figures.push({ n: rollData.target.final, cap: game.i18n.localize("CHAT.TARGET") });
        figures.push({ n: "+" + gained, cap: game.i18n.localize("TITLE.FATIGUE"), lead: gained > 0 });
        notes.push(game.i18n.localize("EFFECTS.SUFFOCATION_BREATH") + ": " + held + " / " + limit);
    }

    await _postConditionCard(actor, combatant, "CONDITION.SUFFOCATING", { figures, notes });
}

/**
 * Вакуум на ходу (BC, стр. 256; DH2, стр. 244 — правило одно и то же).
 *
 * Первые раунды, числом в бонус Стойкости, проходят без вреда. Дальше каждый
 * раунд — взрывной урон от разгерметизации мимо брони И Стойкости, и проверка
 * Стойкости против холода открытого космоса. Удушье вешается отдельным
 * состоянием: без источника воздуха оно идёт своим чередом.
 *
 * @param {Actor} actor
 * @param {object} combatant
 */
async function _applyVacuumEffect(actor, combatant) {
    const tb = _toughnessBonus(actor);
    const exposed = (Number(actor.getFlag("dark-heresy", "vacuumRounds")) || 0) + 1;
    await actor.setFlag("dark-heresy", "vacuumRounds", exposed);

    if (exposed <= tb) {
        await _postConditionCard(actor, combatant, "CONDITION.VACUUM", {
            figures: [{ n: exposed + " / " + tb, cap: game.i18n.localize("EFFECTS.VACUUM_GRACE") }]
        });
        return;
    }

    const decompression = new Roll("1d10");
    await decompression.evaluate();
    const taken = await _applyDirectDamage(actor, decompression.total, true);

    const cold = DarkHeresyUtil.createCharacteristicRollData(actor, "toughness");
    cold.name = "EFFECTS.VACUUM_COLD";
    await _computeCommonTarget(cold);
    await _rollTarget(cold);
    let burn = 0;
    if (!cold.flags.isSuccess) {
        const coldRoll = new Roll("1d10");
        await coldRoll.evaluate();
        burn = await _applyDirectDamage(actor, coldRoll.total, true);
    }

    if (!actor.hasCondition("suffocating")) await actor.addCondition("suffocating", {});
    await _postConditionCard(actor, combatant, "CONDITION.VACUUM", {
        figures: [
            { n: taken, cap: game.i18n.localize("EFFECTS.VACUUM_DECOMPRESSION"), lead: taken > 0 },
            { n: burn, cap: game.i18n.localize("EFFECTS.VACUUM_COLD"), lead: burn > 0 }
        ],
        notes: [game.i18n.localize("EFFECTS.VACUUM_IGNORES")]
    });
}

/**
 * Предложить выход из-под огня (BC, стр. 245; DH2, стр. 230 — правило одно и то же).
 *
 * Проверка делается в конце хода, и её сложность зависит от того, обстреливали ли
 * бойца с прошлого хода и сидит ли он в укрытии, — этого система не знает.
 * Поэтому она не бросает сама, а кладёт кнопку: обычная проверка или лёгкая,
 * решает стол.
 *
 * @param {Actor} actor
 * @param {object} combatant
 */
async function _offerPinningEscape(actor, combatant) {
    const tokenId = combatant?.token?.id;
    const attr = tokenId ? ' data-token-id="' + tokenId + '"' : "";
    const buttons = '<div class="effect-buttons">'
        + '<button type="button" class="pinning-escape" data-actor-id="' + actor.id + '"' + attr + ' data-easy="0">'
        + game.i18n.localize("EFFECTS.PINNING_ESCAPE") + "</button>"
        + '<button type="button" class="pinning-escape" data-actor-id="' + actor.id + '"' + attr + ' data-easy="1">'
        + game.i18n.localize("EFFECTS.PINNING_ESCAPE_EASY") + "</button></div>";
    await _postConditionCard(actor, combatant, "CONDITION.PINNED", {
        notes: [game.i18n.localize("EFFECTS.PINNED_RULES")],
        extra: buttons
    });
}

/**
 * Бросок на выход из-под огня.
 *
 * @param {Event} event
 */
async function onPinningEscapeClick(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const actor = await _getActorFromOwnerId(button.dataset.actorId, button.dataset.tokenId);
    if (!actor) return;

    const rollData = DarkHeresyUtil.createCharacteristicRollData(actor, "willpower");
    rollData.name = "EFFECTS.PINNING_ESCAPE";
    // +30, если по бойцу не стреляли с прошлого хода или он в укрытии.
    rollData.target.modifier = button.dataset.easy === "1" ? 30 : 0;
    await _computeCommonTarget(rollData);
    await _rollTarget(rollData);
    if (rollData.flags.isSuccess) await actor.removeCondition("pinned");
    await _sendRollToChat(rollData);
}

/**
 * Урон от падения (BC, стр. 257; DH2, стр. 243 — правило одно и то же).
 *
 * 1d10 ударного плюс единица за каждый метр, в случайную локацию. Броня не
 * защищает, Стойкость — защищает.
 *
 * @param {Actor} actor
 * @param {number} metres сколько метров пролетел
 * @returns {Promise<number>} сколько ран легло
 */
/**
 * Схлопнуть повторяющиеся прибавки в конце формулы.
 *
 * «1d10+2+2+2» с модом на +2 — это след порчи: одна прибавка законна, лишние
 * набежали от открытий листа. Режем хвост до одной. Одиночное «1d10+2»
 * не трогаем: отличить его от честно вписанного профиля данные не позволяют.
 *
 * @param {string} formula
 * @param {number} bonus величина прибавки мода
 * @returns {string}
 */
function _collapseRepeatedBonus(formula, bonus) {
    if (!bonus) return formula;
    const sign = bonus > 0 ? "+" : "-";
    const piece = `${sign}${Math.abs(bonus)}`;
    let text = String(formula ?? "");
    // Хвост из двух и более одинаковых прибавок сжимаем в одну.
    const tail = new RegExp(`(?:\\${sign}${Math.abs(bonus)}){2,}$`);
    if (tail.test(text)) text = text.replace(tail, piece);
    return text;
}

/**
 * Починить стволы, раздутые прежним багом листа модификаций.
 *
 * До версии 1.3.1 лист оружия отдавал в форму уже посчитанный с модами профиль,
 * и закрытие листа впечатывало его в источник. Каждое открытие прибавляло ещё
 * одну копию бонуса.
 *
 * Чинится двумя путями. Если предмет помнит, откуда взят (`compendiumSource`),
 * задетые поля возвращаются из оригинала — это точное восстановление. Если не
 * помнит, схлопываются лишь заведомо лишние повторы в формулах урона и
 * пробития. Числовые поля — меткость, дальность, обойма — так не чинятся:
 * умноженную вдвое обойму от честной не отличить, поэтому они попадают в отчёт
 * на ручной разбор.
 *
 * @param {object} [options]
 * @param {boolean} [options.apply=false] false — только отчёт, ничего не менять
 * @returns {Promise<object[]>} по записи на каждый затронутый ствол
 */
async function repairModifiedWeapons({ apply = false } = {}) {
    const report = [];
    for (const actor of game.actors) {
        const mods = actor.items.filter(i =>
            i.type === "weaponModification" && i.system?.installed && i.system?.weaponId);
        if (!mods.length) continue;

        const byWeapon = new Map();
        for (const mod of mods) {
            const list = byWeapon.get(mod.system.weaponId) || [];
            list.push(mod);
            byWeapon.set(mod.system.weaponId, list);
        }

        for (const [weaponId, installed] of byWeapon) {
            const weapon = actor.items.get(weaponId);
            if (!weapon || weapon.type !== "weapon") continue;
            const src = weapon._source?.system || {};
            const entry = { actor: actor.name, weapon: weapon.name, method: null, changes: {}, manual: [] };

            const origin = weapon._stats?.compendiumSource || weapon.flags?.core?.sourceId;
            let restored = null;
            if (origin) {
                try { restored = await fromUuid(origin); } catch (err) { restored = null; }
            }

            const update = {};
            if (restored?.system) {
                // Точное восстановление: профиль берём из оригинала.
                entry.method = "compendium";
                for (const key of ["damage", "penetration", "attack", "range", "special", "availability"]) {
                    const was = src[key];
                    const should = restored.system[key];
                    if (should !== undefined && String(was) !== String(should)) {
                        update[`system.${key}`] = should;
                        entry.changes[key] = `${was} -> ${should}`;
                    }
                }
                const clipWas = src.clip?.max;
                const clipShould = restored.system.clip?.max;
                if (clipShould !== undefined && Number(clipWas) !== Number(clipShould)) {
                    update["system.clip.max"] = clipShould;
                    entry.changes["clip.max"] = `${clipWas} -> ${clipShould}`;
                }
            } else {
                // Приблизительная: только заведомо лишние повторы в формулах.
                entry.method = "collapse";
                for (const [field, bonusKey] of [["damage", "damageBonus"], ["penetration", "penetrationBonus"]]) {
                    let text = String(src[field] ?? "");
                    for (const mod of installed) {
                        text = _collapseRepeatedBonus(text, Number(mod.system?.effect?.[bonusKey]) || 0);
                    }
                    if (text !== String(src[field] ?? "")) {
                        update[`system.${field}`] = text;
                        entry.changes[field] = `${src[field]} -> ${text}`;
                    }
                }
                // Числовые поля правятся только глазами.
                for (const mod of installed) {
                    const eff = mod.system?.effect || {};
                    if (Number(eff.attackBonus)) entry.manual.push("attack");
                    if (Number(eff.rangeMultiplier) && Number(eff.rangeMultiplier) !== 1) entry.manual.push("range");
                    if (Number(eff.clipMultiplier) && Number(eff.clipMultiplier) !== 1) entry.manual.push("clip.max");
                }
                entry.manual = [...new Set(entry.manual)];
            }

            if (!Object.keys(entry.changes).length && !entry.manual.length) continue;
            if (apply && Object.keys(update).length) await weapon.update(update);
            entry.applied = apply && !!Object.keys(update).length;
            report.push(entry);
        }
    }
    console.table(report.map(r => ({
        actor: r.actor, weapon: r.weapon, method: r.method,
        fixed: Object.keys(r.changes).join(", ") || "-",
        manual: r.manual.join(", ") || "-", applied: !!r.applied
    })));
    return report;
}

async function applyFallingDamage(actor, metres) {
    if (!actor) return 0;
    const distance = Math.max(Number(metres) || 0, 0);
    const roll = new Roll("1d10");
    await roll.evaluate();
    const raw = roll.total + distance;

    const locationRoll = new Roll("1d100");
    await locationRoll.evaluate();
    const location = game.i18n.localize(_getLocation(locationRoll.total));

    const taken = await _applyDirectDamage(actor, raw, false);
    await _postConditionCard(actor, null, "EFFECTS.FALLING", {
        figures: [
            { n: distance, cap: game.i18n.localize("EFFECTS.FALLING_DISTANCE") },
            { n: raw, cap: game.i18n.localize("CHAT.DAMAGE") },
            { n: taken, cap: game.i18n.localize("WOUND.CURRENT"), lead: taken > 0 }
        ],
        notes: [game.i18n.localize("EFFECTS.FALLING_LOCATION") + ": " + location]
    });
    return taken;
}

async function _applyBleedingEffect(actor, combatant) {
    // Брату Караула Смерти кровопотеря не грозит вовсе: за него это делает орган
    // Ларрамана. Состояние с него снимается — держать его нечем.
    if (!suffersBloodLoss(actor)) {
        await actor.removeCondition?.("bleeding");
        return;
    }
    // Кровопотеря — единственное состояние, где две игры разошлись по существу.
    // Black Crusade (стр. 247) каждый раунд кидает 10% на смерть. Dark Heresy 2
    // (стр. 244) смерти не знает вовсе: там это уровень усталости в начале хода,
    // снимаемый проверкой Медицины, и несколько кровотечений не складываются.
    const rules = Dh.rulesetFor(actor).bloodLoss;
    const lethal = rules.lethal;

    // Бросок на смерть может быть отдан игроку: шанс невелик, и отнимать его у
    // владельца персонажа стол обычно не хочет. Усталость же броска не требует.
    const pendingRoll = lethal && _shouldPromptPlayerRoll(actor);
    let rollResult = null;
    let isDead = false;
    let fatigueApplied = 0;

    if (lethal) {
        if (!pendingRoll) {
            const deathRoll = new Roll("1d100");
            await deathRoll.evaluate();
            rollResult = deathRoll.total;
            // Порог зависит от персонажа: обычно 10% (91-100), у десантника Хаоса 5%.
            ({isDead} = await resolveBloodLoss(actor, rollResult));
        }
    } else {
        // Предел не обрезаем: усталость сверх порога обязана уронить бойца,
        // а этим занимается сверка на изменении актёра.
        const current = Number(actor.system?.fatigue?.value) || 0;
        await actor.update({ "system.fatigue.value": current + 1 });
        fatigueApplied = 1;
    }

    const templateData = {
        actorName: actor.name,
        actorId: actor.id,
        tokenId: combatant?.token?.id,
        lethal: lethal,
        rollResult: rollResult,
        isDead: isDead,
        fatigueApplied: fatigueApplied,
        newFatigue: Number(actor.system?.fatigue?.value) || 0,
        maxFatigue: Number(actor.system?.fatigue?.max) || 0,
        pendingRoll: pendingRoll,
        actorUuid: actor.uuid,
            ownerId: actor.id
    };

    const html = await foundry.applications.handlebars.renderTemplate("systems/dark-heresy/template/chat/bleeding-effect.hbs", templateData);

    await ChatMessage.create({
        content: html,
        speaker: ChatMessage.getSpeaker({ actor: actor, token: combatant?.token }),
        flags: {
            "dark-heresy": {
                type: "bleeding-effect",
                actorId: actor.id
            }
        }
    });
}

/**
 * Handle click on Willpower test button in fire effect card
 */
async function onFireWillpowerTestClick(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const button = event.currentTarget;
    const actorId = button.dataset.actorId;
    if (!actorId) return;

    const actor = game.actors.get(actorId);
    if (!actor) return;

    button.disabled = true;
    _resolvePendingCard(button);

    await prepareCommonRoll(_createFireWillpowerRollData(actor));
}

/**
 * Применить итог любого броска к выделенным токенам — уроном или лечением.
 *
 * Броски случаются и мимо боевого конвейера: сила психики, ловушка, падение,
 * медицинская помощь. Раньше такое число переносили на лист руками, и каждый
 * такой перенос — место для ошибки.
 *
 * Число берётся как есть: ни броня, ни стойкость его не трогают. Это осознанно —
 * кнопка применяет то, что показано, и не спорит со столом о том, что уже учтено
 * в самом броске.
 *
 * @param {Event} event
 */
async function onApplyRollClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const amount = Math.max(Number(button.dataset.amount) || 0, 0);
    const healing = button.dataset.mode === "healing";
    if (amount <= 0) return;

    const tokens = canvas?.tokens?.controlled ?? [];
    if (!tokens.length) {
        ui.notifications.warn(game.i18n.localize("CHAT.APPLY_NO_SELECTION"));
        return;
    }

    const touched = [];
    for (const token of tokens) {
        const actor = token.actor;
        if (!actor?.isOwner) continue;
        const applied = healing
            ? await _applyDirectHealing(actor, amount)
            : await _applyDirectDamage(actor, amount, true);
        if (applied > 0) touched.push(`${actor.name} (${applied})`);
    }

    if (!touched.length) {
        ui.notifications.warn(game.i18n.localize("CHAT.APPLY_NOTHING_HAPPENED"));
        return;
    }
    ui.notifications.info(game.i18n.format(healing ? "CHAT.APPLY_HEALED" : "CHAT.APPLY_DAMAGED",
        { targets: touched.join(", ") }));
}

/**
 * Дописать к обычной карточке броска кнопки «применить как урон/лечение».
 *
 * Только к тем, где есть итог и нет своей боевой обработки: у карточек атаки
 * свои кнопки, и вторая пара рядом с ними только путала бы.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
function _addApplyRollButtons(message, html) {
    if (!game.user?.isGM && !message.isOwner) return;
    if (message.getFlag?.("dark-heresy", "rollData")) return;
    if (html.querySelector(".dh-apply-roll")) return;

    const total = Number(message.rolls?.[0]?.total);
    if (!Number.isFinite(total) || total <= 0) return;

    const row = document.createElement("div");
    row.className = "dh-apply-row";
    row.innerHTML =
        `<button type="button" class="dh-apply-roll" data-mode="damage" data-amount="${total}">`
        + `${game.i18n.localize("CHAT.APPLY_DAMAGE")}</button>`
        + `<button type="button" class="dh-apply-roll" data-mode="healing" data-amount="${total}">`
        + `${game.i18n.localize("CHAT.APPLY_HEALING")}</button>`;
    (html.querySelector(".message-content") ?? html).append(row);
}

/**
 * Register chat message click handlers
 */
Hooks.on("renderChatMessageHTML", (message, html, data) => {
    _addApplyRollButtons(message, html);
    const rollData = message.getFlag?.("dark-heresy", "rollData");

    // Карточка пустотного выстрела своя, к rollData отношения не имеет.
    _activateShipChatListeners(html, message);

    // Hide "Roll Damage" button if user doesn't have permission to the actor who made the roll
    if (rollData?.ownerId) {
        const actor = _actorFromRollData(rollData);
        // If actor exists and user is not GM and doesn't own the actor, hide damage button
        if (actor && !game.user.isGM && !actor.isOwner) {
            for (const button of html.querySelectorAll(".invoke-damage")) button.style.display = "none";
        }
    }

    // Кнопки «бросить самому» видит только владелец персонажа (и ведущий):
    // карточка общая, а кости — чужие.
    for (const button of html.querySelectorAll(".roll-willpower-test, .roll-blood-loss")) {
        const actor = game.actors.get(button.dataset.actorId);
        if (actor && !game.user.isGM && !actor.isOwner) button.style.display = "none";
    }

    // Show/hide revert button based on current user's permissions, not message creator's
    if (rollData?.flags?.isDamageRoll) {
        const canRevert = _canManageDamageRevert();
        for (const container of html.querySelectorAll(".effect-buttons")) {
            container.style.display = canRevert ? "" : "none";
        }
    }
});

Hooks.once("ready", function() {
    if (!game.modules.get("healthEstimate")?.active) return;
    if (game.system.id !== "dark-heresy") return;
    
    // Wait a bit for Health Estimate to fully initialize
    setTimeout(() => {
        try {
            // Create Dark Heresy Estimation Provider
            class DarkHeresyEstimationProvider {
                constructor() {
                    this.organicTypes = ["acolyte", "heretic", "npc"];
                }
                
                /**
                 * Calculates health fraction for Dark Heresy system
                 * In Dark Heresy: 0 wounds = full health, max wounds = dead
                 * So fraction = (maxWounds - currentWounds) / maxWounds
                 */
                fraction(token) {
                    try {
                        const wounds = token.actor?.system?.wounds;
                        if (!wounds) return 0;
                        
                        const maxWounds = Number(wounds.max) || 0;
                        const currentWounds = Number(wounds.value) || 0;
                        
                        if (maxWounds <= 0) return 0;
                        
                        // Calculate remaining health as fraction
                        const remainingHealth = Math.max(0, remainingWounds(wounds));
                        return Math.min(remainingHealth / maxWounds, 1);
                    } catch (err) {
                        console.error("Dark Heresy Health Estimate: Error calculating fraction", err);
                        return 0;
                    }
                }
            }
            
            // Override Health Estimate's estimationProvider to use our provider
            if (game.healthEstimate) {
                const darkHeresyProvider = new DarkHeresyEstimationProvider();
                
                // Override the estimationProvider property if it exists
                if (game.healthEstimate.estimationProvider) {
                    const originalProvider = game.healthEstimate.estimationProvider;
                    
                    // Create a proxy that intercepts fraction calls
                    const proxyProvider = new Proxy(originalProvider, {
                        get: function(target, prop) {
                            if (prop === 'fraction' && game.system.id === "dark-heresy") {
                                return function(token) {
                                    // Ensure attributes.hp exists for Health Estimate's internal checks
                                    if (token?.actor) {
                                        const actor = token.actor;
                                        if (actor.system && !actor.system.attributes) {
                                            actor.system.attributes = {};
                                        }
                                        if (actor.system?.attributes && !actor.system.attributes.hp) {
                                            const wounds = actor.system?.wounds || {};
                                            const maxWounds = Number(wounds.max) || 0;
                                            const currentWounds = Number(wounds.value) || 0;
                                            actor.system.attributes.hp = {
                                                value: currentWounds,
                                                max: maxWounds,
                                                min: 0
                                            };
                                        }
                                    }
                                    return darkHeresyProvider.fraction(token);
                                };
                            }
                            return target[prop];
                        }
                    });
                    
                    game.healthEstimate.estimationProvider = proxyProvider;
                }
                
                // Also override getFraction as fallback
                if (game.healthEstimate.getFraction) {
                    const originalGetFraction = game.healthEstimate.getFraction;
                    
                    game.healthEstimate.getFraction = function(token) {
                        // Use our provider for Dark Heresy system
                        if (game.system.id === "dark-heresy" && token?.actor) {
                            // Ensure attributes.hp exists for Health Estimate's internal checks
                            const actor = token.actor;
                            if (actor.system && !actor.system.attributes) {
                                actor.system.attributes = {};
                            }
                            if (actor.system?.attributes && !actor.system.attributes.hp) {
                                const wounds = actor.system?.wounds || {};
                                const maxWounds = Number(wounds.max) || 0;
                                const currentWounds = Number(wounds.value) || 0;
                                actor.system.attributes.hp = {
                                    value: currentWounds,
                                    max: maxWounds,
                                    min: 0
                                };
                            }
                            return darkHeresyProvider.fraction(token);
                        }
                        // Fall back to original for other systems
                        return originalGetFraction.call(this, token);
                    };
                }
            }
        } catch (err) {
            console.error("Dark Heresy: Failed to register Health Estimate provider", err);
        }
    }, 100);
});





/* -------------------------------------------- */
/*  Окружающая среда сцены                      */
/* -------------------------------------------- */

/**
 * Виджет окружения виден всем, окно правит только ГМ.
 *
 * Виджет перерисовывается на готовности, на смене сцены и на любой правке
 * сцены: окружение лежит во флаге сцены, и другие клиенты узнают о правке
 * только через updateScene.
 */
Hooks.once("ready", () => { try { refreshEnvWidget(); } catch (err) { console.warn("dark-heresy | env", err); } });
Hooks.on("canvasReady", () => { try { refreshEnvWidget(); } catch (err) { console.warn("dark-heresy | env", err); } });

/**
 * Тумблер панели окружения — в левой панели инструментов, рядом с линейкой.
 *
 * Панель нужна не каждому столу и не всегда, а убрать её было нечем. Выбор
 * пользовательский: он хранится у самого пользователя и не трогает сцену, —
 * поэтому и тумблер виден всем, а не одному ведущему.
 */
Hooks.on("getSceneControlButtons", controls => {
    const tools = controls?.tokens?.tools;
    if (!tools) return;
    tools.dhEnvironment = {
        name: "dhEnvironment",
        title: "ENVIRONMENT_TOGGLE",
        icon: "fa-solid fa-cloud-sun",
        order: Object.keys(tools).length,
        toggle: true,
        active: !isEnvWidgetHidden(),
        visible: true,
        onChange: (event, active) => setEnvWidgetHidden(!active)
    };
});
Hooks.on("updateScene", (scene) => {
    try {
        refreshEnvWidget();
        // Окно ГМа перерисовываем только когда правили текущую сцену.
        if (scene?.id === canvas?.scene?.id) refreshEnvironment();
    } catch (err) {
        console.warn("dark-heresy | env", err);
    }
});

/**
 * Кнопка «Окружающая среда» в панели инструментов сцены — только ГМ.
 *
 * После открытия окна панель возвращается на «токены»: кнопка-триггер иначе
 * залипает активной, и повторный клик по ней уже не срабатывает.
 */
Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.isGM) return;
    const icon = "fa-solid fa-cloud-sun-rain";
    const title = game.i18n.localize("ENVIRONMENT.TITLE");
    const trigger = () => {
        openEnvironment();
        setTimeout(() => { try { ui.controls?.activate?.({ control: "tokens" }); } catch (err) {} }, 60);
    };
    const entry = {
        name: "dh-env", title, icon, order: 96, visible: true,
        onChange: (_event, active) => { if (active) trigger(); },
        tools: {
            open: { name: "open", title, icon, order: 1, button: true, onChange: () => trigger() }
        },
        activeTool: "open"
    };
    // v13+ отдаёт объект, более ранние сборки — массив.
    if (Array.isArray(controls)) controls.push({ ...entry, layer: null, tools: [{ name: "open", title, icon, button: true, onClick: () => trigger() }] });
    else controls["dh-env"] = entry;
});
