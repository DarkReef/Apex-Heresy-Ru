import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import templateData from '../script/data/template-data.mjs';
import {resolveTypeTemplate} from '../script/data/models.mjs';

test('synchronous init defaults exactly match the authoritative template.json',()=>{
    const source=JSON.parse(readFileSync(new URL('../template.json',import.meta.url),'utf8'));
    assert.deepEqual(templateData,source,'Run npm run models:build after changing template.json');
    for(const documentName of ['Actor','Item'])for(const type of source[documentName].types)
        assert.deepEqual(resolveTypeTemplate(templateData,documentName,type),resolveTypeTemplate(source,documentName,type));
});
