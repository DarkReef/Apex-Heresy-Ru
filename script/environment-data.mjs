import {environmentText as t} from "./localization/environment-text.mjs";
// script/environment-data.mjs
// ════════════════════════════════════════════════════════════════════════
//  Окружающая среда сцены (корбук «Опасности», стр. 483-484).
//  Параметры: Погода (флавор) · Температура (Жара/Холод) · Гравитация ·
//  Радиация. Хранится во флаге сцены warhammer-dbc.env; ГМ правит в окне,
//  игроки видят только виджет. Помощники возвращают и подпись, и механику
//  (модификатор теста T + частота), чтобы виджет/окно были едины с правилами.
// ════════════════════════════════════════════════════════════════════════

const nonnegative = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;

export const ENV_SCOPE = "dark-heresy";
export const ENV_FLAG  = "env";

// ── «Обстановка»: погода планеты + позиция/реальность корабля-в-пустоте.
//    grp: planet → в виджете подпись «ПОГОДА»; void → «ЛОКАЦИЯ». В корбуке
//    жёсткой таблицы нет — это флавор, задающий настроение сцены. ──────────
export const WEATHER = [
  // Планета — погода
  { key: "clear",     grp: "planet", label: "UI.CLEAR",              icon: "☀",  tone: "#ffd98a" },
  { key: "clouds",    grp: "planet", label: "UI.OVERCAST",           icon: "☁",  tone: "#b8c6d0" },
  { key: "rain",      grp: "planet", label: "UI.RAIN",             icon: "🌧", tone: "#6fa8d0" },
  { key: "storm",     grp: "planet", label: "UI.THUNDERSTORM",             icon: "⛈", tone: "#8ab0e0" },
  { key: "snow",      grp: "planet", label: "UI.SNOW_BLIZZARD",     icon: "❄",  tone: "#cfe8ff" },
  { key: "fog",       grp: "planet", label: "UI.FOG",             icon: "🌫", tone: "#a8b4bc" },
  { key: "wind",      grp: "planet", label: "UI.GALE_WINDS",   icon: "💨", tone: "#bfe0d0" },
  { key: "heat",      grp: "planet", label: "UI.SCORCHING_HEAT",              icon: "🔥", tone: "#ff8a5a" },
  { key: "ash",       grp: "planet", label: "UI.ASH_STORM",    icon: "🌋", tone: "#c08a6a" },
  { key: "acid",      grp: "planet", label: "UI.ACID_RAIN",   icon: "☣",  tone: "#9fd13f" },
  { key: "toxic",     grp: "planet", label: "UI.TOXIC_SMOG",    icon: "🏭", tone: "#b6c04a" },
  { key: "radstorm",  grp: "planet", label: "UI.RAD_STORM", icon: "☢",  tone: "#e8e04a" },
  // Корабль / пустота — позиция и реальность
  { key: "shipnorm",  grp: "void", label: "UI.SHIP_INTERIOR",       icon: "🚀", tone: "#7fbf9c" },
  { key: "materium",  grp: "void", label: "UI.IN_THE_MATERIUM",          icon: "✦",  tone: "#6fa8d0" },
  { key: "orbit",     grp: "void", label: "UI.IN_ORBIT",            icon: "🛰", tone: "#8ab0e0" },
  { key: "void",      grp: "void", label: "UI.OPEN_VOID",      icon: "🌌", tone: "#6a7fb0" },
  { key: "translation", grp: "void", label: "UI.WARP_TRANSLATION",       icon: "🌀", tone: "#b477ff" },
  { key: "warp",      grp: "void", label: "UI.IN_THE_WARP",              icon: "🕳", tone: "#9a5aff" },
  { key: "warpstorm", grp: "void", label: "UI.WARP_STORM",           icon: "🌀", tone: "#e05aff" },
  { key: "gellar",    grp: "void", label: "UI.GELLAR_FIELD_FAILURE",  icon: "⚡", tone: "#ff5a5a" },
  { key: "breach",    grp: "void", label: "UI.HULL_BREACH",      icon: "💨", tone: "#ff8a5a" }
];
export const WEATHER_MAP = Object.fromEntries(WEATHER.map(w => [w.key, w]));
export function weatherMeta(key) { return Object.hasOwn(WEATHER_MAP, key) ? WEATHER_MAP[key] : WEATHER_MAP.clear; }
export const WEATHER_GROUPS = [
  { grp: "planet", label: "UI.PLANET_WEATHER" },
  { grp: "void",   label: "UI.SHIP_VOID_LOCATION" }
];
// Подпись строки виджета: планета → «Погода», пустота/корабль → «Локация».
export function weatherRowLabel(key) { return weatherMeta(key).grp === "void" ? "UI.LOCATION" : "UI.WEATHER"; }

