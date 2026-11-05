import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';

export const TEST_TIERS=Object.freeze(['unit','integration','scenario','contracts']);
// These are multi-step scenarios against simulated Foundry documents. The name
// "e2e" of an existing file does not make it a browser/server acceptance test.
const SCENARIOS=new Set(['ow-damage-e2e.test.mjs','combat-workflow-entry.test.mjs']);
const HOST_INTEGRATION=new Set(['foundry-attack-workflow.test.mjs','workflow-native.test.mjs']);
const CONTRACTS=/^(?:localization-|interface-|lang-|encoding\.|distribution-|release-package\.|pack-|bc-talent-pack\.|equipment-pack-|entry-imports\.|module-syntax\.|wizard-keys\.|origin-source\.|origin-names\.|weapon-type-coverage\.)/;
const COMBAT=/^(?:ammunition-|attack-|combat-|damage-|effect-|evasion-|equipment-bonus|fate\.|force-field\.|foundry-attack-|helpers-isolation\.|jam-|modifier-breakdown\.|ow-damage-|penetration-|remaining-wounds\.|short-magazine\.|spray-|stability-regressions\.|suppression-|token-wounds\.|vitals\.|weapon-ammo-|workflow-)/;

export function classifyTestFile(name,source) {
    if(SCENARIOS.has(name))return 'scenario';
    if(HOST_INTEGRATION.has(name)||/from\s+['"]\.\/helpers\/(?:system|ow-damage-fixture)\.mjs['"]/.test(source))return 'integration';
    if(CONTRACTS.test(name))return 'contracts';
    return /from\s+['"]\.\.\/(?:script|tools\/lib)\//.test(source)?'unit':'contracts';
}

export async function testInventory(root) {
    const names=(await readdir(join(root,'tests'))).filter(name=>name.endsWith('.test.mjs')).sort();
    return Promise.all(names.map(async name=>{
        const source=await readFile(join(root,'tests',name),'utf8');
        const sourceAssertions=(source.match(/assert\.(?:match|doesNotMatch)\(\s*(?:source|builder|flow|block|card|template|html|script)\b/g)??[]).length;
        return {file:`tests/${name}`,tier:classifyTestFile(name,source),combat:COMBAT.test(name),
            sourceAssertions,readsEntrySource:/readFileSync\([^;]*dark-heresy\.js/s.test(source)};
    }));
}

export function selectTests(inventory,{tier='all',focus,name}={}) {
    if(tier!=='all'&&!TEST_TIERS.includes(tier))throw Error(`Unknown tier: ${tier}`);
    if(focus&&focus!=='combat')throw Error(`Unknown focus: ${focus}`);
    const selected=inventory.filter(test=>(tier==='all'||test.tier===tier)&&(!focus||test.combat)
        &&(!name||test.file.toLowerCase().includes(name.toLowerCase())));
    if(!selected.length)throw Error('No tests selected; check the tier/focus/name');
    return selected;
}

export function inventorySummary(inventory) {
    return {files:inventory.length,tiers:Object.fromEntries(TEST_TIERS.map(tier=>[tier,inventory.filter(test=>test.tier===tier).length])),
        combatFiles:inventory.filter(test=>test.combat).length,
        sourceAssertionIndicators:inventory.reduce((sum,test)=>sum+test.sourceAssertions,0),
        filesWithSourceAssertionIndicators:inventory.filter(test=>test.sourceAssertions).map(test=>test.file),
        note:'File-level tiers can contain mixed tests. Source-assertion indicators are a search aid, not a proof of behavior coverage.'};
}
