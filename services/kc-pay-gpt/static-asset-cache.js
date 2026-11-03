'use strict';

/**
 * 静态资产本地镜像缓存引擎 (类似游戏客户端离线资源包)
 *
 * 原理：
 * ChatGPT 前端的静态资源 (JS/CSS/字体) 带有不可变内容哈希 (如 633146.a34c950234.js)。
 * 这些文件属于公共静态资源，不包含用户鉴权信息，也不验证客户端 IP 归属地。
 *
 * 通过本地固态硬盘镜像 (Local NVMe Mirror) 0ms 瞬间提供，
 * 同时未命中的资源采用直连高速网络拉取并固化 (Read-Through Cache)，
 * 彻底避免通过高延迟海外住宅代理重复下载数十兆静态大文件，使页面渲染时间从 55s 骤降至 3~5s。
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.STATIC_ASSET_CACHE_DIR
    || path.join(__dirname, '.cache', 'static_assets');

try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
} catch (_) {}

const MIME_MAP = {
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.json': 'application/json; charset=utf-8'
};

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
}

/**
 * 判断是否为不可变公共静态资产
 * 严格保护：严禁匹配任何动态业务、鉴权、Stripe 敏感 API、人机验证等接口
 */
function isStaticImmutableAsset(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();

    // 绝对排除业务、鉴权、Stripe 动态 API、Radar 遥测、人机验证等
    if (
        lower.includes('/backend-api/') ||
        lower.includes('/api/') ||
        lower.includes('/ces/') ||
        lower.includes('/auth/') ||
        lower.includes('/rest/') ||
        lower.includes('/i/api/') ||
        lower.includes('api.stripe.com') ||
        lower.includes('m.stripe.network') ||
        lower.includes('m.stripe.com') ||
        lower.includes('stripecdn.com') ||
        lower.includes('hcaptcha.com') ||
        lower.includes('challenges.cloudflare.com')
    ) {
        return false;
    }

    // Stripe 官方客户端公共 SDK 与不可变静态资源 (js.stripe.com/v3)
    if (lower.startsWith('https://js.stripe.com/v3') || lower.startsWith('http://js.stripe.com/v3')) {
        try {
            const parsed = new URL(url);
            const p = parsed.pathname.toLowerCase();
            if (p === '/v3' || p === '/v3/') return true;
            const ext = path.extname(p);
            return Boolean(MIME_MAP[ext]);
        } catch (_) {
            return false;
        }
    }

    // 匹配 ChatGPT、Claude、Grok (X) 官方不可变静态资产
    const isPlatformCdn = (
        // 1. ChatGPT / OpenAI CDN
        lower.includes('chatgpt.com/cdn/assets/') ||
        lower.includes('chatgpt.com/_next/static/') ||
        lower.includes('cdn.oaistatic.com/assets/') ||
        // 2. Claude CDN
        lower.includes('assets-proxy.anthropic.com/') ||
        lower.includes('claude.ai/_next/static/') ||
        lower.includes('assets.claude.ai/') ||
        lower.includes('cdn.claude.ai/') ||
        lower.includes('claude.ai/assets/') ||
        lower.includes('claude.ai/static/') ||
        // 3. Grok & X.com CDN
        lower.includes('grok.com/_next/static/') ||
        lower.includes('abs.twimg.com/responsive-web/') ||
        lower.includes('abs.twimg.com/fonts/')
    );

    if (isPlatformCdn) {
        try {
            const parsed = new URL(url);
            const ext = path.extname(parsed.pathname).toLowerCase();
            return Boolean(MIME_MAP[ext]);
        } catch (_) {
            return false;
        }
    }

    return false;
}

/**
 * 将 URL 规范化映射到本地磁盘路径
 */
function getLocalCachePath(url, baseDir = CACHE_DIR) {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    let cleanPath = parsed.pathname.replace(/^\/+/, '');
    if (!cleanPath || cleanPath.endsWith('/')) {
        cleanPath = cleanPath + 'index';
    }
    if (parsed.hostname === 'js.stripe.com' && (cleanPath === 'v3' || cleanPath === 'v3/index')) {
        cleanPath = 'v3.js';
    }
    const safePath = path.normalize(cleanPath).replace(/^(\.\.[\/\\])+/, '');
    return path.join(baseDir, host, safePath);
}

/**
 * 内存中记录正在下载中的 URL，避免并发重复下载同一个文件
 */
const inFlightFetches = new Map();

let hitCount = 0;
let lastHitLogTime = 0;

function recordHit() {
    hitCount += 1;
    const now = Date.now();
    if (now - lastHitLogTime > 4000) {
        lastHitLogTime = now;
        console.log(`⚡ [AssetCache] 本地静态镜像已累计命中 ${hitCount} 个前端资源 (0ms 磁盘直出)`);
    }
}

/**
 * 拦截并由本地镜像或直连读穿缓存提供静态资源
 *
 * @param {import('playwright').Route} route
 * @param {object} [options]
 * @param {string} [options.cacheDir]
 * @param {number} [options.fetchTimeoutMs]
 * @returns {Promise<boolean>} true 表示已被本地缓存处理，false 表示放行
 */