// ── Температура: Жара (корбук стр. 483) + симметричная шкала Холода ────────
// Жара — точная таблица книги. Холод — «по усмотрению ГМа» (значения дизайнер-
// ские, зеркалят суровость жары). test — модификатор к тесту T (порог), freq —
// как часто тест; tone — цвет индикатора; kind — hot|cold|ok.
const HEAT_TABLE = [
  { min: 65, kind: "hot", test: -20, freq: "UI.EVERY_ROUND",     label: "UI.INSIDE_A_BURNING_BUILDING" },
  { min: 60, kind: "hot", test: -15, freq: "UI.EVERY_MINUTE",  label: "UI.STREET_OF_A_BURNING_CITY" },
  { min: 55, kind: "hot", test: -10, freq: "UI.EVERY_5_MINUTES",  label: "UI.ABOVE_A_MAGMA_RIVER" },
  { min: 50, kind: "hot", test:  -5, freq: "UI.EVERY_30_MINUTES", label: "UI.DAYSIDE_OF_A_TIDE_LOCKED_WORLD" },
  { min: 45, kind: "hot", test:   0, freq: "UI.EVERY_HOUR",     label: "UI.FOUNDRY_MANUFACTORUM" },
  { min: 40, kind: "hot", test:   5, freq: "UI.EVERY_2_HOURS",   label: "UI.DESERT_HEAT" },
  { min: 35, kind: "hot", test:  10, freq: "UI.EVERY_4_HOURS",   label: "UI.HEAT_WAVE" },
  { min: 30, kind: "hot", test:  15, freq: "UI.EVERY_8_HOURS",  label: "UI.HOT_DAY_WITHOUT_SHADE" }
];
const COLD_TABLE = [
  { max: -40, kind: "cold", test: -20, freq: "UI.EVERY_ROUND",     label: "UI.CRYOGENICS_OPEN_VOID" },
  { max: -30, kind: "cold", test: -15, freq: "UI.EVERY_MINUTE",  label: "UI.POLAR_NIGHT_ON_AN_ICE_WORLD" },
  { max: -20, kind: "cold", test: -10, freq: "UI.EVERY_5_MINUTES",  label: "UI.BITTER_FROST_BLIZZARD" },
  { max: -10, kind: "cold", test:  -5, freq: "UI.EVERY_30_MINUTES", label: "UI.HARD_FROST" },
  { max:   0, kind: "cold", test:   0, freq: "UI.EVERY_HOUR",     label: "UI.FROST" },
  { max:  10, kind: "cold", test:  10, freq: "UI.EVERY_8_HOURS",  label: "UI.BITING_COLD" }
];

export function tempEffect(t) {
  const c = Number(t);
  for (const row of HEAT_TABLE) if (c >= row.min) return { ...row, active: true };
  for (const row of COLD_TABLE) if (c <= row.max) return { ...row, active: true };
  return { kind: "ok", test: null, freq: "", label: "UI.COMFORTABLE", active: false };
}
// Цвет по температуре (плавный: синий холод → бирюза норма → красный жар).
export function tempTone(t) {
  const c = Number(t);
  if (c >= 55) return "#ff4d3a";
  if (c >= 40) return "#ff8a3a";
  if (c >= 28) return "#ffcf5a";
  if (c >= 5)  return "#5affc0";
  if (c >= -15) return "#5ac8ff";
  return "#a0d8ff";
}

