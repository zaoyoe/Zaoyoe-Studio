'use strict';

/**
 * Xiareng parent/child category grouping.
 *
 * The official read-only endpoint `/shared/commodity/items` only returns the
 * leaf categories (`id`, `name`, `children`) and carries no parent field. The
 * parent groups below are an operator-maintained seed (observed on the
 * supplier storefront on 2026-11-03) keyed by the upstream leaf category id.
 * Administrators can override any assignment or add custom groups through
 * `shop_supplier_category_groups` / `shop_supplier_category_assignments`.
 *
 * Grouping is presentation-only. It never changes upstream identity, pricing,
 * stock or procurement behaviour.
 */

const PROVIDER_ID = 'xiareng';
const GROUP_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UNGROUPED_GROUP_KEY = 'ungrouped';
const MAX_GROUP_NAME_LENGTH = 80;

const SEED_GROUPS = Object.freeze([
    { groupKey: 'xr-2', name: '谷歌邮箱', upstreamCategoryIds: ['87', '88', '102'] },
    { groupKey: 'xr-3', name: 'Telegram 账号', upstreamCategoryIds: ['6', '7', '113', '8', '123', '122', '9'] },
    { groupKey: 'xr-4', name: '全球苹果ID（独享）', upstreamCategoryIds: ['10', '56', '11', '12', '13'] },
    { groupKey: 'xr-16', name: 'Twitter丨推特/X账号/代开订阅', upstreamCategoryIds: ['100', '101', '582'] },
    {
        groupKey: 'xr-23',
        name: 'Tiktok账号/海外抖音',
        upstreamCategoryIds: [
            '24', '29', '30', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44',
            '45', '46', '47', '48', '49', '94', '95', '96', '570', '571', '573', '574', '575', '578', '579', '580'
        ]
    },
    { groupKey: 'xr-28', name: 'GPT/Claude/Grok/Gemini/订阅/成品', upstreamCategoryIds: ['15', '17', '18', '19'] },
    { groupKey: 'xr-59', name: 'Instagram 账号', upstreamCategoryIds: ['60', '68', '133', '22', '77'] },
    {
        groupKey: 'xr-140',
        name: '刷粉服务',
        upstreamCategoryIds: [
            ...Array.from({ length: 112 }, (_, index) => String(141 + index)),
            '258', '259', '260', '581'
        ]
    },
    { groupKey: 'xr-25', name: 'Facebook-脸书', upstreamCategoryIds: ['61', '62', '63', '65', '66', '76', '112', '117', '118', '119'] }
].map((group) => Object.freeze({ ...group, upstreamCategoryIds: Object.freeze([...group.upstreamCategoryIds]) })));

// Leaf categories that the supplier shows as top-level entries without a parent.
const SEED_STANDALONE_CATEGORY_IDS = Object.freeze([
    '52', '64', '69', '71', '20', '21', '26', '27', '53', '73', '103', '124', '134', '577', '128', '129'
]);

function normalizeUpstreamCategoryId(value) {
    if (!['string', 'number'].includes(typeof value)) return '';
    const id = String(value);
    if (!id || id !== id.trim() || id.length > 160 || /[\u0000-\u001f\u007f]/.test(id)) return '';
    return id;
}

function normalizeGroupKey(value) {
    const key = String(value ?? '').trim().toLowerCase();
    return GROUP_KEY.test(key) ? key : '';
}

function normalizeGroupName(value) {
    const name = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return name.slice(0, MAX_GROUP_NAME_LENGTH);
}

/**
 * Merge the seed with persisted overrides.
 *
 * @param {object} overrides
 * @param {Array<{group_key, name, sort_order}>} overrides.groups custom groups
 * @param {Array<{upstream_category_id, group_key}>} overrides.assignments
 *        `group_key = null` places the category at the top level.
 */
