// Release hygiene: keep excluded artwork out of public assets and generated builds.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const baseline = 'decf9a215cddd8792a5f20f4a11a87d4dffa6d15';
const sha = data => createHash('sha256').update(data).digest('hex');
const excluded = ['assets/', 'web/artwork/', 'web/public/assets/'];
const baselineFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const protectedHashes = new Set(baselineFiles.filter(file => excluded.some(prefix => file.startsWith(prefix)) || file === 'web/public/favicon.svg' || file === 'web/src/avatar/shapes.gen.ts').map(file => sha(execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root }))));
let checked = 0;
function inspect(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) inspect(file);
    else {
      const bytes = readFileSync(file);
      assert.equal(protectedHashes.has(sha(bytes)), false, `Excluded upstream artwork copied to ${file}`);
      if (/\.(?:tsx?|jsx?|html|css)$/.test(file)) {
        const source = bytes.toString();
        assert.doesNotMatch(source, /(?:src|href|url\()\s*[=:(]?\s*['"]?\/assets\/(?:icons|apps)\//, `Old asset reference in ${file}`);
        assert.doesNotMatch(source, /<title>Grokbot<|>Grokbot<|Sharing isn’t available in Grokbot/, `Upstream product identity in ${file}`);
      }
      checked++;
    }
  }
}
for (const dir of excluded) assert.equal(existsSync(path.join(root, dir)), false, `Excluded artwork directory remains: ${dir}`);
for (const dir of ['web/public', 'web/src', 'web/dist']) {
  assert.ok(existsSync(path.join(root, dir)), `Missing ${dir}; build the web app before auditing`);
  inspect(path.join(root, dir));
}
console.log(`Branding hygiene passed: ${checked} source/build files checked; ${protectedHashes.size} upstream artifact hashes excluded. Legal clearance remains a separate release gate.`);