// ── Гравитация (корбук стр. 484): Высокая / Низкая / Невесомость ───────────
export function gravityEffect(g) {
  const G = Number(g);
  if (G <= 0) return {
    kind: "zero", label: "UI.ZERO_GRAVITY",
    note: "UI.GRAVITY_ZERO_NOTE",
    tone: "#b477ff"
  };
  if (G < 1) {
    const noRun = G <= 0.6;
    // Trade(Voidfarer) помогает при 0.6/0.5/0.4/0.3/0.2 → +0/+10/+20/+30
    return {
      kind: "low", label: t("UI.GRAVITY_LOW", {gravity:G}),
      note: t("UI.GRAVITY_LOW_NOTE", {gravity:G.toFixed(1)}) + (noRun ? t("UI.GRAVITY_NO_RUN") : ""),
      tone: "#7fd0ff"
    };
  }
  if (G > 1) return {
    kind: "high", label: t("UI.GRAVITY_HIGH", {gravity:G}),
    note: t("UI.GRAVITY_HIGH_NOTE", {gravity:G.toFixed(1)}),
    tone: "#ff9a6a"
  };
  return { kind: "norm", label: "UI.NORMAL_1G", note: "UI.STANDARD_GRAVITY_NO_PENALTIES", tone: "#8fe0b0" };
}

// ── Радиация (корбук стр. 484): интенсивность 1-10 + защита ────────────────
export const RAD_TABLE = [
  { lvl: 1,  freq: "UI.EVERY_8_HOURS",  label: "UI.VOLCANO_SLOPES_DEEP_MINES" },
  { lvl: 2,  freq: "UI.EVERY_4_HOURS",   label: "UI.HIVE_INDUSTRIAL_ZONE_FORGE" },
  { lvl: 3,  freq: "UI.EVERY_2_HOURS",   label: "UI.INSIDE_A_MINE_REFINERY" },
  { lvl: 4,  freq: "UI.EVERY_HOUR",     label: "UI.HIVE_WORLD_FORGE_WORLD_WASTES" },
  { lvl: 5,  freq: "UI.EVERY_30_MINUTES", label: "UI.WASTE_DUMPS_OPEN_VOID" },
  { lvl: 6,  freq: "UI.EVERY_15_MINUTES", label: "UI.FALLOUT_ZONE_AFTER_A_NUCLEAR_BLAST" },
  { lvl: 7,  freq: "UI.EVERY_5_MINUTES",  label: "UI.RADIOACTIVE_FALLOUT_REACTOR_VENTING" },
  { lvl: 8,  freq: "UI.EVERY_MINUTE",  label: "UI.EXPOSED_REACTOR_WARP_DRIVE_CORE" },
  { lvl: 9,  freq: "UI.EVERY_ROUND",      label: "UI.CLOSE_TO_A_REACTOR_WARP_DRIVE_CORE" },
  { lvl: 10, freq: "UI.5_PER_ROUND",        label: "UI.INSIDE_A_REACTOR_FUELLING_A_WARP_DRIVE" }
];
export const RAD_PROTECTION = [
  { label: "UI.SEALED_ARMOUR_CHEM_SUIT", val: "−1" },
  { label: "UI.VOID_ARMOUR_RAD_SUIT", val: "−2" },
  { label: "UI.POWER_ARMOUR",                       val: "−1" },
  { label: "UI.TERMINATOR_ARMOUR",                val: "UI.IMMUNE" },
  { label: "UI.MACHINE_TRAIT",                       val: "−1" },
  { label: "UI.ACTIVE_MELANOCHROME_GENE_SEED",    val: "−1" },
  { label: "UI.STUFF_OF_NIGHTMARES_TRAIT",           val: "UI.IMMUNE" },
  { label: "UI.INSIDE_A_TIN_STRUCTURE",             val: "−1" },
  { label: "UI.INSIDE_A_ROCKCRETE_STRUCTURE",           val: "−2" },
  { label: "UI.INSIDE_A_BUNKER_CAVE",             val: "−3" },
  { label: "UI.INSIDE_A_RAD_BUNKER",        val: "UI.IMMUNE" }
];
export function radEffect(lvl) {
  const l = Math.max(0, Math.min(10, Math.round(Number(lvl) || 0)));
  if (l <= 0) return { lvl: 0, label: "UI.BACKGROUND_NORMAL", freq: "", active: false, tone: "#8fe0b0" };
  const row = RAD_TABLE.find(r => r.lvl === l) || RAD_TABLE[RAD_TABLE.length - 1];
  // Цвет усиливается с уровнем (зелёный → жёлтый → оранжевый → красный).
  const tone = l >= 8 ? "#ff3a3a" : l >= 6 ? "#ff7a2a" : l >= 4 ? "#ffd23a" : "#b6e04a";
  return { ...row, active: true, tone };
}