async function handleStaticAssetCache(route, options = {}) {
    const req = route.request();
    const url = req.url();

    if (req.method() !== 'GET' || !isStaticImmutableAsset(url)) {
        return false;
    }

    const cacheDir = options.cacheDir || CACHE_DIR;
    const localPath = getLocalCachePath(url, cacheDir);
    const mimeType = getMimeType(localPath);

    // 1. 本地磁盘命中（游戏离线包 0ms 瞬间透出）
    if (fs.existsSync(localPath)) {
        try {
            await route.fulfill({
                status: 200,
                path: localPath,
                headers: {
                    'content-type': mimeType,
                    'cache-control': 'public, max-age=2592000, immutable',
                    'x-cache': 'HIT-LOCAL-MIRROR'
                }
            });
            recordHit();
            return true;
        } catch (_) {
            // 本地读取异常降级继续
        }
    }

    // 2. 本地未命中：通过高速直连拉取并固化写入本地磁盘（不消耗海外住宅代理）
    try {
        let fetchPromise = inFlightFetches.get(url);
        if (!fetchPromise) {
            const timeoutMs = options.fetchTimeoutMs || 8000;
            fetchPromise = (async () => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    const resp = await fetch(url, {
                        signal: controller.signal,
                        headers: {
                            'Accept': '*/*',
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                        }
                    });
                    if (!resp.ok) return null;
                    const buf = Buffer.from(await resp.arrayBuffer());
                    try {
                        fs.mkdirSync(path.dirname(localPath), { recursive: true });
                        const tempPath = `${localPath}.tmp.${Date.now()}`;
                        fs.writeFileSync(tempPath, buf);
                        fs.renameSync(tempPath, localPath);
                    } catch (_) {}
                    return buf;
                } catch (_) {
                    return null;
                } finally {
                    clearTimeout(timer);
                }
            })();
            inFlightFetches.set(url, fetchPromise);
            fetchPromise.catch(() => null).finally(() => inFlightFetches.delete(url));
        }

        const buffer = await fetchPromise;
        if (buffer && buffer.length > 0) {
            await route.fulfill({
                status: 200,
                body: buffer,
                headers: {
                    'content-type': mimeType,
                    'cache-control': 'public, max-age=2592000, immutable',
                    'x-cache': 'MISS-FETCHED-DIRECT'
                }
            });
            return true;
        }
    } catch (_) {
        // 直连异常安全回退，交由上游常规通道处理
    }

    return false;
}

/**
 * 定期清理长期未使用的陈旧缓存与容量控制 (TTL + LRU)
 *
 * @param {object} [options]
 * @param {number} [options.maxAgeDays=30] 超过多少天未访问则清理
 * @param {number} [options.maxSizeBytes=524288000] 目录最大容量 (默认 500MB)
 * @returns {Promise<{ removedFiles: number, freedBytes: number }>}
 */
async function cleanStaleCache(options = {}) {
    const maxAgeDays = options.maxAgeDays || 30;
    const maxSizeBytes = options.maxSizeBytes || 500 * 1024 * 1024;
    const maxAgeMs = maxAgeDays * 24 * 3600 * 1000;
    const now = Date.now();
    let removedFiles = 0;
    let freedBytes = 0;

    try {
        if (!fs.existsSync(CACHE_DIR)) return { removedFiles: 0, freedBytes: 0 };

        const allFiles = [];
        const scanDir = (dir) => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath);
                } else if (entry.isFile()) {
                    try {
                        const stat = fs.statSync(fullPath);
                        allFiles.push({ path: fullPath, size: stat.size, mtime: stat.mtimeMs });
                    } catch (_) {}
                }
            }
        };

        scanDir(CACHE_DIR);

        let totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);

        // 1. TTL 清理：淘汰超过 maxAgeDays 的陈旧版本
        for (const file of allFiles) {
            if (now - file.mtime > maxAgeMs) {
                try {
                    fs.unlinkSync(file.path);
                    removedFiles += 1;
                    freedBytes += file.size;
                    totalSize -= file.size;
                    file.deleted = true;
                } catch (_) {}
            }
        }

        // 2. 容量配额控制：按最后修改时间由旧到新淘汰超额文件
        if (totalSize > maxSizeBytes) {
            const remaining = allFiles.filter(f => !f.deleted).sort((a, b) => a.mtime - b.mtime);
            for (const file of remaining) {
                if (totalSize <= maxSizeBytes) break;
                try {
                    fs.unlinkSync(file.path);
                    removedFiles += 1;
                    freedBytes += file.size;
                    totalSize -= file.size;
                } catch (_) {}
            }
        }
    } catch (_) {}

    return { removedFiles, freedBytes };
}

module.exports = {
    isStaticImmutableAsset,
    getLocalCachePath,
    handleStaticAssetCache,
    cleanStaleCache,
    CACHE_DIR
};
