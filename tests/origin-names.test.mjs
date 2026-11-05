import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {findContent, GRANT_ITEM_TYPES} from '../script/creation/content-lookup.mjs';
import {withCopiedPack} from './helpers/pack-copy.mjs';

const PACKS = ['dark-heresy', 'black-crusade', 'rogue-trader', 'only-war', 'deathwatch'];
const TYPES = GRANT_ITEM_TYPES;

/** Names an origin hands out, with where each came from. */
function grantedNames() {
    const dir = new URL('../packs-src/origins/', import.meta.url);
    const out = new Map();
    const add = (kind, name, where) => {
        if (!name) return;
        const key = `${kind}\u0000${name}`;
        if (!out.has(key)) out.set(key, {kind, name, where: []});
        out.get(key).where.push(where);
    };
    const scan = (grants, where) => {
        for (const t of grants?.talents ?? []) add('talent', t.name, where);
        for (const t of grants?.traits ?? []) add('trait', t.name, where);
        for (const e of grants?.equipment ?? []) add('equipment', e.name, where);
    };
    for (const file of readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'folders.json'))
        for (const entry of JSON.parse(readFileSync(new URL(file, dir), 'utf8'))) {
            scan(entry.system.grants, entry.name);
            for (const choice of entry.system.choices ?? [])
                for (const option of choice.options ?? []) scan(option.grants, `${entry.name} / ${option.label}`);
        }
    return [...out.values()];
}

test('every name an origin grants resolves to a real compendium entry', async () => {
    const index = {};
    for (const pack of PACKS) {
        index[pack] = await withCopiedPack(pack,async db=>{
            const entries=[];
            for await (const [key, value] of db.iterator())
                if(key.startsWith('!items!'))entries.push({name:value.name,type:value.type});
            return entries;
        });
    }

    const missing = [];
    for (const {kind, name, where} of grantedNames()) {
        const hit = PACKS.map(p => findContent(index[p], TYPES[kind], name)).find(Boolean);
        if (!hit) missing.push(`${kind} "${name}" — granted by ${[...new Set(where)].join('; ')}`);
    }
    assert.deepEqual(missing, [], 'these grants would become stub items on the actor');
});