// ── Мощность дозы: научная шкала вместо безымянных уровней ────────────────
// Хранится всегда в мкЗв/ч — это каноническая единица состояния; в каком виде
// её показывать, решает отдельный флаг. Игровой «уровень» 1-10 из RAD_TABLE
// никуда не делся: он выводится из дозы и по-прежнему задаёт частоту проверок.
// Границы — логарифмическая лестница, примерно по половине порядка на ступень.
export const RAD_BANDS = [
  { min: 0,          lvl: 0,  label: "UI.NATURAL_BACKGROUND",   tone: "#8fe0b0" },
  { min: 0.3,        lvl: 1,  label: "UI.ELEVATED_BACKGROUND",  tone: "#b6e04a" },
  { min: 3,          lvl: 2,  label: "UI.MILDLY_ELEVATED",      tone: "#d6e04a" },
  { min: 30,         lvl: 3,  label: "UI.CONTAMINATED",         tone: "#ffd23a" },
  { min: 300,        lvl: 4,  label: "UI.HAZARDOUS",            tone: "#ffb02a" },
  { min: 3000,       lvl: 5,  label: "UI.SEVERE",               tone: "#ff8a2a" },
  { min: 30000,      lvl: 6,  label: "UI.ACUTE_HAZARD",         tone: "#ff6a2a" },
  { min: 300000,     lvl: 7,  label: "UI.RADIATION_SICKNESS",   tone: "#ff4a2a" },
  { min: 1000000,    lvl: 8,  label: "UI.ACUTE_RADIATION_SYNDROME", tone: "#ff3a3a" },
  { min: 5000000,    lvl: 9,  label: "UI.LETHAL_EXPOSURE",      tone: "#ff2a6a" },
  { min: 20000000,   lvl: 10, label: "UI.IMMEDIATELY_FATAL",    tone: "#ff5ad8" }
];

// Единицы показа. Хранение всегда в мкЗв/ч, показ — в выбранной.
export const RAD_UNITS = {
  uSv: { key: "uSv", label: "UI.MICROSIEVERT_HOUR", factor: 1 },
  mSv: { key: "mSv", label: "UI.MSV_H", factor: 1000 },
  Sv:  { key: "Sv",  label: "UI.SV_H",  factor: 1000000 }
};
export const RAD_UNIT_ORDER = ["uSv", "mSv", "Sv"];

/** Диапазон, в который попадает мощность дозы (мкЗв/ч). */
export function radBand(dose) {
  const d = nonnegative(dose);
  let band = RAD_BANDS[0];
  for (const b of RAD_BANDS) if (d >= b.min) band = b;
  return band;
}

/** Игровой уровень 1-10 по дозе — от него зависит частота проверок. */
export function radLevelFromDose(dose) { return radBand(dose).lvl; }

/** Представительная доза для игрового уровня — для переноса старых сцен. */
export function radDoseFromLevel(lvl) {
  const l = Math.max(0, Math.min(10, Math.round(Number(lvl) || 0)));
  const band = RAD_BANDS.find(b => b.lvl === l) || RAD_BANDS[0];
  return band.min;
}

/**
 * Доза в выбранных единицах: значение и подпись.
 * Крупные числа режем до трёх значащих, чтобы не разъезжалась вёрстка.
 */
export function formatDose(dose, unitKey) {
  const unit = Object.hasOwn(RAD_UNITS, unitKey) ? RAD_UNITS[unitKey] : RAD_UNITS.uSv;
  const v = (nonnegative(dose)) / unit.factor;
  // Хвостовые нули срезаем целиком: «5», а не «5.0» и не «5.00».
  const trim = text => String(Number(text));
  let text;
  if (v === 0) text = "0";
  else if (v >= 100) text = String(Math.round(v));
  else if (v >= 10) text = trim(v.toFixed(1));
  else if (v >= 1) text = trim(v.toFixed(2));
  else text = trim(v.toPrecision(2));
  return { value: v, text, unit: t(unit.label), unitKey: unit.key };
}

