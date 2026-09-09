const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const rollbackSource = fs.readFileSync(
  path.join(repoRoot, 'scripts', 'rollback-kvm4-sub2api.sh'),
  'utf8'
);

test('KVM4 rollback remains NewAPI-only after legacy bridge removal', () => {
  assert.match(rollbackSource, /Rollback the KVM4 NewAPI service slot/);
  assert.match(rollbackSource, /current release is not a NewAPI release/);
  assert.match(rollbackSource, /active compose file still declares the removed legacy-sub2api bridge/);
  assert.match(rollbackSource, /NewAPI rollback target not found/);
  assert.match(rollbackSource, /target release still declares the removed legacy-sub2api bridge/);
  assert.match(rollbackSource, /docker rm -f sub2api-legacy/);
  assert.match(rollbackSource, /docker compose --env-file \.env -f docker-compose\.local\.yml up -d postgres redis/);

  assert.doesNotMatch(rollbackSource, /printf '%s\\n' legacy/);
  assert.doesNotMatch(rollbackSource, /target_src="\$target_root\/sub2api"/);
  assert.doesNotMatch(rollbackSource, /candidate_src="\$candidate\/sub2api"/);
  assert.doesNotMatch(rollbackSource, /up -d postgres redis legacy-sub2api/);
});
