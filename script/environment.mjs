import {environmentText as t} from "./localization/environment-text.mjs";
// ════════════════════════════════════════════════════════════════════════
//  Окружающая Среда — окно ГМа (когитаторный стиль) + экранный виджет.
//  • Окно: левое меню-категории (Погода/Температура/Гравитация/Радиация),
//    справа — редактор с живым предпросмотром механики (корбук 483-484).
//    Только ГМ. Правки авто-сохраняются во флаг текущей сцены.
//  • Виджет: в левом-нижнем углу (справа от списка игроков) — видят ВСЕ.
// ════════════════════════════════════════════════════════════════════════

import {
  normalizeEnv, localizeRow, WEATHER, WEATHER_GROUPS, RAD_TABLE, RAD_PROTECTION, envView, defaultEnv,
  RAD_UNITS, RAD_UNIT_ORDER,
  resolveEnvContainer, readEnvForScene
} from "./environment-data.mjs";

// Экранирование пользовательского текста перед вставкой в разметку виджета.
const esc = v => foundry.utils.escapeHTML(String(v ?? ""));

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
function currentScene() { return globalThis.canvas?.scene ?? game.scenes?.current ?? null; }

const CATS = [
  { key: "weather", label: "UI.WEATHER",     icon: "🌤" },
  { key: "temp",    label: "UI.TEMPERATURE", icon: "🌡" },
  { key: "gravity", label: "UI.GRAVITY",     icon: "🪐" },
  { key: "rad",     label: "UI.RADIATION",   icon: "☢" }
];

export class EnvironmentApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "wh-environment",
    classes: ["dark-heresy", "wh-holo", "wh-environment"],
    window: {title: "UI.ENVIRONMENT", resizable: true},
    position: {width: 560, height: 596}
  };
  static PARTS = {body: {template: "systems/dark-heresy/template/apps/environment.hbs"}};

  constructor(...args) { super(...args); this.envState = { cat: "weather" }; }

  async _prepareContext() {
    const isGM  = game.user.isGM;
    const scene = currentScene();
    const shown = readEnvForScene(scene);
    const v = envView(shown);
    return {
      isGM,
      sceneName: scene?.name || t("UI.NO_ACTIVE_SCENE"),
      cat: this.envState.cat,
      cats: CATS.map(c => ({ ...localizeRow(c), active: c.key === this.envState.cat })),
      isWeather: this.envState.cat === "weather",
      isTemp:    this.envState.cat === "temp",
      isGravity: this.envState.cat === "gravity",
      isRad:     this.envState.cat === "rad",
      env: v,
      weatherGroups: WEATHER_GROUPS.map(g => ({
        label: t(g.label),
        items: WEATHER.filter(w => w.grp === g.grp).map(w => ({ ...localizeRow(w), selected: w.key === v.weather.key && !v.weather.custom }))
      })),
      weatherCustom: v.weather.custom ? v.raw.weatherText : "",
      gravPresets: [0, 0.2, 0.5, 0.8, 1, 1.5, 2, 3].map(g => ({ g, selected: Number(v.raw.gravity) === g })),
      // Поле ввода показывает дозу в выбранной единице, а не в мкЗв/ч.
      radInput: v.rad.text,
      radUnitLabel: v.rad.unit,
      radUnits: RAD_UNIT_ORDER.map(k => ({ key: k, label: t(RAD_UNITS[k].label), selected: k === v.rad.unitKey })),
      radTable: RAD_TABLE.map(localizeRow),
      radProtection: RAD_PROTECTION.map(localizeRow),
      note: v.note
    };
  }

  _patch(patch) {
    if (!game.user.isGM) return Promise.resolve();
    const scene = currentScene();
    if (!scene) { ui.notifications?.warn(t("UI.ENVIRONMENT_NO_ACTIVE_SCENE")); return Promise.resolve(); }
    // Serialize writes so a second field edit reads the first edit's committed state.
    const operation = (this.pendingSave ?? Promise.resolve()).catch(() => {}).then(async () => {
      const c = resolveEnvContainer(scene);
      await c.write(normalizeEnv({...c.read(), ...patch}));
      if (this.rendered) await this.render();
    });
    this.pendingSave = operation;
    operation.catch(error => {
      console.error("dark-heresy | environment save", error);
      ui.notifications?.error(t("UI.ENVIRONMENT_SAVE_FAILED"));
    });
    return operation;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;

    // Категории (левое меню)
    el.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => { this.envState.cat = b.dataset.cat; this.render(); }));

    if (!game.user.isGM) return;   // редактирование — только ГМ

    // Погода
    el.querySelectorAll("[data-weather]").forEach(b => b.addEventListener("click", () => this._patch({ weather: b.dataset.weather, weatherText: "" })));
    el.querySelector("[name=weatherText]")?.addEventListener("change", e => this._patch({ weatherText: e.target.value.trim() }));

    // Температура
    const tempIn = el.querySelector("[name=temp]");
    tempIn?.addEventListener("change", e => this._patch({ temp: Math.round(Number(e.target.value) || 0) }));
    el.querySelector("[name=tempRange]")?.addEventListener("input", e => { if (tempIn) tempIn.value = e.target.value; });
    el.querySelector("[name=tempRange]")?.addEventListener("change", e => this._patch({ temp: Math.round(Number(e.target.value) || 0) }));
    el.querySelectorAll("[data-tempstep]").forEach(b => b.addEventListener("click", () => {
      this._patch({ temp: Math.round((readEnvForScene(currentScene()).temp || 0) + Number(b.dataset.tempstep)) });
    }));

    // Гравитация
    el.querySelector("[name=gravity]")?.addEventListener("change", e => this._patch({ gravity: Math.max(0, Number(e.target.value) || 0) }));
    el.querySelectorAll("[data-grav]").forEach(b => b.addEventListener("click", () => this._patch({ gravity: Number(b.dataset.grav) })));

    // Радиация: число вводится в текущих единицах, хранится всегда в мкЗв/ч.
    el.querySelector("[name=radDose]")?.addEventListener("change", e => {
        const unit = RAD_UNITS[readEnvForScene(currentScene()).radUnit] || RAD_UNITS.uSv;
        const entered = Math.max(0, Number(e.target.value) || 0);
        this._patch({ radDose: entered * unit.factor });
    });
    // Кнопка единиц перебирает мкЗв → мЗв → Зв по кругу; сама доза не меняется.
    el.querySelectorAll("[data-radunit]").forEach(b => b.addEventListener("click", () => {
        this._patch({ radUnit: b.dataset.radunit });
    }));

    // Заметка ГМа (видна игрокам в виджете)
    el.querySelector("[name=note]")?.addEventListener("change", e => this._patch({ note: e.target.value.trim() }));

    // Сброс к норме
    el.querySelector("[data-act=reset]")?.addEventListener("click", () => this._patch(defaultEnv()));
  }

  async close(options) { await this.pendingSave?.catch(() => {}); const result = await super.close(options); if (_instance === this) _instance = null; return result; }
}

