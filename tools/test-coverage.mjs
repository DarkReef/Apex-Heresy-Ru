import {readFile,readdir} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';

const percentage=(covered,total)=>total?Number((100*covered/total).toFixed(2)):null;
// This is a generated snapshot of template.json, not executable game behavior.
// Keep the allow-list explicit: ordinary catalogs still belong to both totals.
const generatedDataFiles=['script/data/template-data.mjs'];
function normalized(path,root) {
    const local=isAbsolute(path)?relative(root,path):path;
    return local.replaceAll('\\','/').replace(/^\.\//,'');
}
export function parseLcov(text,{root=process.cwd()}={}) {
    const files=[];
    for(const record of text.split('end_of_record')) {
        const path=/^SF:(.+)$/m.exec(record)?.[1]?.trim();if(!path)continue;
        const count=key=>Number(new RegExp(`^${key}:(\\d+)$`,'m').exec(record)?.[1]??0);
        const lines={found:count('LF'),hit:count('LH')},functions={found:count('FNF'),hit:count('FNH')},branches={found:count('BRF'),hit:count('BRH')};
        files.push({file:normalized(path,root),lines,functions,branches,
            percentages:{lines:percentage(lines.hit,lines.found),functions:percentage(functions.hit,functions.found),branches:percentage(branches.hit,branches.found)}});
    }
    return files;
}

export function coverageTotals(files) {
    const total=Object.fromEntries(['lines','functions','branches'].map(key=>[key,{found:0,hit:0}]));
    for(const file of files)for(const key of Object.keys(total)){total[key].found+=file[key].found;total[key].hit+=file[key].hit;}
    return {...total,percentages:Object.fromEntries(Object.keys(total).map(key=>[key,percentage(total[key].hit,total[key].found)]))};
}

async function sourceFiles(path,prefix='script') {
    const files=[];
    for(const entry of await readdir(path,{withFileTypes:true})) {
        if(entry.isDirectory())files.push(...await sourceFiles(join(path,entry.name),`${prefix}/${entry.name}`));
        else if(/\.(?:mjs|js)$/.test(entry.name))files.push(`${prefix}/${entry.name}`);
    }
    return files.sort();
}

export async function coverageReport(root,lcovPath) {
    const files=parseLcov(await readFile(lcovPath,'utf8'),{root});
    const runtime=await sourceFiles(join(root,'script')),reported=new Set(files.map(file=>file.file));
    const generated=new Set(generatedDataFiles),behaviorFiles=files.filter(file=>!generated.has(file.file));
    const groups={};
    for(const file of files) {
        const group=file.file==='script/dark-heresy.js'?'entry (VM with Foundry stubs)':file.file.split('/')[1];
        (groups[group]??=[]).push(file);
    }
    return {denominator:'Only V8-reported loaded scripts. Not a complete repository coverage percentage.',
        runtimeSourceFiles:runtime.length,reportedFiles:files.length,unreportedRuntimeFiles:runtime.filter(file=>!reported.has(file)),
        loadedScripts:coverageTotals(files),
        generatedDataFiles:[...generatedDataFiles],
        behaviorDenominator:'Only V8-reported loaded scripts excluding explicit generatedDataFiles. Ordinary catalogs remain included; not complete repository or semantic coverage.',
        reportedBehaviorFiles:behaviorFiles.length,loadedBehaviorScripts:coverageTotals(behaviorFiles),
        groups:Object.fromEntries(Object.entries(groups).map(([name,group])=>[name,coverageTotals(group)])),
        files,
        limits:['VM entry and host-adapter tests use simulated Foundry documents, DOM and persistence.',
            'The separate loadedBehaviorScripts total excludes only generatedDataFiles; raw loadedScripts and group totals retain them.',
            'Top-level constants/catalog declarations can count as executed without proving every rule.',
            'Coverage is not evidence of browser behavior, multiplayer networking, package updates or live MCP access.']};
}
