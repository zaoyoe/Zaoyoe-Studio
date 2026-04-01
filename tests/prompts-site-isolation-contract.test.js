const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('prompts runtime isolates realtime, counts, cache, and likes by site', () => {
    const source = readRepoFile('prompts-poetry.js');

    const requiredMarkers = [
        'function normalizePromptInteractionSite(site)',
        'function getPromptInteractionSite()',
        'function getPromptCommentCacheKey(promptId, site = getPromptInteractionSite())',
        ".channel(`prompt-comments-updates-${site}`)",
        "filter: `site=eq.${site}`",
        "if (normalizePromptInteractionSite(comment.site) !== currentSite) return;",
        "const cacheKey = getPromptCommentCacheKey(promptId, site);",
        ".eq('site', site)\n            .order('is_pinned', { ascending: false })",
        ".from('comment_likes')\n            .select('comment_id, user_id')\n            .eq('site', site)",
        "commentCache.set(cacheKey, {",
        ".eq('user_id', user.id)\n                .eq('site', site);",
        ".insert({ comment_id: commentId, user_id: user.id, site });",
        "insertData.site = site;",
        "commentCache.delete(getPromptCommentCacheKey(currentPromptId, site));",
        "commentCache.get(getPromptCommentCacheKey(currentPromptId))"
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `prompts-poetry.js should contain ${marker}`);
    }
});

test('prompt reply trigger and like sync migration keep interaction rows site-aware', () => {
    const triggerSource = readRepoFile('supabase/trigger-auto-link-replies.sql');
    const migrationSource = readRepoFile('supabase/migrations/20260401_prompt_comment_site_isolation.sql');
    const promptCommentsSchema = readRepoFile('supabase/schema-comments-points.sql');
    const commentLikesSchema = readRepoFile('supabase/schema-comment-likes.sql');

    assert.equal(
        triggerSource.includes('AND c.site = NEW.site'),
        true,
        'trigger-auto-link-replies.sql should only auto-link replies within the same site'
    );

    const migrationMarkers = [
        'CREATE OR REPLACE FUNCTION public.auto_link_reply_comment()',
        'AND c.site = NEW.site',
        'CREATE OR REPLACE FUNCTION public.sync_comment_like_site()',
        "RAISE EXCEPTION 'prompt comment % not found for site sync'",
        'NEW.site := CASE WHEN comment_site = \'intl\' THEN \'intl\' ELSE \'cn\' END;',
        'CREATE TRIGGER trigger_sync_comment_like_site',
        'UPDATE public.comment_likes cl'
    ];

    for (const marker of migrationMarkers) {
        assert.equal(
            migrationSource.includes(marker),
            true,
            `20260401_prompt_comment_site_isolation.sql should contain ${marker}`
        );
    }

    assert.equal(
        promptCommentsSchema.includes("site VARCHAR(10) DEFAULT 'cn' NOT NULL"),
        true,
        'schema-comments-points.sql should define prompt comment site isolation in the base schema'
    );
    assert.equal(
        commentLikesSchema.includes("site VARCHAR(10) DEFAULT 'cn' NOT NULL"),
        true,
        'schema-comment-likes.sql should define comment like site isolation in the base schema'
    );
    assert.equal(
        commentLikesSchema.includes('CREATE INDEX IF NOT EXISTS idx_comment_likes_site ON public.comment_likes(site);'),
        true,
        'schema-comment-likes.sql should index comment like site lookups'
    );
});

test('admin gallery UI explains that prompt content stays global while site filtering targets interaction semantics', () => {
    const adminHtml = readRepoFile('admin-studio.html');

    assert.equal(
        adminHtml.includes('Gallery 里的 Prompt 内容资产仍是全局共享；顶部站点筛选不会切换这份内容列表，但卡片现在会同步展示 CN / INTL 的互动摘要，并继续用于写保护。'),
        true,
        'admin-studio.html should clarify gallery site filter semantics for operators'
    );
});
