// main.ts — LANTERN QUAY entrypoint (Node 22, standard library only).
// Copies game/ and screenshots/ from this repository to /output (or
// $MAKEFUN_OUTPUT_DIR) and writes /output/dossier.json with buildDossier
// from vendor/makefun-threejs.ts (the kit's copy, unchanged).
// Both runs must write the same bytes: the copy is a plain file copy and
// buildDossier is deterministic over the same directory.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const out = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const root = dirname(fileURLToPath(import.meta.url));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'game'), join(out, 'game'), { recursive: true });
cpSync(join(root, 'screenshots'), join(out, 'screenshots'), { recursive: true });

const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
writeFileSync(join(out, 'dossier.json'), dossier);
console.log(`wrote ${join(out, 'dossier.json')} (${dossier.length} bytes)`);
