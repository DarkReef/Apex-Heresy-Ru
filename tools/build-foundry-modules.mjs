import {readFileSync,existsSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root,'dist','foundry-modules');
mkdirSync(output,{recursive:true});
for (const id of ['riftan-charbar','itempileffg','riftan-smart-assessment']) {
    const directory=join(root,'modules',id), manifest=JSON.parse(readFileSync(join(directory,'module.json'),'utf8'));
    if (manifest.id!==id || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version)) throw new Error('Unexpected package identity');
    for (const path of [...manifest.esmodules,...manifest.styles,...manifest.languages.map(lang=>lang.path),'LICENSE','README.md']) {
        const file=resolve(directory,path);
        if (!file.startsWith(directory+'/') || !existsSync(file)) throw new Error(`Missing or invalid package file ${id}/${path}`);
    }
    const archive=join(output,`${id}.zip`);
    rmSync(archive,{force:true});
    execFileSync('zip',['-qr',archive,'.'],{cwd:directory});
    mkdirSync(join(output,id),{recursive:true});
    copyFileSync(join(directory,'module.json'),join(output,id,'module.json'));
    console.log(`${id} ${manifest.version}: ${archive}`);
}
