// make-upstream-manifest.mjs — record the sha256 of every upstream source file
// as it exists on branch `main` (the pristine upstream tree this fork branched
// from), so tests/quilt.test.mjs can prove the working tree never drifted.
//
//   node tools/make-upstream-manifest.mjs
//
// Source of truth is git, not the working tree: index.html is the one upstream
// file this fork is allowed to touch, so its hash must come from `main`, never
// from the current checkout. Re-run after pulling upstream; the test fails on
// any unrecorded drift.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const BRANCH = 'main';
// text source files worth guarding; 134 MB of .obj/.mp3 assets are not
const GUARDED = /\.(js|html|json|css|txt)$|^LICENSE$/;
// this fork's whole point includes a rebuilt README (fork positioning,
// respect-for-original, ecosystem) — its credit to upstream is guarded by its
// own test instead of by byte-identity
const UNGUARDED = /^README\.md$/;

const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', BRANCH], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((p) => GUARDED.test(p) && !UNGUARDED.test(p));

const manifest = {};
for (const p of paths) {
  const bytes = execFileSync('git', ['show', `${BRANCH}:${p}`]);
  manifest[p] = createHash('sha256').update(bytes).digest('hex');
}

writeFileSync(
  'tests/upstream-manifest.json',
  JSON.stringify(
    {
      _comment:
        'sha256 of upstream files as of the branch this fork ported from. ' +
        'Regenerate with node tools/make-upstream-manifest.mjs after pulling upstream. ' +
        'index.html is the single permitted upstream edit; its delta is asserted ' +
        'separately (marked quilt block only).',
      _branch: BRANCH,
      files: manifest,
    },
    null,
    2,
  ) + '\n',
);

console.log(`recorded ${Object.keys(manifest).length} upstream files from ${BRANCH}`);
