const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('PointsService routes wallet overview and transaction reads through wallet APIs', () => {
    const source = readRepoFile('js/services/PointsService.js');

    assert.equal(source.includes("'/api/wallet/overview'"), true, 'PointsService should load wallet overview via /api/wallet/overview');
    assert.equal(source.includes("'/api/wallet/transactions'"), true, 'PointsService should load wallet transactions via /api/wallet/transactions');
    assert.equal(source.includes("'/api/wallet/prompt-titles'"), true, 'PointsService should load wallet prompt titles via /api/wallet/prompt-titles');
    assert.equal(source.includes("'/api/wallet/verify-log'"), true, 'PointsService should load wallet verify logs via /api/wallet/verify-log');
});

test('WalletModal main browse and search paths use PointsService transaction API instead of direct wallet table reads', () => {
    const source = readRepoFile('js/components/WalletModal.js');

    assert.equal(source.includes('pointsService?.getWalletTransactions'), true, 'WalletModal should use PointsService.getWalletTransactions');
    assert.equal(source.includes('pointsService?.getWalletPromptTitles'), true, 'WalletModal should use PointsService.getWalletPromptTitles');
    assert.equal(source.includes('pointsService?.getWalletVerifyLog'), true, 'WalletModal should use PointsService.getWalletVerifyLog');
    assert.equal(source.includes('const searchResult = await this.searchWalletTransactions('), true, 'WalletModal search path should remain routed through the wallet search helper');
    assert.equal(source.includes('const walletRecords = await pointsService.getWalletTransactions('), true, 'WalletModal browse path should fetch wallet records through PointsService');
    assert.equal(source.includes("from('prompts')"), false, 'WalletModal should no longer read prompts directly from Supabase');
    assert.equal(source.includes("from('verification_logs')"), false, 'WalletModal should no longer read verification_logs directly from Supabase');
});