function resolveCategoryGrouping({ groups = [], assignments = [] } = {}) {
    const groupDefinitions = new Map();
    SEED_GROUPS.forEach((group, index) => {
        groupDefinitions.set(group.groupKey, { groupKey: group.groupKey, name: group.name, custom: false, sortOrder: index });
    });
    for (const row of Array.isArray(groups) ? groups : []) {
        const groupKey = normalizeGroupKey(row?.group_key);
        const name = normalizeGroupName(row?.name);
        if (!groupKey || groupKey === UNGROUPED_GROUP_KEY || !name) continue;
        const existing = groupDefinitions.get(groupKey);
        groupDefinitions.set(groupKey, {
            groupKey,
            name,
            custom: existing ? existing.custom : true,
            sortOrder: Number.isSafeInteger(Number(row?.sort_order)) ? Number(row.sort_order) : (existing?.sortOrder ?? 1000)
        });
    }

    const assignmentByCategoryId = new Map();
    SEED_GROUPS.forEach((group) => group.upstreamCategoryIds.forEach((id) => assignmentByCategoryId.set(id, group.groupKey)));
    SEED_STANDALONE_CATEGORY_IDS.forEach((id) => assignmentByCategoryId.set(id, null));
    for (const row of Array.isArray(assignments) ? assignments : []) {
        const id = normalizeUpstreamCategoryId(row?.upstream_category_id);
        if (!id) continue;
        if (row?.group_key === null || row?.group_key === '') {
            assignmentByCategoryId.set(id, null);
            continue;
        }
        const groupKey = normalizeGroupKey(row?.group_key);
        if (groupKey && groupDefinitions.has(groupKey)) assignmentByCategoryId.set(id, groupKey);
    }
    return { groupDefinitions, assignmentByCategoryId };
}

/**
 * Build the presentation tree for one catalog snapshot.
 *
 * Node order follows the upstream category order: a group is positioned at its
 * first member category, standalone categories at their own index. Unknown new
 * upstream categories are collected in an explicit "未分组" bucket.
 */
function buildCategoryTree({ categories = [], items = [], groups = [], assignments = [] } = {}) {
    const { groupDefinitions, assignmentByCategoryId } = resolveCategoryGrouping({ groups, assignments });
    const goodsByCategoryKey = new Map();
    for (const item of Array.isArray(items) ? items : []) {
        for (const key of Array.isArray(item?.catalogCategoryKeys) ? item.catalogCategoryKeys : []) {
            if (!goodsByCategoryKey.has(key)) goodsByCategoryKey.set(key, new Set());
            goodsByCategoryKey.get(key).add(item.providerGoodsId);
        }
    }

    const groupNodes = new Map();
    const nodes = [];
    const ungrouped = [];
    categories.forEach((category, index) => {
        const upstreamCategoryId = normalizeUpstreamCategoryId(category?.upstreamIdCandidate);
        const leaf = {
            type: 'category',
            categoryKey: category.categoryKey,
            name: category.name,
            iconUrl: category.iconUrl || matchCategoryIconUrl(category.name),
            upstreamCategoryId: upstreamCategoryId || null,
            itemCount: Number.isSafeInteger(category.itemCount) ? category.itemCount : 0
        };
        const hasAssignment = upstreamCategoryId && assignmentByCategoryId.has(upstreamCategoryId);
        if (!hasAssignment) {
            ungrouped.push(leaf);
            return;
        }
        const groupKey = assignmentByCategoryId.get(upstreamCategoryId);
        if (!groupKey) {
            nodes.push({ position: index, node: leaf });
            return;
        }
        let groupNode = groupNodes.get(groupKey);
        if (!groupNode) {
            const definition = groupDefinitions.get(groupKey);
            groupNode = {
                type: 'group',
                groupKey,
                name: definition.name,
                iconUrl: matchCategoryIconUrl(definition.name),
                custom: definition.custom,
                children: []
            };
            groupNodes.set(groupKey, groupNode);
            nodes.push({ position: index, node: groupNode });
        }
        groupNode.children.push(leaf);
    });

    // Custom groups without members stay visible so administrators can move
    // categories into them; empty seed groups (removed upstream) are hidden.
    for (const definition of groupDefinitions.values()) {
        if (!definition.custom || groupNodes.has(definition.groupKey)) continue;
        const groupNode = { type: 'group', groupKey: definition.groupKey, name: definition.name, custom: true, children: [] };
        groupNodes.set(definition.groupKey, groupNode);
        nodes.push({ position: categories.length + definition.sortOrder, node: groupNode });
    }

    nodes.sort((left, right) => left.position - right.position);
    const tree = nodes.map(({ node }) => node);
    if (ungrouped.length) {
        const ungroupedNode = { type: 'group', groupKey: UNGROUPED_GROUP_KEY, name: '未分组', custom: false, children: ungrouped };
        groupNodes.set(UNGROUPED_GROUP_KEY, ungroupedNode);
        tree.push(ungroupedNode);
    }
    for (const groupNode of groupNodes.values()) {
        const goods = new Set();
        groupNode.children.forEach((child) => goodsByCategoryKey.get(child.categoryKey)?.forEach((id) => goods.add(id)));
        groupNode.itemCount = goods.size;
        groupNode.categoryKeys = groupNode.children.map((child) => child.categoryKey);
    }
    return tree;
}

