import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, statSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';

/**
 * Every file under script/ must parse as an ES module.
 *
 * The rest of the suite loads script/dark-heresy.js in a vm with its import lines
 * stripped, so a syntax error inside one of the imported modules never reaches it:
 * an `await` written in a synchronous method once shipped that way and took the
 * whole system down in Foundry while 435 tests stayed green. This is the guard.
 */
const root = fileURLToPath(new URL('../script', import.meta.url));

function scripts(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return scripts(path);
        return /\.m?js$/.test(name) ? [path] : [];
    });
}

test('every script parses as a module, imports and all', () => {
    const files = scripts(root);
    assert.ok(files.length > 5, 'the sweep found the scripts');
    // One parser process retains the complete syntax sweep without starting a
    // separate Node runtime for every file. No browser module is executed.
    try {
        execFileSync(process.execPath,
            ['--experimental-vm-modules',fileURLToPath(new URL('../tools/test-module-syntax.mjs',import.meta.url)),...files],
            {stdio:['ignore','ignore','pipe']});
    } catch(err) {
        assert.fail(`Module syntax failed: ${err.message}\n${String(err.stderr)}`);
    }
});

test('the batched parser checks later files and reports the actual malformed module',()=>{
    const directory=mkdtempSync(join(tmpdir(),'apex-module-syntax-'));
    assert.equal(dirname(directory),resolve(tmpdir()));
    const valid=join(directory,'valid.mjs'),invalid=join(directory,'invalid.mjs');
    try {
        writeFileSync(valid,'export const ok=1;');writeFileSync(invalid,'export const broken = ;');
        assert.throws(()=>execFileSync(process.execPath,
            ['--experimental-vm-modules',fileURLToPath(new URL('../tools/test-module-syntax.mjs',import.meta.url)),valid,invalid],
            {stdio:['ignore','ignore','pipe']}),error=>{
            assert.equal(error.status,1);assert.ok(String(error.stderr).includes(invalid));return true;
        });
    } finally {rmSync(directory,{recursive:true,force:true});}
});
