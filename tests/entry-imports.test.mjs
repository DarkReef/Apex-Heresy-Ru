import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {entrySourceForVM} from './helpers/system.mjs';

// tests/helpers/system.mjs runs the entry module inside node:vm after stripping its import
// lines with a single-line regex. An import spread over two lines survives the strip, and the
// suite cannot compile the VM entry. Keep this explicit contract until the harness
// supports multiline imports. The transform preserves original line/offset mapping.
test('every import in the entry module fits on one line, or the test harness cannot strip it', () => {
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    const lines = source.split(/\r?\n/);
    const unstripped = lines
        .map((line, index) => ({line, number: index + 1}))
        .filter(({line}) => /^\s*import\b/.test(line) && !/;\s*$/.test(line));
    assert.deepEqual(unstripped, [], 'these import statements span more than one line');
});

test('the harness strips the imports it is given', () => {
    const source = readFileSync(new URL('../script/dark-heresy.js', import.meta.url), 'utf8');
    const stripped = entrySourceForVM(source);
    assert.doesNotMatch(stripped, /^\s*import\b/m);
    assert.equal(stripped.length,source.length,'V8 offsets must refer to the original entry file');
    assert.equal(stripped.split('\n').length,source.split('\n').length,'stack and coverage lines must not shift');
});