/** Полное состояние радиации: доза, диапазон, игровой уровень и частота. */
export function radState(dose, unitKey) {
  const d = nonnegative(dose);
  const band = radBand(d);
  const row = RAD_TABLE.find(r => r.lvl === band.lvl);
  return {
    dose: d,
    ...formatDose(d, unitKey),
    band: band.label,
    lvl: band.lvl,
    tone: band.tone,
    active: band.lvl > 0,
    freq: row ? row.freq : "",
    source: row ? row.label : ""
  };
}

// ── Состояние сцены: чтение/запись ────────────────────────────────────────
export function defaultEnv() {
  return { weather: "clear", weatherText: "", temp: 20, gravity: 1, radDose: 0, radUnit: "uSv", note: "" };
}
export function normalizeEnv(raw) {
  const d = defaultEnv();
  if (!raw) return d;
  return {
    weather:     Object.hasOwn(WEATHER_MAP, raw.weather) ? raw.weather : d.weather,
    weatherText: typeof raw.weatherText === "string" ? raw.weatherText : "",
    temp:        Number.isFinite(Number(raw.temp)) ? Number(raw.temp) : d.temp,
    gravity:     Number.isFinite(Number(raw.gravity)) ? Math.max(0, Number(raw.gravity)) : d.gravity,
    // Сцены, сохранённые до перехода на дозу, держат уровень 0-10 — переводим
    // его в представительную дозу диапазона, чтобы ничего не потерялось.
    radDose:     Number.isFinite(Number(raw.radDose))
                   ? Math.max(0, Number(raw.radDose))
                   : radDoseFromLevel(raw.rad),
    radUnit:     Object.hasOwn(RAD_UNITS, raw.radUnit) ? raw.radUnit : d.radUnit,
    note:        typeof raw.note === "string" ? raw.note : ""
  };
}
export function readEnv(scene) { return normalizeEnv(scene?.getFlag?.(ENV_SCOPE, ENV_FLAG)); }
export async function writeEnv(scene, env) {
  if (!scene || !game.user.isGM) return;
  await scene.setFlag(ENV_SCOPE, ENV_FLAG, env);
}

// Полный «вид» окружения — единый источник для окна и виджета. Принимает уже
// нормализованный env (резолвится группо-осознанно вызывающим — см. Нексус).
export function localizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key,value]) => [key, ["label","freq","note","band","source","val"].includes(key) ? t(value) : value]));
}
export function envView(e) {
  const w = weatherMeta(e.weather);
  const temp = localizeRow(tempEffect(e.temp));
  const grav = localizeRow(gravityEffect(e.gravity));
  const rad  = localizeRow(radState(e.radDose, e.radUnit));
  const testSigned = temp.test == null ? "" : (temp.test >= 0 ? `+${temp.test}` : `${temp.test}`);
  return {
    raw: e,
    weather: { key: e.weather, label: e.weatherText || t(w.label), icon: w.icon, tone: w.tone, custom: !!e.weatherText, grp: w.grp, rowLabel: t(weatherRowLabel(e.weather)) },
    temp: { value: e.temp, tone: tempTone(e.temp), testSigned, ...temp },
    gravity: { value: e.gravity, ...grav },
    rad: { value: e.radDose, ...rad },
    note: e.note
  };
}

// ── Совместимость с окном: контейнер окружения ────────────────────────────
// В системе-доноре окружение могло принадлежать группе сцен («Нексус»). Здесь
// групп нет, поэтому источник всегда один — флаг самой сцены. Форма контейнера
// сохранена: появится группировка сцен — меняется только этот блок.
export function primaryGroupForScene() { return null; }
export function envSceneHasOverride(scene) { return !!scene?.getFlag?.(ENV_SCOPE, ENV_FLAG); }
export function resolveEnvContainer(scene) {
  return {
    kind: "scene", id: scene?.id || "", label: scene?.name || "",
    read:  () => normalizeEnv(scene?.getFlag?.(ENV_SCOPE, ENV_FLAG)),
    write: (v) => scene?.setFlag?.(ENV_SCOPE, ENV_FLAG, v),
    clear: () => scene?.unsetFlag?.(ENV_SCOPE, ENV_FLAG)
  };
}
export function readEnvForScene(scene) { return resolveEnvContainer(scene).read(); }
