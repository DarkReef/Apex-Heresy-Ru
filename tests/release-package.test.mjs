import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstat, mkdir, mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClassicLevel} from 'classic-level';
import {buildRelease, RELEASE_CONTENTS} from '../tools/build-release.mjs';

async function treeHashes(path, prefix = '') {
    const result = {};
    for (const name of (await readdir(path)).sort()) {
        const child = join(path, name);
        const key = join(prefix, name);
        if ((await lstat(child)).isDirectory()) Object.assign(result, await treeHashes(child, key));
        else result[key] = createHash('sha256').update(await readFile(child)).digest('hex');
    }
    return result;
}

async function makeFixture() {
    // Isolated fixture roots are intentionally retained; tests never recursively delete paths.
    const root = await mkdtemp(join(tmpdir(), 'apex-release-fixture-'));
    const source = join(root, 'source');
    await mkdir(source);
    const fileEntries = new Set(['system.json', 'template.json', 'LICENSE', 'README.md', 'tools/Move-ApexWorld.ps1']);
    for (const entry of RELEASE_CONTENTS) {
        const path = join(source, entry);
        if (fileEntries.has(entry)) {
            await mkdir(join(path, '..'), {recursive: true});
            await writeFile(path, entry.endsWith('.json') ? '{}' : `fixture ${entry}\n`);
        } else {
            await mkdir(path, {recursive: true});
            if (entry !== 'packs') await writeFile(join(path, 'included.txt'), `fixture ${entry}\n`);
        }
    }
    const manifest = {
        id: 'apex-heresy-ru', version: '1.6.0',
        packs: [{name: 'only-war', system: 'apex-heresy-ru', path: 'packs/only-war', type: 'Item'}]
    };
    await writeFile(join(source, 'system.json'), JSON.stringify(manifest));
    const db = new ClassicLevel(join(source, 'packs', 'only-war'), {valueEncoding: 'json'});
    const records = {
        '!items!stable-item': {
            _id: 'stable-item', name: 'dark-heresy stays literal', type: 'weapon',
            img: 'systems/dark-heresy/assets/weapon.webp',
            system: {description: '<a>@UUID[Compendium.dark-heresy.only-war.Item.stable-item]</a>', damage: '1d10+3'},
            flags: {'dark-heresy': {equipped: true, source: 'Compendium.dark-heresy.only-war.Item.stable-item'}, other: {kept: 42}},
            _stats: {systemId: 'dark-heresy', systemVersion: '1.4.2', compendiumSource: 'Compendium.dark-heresy.only-war.Item.stable-item'},
            effects: [{_id: 'stable-effect', img: 'systems/dark-heresy/assets/effect.webp', _stats: {systemId: 'dark-heresy'}}],
            command: 'game.settings.get("dark-heresy", "mode"); fromUuid("Compendium.dark-heresy.only-war.Item.stable-item")'
        },
        '!folders!stable-folder': {_id: 'stable-folder', name: 'Arsenal', sorting: 'a', flags: {}},
        '!items!unchanged-item': {_id: 'unchanged-item', img: 'icons/weapon.svg', system: {quantity: 3}, _stats: {systemId: 'apex-heresy-ru'}}
    };
    try {
        await db.open();
        await db.batch(Object.entries(records).map(([key, value]) => ({type: 'put', key, value})));
    } finally { await db.close(); }
    return {root, source, manifest, records};
}

test('release rewrites copied packs without changing source files, document IDs, mechanics or flag scopes', async () => {
    const {root, source, records} = await makeFixture();
    const sourceHashes = await treeHashes(source);
    const output = join(root, 'release');
    const report = await buildRelease({sourceRoot: source, outputDirectory: output});
    assert.equal(report.systemId, 'apex-heresy-ru');
    assert.equal(report.records, 3);
    assert.equal(report.changed, 1);
    assert.deepEqual(await treeHashes(source), sourceHashes, 'even LevelDB logs/manifests must remain byte-identical');
    for (const entry of RELEASE_CONTENTS) assert.ok(await lstat(join(output, entry)), `release includes ${entry}`);
    assert.equal(await readFile(join(output, 'tools/Move-ApexWorld.ps1'), 'utf8'), 'fixture tools/Move-ApexWorld.ps1\n');
    const db = new ClassicLevel(join(output, 'packs/only-war'), {valueEncoding: 'json', createIfMissing: false});
    try {
        await db.open();
        assert.deepEqual((await db.keys().all()).sort(), Object.keys(records).sort());
        const item = await db.get('!items!stable-item');
        assert.equal(item._id, 'stable-item');
        assert.equal(item.effects[0]._id, 'stable-effect');
        assert.equal(item.img, 'systems/apex-heresy-ru/assets/weapon.webp');
        assert.match(item.system.description, /Compendium\.apex-heresy-ru\.only-war\.Item\.stable-item/);
        assert.equal(item.system.damage, '1d10+3');
        assert.equal(item._stats.systemId, 'apex-heresy-ru');
        assert.equal(item._stats.systemVersion, '1.4.2');
        assert.equal(item.effects[0]._stats.systemId, 'apex-heresy-ru');
        assert.equal(item.flags['dark-heresy'].equipped, true);
        assert.equal(item.flags['dark-heresy'].source, 'Compendium.apex-heresy-ru.only-war.Item.stable-item');
        assert.deepEqual(item.flags.other, {kept: 42});
        assert.equal(item.flags['apex-heresy-ru'], undefined);
        assert.equal(item.command, records['!items!stable-item'].command, 'never rewrite executable macro source implicitly');
        assert.deepEqual(await db.get('!folders!stable-folder'), records['!folders!stable-folder']);
        assert.deepEqual(await db.get('!items!unchanged-item'), records['!items!unchanged-item']);
    } finally { await db.close(); }
    const outputHashes = await treeHashes(output);
    await assert.rejects(buildRelease({sourceRoot: source, outputDirectory: output}), /already exists/);
    assert.deepEqual(await treeHashes(output), outputHashes, 'existing output must not be overwritten');
    assert.deepEqual(await treeHashes(source), sourceHashes, 'validation and output DB inspection never open the source');
});

test('release preflight requires explicit new output and refuses input recursion, wrong IDs and escaping pack paths', async () => {
    const {root, source, manifest} = await makeFixture();
    await assert.rejects(buildRelease({sourceRoot: source}), /explicit outputDirectory/);
    await assert.rejects(buildRelease({sourceRoot: source, outputDirectory: join(source, 'packs', 'release')}), /inside release input/);
    const output = join(root, 'rejected');
    await writeFile(join(source, 'system.json'), JSON.stringify({...manifest, id: 'dark-heresy'}));
    await assert.rejects(buildRelease({sourceRoot: source, outputDirectory: output}), /manifest id/);
    await assert.rejects(lstat(output), {code: 'ENOENT'});
    await writeFile(join(source, 'system.json'), JSON.stringify({...manifest, packs: [{...manifest.packs[0], path: 'packs/../../outside'}]}));
    await assert.rejects(buildRelease({sourceRoot: source, outputDirectory: output}), /escapes the packs directory/);
    await assert.rejects(lstat(output), {code: 'ENOENT'});
});