let _instance = null;
export function openEnvironment() {
  if (!game.user.isGM) { ui.notifications?.info(t("UI.THE_ENVIRONMENT_IS_SET_BY_THE_GAMEMASTER")); return null; }
  if (!_instance) _instance = new EnvironmentApp();
  _instance.render({force: true});
  return _instance;
}
export function refreshEnvironment() { if (_instance?.rendered) _instance.render(); }

// ══════════════════════════ ЭКРАННЫЙ ВИДЖЕТ ════════════════════════════════
// Постоянная панель в левом-нижнем углу (справа от списка игроков) — для ВСЕХ.
function _widgetHTML(v) {
  const rows = [];
  rows.push(`<div class="wh-env-w-row" style="--c:${v.weather.tone}">
    <span class="wh-env-w-ic">${v.weather.icon}</span>
    <span class="wh-env-w-k">${esc(v.weather.rowLabel)}</span>
    <span class="wh-env-w-v">${esc(v.weather.label)}</span>
  </div>`);
  const tSign = v.temp.testSigned ? `${t("UI.TOUGHNESS_SHORT")}${v.temp.testSigned}` : "";
  rows.push(`<div class="wh-env-w-row" style="--c:${v.temp.tone}">
    <span class="wh-env-w-ic">🌡</span>
    <span class="wh-env-w-k">${esc(t("UI.TEMPERATURE"))}</span>
    <span class="wh-env-w-v">${v.temp.value}°C${tSign ? ` <b class="wh-env-w-t">${tSign}</b>` : ""}</span>
  </div>`);
  rows.push(`<div class="wh-env-w-row" style="--c:${v.gravity.tone}">
    <span class="wh-env-w-ic">🪐</span>
    <span class="wh-env-w-k">${esc(t("UI.GRAVITY"))}</span>
    <span class="wh-env-w-v">${v.gravity.kind === "zero" ? "0G" : Number(v.gravity.value).toFixed(1) + "G"}</span>
  </div>`);
  const radCls = v.rad.active ? " danger" : "";
  rows.push(`<div class="wh-env-w-row${radCls}" style="--c:${v.rad.tone}">
    <span class="wh-env-w-ic">☢</span>
    <span class="wh-env-w-k">${esc(t("UI.RADIATION"))}</span>
    <span class="wh-env-w-v">${v.rad.active ? `${v.rad.text} ${esc(v.rad.unit)}` : t("UI.NORMAL")}</span>
  </div>`);
  const note = v.note ? `<div class="wh-env-w-note">${esc(v.note)}</div>` : "";
  return `<div class="wh-env-w-head"><span class="wh-env-w-led"></span><span class="wh-env-w-title">${esc(t("UI.ENVIRONMENT_HEADING"))}</span><span class="wh-env-w-collapse" title=t("UI.COLLAPSE_EXPAND")>▾</span></div>
    <div class="wh-env-w-body">${rows.join("")}</div>${note}`;
}

