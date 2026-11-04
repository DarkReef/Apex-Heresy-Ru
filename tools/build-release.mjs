/**
 * Stage an installable release in a NEW directory; no ZIP or deletion is done.
 * Usage: node tools/build-release.mjs <new-staging-directory>
 * (--output <new-staging-directory> is also accepted.)
 *
 * LevelDB opens can write logs/metadata even when used only to read. Source pack
 * directories are therefore copied first; only the release copies are opened.
 * On failure the incomplete staging directory is retained for inspection.
 */
import {copyFile, lstat, mkdir, readFile, readdir, realpath} from 'node:fs/promises';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ClassicLevel} from 'classic-level';
import {LEGACY_DATA_SCOPE, SYSTEM_ID, rewriteLegacyReferences} from '../script/package-identity.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
export const RELEASE_CONTENTS = Object.freeze([
    'system.json', 'template.json', 'script', 'template', 'css', 'assets', 'logo',
    'packs', 'lang', 'localization', 'LICENSE', 'README.md', 'docs', 'tools/Move-ApexWorld.ps1'
]);

function isWithin(parent, path) {
    const pathFromParent = relative(parent, path);
    return pathFromParent === '' || (!isAbsolute(pathFromParent) && pathFromParent !== '..' && !pathFromParent.startsWith(`..${sep}`));
}

async function requireAbsent(path) {
    try {
        await lstat(path);
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    throw new Error(`Output path already exists; choose a new directory: ${path}`);
}

async function inspectTree(source, files, directories, prefix = '') {
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) throw new Error(`Release input must not contain symbolic links: ${source}`);
    if (stat.isDirectory()) {
        directories.push(prefix);
        for (const child of (await readdir(source)).sort()) {
            await inspectTree(join(source, child), files, directories, join(prefix, child));
        }
    } else if (stat.isFile()) files.push(prefix);
    else throw new Error(`Release input is not a regular file or directory: ${source}`);
}

function validatePackPath(pack, sourceRoot) {
    if (typeof pack.path !== 'string' || !pack.path.startsWith('packs/') || pack.path.includes('\\')) {
        throw new Error(`Invalid pack path: ${pack.path}`);
    }
    const sourcePath = resolve(sourceRoot, pack.path);
    const packsRoot = join(sourceRoot, 'packs');
    if (sourcePath === packsRoot || !isWithin(packsRoot, sourcePath)) {
        throw new Error(`Pack path escapes the packs directory: ${pack.path}`);
    }
    if (pack.system !== SYSTEM_ID) throw new Error(`Pack ${pack.name} must declare system ${SYSTEM_ID}.`);
    return relative(sourceRoot, sourcePath);
}

/** Preserve document/key IDs and flag namespaces; change only package references. */
function rewritePackRecord(original) {
    const updated = rewriteLegacyReferences(original);
    const updateStats = value => {
        if (Array.isArray(value)) {
            for (const entry of value) updateStats(entry);
        } else if (value && typeof value === 'object') {
            if (value._stats?.systemId === LEGACY_DATA_SCOPE) value._stats.systemId = SYSTEM_ID;
            for (const [key, entry] of Object.entries(value)) {
                if (key !== 'command') updateStats(entry);
            }
        }
    };
    updateStats(updated);
    return updated;
}

async function rewriteCopiedPack(path, name) {
    const db = new ClassicLevel(path, {keyEncoding: 'utf8', valueEncoding: 'utf8', createIfMissing: false});
    let records = 0;
    let changed = 0;
    let batch = [];
    try {
        await db.open();
        for await (const [key, raw] of db.iterator()) {
            let original;
            try { original = JSON.parse(raw); }
            catch (cause) { throw new Error(`Pack ${name}, record ${key}: invalid JSON.`, {cause}); }
            const updated = rewritePackRecord(original);
            records++;
            if (JSON.stringify(original) === JSON.stringify(updated)) continue;
            batch.push({type: 'put', key, value: JSON.stringify(updated)});
            changed++;
            if (batch.length >= 128) {
                await db.batch(batch);
                batch = [];
            }
        }
        if (batch.length) await db.batch(batch);
    } finally {
        await db.close();
    }
    return {name, records, changed};
}

/**
 * Exported for fixture verification. sourceRoot defaults to this repository;
 * outputDirectory is deliberately mandatory and must not already exist.
 */
export async function buildRelease({outputDirectory, sourceRoot = repositoryRoot} = {}) {
    if (typeof outputDirectory !== 'string' || !outputDirectory.trim()) {
        throw new Error('An explicit outputDirectory is required.');
    }
    const source = await realpath(resolve(sourceRoot));
    const requestedOutput = resolve(outputDirectory);
    await requireAbsent(requestedOutput);
    // Resolve the existing parent so a junction cannot redirect output into an input.
    // Requiring an existing parent also prevents unexpected directory-tree creation.
    const outputParent = await realpath(dirname(requestedOutput));
    const output = join(outputParent, relative(dirname(requestedOutput), requestedOutput));
    if (output === source) throw new Error('Output must differ from the source repository.');
    await requireAbsent(output);
    for (const entry of RELEASE_CONTENTS) {
        if (isWithin(resolve(source, entry), output)) throw new Error(`Output must not be inside release input: ${entry}`);
    }

    const manifest = JSON.parse(await readFile(join(source, 'system.json'), 'utf8'));
    if (manifest.id !== SYSTEM_ID) throw new Error(`Release manifest id must be ${SYSTEM_ID}.`);
    if (!Array.isArray(manifest.packs)) throw new Error('Release manifest must contain a packs array.');
    const packPaths = manifest.packs.map(pack => validatePackPath(pack, source));
    if (new Set(packPaths.map(path => process.platform === 'win32' ? path.toLowerCase() : path)).size !== packPaths.length) {
        throw new Error('Manifest contains duplicate pack paths.');
    }

    // Preflight every included input before creating the output directory.
    const files = [];
    const directories = [];
    for (const entry of RELEASE_CONTENTS) await inspectTree(join(source, entry), files, directories, entry);
    for (const path of packPaths) {
        if (!(await lstat(join(source, path))).isDirectory()) throw new Error(`Pack is not a directory: ${path}`);
    }
    await mkdir(output); // Atomic refusal if another process created it after preflight.
    try {
        for (const directory of directories) await mkdir(join(output, directory), {recursive: true});
        for (const file of files) {
            const destination = join(output, file);
            await mkdir(dirname(destination), {recursive: true});
            await copyFile(join(source, file), destination);
        }
        const packs = [];
        for (let index = 0; index < packPaths.length; index++) {
            packs.push(await rewriteCopiedPack(join(output, packPaths[index]), manifest.packs[index].name));
        }
        return {
            outputDirectory: output, systemId: manifest.id, version: manifest.version,
            filesCopied: files.length, packs,
            records: packs.reduce((sum, pack) => sum + pack.records, 0),
            changed: packs.reduce((sum, pack) => sum + pack.changed, 0)
        };
    } catch (cause) {
        throw new Error(`Release build failed; incomplete staging retained at ${output}. ${cause.message}`, {cause});
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const outputDirectory = args.length === 1 ? args[0] : args.length === 2 && args[0] === '--output' ? args[1] : undefined;
    if (!outputDirectory || outputDirectory.startsWith('--')) {
        console.error('Usage: node tools/build-release.mjs <new-staging-directory>');
        process.exitCode = 1;
    } else {
        try { console.log(JSON.stringify(await buildRelease({outputDirectory}), null, 2)); }
        catch (error) {
            console.error(error.message);
            process.exitCode = 1;
        }
    }
}
