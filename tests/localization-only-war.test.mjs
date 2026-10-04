import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClassicLevel} from 'classic-level';
import {ruleName} from '../script/localization/rule-name.mjs';
import {ruleText} from '../script/localization/rule-text.mjs';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const catalog = read('../localization/ru/dark-heresy.only-war.json');
const sources = read('../localization/ru/only-war-sources.json');
const visible = text => text.replace(/<[^>]*>/g, ' ').replace(/\b[IVX]+\b/g, '');

test('Only War translates every nonempty prose field without replacing mechanical data', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'apex-ow-test-'));
    const copy = join(temporary, 'db');
    cpSync(new URL('../packs/only-war', import.meta.url), copy, {recursive: true});
    const db = new ClassicLevel(copy, {valueEncoding: 'utf8'});
    try {
        await db.open();
        const ids = [];
        for await (const [key, raw] of db.iterator()) {
            if (key.startsWith('!folders!')) {
                const folder = JSON.parse(raw).name;
                assert.match(catalog.folders[folder], /[А-Яа-яЁё]/u, folder);
            }
            if (!key.startsWith('!items!')) continue;
            const original = JSON.parse(raw);
            const id = original._id;
            ids.push(id);
            const entry = catalog.entries[id];
            assert.ok(entry && sources[id], original.name);
            assert.match(entry.name, /[А-Яа-яЁё]/u, original.name);
            assert.equal(sources[id].name, original.name);
            for (const field of ['description', 'benefit', 'shortDescription', 'effect']) {
                if (typeof original.system[field] === 'string' && original.system[field].trim()) {
                    assert.equal(typeof entry[field], 'string', `${original.name}:${field}`);
                    assert.match(visible(entry[field]), /[А-Яа-яЁё]/u, `${original.name}:${field}`);
                    assert.doesNotMatch(visible(entry[field]), /[A-Za-z]{3,}/, `${original.name}:${field}`);
                } else assert.equal(entry[field], undefined, `${original.name}:${field}`);
            }
            assert.deepEqual(Object.keys(entry).filter(field => !['name', 'description', 'benefit', 'shortDescription', 'effect'].includes(field)), []);
            // Babele's original name is sufficient for existing English rule consumers.
            assert.equal(ruleName({...original, name: entry.name, flags: {babele: {originalName: original.name}}}), original.name);
        }
        assert.equal(ids.length, 498);
        assert.deepEqual(Object.keys(catalog.entries).sort(), ids.sort());
        assert.deepEqual(Object.keys(sources).sort(), ids.sort());
    } finally {
        await db.close();
        rmSync(temporary, {recursive: true, force: true});
    }
});

test('Only War names match the supplied Russian book, including contextual variants', () => {
    const name = en => catalog.entries[Object.keys(sources).find(id => sources[id].name === en)].name;
    for (const [en, ru] of Object.entries({
        Gunslinger: 'Акимбо', 'Armour-Monger': 'Бронник', 'Thunder Charge': 'Ураганный натиск',
        'Hammer Blow': 'Громовой удар', 'Vortex of Doom': 'Погибельный вихрь',
        'Scrier’s Gaze': 'Ясновиденье', 'M34 Autocannon': 'Автопушка М34',
        'M36 Lasgun': 'Лазган М36', 'Plasma Gun': 'Плазмомёт',
        'Heavy Leathers': 'Звериные шкуры', 'Feudal World Plate': 'Латы',
        'Power Field (Personal)': 'Силовое поле (личное)',
        'Power Field (Vehicle/Emplacement)': 'Силовое поле (для техники/укреплений)'
    })) assert.equal(name(en), ru, en);
    const origins = read('../localization/ru/dark-heresy.origins.json').entries;
    assert.equal(origins.XhiDR3yuPLdlaSAP.name, '18-й катачанский полк «Нетопыри»');
    assert.equal(origins.FHuz8XgQvUHc6wVj.name, 'Упрямец');
});

