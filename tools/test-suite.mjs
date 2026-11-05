import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {testInventory,selectTests,inventorySummary} from './test-inventory.mjs';
import {coverageReport} from './test-coverage.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const {values}=parseArgs({options:{tier:{type:'string',default:'all'},focus:{type:'string'},name:{type:'string'},
    list:{type:'boolean',default:false},coverage:{type:'boolean',default:false},watch:{type:'boolean',default:false},
    output:{type:'string',default:'coverage/test-audit'},concurrency:{type:'string'}}});
try {
    const inventory=await testInventory(root),selected=selectTests(inventory,values);
    if(values.list){console.log(JSON.stringify({inventory:inventorySummary(inventory),selected},null,2));}
    else {
        if(values.coverage&&values.watch)throw Error('Use either coverage or watch');
        const args=['--test'];
        if(values.watch)args.push('--watch');
        if(values.concurrency){if(!/^[1-9]\d*$/.test(values.concurrency))throw Error('Concurrency must be a positive integer');args.push(`--test-concurrency=${values.concurrency}`);}
        const output=resolve(root,values.output);
        if(values.coverage){
            await mkdir(output,{recursive:true});
            args.push('--experimental-test-coverage','--test-coverage-include=script/**',
                '--test-reporter=spec',`--test-reporter-destination=${join(output,'tests.log')}`,
                '--test-reporter=lcov',`--test-reporter-destination=${join(output,'lcov.info')}`);
        }
        args.push(...selected.map(test=>test.file));
        console.log(`Running ${selected.length} test files (${values.tier}${values.focus?`, ${values.focus}`:''})${values.coverage?' with V8 coverage':''}`);
        const started=performance.now();
        const status=await new Promise((done,reject)=>{
            const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',shell:false});
            child.once('error',reject);child.once('exit',(code,signal)=>done({code:code??1,signal}));
        });
        if(values.coverage){
            const report={generatedAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,
                command:[process.execPath,...args],exitCode:status.code,durationMs:Number((performance.now()-started).toFixed(3)),
                selection:{tier:values.tier,focus:values.focus??null,files:selected.map(test=>test.file)},inventory:inventorySummary(inventory),
                coverage:await coverageReport(root,join(output,'lcov.info'))};
            const log=await readFile(join(output,'tests.log'),'utf8');
            report.tests=Object.fromEntries(['tests','pass','fail','skipped'].map(key=>[key,Number(new RegExp(`^\\s*(?:ℹ|#)\\s+${key} (\\d+)\\s*$`,'m').exec(log)?.[1]??0)]));
            await writeFile(join(output,'summary.json'),JSON.stringify(report,null,2)+'\n');
            console.log(JSON.stringify({exit:status.code,durationMs:report.durationMs,tests:report.tests,
                loadedScriptsCoverage:report.coverage.loadedScripts.percentages,reportedRuntimeFiles:report.coverage.reportedFiles,
                unreportedRuntimeFiles:report.coverage.unreportedRuntimeFiles.length,summary:join(output,'summary.json')},null,2));
        }
        process.exitCode=status.code;
    }
} catch(error) {console.error(error.message);process.exitCode=1;}
