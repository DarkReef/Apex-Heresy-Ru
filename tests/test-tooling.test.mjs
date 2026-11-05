import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {testInventory,selectTests} from '../tools/test-inventory.mjs';
import {parseLcov,coverageTotals,coverageReport} from '../tools/test-coverage.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));

test('unit/TDD selection excludes VM integration and simulated end-to-end scenarios without losing the full suite',async()=>{
    const inventory=await testInventory(root),all=selectTests(inventory);
    assert.equal(new Set(all.map(test=>test.file)).size,all.length);
    assert.deepEqual(all,inventory);
    for(const unit of selectTests(inventory,{tier:'unit'})) {
        const source=await readFile(new URL(`../${unit.file}`,import.meta.url),'utf8');
        assert.doesNotMatch(source,/from\s+['"]\.\/helpers\/(?:system|ow-damage-fixture)\.mjs['"]/);
    }
    assert.equal(inventory.find(test=>test.file.endsWith('/ow-damage-e2e.test.mjs')).tier,'scenario');
    assert.equal(inventory.find(test=>test.file.endsWith('/combat-workflow-entry.test.mjs')).tier,'scenario');
    for(const file of ['attack-workflow','effect-clock','ammunition-link','workflow-native','combat-workflow-entry'])
        assert.ok(selectTests(inventory,{focus:'combat'}).some(test=>test.file.endsWith(`/${file}.test.mjs`)),file);
    assert.throws(()=>selectTests(inventory,{tier:'e2e'}),/Unknown tier/);
    assert.throws(()=>selectTests(inventory,{name:'does-not-exist'}),/No tests selected/);
});

test('LCOV summaries retain actual line/function/branch denominators and normalize portable source paths',()=>{
    const lcov='TN:\nSF:script\\combat\\example.mjs\nLF:10\nLH:7\nFNF:4\nFNH:2\nBRF:8\nBRH:3\nend_of_record\n'
        +'SF:script/data/example.mjs\nLF:4\nLH:4\nFNF:2\nFNH:2\nBRF:0\nBRH:0\nend_of_record\n';
    const files=parseLcov(lcov,{root});
    assert.equal(files[0].file,'script/combat/example.mjs');
    assert.deepEqual(files[0].percentages,{lines:70,functions:50,branches:37.5});
    assert.equal(files[1].percentages.branches,null,'no executable branches must not become an invented 100%');
    const total=coverageTotals(files);
    assert.deepEqual(total.lines,{found:14,hit:11});assert.deepEqual(total.functions,{found:6,hit:4});
    assert.deepEqual(total.branches,{found:8,hit:3});assert.equal(total.percentages.lines,78.57);
});

test('generated template declarations cannot inflate the separate behavior total, while raw data and ordinary catalogs remain',async t=>{
    const fixture=await mkdtemp(join(tmpdir(),'apex-coverage-'));
    t.after(()=>rm(fixture,{recursive:true,force:true}));
    await mkdir(join(fixture,'script/data'),{recursive:true});
    const records=[
        {file:'script/data/template-data.mjs',found:1000,hit:1000},
        {file:'script/data/equipment-catalog.mjs',found:10,hit:10},
        {file:'script/rules.mjs',found:10,hit:5}
    ];
    for(const {file} of records)await writeFile(join(fixture,file),'export default {};\n');
    const lcov=records.map(({file,found,hit})=>`SF:${file}\nLF:${found}\nLH:${hit}\nFNF:0\nFNH:0\nBRF:0\nBRH:0\nend_of_record\n`).join('');
    const lcovPath=join(fixture,'lcov.info');await writeFile(lcovPath,lcov);
    const report=await coverageReport(fixture,lcovPath);
    assert.deepEqual(report.generatedDataFiles,['script/data/template-data.mjs']);
    assert.equal(report.reportedFiles,3);assert.equal(report.reportedBehaviorFiles,2);
    assert.deepEqual(report.loadedScripts,coverageTotals(parseLcov(lcov,{root:fixture})),'raw V8 denominator must be unchanged');
    assert.deepEqual(report.loadedScripts.lines,{found:1020,hit:1015});
    assert.equal(report.loadedScripts.percentages.lines,99.51);
    assert.deepEqual(report.loadedBehaviorScripts.lines,{found:20,hit:15},'ordinary catalogs must remain in the behavior denominator');
    assert.equal(report.loadedBehaviorScripts.percentages.lines,75);
    assert.equal(report.loadedBehaviorScripts.percentages.functions,null);
    assert.equal(report.files.length,3);assert.deepEqual(report.unreportedRuntimeFiles,[]);
    assert.deepEqual(report.groups.data.lines,{found:1010,hit:1010},'raw groups must retain generated declarations');
    assert.match(report.behaviorDenominator,/Only V8-reported loaded scripts/);
    assert.match(report.behaviorDenominator,/not complete repository or semantic coverage/);
});