test('Russian descriptions retain easily missed rules and exclude neighbouring sections', () => {
    const text = en => catalog.entries[Object.keys(sources).find(id => sources[id].name === en)].description;
    assert.match(text('Hallucinogen Grenade'), /10 метров/);
    assert.match(text('Hallucinogen Grenade'), /1d10 раундов/);
    assert.match(text('Photon Flash Grenade'), /15 метров/);
    assert.match(text('Power Fist'), /БС × 2/);
    assert.match(text('Auxiliary Grenade Launcher'), /45 м/);
    assert.match(text('Spook'), /на один час/);
    assert.match(text('Refractor Field'), /01–15.*01–10.*01–05/);
    assert.match(text('Scrier’s Gaze'), /4 и более ступеней/);
    assert.doesNotMatch(text('Crushing Blow'), /Враг \(Х\)/);
    assert.doesNotMatch(text('Mechanicus Implants'), /пережив.*одержимость/iu);
    assert.doesNotMatch(text('Warp Lock'), /@@@|Адептус Механикус|Торговля/);
});

test('Only War prose has balanced HTML and its coverage includes summaries', () => {
    for (const [id, entry] of Object.entries(catalog.entries)) {
        const stack = [];
        for (const [, closing, tag] of entry.description.matchAll(/<(\/)?(div|p|strong)\b[^>]*>/g)) {
            if (closing) assert.equal(stack.pop(), tag, id);
            else stack.push(tag);
        }
        assert.deepEqual(stack, [], id);
    }
    const coverage = read('../localization/ru/coverage.json').packs['only-war'];
    assert.equal(coverage.names, 498);
    assert.equal(coverage.descriptions, 498);
    assert.deepEqual(coverage.prose.benefit, {total: 175, translated: 175});
    assert.deepEqual(coverage.prose.shortDescription, {total: 35, translated: 35});
    assert.deepEqual(coverage.pending, []);
});

test('display translation handles requirements and properties without changing rule inputs', () => {
    const original = 'Ballistic Skill 40, Weapon Training (Las), Psy Rating 3';
    assert.equal(ruleText(original, 'ow', 'ru'), 'Дальний бой 40, Владение оружием (Лазерное), Пси-рейтинг 3');
    assert.equal(ruleText('Half Action; 5 metres x Psy Rating; Blast (5), Reliable', 'Only War, p. 183', 'ru'),
        'Частичное действие; 5 метров x Пси-рейтинг; Взрыв (5), Надёжное');
    assert.equal(ruleText('1d10+5', 'ow', 'ru'), '1d10+5');
    assert.equal(ruleText('Willpower, Psyker', 'ow', 'ru', 'aptitudes'), 'Сила воли, Псайкерство');
    assert.equal(ruleText('Psyker', 'ow', 'ru'), 'Псайкер');
    assert.equal(ruleText(original, 'ow', 'en'), original);
    assert.equal(ruleText(original, 'dh2', 'ru'), original);
    assert.equal(ruleText('CustomWordNotInTheBook', 'ow', 'ru'), 'CustomWordNotInTheBook');
});

test('all six Only War tables translate their 91 results and preserve inline roll formulas', async () => {
    const ids = ['5dQOWsruUbGsqlfJ', 'A3DmCw6azKiF5WUz', 'fS5OOWE7c3vjaUqG',
        'fpUBLAE7dXL4YbPf', 'gjm6DH8kCYo7U7Pf', 'o4ASNLJs7OJ0Xb8U'];
    const tables = read('../localization/ru/dark-heresy.bc-tables.json');
    const temporary = mkdtempSync(join(tmpdir(), 'apex-ow-tables-'));
    const copy = join(temporary, 'db');
    cpSync(new URL('../packs/bc-tables', import.meta.url), copy, {recursive: true});
    const db = new ClassicLevel(copy, {valueEncoding: 'utf8'});
    let count = 0;
    const formulas = text => text.match(/\[\[.*?\]\]/g) ?? [];
    try {
        await db.open();
        for await (const [key, raw] of db.iterator()) {
            if (!key.startsWith('!tables.results!')) continue;
            const tableId = key.slice('!tables.results!'.length).split('.')[0];
            if (!ids.includes(tableId)) continue;
            const result = JSON.parse(raw);
            const entry = tables.entries[tableId].results[result._id];
            assert.ok(entry, key);
            assert.match(entry.description, /[А-Яа-яЁё]/u, key);
            assert.deepEqual(formulas(entry.description), formulas(result.description), key);
            assert.deepEqual(Object.keys(entry).sort(), ['description', 'name']);
            count++;
        }
        assert.equal(count, 91);
        assert.equal(ids.reduce((sum, id) => sum + Object.keys(tables.entries[id].results).length, 0), count);
    } finally {
        await db.close();
        rmSync(temporary, {recursive: true, force: true});
    }
});
