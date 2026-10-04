/** Rebuild reviewed translations; copy LevelDBs before opening (opening writes).
 * npm install; npm run localization:build
 * Coverage is explicit: untranslated fields are NOT copied to translation files.
 */
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClassicLevel} from 'classic-level';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
const glossary = json('localization/ru/glossary.json');
const en = json('lang/en.json');
if (Object.values(en).some(text => !(text in glossary))) throw new Error('Missing interface translations');
write('lang/ru.json', {...Object.fromEntries(Object.entries(en).map(([key, value]) => [key, glossary[value]])), 'BIO.NAME': 'Имя'});
const overrides = json('localization/ru/entries.json');
const coverage = {interface: {translated: Object.keys(en).length, total: Object.keys(en).length}, packs: {}};
for (const pack of json('system.json').packs) {
    const temporary = mkdtempSync(join(tmpdir(), 'apex-ru-'));
    let db;
    try {
        const copy = join(temporary, 'db');
        cpSync(pack.path, copy, {recursive: true});
        db = new ClassicLevel(copy, {valueEncoding: 'utf8'});
        await db.open();
        const mapping = pack.type === 'Item' ? {
            name: 'name', description: 'system.description', benefit: 'system.benefit',
            shortDescription: 'system.shortDescription', effect: 'system.effect'
        } : {name: 'name', description: 'description', results: {path: 'results', converter: 'tableResults'}};
        const translation = {label: glossary[pack.label] ?? pack.label, mapping, entries: {}, folders: {}};
        let total = 0, names = 0, descriptions = 0;
        const pending = [];
        for await (const [key, raw] of db.iterator()) {
            const data = JSON.parse(raw);
            if (key.startsWith('!folders!')) {
                if (glossary[data.name]) translation.folders[data.name] = glossary[data.name];
                continue;
            }
            if (!(key.startsWith('!items!') || key.startsWith('!tables!'))) continue;
            total++;
            const entry = {...(overrides[pack.name]?.[data._id] ?? {})};
            if (glossary[data.name]) entry.name ??= glossary[data.name];
            const fields = pack.type === 'Item' ? data.system ?? {} : data;
            for (const field of ['description', 'benefit', 'shortDescription', 'effect']) {
                if (typeof fields[field] === 'string' && glossary[fields[field]]) entry[field] ??= glossary[fields[field]];
            }
            if (entry.name) names++;
            if (entry.description) descriptions++;
            if (Object.keys(entry).length) translation.entries[data._id] = entry;
            if (!entry.name || (fields.description && !entry.description)) pending.push({id: data._id, name: data.name,
                fields: [!entry.name && 'name', fields.description && !entry.description && 'description'].filter(Boolean)});
        }
        write(`localization/ru/dark-heresy.${pack.name}.json`, translation);
        coverage.packs[pack.name] = {total, names, descriptions, pending};
    } finally {
        if (db) await db.close();
        rmSync(temporary, {recursive: true, force: true});
    }
}
write('localization/ru/coverage.json', coverage);
console.log(JSON.stringify({interface: coverage.interface, packs: Object.fromEntries(Object.entries(coverage.packs)
    .map(([name, {total, names, descriptions}]) => [name, {total, names, descriptions}]))}, null, 2));
