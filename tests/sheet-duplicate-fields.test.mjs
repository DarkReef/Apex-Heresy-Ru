import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSystem} from './helpers/system.mjs';
import {collapseRepeatedText} from '../script/data/repeated-text.mjs';

const ROOT = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path.replace('systems/dark-heresy/', ''), ROOT), 'utf8');

/** A template with every partial it names by path folded in. */
function expanded(path, seen = new Set()) {
    if (seen.has(path)) return '';
    seen.add(path);
    return read(path).replace(/{{>\s*"?(systems\/dark-heresy\/[\w\/.-]+\.hbs)"?[^}]*}}/g,
        (_all, partial) => expanded(partial, seen));
}

/** Everything one book's character sheet puts into its single form. */
function formOf(sheet) {
    const base = 'systems/dark-heresy/template/sheet/actor/';
    return forBook([expanded(`${base}character.hbs`), expanded(sheet.bioPartial),
        ...sheet.vitals.map(key => expanded(`${base}partial/vital-${key}.hbs`)),
        ...sheet.tabList.map(tab => expanded(`${base}${tab.partial}`))].join('\n'), sheet.ruleset);
}

/** Drop what a template hides from this book: {{#unless (eq ruleset "x")}} blocks. */
function forBook(text, book) {
    const innermost = /{{#unless \(eq ruleset "(\w+)"\)}}((?:(?!{{#unless)[\s\S])*?){{\/unless}}/g;
    for (let before; before !== text;) {
        before = text;
        text = text.replace(innermost, (_all, hidden, body) => hidden === book ? '' : body);
    }
    return text;
}

test('no book sheet puts the same text field into its form twice', () => {
    // Two inputs sharing a name are submitted as an array, and a text field
    // stores an array as "value,value". Each save then doubled what the last one
    // left, which is how a Personal Demeanour grew every time the sheet closed.
    const sheets = loadSystem().get('Dh.bookSheets');
    for (const [book, sheet] of Object.entries(sheets)) {
        const names = [...formOf(sheet).matchAll(/<(?:input|textarea)[^>]*\sname="(system\.bio\.[\w.]+)"/g)]
            .map(match => match[1]);
        const twice = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
        assert.deepEqual(twice, [], `${book}: submitted twice`);
    }
});

test('a doubled value is collapsed back to what was typed', () => {
    assert.equal(collapseRepeatedText('Stoic,Stoic'), 'Stoic');
    assert.equal(collapseRepeatedText('Stoic,Stoic,Stoic,Stoic,Stoic,Stoic,Stoic,Stoic'), 'Stoic');
});

test('a value with commas of its own is collapsed whole', () => {
    const line = 'Calculating: analytical, aware of the pros and cons, always';
    assert.equal(collapseRepeatedText([line, line, line, line].join(',')), line);
});

test('text that merely contains a comma is left alone', () => {
    for (const text of ['Stoic', '', 'Proud, Stoic', 'a,b,a', 'Stoic,Stoic,Proud'])
        assert.equal(collapseRepeatedText(text), text);
});

test('what is not text is returned untouched', () => {
    assert.equal(collapseRepeatedText(undefined), undefined);
    assert.equal(collapseRepeatedText(7), 7);
});

test('the world migration repairs the fields that were doubled', () => {
    const patch = loadSystem().get('repeatedBioPatch');
    const actor = {type: 'acolyte', _source: {system: {bio: {
        demeanour: 'Stoic,Stoic,Stoic,Stoic', comrade: 'Hask,Hask', comradeDemeanour: 'Dour', notes: 'x,x'}}}};
    assert.deepEqual({...patch(actor)}, {'system.bio.demeanour': 'Stoic', 'system.bio.comrade': 'Hask'});
});

test('a character with nothing doubled is not written to', () => {
    const patch = loadSystem().get('repeatedBioPatch');
    assert.deepEqual({...patch({type: 'acolyte', _source: {system: {bio: {demeanour: 'Stoic'}}}})}, {});
    assert.deepEqual({...patch({type: 'vehicle', _source: {system: {}}})}, {});
});
