/**
 * Собрать компендиум предметов книги из исходников packs-src/<пак>.
 *
 * Исходник — массив предметов в JSON, по файлу на раздел книги. Дерево папок и
 * их цвета лежат отдельно, в folders.json. Недостающие поля предмета берутся из
 * template.json, а допустимые значения ключей — прямо из кода системы: так
 * компендиум не может разойтись с тем, что система на самом деле понимает.
 *
 * Идентификаторы выводятся из папки и имени детерминированно: пересборка не
 * рвёт ссылки на предметы, уже перетащенные в мир.
 *
 * Запуск: node tools/build-items.mjs <пак>          — проверить и собрать
 *         node tools/build-items.mjs <пак> --check  — только проверить
 *
 * Имя пака — каталог в packs-src (rogue-trader, only-war, deathwatch). Без аргумента
 * берётся rogue-trader: так продолжают работать старые команды.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import {packEffectData} from './lib/pack-effects.mjs';
import {splitItemEffects} from './lib/equipment-pack-data.mjs';
import {validateOrigin} from "../script/creation/origin-data.mjs";

const require = createRequire(import.meta.url);

const CHECK_ONLY = process.argv.includes("--check");
const PACK = process.argv.slice(2).find(a => !a.startsWith("--")) ?? "rogue-trader";
if (!/^[a-z][a-z0-9-]*$/.test(PACK)) throw new Error('Invalid package directory name');
const SRC = `packs-src/${PACK}`;
const DEST = `packs/${PACK}`;

if (!existsSync(SRC)) {
    console.error(`нет каталога исходников ${SRC}`);
    process.exit(1);
}
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Стабильный 16-символьный идентификатор Foundry из произвольного ключа. */
function idFor(key) {
    const digest = createHash("sha1").update(key).digest();
    let id = "";
    for (let i = 0; i < 16; i++) id += ALPHABET[digest[i] % ALPHABET.length];
    return id;
}

const template = JSON.parse(readFileSync("template.json", "utf8"));
const systemVersion = JSON.parse(readFileSync("system.json", "utf8")).version;
const script = readFileSync("script/dark-heresy.js", "utf8");

/** Ключи объекта-справочника Dh.<name> из кода системы. */
function configKeys(name) {
    const start = script.indexOf(`Dh.${name} = {`);
    if (start < 0) throw new Error(`в коде нет Dh.${name}`);
    const end = script.indexOf("};", start);
    return new Set([...script.slice(start, end).matchAll(/^\s*"?([a-zA-Z-]+)"?\s*:/gm)].map(m => m[1]));
}

const KEYS = {
    availability: configKeys("availability"),
    craftsmanship: configKeys("craftmanship"),
    renown: configKeys("renown"),
    weaponClass: configKeys("weaponClass"),
    weaponType: configKeys("weaponType"),
    damageType: configKeys("damageTypes"),
    armourType: configKeys("armourTypes"),
    shipWeaponType: configKeys("shipWeaponTypes"),
    shipLocation: configKeys("shipLocations"),
    componentCategory: configKeys("shipComponentCategories"),
    shipQuality: configKeys("shipQualities")
};

