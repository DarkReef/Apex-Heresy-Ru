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
write('lang/ru.json', {...Object.fromEntries(Object.entries(en).map(([key, value]) => [key, glossary[value]])), ...json('localization/ru/interface-overrides.json')});
const overrides = json('localization/ru/entries.json');
const packFolders = json('localization/ru/pack-folders.json');
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
        const tableRows = [];
        const prose = Object.fromEntries(['description', 'benefit', 'shortDescription', 'effect']
            .map(field => [field, {total: 0, translated: 0}]));
        for await (const [key, raw] of db.iterator()) {
            const data = JSON.parse(raw);
            if (key.startsWith('!tables.results!')) {
                tableRows.push({tableId: key.slice('!tables.results!'.length).split('.')[0], data});
                continue;
            }
            if (key.startsWith('!folders!')) {
                const folder = packFolders[pack.name]?.[data.name] ?? glossary[data.name];
                if (folder) translation.folders[data.name] = folder;
                continue;
            }
            if (!(key.startsWith('!items!') || key.startsWith('!tables!'))) continue;
            total++;
            const entry = {...(overrides[pack.name]?.[data._id] ?? {})};
            if (glossary[data.name]) entry.name ??= glossary[data.name];
            const fields = pack.type === 'Item' ? data.system ?? {} : data;
            for (const field of ['description', 'benefit', 'shortDescription', 'effect']) {
                if (typeof fields[field] === 'string' && glossary[fields[field]]) entry[field] ??= glossary[fields[field]];
                if (typeof fields[field] === 'string' && fields[field].trim()) {
                    prose[field].total++;
                    if (typeof entry[field] === 'string' && entry[field].trim()) prose[field].translated++;
                } else if (entry[field] !== undefined) {
                    throw new Error(`Translation must not replace a mechanical/non-text field: ${pack.name}:${data._id}:${field}`);
                }
            }
            if (entry.name) names++;
            if (entry.description) descriptions++;
            if (Object.keys(entry).length) translation.entries[data._id] = entry;
            const missing = [!entry.name && 'name', ...Object.keys(prose)
                .filter(field => typeof fields[field] === 'string' && fields[field].trim() && !entry[field])].filter(Boolean);
            if (missing.length) pending.push({id: data._id, name: data.name, fields: missing});
        }
        const results = {total: tableRows.length, names: 0, descriptions: 0, pending: []};
        for (const {tableId, data} of tableRows) {
            const entry = translation.entries[tableId]?.results?.[data._id];
            if (entry?.name) results.names++;
            if (entry?.description) results.descriptions++;
            const fields = [data.name && !entry?.name && 'name', data.description && !entry?.description && 'description'].filter(Boolean);
            if (fields.length) results.pending.push({tableId, id: data._id, name: data.name, fields});
        }
        write(`localization/ru/dark-heresy.${pack.name}.json`, translation);
        if (pack.name === 'only-war') {
            const terms = json('localization/ru/only-war-rule-terms.json');
            for (const [id, source] of Object.entries(json('localization/ru/only-war-sources.json'))) {
                // Contextual property names have priority over similarly named creature traits.
                terms[source.name] ??= translation.entries[id].name;
            }
            writeFileSync('script/localization/only-war-terms.mjs',
                '// Generated by npm run localization:build. Display only; never use for rule parsing.\n' +
                'export const onlyWarTerms = Object.freeze(' + JSON.stringify(terms, null, 2) + ');\n');
        }
        coverage.packs[pack.name] = {total, names, descriptions, prose, pending, ...(tableRows.length ? {results} : {})};
    } finally {
        if (db) await db.close();
        rmSync(temporary, {recursive: true, force: true});
    }
}
write('localization/ru/coverage.json', coverage);
console.log(JSON.stringify({interface: coverage.interface, packs: Object.fromEntries(Object.entries(coverage.packs)
    .map(([name, {total, names, descriptions}]) => [name, {total, names, descriptions}]))}, null, 2));
