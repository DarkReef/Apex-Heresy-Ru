/** Keep init synchronous: ship template defaults as an importable ES module. */
import {readFile,writeFile} from 'node:fs/promises';
const source=new URL('../template.json',import.meta.url);
const destination=new URL('../script/data/template-data.mjs',import.meta.url);
const data=JSON.parse(await readFile(source,'utf8'));
if(!Array.isArray(data.Actor?.types)||!Array.isArray(data.Item?.types))throw Error('Invalid system template');
const generated='/** Generated from template.json. Run npm run models:build after changing defaults. */\n'
    +`export default ${JSON.stringify(data,null,2)};\n`;
await writeFile(destination,generated,'utf8');
console.log('Generated synchronous template defaults for Actor and Item models.');