// Восстанавливает позицию из localStorage или ставит дефолт правее списка игроков.
function _applyEnvPos(el) {
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem("wh-env-pos") || "null"); } catch (e) {}
  if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
    el.style.left = `${pos.left}px`; el.style.top = `${pos.top}px`;
  } else {
    // Дефолт: правее списка игроков и выше нижнего HUD (можно перетащить).
    el.style.left = "232px";
    el.style.top  = `${Math.max(10, (window.innerHeight || 800) - 340)}px`;
  }
  el.style.right = "auto"; el.style.bottom = "auto";
}

// Перетаскивание за шапку (позиция сохраняется на клиенте).
function _wireEnvDrag(el) {
  const head = el.querySelector(".wh-env-w-head");
  if (!head) return;
  head.addEventListener("mousedown", ev => {
    if (ev.target.closest(".wh-env-w-collapse")) return;   // клик по «свернуть» — не тащим
    ev.preventDefault();
    const r = el.getBoundingClientRect();
    const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    el.classList.add("dragging");
    const move = e => {
      const left = Math.max(0, Math.min(window.innerWidth  - 40, e.clientX - dx));
      const top  = Math.max(0, Math.min(window.innerHeight - 24, e.clientY - dy));
      el.style.left = `${left}px`; el.style.top = `${top}px`;
      el.style.right = "auto"; el.style.bottom = "auto";
    };
    const up = () => {
      el.classList.remove("dragging");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      try { localStorage.setItem("wh-env-pos", JSON.stringify({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) })); } catch (e) {}
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
}

// Панель окружения нужна не каждому столу и не всегда. Выбор хранится у самого
// пользователя, рядом со свёрнутым состоянием: это его вид, а не свойство сцены.
const ENV_HIDDEN_KEY = "wh-env-hidden";

/** Спрятана ли панель у этого пользователя. */
export function isEnvWidgetHidden() {
  try { return localStorage.getItem(ENV_HIDDEN_KEY) === "1"; }
  catch (e) { return false; }
}

/** Запомнить выбор и перерисовать. */
export function setEnvWidgetHidden(hidden) {
  try { localStorage.setItem(ENV_HIDDEN_KEY, hidden ? "1" : "0"); }
  catch (e) {}
  refreshEnvWidget();
}

export function refreshEnvWidget() {
  try {
    const scene = currentScene();
    let el = document.getElementById("wh-env-widget");
    // Спрятанная панель снимается с экрана целиком, а не прячется прозрачностью:
    // иначе она продолжала бы перехватывать клики по холсту.
    if (isEnvWidgetHidden()) { el?.remove(); return; }
    if (!scene) { el?.remove(); return; }
    const fresh = !el;
    if (!el) {
      el = document.createElement("div");
      el.id = "wh-env-widget";
      document.body.appendChild(el);
      try { if (localStorage.getItem("wh-env-collapsed") === "1") el.classList.add("collapsed"); } catch {}
    }
    el.classList.toggle("gm", game.user.isGM);
    el.innerHTML = _widgetHTML(envView(readEnvForScene(scene)));
    if (fresh) _applyEnvPos(el);
    _wireEnvDrag(el);
    // Свернуть/развернуть.
    el.querySelector(".wh-env-w-collapse")?.addEventListener("click", ev => {
      ev.stopPropagation();
      const c = el.classList.toggle("collapsed");
      try { localStorage.setItem("wh-env-collapsed", c ? "1" : "0"); } catch (e) {}
    });
    // Клик по телу открывает окно (только ГМ).
    el.querySelector(".wh-env-w-body")?.addEventListener("click", () => { if (game.user.isGM) openEnvironment(); });
  } catch (e) { console.warn("dark-heresy | env widget", e); }
}
