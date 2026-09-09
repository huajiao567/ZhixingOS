import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const sourcePath = resolve(repoRoot, 'public/avatar/AvatarSample_G.glb');
const distRoot = resolve(repoRoot, process.argv[2] ?? 'dist');
const canonicalDistPath = resolve(distRoot, 'avatar/AvatarSample_G.glb');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

if (!existsSync(sourcePath)) {
  throw new Error('production AvatarSample_G.glb is missing from public/avatar');
}
if (!existsSync(canonicalDistPath)) {
  throw new Error('web export must contain /avatar/AvatarSample_G.glb from Expo public assets');
}

const sourceHash = sha256(sourcePath);
const canonicalHash = sha256(canonicalDistPath);
if (canonicalHash !== sourceHash) {
  throw new Error(`web avatar bytes differ from reviewed source: source=${sourceHash} dist=${canonicalHash}`);
}

const matchingCopies = walk(distRoot)
  .filter((path) => path.toLowerCase().endsWith('.glb'))
  .filter((path) => sha256(path) === sourceHash)
  .map((path) => relative(distRoot, path).replaceAll('\\', '/'));

if (matchingCopies.length !== 1 || matchingCopies[0] !== 'avatar/AvatarSample_G.glb') {
  throw new Error(
    `production VRM must appear exactly once in Web export; found ${matchingCopies.length}: ${matchingCopies.join(', ')}`,
  );
}

const bytes = statSync(sourcePath).size;
console.log('[avatar-web-bundle]', JSON.stringify({
  sourceSha256: sourceHash,
  canonicalBytes: bytes,
  matchingCopies,
  duplicateBytes: 0,
}));
