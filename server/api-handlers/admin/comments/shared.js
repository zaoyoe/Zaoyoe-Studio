const { normalizeAdminSite } = require('../../../../api/_lib/admin');

function normalizeCommentsView(value) {
    return String(value || '').trim().toLowerCase() === 'gallery' ? 'gallery' : 'guestbook';
}

function normalizeCommentsSite(value, defaultValue = 'all') {
    return normalizeAdminSite(value, { defaultValue }) || defaultValue;
}

function applyCommentsSiteFilter(query, site, column = 'site') {
    if (!query) return query;
    if (normalizeCommentsSite(site) === 'all') {
        return query;
    }
    return query.eq(column, normalizeCommentsSite(site, 'cn'));
}

function applyCommentsDateRange(query, { dateFrom = '', dateTo = '' } = {}) {
    let nextQuery = query;
    const normalizedDateFrom = String(dateFrom || '').trim();
    const normalizedDateTo = String(dateTo || '').trim();

    if (normalizedDateFrom) {
        const parsedStart = new Date(normalizedDateFrom);
        if (!Number.isNaN(parsedStart.getTime())) {
            nextQuery = nextQuery.gte('created_at', parsedStart.toISOString());
        }
    }

    if (normalizedDateTo) {
        const endDate = new Date(normalizedDateTo);
        if (!Number.isNaN(endDate.getTime())) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateTo)) {
                endDate.setDate(endDate.getDate() + 1);
            } else {
                endDate.setMilliseconds(endDate.getMilliseconds() + 1);
            }
            nextQuery = nextQuery.lt('created_at', endDate.toISOString());
        }
    }

    return nextQuery;
}

function buildCountMap(rows = [], keyField) {
    return (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
        const key = row?.[keyField];
        if (!key) return acc;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function sortByCreatedAtDesc(rows = []) {
    return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
        const leftTime = Date.parse(left?.created_at || 0);
        const rightTime = Date.parse(right?.created_at || 0);
        return rightTime - leftTime;
    });
}

function collectDescendantCommentIds(comments = [], rootIds = []) {
    const pending = Array.isArray(rootIds) ? [...rootIds] : [];
    const collected = new Set(pending.filter(Boolean));

    while (pending.length > 0) {
        const currentId = pending.shift();
        (Array.isArray(comments) ? comments : []).forEach(comment => {
            const commentId = comment?.id;
            if (!commentId || collected.has(commentId)) return;
            if (comment?.parent_id === currentId) {
                collected.add(commentId);
                pending.push(commentId);
            }
        });
    }

    return Array.from(collected);
}

function uniqueIds(values = []) {
    return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

module.exports = {
    applyCommentsDateRange,
    applyCommentsSiteFilter,
    buildCountMap,
    collectDescendantCommentIds,
    normalizeCommentsSite,
    normalizeCommentsView,
    sortByCreatedAtDesc,
    uniqueIds
};