function findGroupCategoryKeys(tree, groupKey) {
    const group = (Array.isArray(tree) ? tree : []).find((node) => node.type === 'group' && node.groupKey === groupKey);
    return group ? [...group.categoryKeys] : null;
}

function findFirstCategoryInTree(tree, categories = []) {
    if (Array.isArray(tree)) {
        for (const node of tree) {
            if (node.type === 'group' && Array.isArray(node.children) && node.children.length > 0) {
                const child = node.children.find((c) => c && c.categoryKey);
                if (child) return child.categoryKey;
            }
            if (node.type === 'category' && node.categoryKey) {
                return node.categoryKey;
            }
        }
    }
    return categories[0]?.categoryKey || null;
}

const SEED_CATEGORY_ICONS = Object.freeze({
    '谷歌邮箱': 'https://xiareng.cc/assets/cache/general/image/202606110717596115692.png',
    '谷歌邮箱（自营）': 'https://xiareng.cc/assets/cache/general/image/202606110717596115692.png',
    '谷歌邮箱（老外寄售）': 'https://xiareng.cc/assets/cache/general/image/202606110717596115692.png',
    '谷歌企业邮箱': 'https://xiareng.cc/assets/cache/general/image/202606110717596115692.png',
    'Telegram 账号': 'https://xiareng.cc/assets/cache/general/image/2026-06-03/887a95445c80001b836e033dfc96aefe.gif',
    '飞机API': 'https://xiareng.cc/assets/cache/general/image/2026-06-03/887a95445c80001b836e033dfc96aefe.gif',
    'TG飞机（会员号/靓号）': 'https://xiareng.cc/assets/cache/general/image/202608282056387982820.png',
    '全球苹果ID（独享）': 'https://xiareng.cc/assets/cache/general/image/202608282040165745618.png',
    '苹果ID密保号 | 老号': 'https://xiareng.cc/assets/cache/general/image/202608282040165745618.png',
    '小火煎成品号': 'https://xiareng.cc/assets/cache/general/image/202608282037035049986.png',
    '老苹果ID/带iCloud号': 'https://xiareng.cc/assets/cache/general/image/202608282040455302902.png',
    'Twitter丨推特/X账号/代开订阅': 'https://xiareng.cc/assets/cache/general/image/202608280328199135825.jpg',
    'Tiktok账号/海外抖音': 'https://xiareng.cc/assets/cache/general/image/202608282100277454204.png',
    'GPT/Claude/Grok/Gemini/订阅/成品': 'https://xiareng.cc/assets/cache/general/image/202606030325329662693.jpg',
    'Threads 账号': 'https://xiareng.cc/assets/cache/general/image/202608282035556231552.jpg',
    'Instagram 账号': 'https://xiareng.cc/assets/cache/general/image/202608282032204664123.png',
    '日韩台/Kakao/LINE': 'https://xiareng.cc/assets/cache/general/image/202609090349395858414.webp',
    'linkedin 领英': 'https://xiareng.cc/assets/cache/general/image/202608280327037859504.png',
    '大黄蜂/巴豆/OKC': 'https://xiareng.cc/assets/cache/general/image/202609082304026891880.png',
    'Whatsapp/注册/API': 'https://xiareng.cc/assets/cache/general/image/2026-09-09/e3d9a6aa1ff9e820d90686a386ce7a04.webp',
    'USDT/收款靓号': 'https://xiareng.cc/assets/cache/general/image/202609082303199195241.jpg',
    'Facebook-脸书': 'https://xiareng.cc/assets/cache/general/image/202608282053342883033.png',
    '飞机会员官方代开/频道僵尸粉/浏览量': 'https://xiareng.cc/assets/cache/general/image/202609082301585122771.jpg',
    '雅虎邮箱': 'https://xiareng.cc/assets/cache/user/1571/image/202609032352313890364.png',
    '刷粉服务': 'https://xiareng.cc/assets/static/images/smm/telegram.svg',
    'YouTube服务': 'https://xiareng.cc/assets/static/images/smm/youtube.svg',
    'GMX 邮箱': 'https://xiareng.cc/assets/cache/general/image/b9b4b16da6febc4bb0677bbc7d83de0b.webp'
});

