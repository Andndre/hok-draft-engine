import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../dist/', import.meta.url)).replace(/[\\/]$/, '');
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);
const files = walk(root);
if (files.some(file => /\.(onnx|wasm)(\.data)?$/.test(file))) throw new Error('Production build contains experimental model assets.');
const scripts = files.filter(file => file.endsWith('.js'));
if (!scripts.some(file => /opponent\.worker[^\\/]*\.js$/.test(file))) throw new Error('Opponent worker is missing from the build.');
for (const file of scripts) if (/api\.typesafe\.ai|onnxruntime|hok_jev_student/.test(readFileSync(file, 'utf8'))) throw new Error('Production script contains an obsolete model dependency.');
const manifest = JSON.parse(readFileSync(resolve(root, 'data_manifest.json'), 'utf8'));
for (const artifact of Object.values(manifest.artifacts)) {
  const path = resolve(root, artifact.file);
  if (!path.startsWith(root + sep)) throw new Error('Artifact path leaves build directory.');
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (digest !== artifact.sha256) throw new Error('Production artifact checksum does not match manifest.');
}
console.log('Production verified: dataset checksums, local opponent worker, no ONNX/WASM or cloud inference dependency.');
