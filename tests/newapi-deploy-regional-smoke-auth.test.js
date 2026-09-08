const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('NewAPI deployment regional smoke keeps user auth and staged credential cleanup', () => {
  const deploySource = readRepoFile('scripts/deploy-kvm4-sub2api.sh');
  const routerSource = readRepoFile('services/newapi/router/api-router.go');

  assert.match(
    routerSource,
    /tokenRoute := apiRouter\.Group\("\/token"\)[\s\S]*?tokenRoute\.Use\(middleware\.UserAuth\(\)\)[\s\S]*?tokenRoute\.GET\("\/regional-restriction", controller\.GetRegionalRestrictionStatus\)/
  );
  assert.match(deploySource, /smoke_dashboard_token="\$\(openssl rand -hex 16\)"/);
  assert.match(deploySource, /auth_version, access_token\) VALUES \([\s\S]*?'\$smoke_dashboard_token'\)/);

  const dashboardAuthorization = '-H "Authorization: Bearer $smoke_dashboard_token"';
  assert.equal(
    deploySource.split(dashboardAuthorization).length - 1,
    2,
    'both local and Cloudflare regional checks must authenticate as the smoke user'
  );
  assert.match(deploySource, /smoke_user_cleanup_pending=1/);
  assert.match(deploySource, /smoke_user_cache_cleanup_pending=1/);
  assert.doesNotMatch(deploySource, /legacy_healthcheck|zaoyoe\/sub2api:(legacy|local)/);
  assert.doesNotMatch(deploySource, /SOURCE_BASE_URL|BRIDGE_BASE_URL|\/sub2api-migrate/);
  assert.match(deploySource, /previous_was_newapi.*newapi_database_exists.*already exists before the first NewAPI cutover/s);
  assert.match(deploySource, /UPDATE abilities SET enabled = false[\s\S]*type = 59/);
  assert.match(deploySource, /c\.type <> 59[\s\S]*COALESCE\(c\.tag, ''\) NOT LIKE 'sub2api-bridge:%'/);
  assert.match(deploySource, /smoke_candidate_rows=\(\)/);
  assert.match(deploySource, /c\.tag LIKE 'sub2api-native:%'/);
  assert.match(deploySource, /c\.type = 14 AND a\.model LIKE 'claude-%'/);
  assert.match(deploySource, /a\.model NOT LIKE 'video-%'/);
  assert.match(deploySource, /role, status, email,[\s\S]*VALUES \('[\s\S]*', 10, 1,/);
  assert.match(deploySource, /smoke_key="sk-\$smoke_token_secret-\$candidate_channel_id"/);
  assert.match(deploySource, /smoke_chat_status="\$\(curl -sS --max-time 120/);
  assert.match(deploySource, /\(429\|500\|502\|503\|504\)/);
  assert.match(deploySource, /returned HTTP \$smoke_chat_status; trying the next candidate/);
  assert.match(deploySource, /failed with non-retryable HTTP \$smoke_chat_status/);
  assert.match(deploySource, /all provider chat smoke candidates failed/);
  assert.match(deploySource, /channel_id = \$smoke_channel_id/);

  const preIngressCleanup = deploySource.slice(
    deploySource.indexOf('if ! deleted_smoke_token_id='),
    deploySource.indexOf('if ! local_edge_region_payload=')
  );
  assert.match(preIngressCleanup, /DELETE FROM tokens WHERE id = \$smoke_token_id AND user_id = \$smoke_user_id RETURNING id/);
  assert.match(preIngressCleanup, /psql[\s\S]*?-qAtc[\s\S]*?DELETE FROM tokens/);
  assert.match(preIngressCleanup, /deleted_smoke_token_id[\s\S]*?!= "\$smoke_token_id"/);
  assert.doesNotMatch(preIngressCleanup, /DELETE FROM users/);
  assert.match(preIngressCleanup, /flush_newapi_redis/);
  assert.match(preIngressCleanup, /--force-recreate sub2api/);

  const cleanupHelper = deploySource.slice(
    deploySource.indexOf('cleanup_regional_smoke_user() {'),
    deploySource.indexOf('fail_after_public_open() {')
  );
  assert.match(cleanupHelper, /smoke_user_cleanup_pending/);
  assert.match(
    cleanupHelper,
    /DELETE FROM users WHERE id = \$smoke_user_id AND username = '\$smoke_username' AND access_token = '\$smoke_dashboard_token' RETURNING id/
  );
  assert.match(cleanupHelper, /psql[\s\S]*?-qAtc[\s\S]*?DELETE FROM users/);
  assert.match(cleanupHelper, /deleted_smoke_user_id[\s\S]*?== "\$smoke_user_id"/);
  assert.match(cleanupHelper, /smoke_user_cache_cleanup_pending/);
  assert.match(cleanupHelper, /flush_newapi_redis \|\| return 1/);

  const postOpenFailureHandler = deploySource.slice(
    deploySource.indexOf('fail_after_public_open() {'),
    deploySource.indexOf('[[ -n "${KVM4_SUB2API_ROOT:-}" ]]')
  );
  const reblockIndex = postOpenFailureHandler.indexOf(
    'install_managed_caddy_config "$newapi_regional_edge_secret" maintenance'
  );
  const failureCleanupIndex = postOpenFailureHandler.indexOf('cleanup_regional_smoke_user');
  assert.notEqual(reblockIndex, -1);
  assert.notEqual(failureCleanupIndex, -1);
  assert.ok(
    reblockIndex < failureCleanupIndex,
    'post-open failures must re-block public ingress before credential cleanup'
  );
  assert.match(postOpenFailureHandler, /cleanup_regional_smoke_user/);
  assert.match(postOpenFailureHandler, /temporary credential cleanup failed/);

  const postIngressCleanup = deploySource.slice(
    deploySource.indexOf('if ! edge_region_payload='),
    deploySource.indexOf('if [[ -n "$previous_src" ]]')
  );
  assert.match(postIngressCleanup, /if ! cleanup_regional_smoke_user; then/);
  assert.match(
    postIngressCleanup,
    /fail_after_public_open "failed to remove the regional smoke-test user or clear its cached credentials"/
  );
});