function matchCategoryIconUrl(categoryName = '', defaultIcon = '') {
    const name = String(categoryName || '').trim();
    if (!name) return defaultIcon;
    if (SEED_CATEGORY_ICONS[name]) return SEED_CATEGORY_ICONS[name];

    const lower = name.toLowerCase();

    // Specific AI / brand models must have their own high-res distinct icons
    if (lower.includes('gemini')) return '/assets/affiliate-poster-icons/gemini.png';
    if (lower.includes('claude')) return '/assets/affiliate-poster-icons/claude.png';
    if (lower.includes('chatgpt') || lower.includes('gpt') || lower.includes('openai')) return '/assets/affiliate-poster-icons/gpt.png';
    if (lower.includes('苹果') || lower.includes('apple') || lower.includes('icloud') || lower.includes('小火煎')) return '/assets/affiliate-poster-icons/apple-id.svg';
    if (lower.includes('谷歌') || lower.includes('gmail') || lower.includes('邮箱') || lower.includes('mail')) return '/assets/affiliate-poster-icons/gmail.png';
    if (lower.includes('resource') || lower.includes('资源') || lower.includes('api') || lower.includes('中转') || lower.includes('forward')) return '/assets/affiliate-poster-icons/api-transfer.svg';
    if (lower.includes('other') || lower.includes('其它') || lower.includes('其他')) return '/assets/favicon.svg';

    for (const [key, iconUrl] of Object.entries(SEED_CATEGORY_ICONS)) {
        if (key === 'GPT/Claude/Grok/Gemini/订阅/成品') continue; // Do not fuzzy match individual models into combined group icon
        if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
            return iconUrl;
        }
    }

    if (lower.includes('telegram') || lower.includes('飞机') || lower.includes('tg')) return SEED_CATEGORY_ICONS['Telegram 账号'];
    if (lower.includes('twitter') || lower.includes('推特') || lower === 'x' || lower.includes('/x')) return SEED_CATEGORY_ICONS['Twitter丨推特/X账号/代开订阅'];
    if (lower.includes('tiktok') || lower.includes('抖音') || lower.includes('tk')) return SEED_CATEGORY_ICONS['Tiktok账号/海外抖音'];
    if (lower.includes('grok')) return SEED_CATEGORY_ICONS['GPT/Claude/Grok/Gemini/订阅/成品'];
    if (lower.includes('threads')) return SEED_CATEGORY_ICONS['Threads 账号'];
    if (lower.includes('instagram') || lower.includes('ins')) return SEED_CATEGORY_ICONS['Instagram 账号'];
    if (lower.includes('line') || lower.includes('kakao') || lower.includes('日韩台')) return SEED_CATEGORY_ICONS['日韩台/Kakao/LINE'];
    if (lower.includes('linkedin') || lower.includes('领英')) return SEED_CATEGORY_ICONS['linkedin 领英'];
    if (lower.includes('bumble') || lower.includes('大黄蜂') || lower.includes('巴豆')) return SEED_CATEGORY_ICONS['大黄蜂/巴豆/OKC'];
    if (lower.includes('whatsapp')) return SEED_CATEGORY_ICONS['Whatsapp/注册/API'];
    if (lower.includes('usdt') || lower.includes('tron') || lower.includes('trx')) return SEED_CATEGORY_ICONS['USDT/收款靓号'];
    if (lower.includes('facebook') || lower.includes('脸书') || lower.includes('fb')) return SEED_CATEGORY_ICONS['Facebook-脸书'];
    if (lower.includes('雅虎') || lower.includes('yahoo')) return SEED_CATEGORY_ICONS['雅虎邮箱'];
    if (lower.includes('youtube') || lower.includes('油管') || lower.includes('影音')) return SEED_CATEGORY_ICONS['YouTube服务'];
    if (lower.includes('刷粉') || lower.includes('粉')) return SEED_CATEGORY_ICONS['刷粉服务'];

    return defaultIcon;
}

function listAssignableGroups({ groups = [] } = {}) {
    const { groupDefinitions } = resolveCategoryGrouping({ groups });
    return [...groupDefinitions.values()]
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map(({ groupKey, name, custom }) => ({ groupKey, name, custom }));
}

module.exports = {
    PROVIDER_ID,
    SEED_GROUPS,
    SEED_STANDALONE_CATEGORY_IDS,
    SEED_CATEGORY_ICONS,
    UNGROUPED_GROUP_KEY,
    normalizeGroupKey,
    normalizeGroupName,
    normalizeUpstreamCategoryId,
    matchCategoryIconUrl,
    resolveCategoryGrouping,
    buildCategoryTree,
    findGroupCategoryKeys,
    findFirstCategoryInTree,
    listAssignableGroups
};
