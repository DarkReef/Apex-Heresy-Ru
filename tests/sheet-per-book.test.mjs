import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {loadSystem} from './helpers/system.mjs';
import {RULESET_DEFS} from '../script/creation/ruleset-data.mjs';

const template = JSON.parse(readFileSync(new URL('../template.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');

/** Fields a character type actually has, its templates folded in. */
const model = type => (template.Actor[type].templates ?? [])
    .reduce((out, name) => ({...out, ...template.Actor.templates[name]}), {...template.Actor[type]});

test('both character types carry every field any book writes', () => {
    const acolyte = model('acolyte');
    const heretic = model('heretic');
    for (const field of ['race', 'archetype', 'patron', 'alignment', 'pride', 'vice', 'aspiration']) {
        assert.notEqual(acolyte[field], undefined, `acolyte has no ${field}`);
        assert.notEqual(heretic[field], undefined, `heretic has no ${field}`);
    }
    // Whatever the book writes, it writes into the same shape on either type: a character
    // can be re-pointed at another book without being re-created.
    assert.deepEqual(Object.keys(acolyte).sort(), Object.keys(heretic).sort());
});

test('no book demands an actor type any more', () => {
    for (const [id, def] of Object.entries(RULESET_DEFS))
        assert.equal(def.actorType, undefined, id);
    assert.equal(source.includes('WIZARD.WRONG_TYPE'), false,
        'the warning that asked the player to have a different sheet created is gone');
});

test('every book has a sheet, and the sheet is chosen by the book', () => {
    const system = loadSystem();
    const sheets = system.get('Dh.bookSheets');
    assert.deepEqual(Object.keys(sheets).sort(), Object.keys(RULESET_DEFS).sort());

    const sheetFor = system.get('Dh.sheetFor');
    assert.equal(sheetFor({system: {ruleset: 'bc'}, type: 'acolyte'}), 'BlackCrusadeSheet',
        'the book wins over the type');
    assert.equal(sheetFor({system: {ruleset: 'ow'}, type: 'heretic'}), 'OnlyWarSheet');
    // A character who never named a book keeps the sheet his type always had.
    assert.equal(sheetFor({type: 'heretic', system: {}}), 'BlackCrusadeSheet');
    assert.equal(sheetFor({type: 'acolyte', system: {}}), 'DarkHeresy2Sheet');
    assert.equal(sheetFor(null), 'DarkHeresy2Sheet');
});

test('each sheet names its own biography, vitals and tabs', () => {
    const system = loadSystem();
    const sheets = system.get('Dh.bookSheets');
    const seen = new Map();
    for (const [id, sheet] of Object.entries(sheets)) {
        assert.equal(sheet.ruleset, id);
        assert.match(sheet.bioPartial, /partial\/bio-[a-z-]+\.hbs$/, id);
        assert.ok(sheet.vitals.length >= 3, id);
        assert.ok(sheet.tabList.length >= 8, id);
        // Two books must not share one biography: that was the whole point.
        assert.equal(seen.get(sheet.bioPartial), undefined, `${id} reuses ${sheet.bioPartial}`);
        seen.set(sheet.bioPartial, id);
    }
    const tabs = id => sheets[id].tabList.map(tab => tab.id);
    assert.ok(tabs('ow').includes('squad'), 'the Guardsman has his Comrade');
    assert.equal(tabs('dh2').includes('squad'), false);
    assert.ok(tabs('bc').includes('allegiance'), 'the Heretic has his patron and his tally');
    assert.equal(tabs('dh2').includes('allegiance'), false);
    assert.ok(sheets.bc.vitals.includes('infamy'), 'Infamy Points stand where Fate would');
    assert.equal(sheets.bc.vitals.includes('fate'), false);
});

test('every partial a sheet names exists and is preloaded', () => {
    const system = loadSystem();
    const sheets = system.get('Dh.bookSheets');
    const wanted = new Set(["systems/apex-heresy-ru/template/sheet/actor/character.hbs"]);
    for (const sheet of Object.values(sheets)) {
        wanted.add(sheet.bioPartial);
        for (const key of sheet.vitals)
            wanted.add(`systems/apex-heresy-ru/template/sheet/actor/partial/vital-${key}.hbs`);
        for (const tab of sheet.tabList)
            wanted.add(`systems/apex-heresy-ru/template/sheet/actor/${tab.partial}`);
    }
    for (const path of wanted) {
        const file = new URL('../' + path.replace('systems/apex-heresy-ru/', ''), import.meta.url);
        assert.ok(existsSync(file), `missing file: ${path}`);
        // A partial addressed by a name from the context must be loaded up front, or
        // Handlebars will not find it when the sheet renders.
        assert.ok(source.includes(`"${path}"`), `not preloaded: ${path}`);
    }
});

test('the frame hands the sheet context down to every partial it calls', () => {
    const frame = readFileSync(new URL('../template/sheet/actor/character.hbs', import.meta.url), 'utf8');
    // Inside an {{#each}} the current context is the row, so a partial called there
    // would otherwise render without system, items or anything else.
    assert.match(frame, /\{\{> \(lookup vital "partial"\) \.\.\/this\}\}/);
    assert.match(frame, /\{\{> \(lookup tab "partial"\) \.\.\/this\}\}/);
});

test('the book is asked for once, where the character is created', () => {
    // The dialog folds its form fields straight into the created document, so a select
    // named system.ruleset is all it takes — nothing is intercepted.
    assert.match(source, /Hooks\.on\("renderDialogV2"/);
    assert.match(source, /select\.name = "system\.ruleset"/);
    assert.match(source, /RULESET\.CHARACTER_BOOK/);
    // A new Chaos character is a Character with a book, not a second document type.
    assert.match(source, /option\[value="heretic"\]'\)\?\.remove\(\)/);
    // And the sheet is right from the first render, not after the first edit.
    assert.match(source, /Hooks\.on\("preCreateActor"/);
});

test('the sheet no longer carries a book selector', () => {
    const portrait = readFileSync(
        new URL('../template/sheet/actor/partial/portrait.hbs', import.meta.url), 'utf8');
    assert.equal(portrait.includes('system.ruleset'), false,
        'the book is chosen when the character is created, not edited on the sheet');
    for (const book of ['dark-heresy', 'only-war', 'black-crusade', 'rogue-trader', 'deathwatch']) {
        const bio = readFileSync(
            new URL(`../template/sheet/actor/partial/bio-${book}.hbs`, import.meta.url), 'utf8');
        assert.equal(bio.includes('system.ruleset'), false, book);
    }
});

test('choosing a sheet by hand names the book too', () => {
    // Otherwise a character could read as Only War and be priced as Dark Heresy.
    assert.match(source, /flags\.core\.sheetClass/);
    assert.match(source, /Object\.entries\(Dh\.bookSheets\)\.find/);
});