// Особые качества, которые разбирает extractWeaponTraits. Остальные система
// показывает, но не автоматизирует — об этом стоит знать, а не узнать в бою.
const traitStart = script.indexOf("const DH_WEAPON_TRAITS = [");
const TRAITS = new Set([...script.slice(traitStart, script.indexOf("];", traitStart))
    .matchAll(/name:\s*"([^"]+)"/g)].map(m => m[1].toLowerCase()));

/** Слить значения из over в base, вложенные объекты — рекурсивно. */
function deepMerge(base, over) {
    for (const [k, v] of Object.entries(over ?? {})) {
        const plain = x => x && typeof x === "object" && !Array.isArray(x);
        if (plain(v) && plain(base[k])) deepMerge(base[k], v);
        else base[k] = v;
    }
    return base;
}

/** Данные предмета по умолчанию: шаблоны типа плюс его собственные поля. */
function defaultsFor(type) {
    const own = structuredClone(template.Item[type]);
    const out = {};
    for (const t of own.templates ?? []) deepMerge(out, structuredClone(template.Item.templates[t]));
    delete own.templates;
    return deepMerge(out, own);
}

/** Поля источника, которых нет в схеме: опечатка в ключе иначе молча теряется. */
function unknownKeys(defaults, given, prefix = "") {
    const bad = [];
    for (const [k, v] of Object.entries(given ?? {})) {
        if (k === "source" && !prefix) continue;
        if (!(k in defaults)) { bad.push(prefix + k); continue; }
        const plain = x => x && typeof x === "object" && !Array.isArray(x);
        // Пустой объект в шаблоне — это свободная карта (характеристики происхождения,
        // переопределения качеств оружия), а не закрытая форма: её ключи задаёт контент,
        // и «лишними» они быть не могут.
        if (plain(v) && plain(defaults[k]) && Object.keys(defaults[k]).length)
            bad.push(...unknownKeys(defaults[k], v, `${prefix}${k}.`));
    }
    return bad;
}

const errors = [];
const warnings = [];

// ── Папки ─────────────────────────────────────────────────────────────────
const folderSrc = JSON.parse(readFileSync(`${SRC}/folders.json`, "utf8"));
const folders = new Map();
for (const [path, spec] of Object.entries(folderSrc)) {
    const parts = path.split("/");
    const parentPath = parts.slice(0, -1).join("/");
    if (parentPath && !folderSrc[parentPath]) errors.push(`папка ${path}: нет родителя ${parentPath}`);
    const color = spec.color ?? folderSrc[parentPath]?.color ?? null;
    folders.set(path, {
        _id: idFor(`rt:folder:${path}`), name: parts.at(-1), type: "Item", description: "",
        folder: parentPath ? idFor(`rt:folder:${parentPath}`) : null,
        sorting: "a", sort: spec.sort ?? 0, color, flags: {}
    });
}

// ── Предметы ──────────────────────────────────────────────────────────────
const files = readdirSync(SRC).filter(f => f.endsWith(".json") && f !== "folders.json").sort();
const items = [];
const seen = new Set();

for (const file of files) {
    let list;
    try {
        list = JSON.parse(readFileSync(`${SRC}/${file}`, "utf8"));
    } catch (err) {
        errors.push(`${file}: не разбирается JSON — ${err.message}`);
        continue;
    }
    if (!Array.isArray(list)) { errors.push(`${file}: ожидается массив предметов`); continue; }

    for (const src of list) {
        const where = `${file} → ${src?.name ?? "?"}`;
        if (!src?.name) { errors.push(`${where}: нет имени`); continue; }
        if (!template.Item.types.includes(src.type)) { errors.push(`${where}: неизвестный тип ${src.type}`); continue; }
        if (!folders.has(src.folder)) errors.push(`${where}: нет папки ${src.folder}`);

        const key = `${src.folder}::${src.name}`;
        if (seen.has(key)) errors.push(`${where}: дубль в папке ${src.folder}`);
        seen.add(key);

        const defaults = defaultsFor(src.type);
        for (const k of unknownKeys(defaults, src.system)) errors.push(`${where}: лишнее поле system.${k}`);
        const sys = deepMerge(defaults, structuredClone(src.system ?? {}));
        if (!sys.source) errors.push(`${where}: нет source`);
        if (!String(sys.description ?? "").trim()) warnings.push(`${where}: пустое описание`);

        const check = (value, set, label) => {
            if (value !== undefined && value !== "" && !set.has(value)) errors.push(`${where}: ${label} «${value}» не из справочника`);
        };
        if ("availability" in sys) check(sys.availability, KEYS.availability, "availability");
        if ("craftsmanship" in sys) check(sys.craftsmanship, KEYS.craftsmanship, "craftsmanship");
        if ("renown" in sys) check(sys.renown, KEYS.renown, "renown");

        if (src.type === "weapon") {
            check(sys.class, KEYS.weaponClass, "class");
            check(sys.type, KEYS.weaponType, "type");
            check(sys.damageType, KEYS.damageType, "damageType");
            // Урона нет у пусковых установок — он приходит со снарядом (в книге
            // «†»), — у гранат без осколков (дым, ослепление, галлюциногены) и у
            // сетей вроде бол, которые только опутывают.
            // Экзотика вроде гравитонного ружья бьёт не уроном, а правилом: в
            // книге в графе стоит «Special», и формулы у неё нет.
            const damageless = ["launcher", "explosive", "exotic"].includes(sys.type)
                || /snare/i.test(String(sys.special ?? ""));
            if (!sys.damage && !damageless) errors.push(`${where}: нет урона`);
            for (const raw of String(sys.special ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
                const base = raw.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase();
                if (!TRAITS.has(base) && !TRAITS.has(raw.toLowerCase())) warnings.push(`${where}: качество «${raw}» система не автоматизирует`);
            }
        }
        // Происхождение проверяется тем же кодом, что и система в игре
        // (script/creation/origin-data.mjs): разойтись им нечем.
        if (src.type === "origin") for (const problem of validateOrigin(sys)) errors.push(`${where}: ${problem}`);
        if (src.type === "armour") check(sys.type, KEYS.armourType, "type");
        if (src.type === "shipWeapon") {
            check(sys.weaponType, KEYS.shipWeaponType, "weaponType");
            check(sys.location, KEYS.shipLocation, "location");
        }
        if (src.type === "shipComponent") {
            check(sys.category, KEYS.componentCategory, "category");
            check(sys.quality, KEYS.shipQuality, "quality");
        }

        const img = src.img ?? "icons/svg/item-bag.svg";
        if (img.startsWith("systems/apex-heresy-ru/") && !existsSync(img.replace("systems/apex-heresy-ru/", ""))) {
            errors.push(`${where}: нет файла иконки ${img}`);
        }

        items.push({
            _id: idFor(`rt:item:${src.folder}:${src.name}`), name: src.name, type: src.type, img,
            system: sys, ...packEffectData(src), folder: folders.get(src.folder)?._id ?? null,
            sort: 0, ownership: { default: 0 }
        });
    }
}

// ── Отчёт ─────────────────────────────────────────────────────────────────
const byFolder = new Map();
for (const it of items) {
    const path = [...folders.entries()].find(([, f]) => f._id === it.folder)?.[0] ?? "(без папки)";
    byFolder.set(path, (byFolder.get(path) ?? 0) + 1);
}
for (const [path, n] of [...byFolder.entries()].sort()) console.log(`${String(n).padStart(4)}  ${path}`);
console.log(`предметов: ${items.length}, папок: ${folders.size}, файлов: ${files.length}`);
for (const w of warnings) console.log(`предупреждение: ${w}`);
for (const e of errors) console.log(`ОШИБКА: ${e}`);
if (errors.length) {
    console.log(`${errors.length} ошибок — пак не собран`);
    process.exit(1);
}
if (CHECK_ONLY) process.exit(0);

// ── Запись ────────────────────────────────────────────────────────────────
const { ClassicLevel } = require("classic-level");

// Foundry держит LOCK на загруженных паках. Сносить каталог вслепую нельзя: на
// полпути это оставило бы пак разобранным. Сначала проверяем, открывается ли он.
if (existsSync(DEST)) {
    try {
        const probe = new ClassicLevel(DEST, { valueEncoding: "json" });
        await probe.open();
        await probe.close();
    } catch (err) {
        console.log(`cannot write ${DEST}: the pack is locked. Close Foundry and run again.`);
        process.exit(1);
    }
    rmSync(DEST, { recursive: true, force: true });
}

const stats = () => ({
    compendiumSource: null, coreVersion: "14.365", createdTime: null, duplicateSource: null,
    exportSource: null, lastModifiedBy: null, modifiedTime: null,
    systemId: "dark-heresy", systemVersion
});

const db = new ClassicLevel(DEST, { valueEncoding: "json" });
await db.open();
const batch = db.batch();
for (const f of folders.values()) batch.put(`!folders!${f._id}`, { ...f, _stats: stats() });
for (const it of items) {
    const split = splitItemEffects({...it, _stats:stats()});
    batch.put(`!items!${it._id}`, split.document);
    for (const effect of split.effects) batch.put(effect.key, effect.value);
}
await batch.write();
await db.close();
console.log(`built ${DEST}: ${items.length} items, ${folders.size} folders`);
