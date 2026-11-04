import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('package and Babele collections share the independent identity and own update source', () => {
    const manifest = JSON.parse(read('system.json'));
    assert.equal(manifest.id, 'apex-heresy-ru');
    assert.equal(manifest.manifest, 'https://github.com/DarkReef/Apex-Heresy-Ru/releases/latest/download/system.json');
    assert.equal(manifest.download, `https://github.com/DarkReef/Apex-Heresy-Ru/releases/download/v${manifest.version}-ru/apex-heresy-ru.zip`);
    for (const pack of manifest.packs) {
        assert.equal(pack.system, manifest.id);
        assert.ok(existsSync(new URL(`localization/ru/${manifest.id}.${pack.name}.json`, root)), pack.name);
    }
    for (const path of [...manifest.esmodules, ...manifest.styles]) assert.ok(existsSync(new URL(path,root)),path);
});

test('runtime uses independent resources/socket and never calls forbidden legacy flag APIs', () => {
    for (const folder of ['script', 'template', 'css']) {
        for (const path of readdirSync(new URL(folder+'/',root), {recursive:true})) {
            if (!/\.(mjs|js|hbs|css)$/.test(path)) continue;
            const name = `${folder}/${path.replaceAll('\\','/')}`;
            // Compatibility adapters necessarily mention the source references.
            if (/package-(identity|reference-migration)\.mjs$/.test(name)) continue;
            const source = read(name);
            assert.doesNotMatch(source, /systems\/dark-heresy\/|Compendium\.dark-heresy\.|system\.dark-heresy\b/, name);
            assert.doesNotMatch(source, /(?:getFlag|setFlag|unsetFlag)(?:\?\.)?\(\s*["']dark-heresy["']/, name);
        }
    }
});
