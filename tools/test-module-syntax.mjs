import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Parse all requested modules in one process. This does not execute their browser
// code, resolve dependencies or pretend to test Foundry initialization.
if(typeof vm.SourceTextModule!=='function')throw Error('Run with --experimental-vm-modules');
const files=process.argv.slice(2);
if(!files.length)throw Error('At least one source file is required');
const failures=[];
for(const file of files) {
    try {new vm.SourceTextModule(await readFile(file,'utf8'),{identifier:file});}
    catch(error){failures.push(`${file}: ${error.message}`);}
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
