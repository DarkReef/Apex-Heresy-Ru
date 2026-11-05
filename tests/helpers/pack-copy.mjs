import {mkdtemp,cp,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {ClassicLevel} from 'classic-level';

/** LevelDB opens can write logs. Inspect only a private copy of a repository pack. */
export async function withCopiedPack(pack,read) {
    if(!/^[a-z0-9-]+$/.test(pack))throw Error('Invalid repository pack name');
    const temporary=await mkdtemp(join(tmpdir(),'apex-pack-contract-'));
    if(dirname(temporary)!==resolve(tmpdir()))throw Error('Temporary pack path escaped its parent');
    let db;
    try {
        const copy=join(temporary,'pack');
        await cp(new URL(`../../packs/${pack}/`,import.meta.url),copy,{recursive:true});
        db=new ClassicLevel(copy,{valueEncoding:'json',createIfMissing:false});
        await db.open();return await read(db);
    } finally {
        try {await db?.close();} finally {await rm(temporary,{recursive:true,force:true});}
    }
}
