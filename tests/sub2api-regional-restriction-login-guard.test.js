const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const sub2apiRoot = path.join(repoRoot, 'services', 'sub2api');

const sourceExtensions = new Set([
  '.go',
  '.sql',
  '.ts',
  '.vue',
]);

function walkFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === '.git' ||
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'coverage'
    ) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
      continue;
    }

    if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Sub2API regional restriction blocks token issuance without blocking the whole login page', () => {
  const regionalRestrictionSource = readRepoFile(
    'services/sub2api/backend/internal/handler/regional_restriction.go'
  );
  const authHandlerSource = readRepoFile(
    'services/sub2api/backend/internal/handler/auth_handler.go'
  );
  const authRoutesSource = readRepoFile(
    'services/sub2api/backend/internal/server/routes/auth.go'
  );
  const loginViewSource = readRepoFile(
    'services/sub2api/frontend/src/views/auth/LoginView.vue'
  );
  const apiClientSource = readRepoFile(
    'services/sub2api/frontend/src/api/client.ts'
  );

  assert.match(regionalRestrictionSource, /regionalRestrictionScopeLogin\s+= "login"/);
  assert.match(regionalRestrictionSource, /RegionalRestrictionLoginEnabled/);
  assert.match(authHandlerSource, /GetRegionalRestrictionLoginStatus/);
  assert.match(authRoutesSource, /\/regional-restriction\/login/);
  assert.match(authHandlerSource, /func \(h \*AuthHandler\) Login\(c \*gin\.Context\)[\s\S]*regionalRestrictionScopeLogin/);
  assert.match(authHandlerSource, /func \(h \*AuthHandler\) Login2FA\(c \*gin\.Context\)[\s\S]*regionalRestrictionScopeLogin/);
  assert.match(authHandlerSource, /func \(h \*AuthHandler\) RefreshToken\(c \*gin\.Context\)[\s\S]*regionalRestrictionScopeLogin/);
  assert.match(loginViewSource, /@submit\.prevent="handleLogin"/);
  assert.match(loginViewSource, /getLoginRegionalRestrictionStatus/);
  assert.match(loginViewSource, /openRegistrationRegionDialog\('login_blocked'\)/);
  assert.match(loginViewSource, /Login is not available in your region/);
  assert.match(apiClientSource, /region_blocked=login/);
});

test('Sub2API regional restriction keeps only the approved entry points enabled', () => {
  const regionalRestrictionSource = readRepoFile(
    'services/sub2api/backend/internal/handler/regional_restriction.go'
  );
  const authHandlerSource = readRepoFile(
    'services/sub2api/backend/internal/handler/auth_handler.go'
  );
  const authRoutesSource = readRepoFile(
    'services/sub2api/backend/internal/server/routes/auth.go'
  );
  const userRoutesSource = readRepoFile(
    'services/sub2api/backend/internal/server/routes/user.go'
  );
  const keysViewSource = readRepoFile(
    'services/sub2api/frontend/src/views/user/KeysView.vue'
  );

  assert.match(regionalRestrictionSource, /regionalRestrictionScopeRegistration\s+= "registration"/);
  assert.match(regionalRestrictionSource, /regionalRestrictionScopeLogin\s+= "login"/);
  assert.match(regionalRestrictionSource, /regionalRestrictionScopeOAuthSignup\s+= "oauth_signup"/);
  assert.match(regionalRestrictionSource, /regionalRestrictionScopeAPIKeyPage\s+= "api_key_page"/);
  assert.match(regionalRestrictionSource, /regionalRestrictionScopeAPIKeyCreate\s+= "api_key_create"/);

  assert.match(authHandlerSource, /GetRegionalRestrictionRegistrationStatus/);
  assert.match(authHandlerSource, /GetRegionalRestrictionLoginStatus/);
  assert.match(authRoutesSource, /\/regional-restriction\/registration/);
  assert.match(authRoutesSource, /\/regional-restriction\/login/);
  assert.match(userRoutesSource, /authenticated\.Group\("\/keys"\)/);
  assert.match(userRoutesSource, /keys\.GET\("\/regional-restriction", h\.APIKey\.GetRegionalRestrictionStatus\)/);
  assert.match(keysViewSource, /API Key Use Confirmation/);
  assert.match(keysViewSource, /restricted region/);
});
