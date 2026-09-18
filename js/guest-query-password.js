'use strict';

/*
 * Guest query-password generator — Order Access 2.0 §6.1.3 / §11.3.
 *
 * Shared by the shop checkout modal (js/guest-shop-client.js) and the guest
 * order lookup page (js/guest-orders-client.js) so that "帮我生成" produces
 * exactly one shape of password everywhere. It is a MANDATORY companion to the
 * four-class rule K27, not decoration: without it the cheapest way for a buyer
 * to satisfy "8 位以上 + 大写 + 小写 + 数字 + 标点" is to reuse a real password
 * from another site, which is strictly worse for them (§8.3).
 *
 * Hard constraints inherited from the guest-channel contract tests:
 *   - crypto.getRandomValues only; Math.random is forbidden in guest scripts.
 *   - no localStorage, no supabase / access_token / Authorization, no claim
 *     secret: this module never sees or stores an order credential.
 *   - the alphabet mirrors the server's GENERATED_QUERY_PASSWORD_CLASSES
 *     character-for-character (ambiguous glyphs 0 O o 1 l I | are removed), and
 *     the local rejection rules mirror the server's P9 / P10 / P7b so a
 *     generated password is never one the server would refuse to store. The
 *     server stays authoritative (§6.1.4); this only avoids a pointless
 *     round-trip and a confusing "强度不足" error on a password we minted.
 *
 * Deliberately NOT mirrored: the P7a denylist. It is an exact-equality check
 * against ~120 word+suffix entries, so a 12-character random string collides
 * with probability < 1e-18, and shipping the list to the browser would leak a
 * server-side policy asset for no measurable gain.
 */
(() => {
    // §6.1.3: 12 characters, ambiguity-free, one guaranteed character per class.
    const GENERATED_LENGTH = 12;
    const CLASSES = Object.freeze({
        upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
        lower: 'abcdefghijkmnqrstuvwxyz',
        digit: '23456789',
        punct: '!@#$%^&*()-_=+[]{};:,.<>?/~'
    });
    const CLASS_LIST = Object.freeze(Object.values(CLASSES));
    const ALPHABET = Object.freeze(CLASS_LIST.join(''));

    // P1 / P10 / P9 thresholds, identical to api/_lib/guest-shop/security.js.
    const MIN_LENGTH = 8;
    const MIN_DISTINCT = 5;
    const MAX_REPEAT_RUN = 3;
    const SEQUENCE_MIN_LENGTH = 4;

    // P7b-① stems. Mirrored because they are substring matches, so a random
    // string really can hit them (`abc` and leet-unfolded `7357` -> `test`).
    const WEAK_STEMS = Object.freeze([
        'password', 'passwd', 'passw', 'admin', 'qwerty', 'asdf', 'zxcv',
        'letmein', 'welcome', 'abc', 'iloveyou'
    ]);

    // P7b-② keyboard rows; windows of 4+ in both directions are rejected.
    const KEYBOARD_ROWS = Object.freeze(['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890']);

    const LEET_TO_PLAIN = Object.freeze({
        3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '+': 't'
    });

    // P7b-③ "Capitalized word + digits + one trailing punctuation".
    const WEAK_STRUCTURE = /^[A-Z][A-Za-z]*[0-9]+[^A-Za-z0-9]$/;

    function buildWeakSequences() {
        const set = new Set();
        for (const row of KEYBOARD_ROWS) {
            for (let start = 0; start < row.length; start += 1) {
                for (let end = start + SEQUENCE_MIN_LENGTH; end <= row.length; end += 1) {
                    const window = row.slice(start, end);
                    set.add(window);
                    set.add([...window].reverse().join(''));
                }
            }
        }
        return set;
    }

    const WEAK_SEQUENCES = buildWeakSequences();

    function getCrypto() {
        const source = globalThis.crypto || (typeof window !== 'undefined' ? window.crypto : null);
        if (!source || typeof source.getRandomValues !== 'function') {
            throw new Error('当前浏览器不支持安全随机数，请升级浏览器或手动设置查询密码');
        }
        return source;
    }

    /**
     * Unbiased integer in [0, max) from crypto.getRandomValues. The biased tail
     * of the 32-bit space is rejected instead of using a modulo, otherwise the
     * first alphabet characters would be marginally over-represented.
     */
    function randomInt(max) {
        if (!Number.isInteger(max) || max < 1) throw new Error('随机数范围不正确');
        const source = getCrypto();
        const limit = Math.floor(0x100000000 / max) * max;
        const buffer = new Uint32Array(1);
        for (let attempt = 0; attempt < 64; attempt += 1) {
            source.getRandomValues(buffer);
            if (buffer[0] < limit) return buffer[0] % max;
        }
        throw new Error('无法获取安全随机数，请手动设置查询密码');
    }

    /**
     * §6.1.2 step 2: fold fullwidth ASCII (！＃＠ ａ Ａ ３) to halfwidth so a
     * Chinese IME cannot silently change the stored secret. The server folds the
     * same way, so what the buyer sees is what gets hashed.
     */
    function foldFullwidth(value) {
        let out = '';
        for (const chunk of String(value ?? '')) {
            const codePoint = chunk.codePointAt(0);
            out += (codePoint >= 0xff01 && codePoint <= 0xff5e)
                ? String.fromCharCode(codePoint - 0xfee0)
                : chunk;
        }
        return out;
    }

    function leetUnfold(value) {
        let out = '';
        for (const ch of value) out += LEET_TO_PLAIN[ch] ?? ch;
        return out;
    }

    function longestRepeatRun(value) {
        let best = 1;
        let run = 1;
        const keyOf = (ch) => (/[A-Za-z]/.test(ch) ? ch.toLowerCase() : ch);
        for (let index = 1; index < value.length; index += 1) {
            run = keyOf(value[index]) === keyOf(value[index - 1]) ? run + 1 : 1;
            if (run > best) best = run;
        }
        return best;
    }

    function longestMonotonicRun(value) {
        let best = 1;
        let ascending = 1;
        let descending = 1;
        for (let index = 1; index < value.length; index += 1) {
            const prev = value.charCodeAt(index - 1);
            const current = value.charCodeAt(index);
            const comparable = /[a-z0-9]/.test(value[index - 1]) && /[a-z0-9]/.test(value[index]);
            ascending = comparable && current === prev + 1 ? ascending + 1 : 1;
            descending = comparable && current === prev - 1 ? descending + 1 : 1;
            if (ascending > best) best = ascending;
            if (descending > best) best = descending;
        }
        return best;
    }

    /**
     * Live checklist state for §11.3. Only P1 and P2a-d are surfaced: those are
     * the four things a human can actually act on. P6-P10 stay server-side and
     * are reported through the create-order error message.
     */
    function inspect(rawPassword) {
        const value = foldFullwidth(rawPassword);
        return {
            length: [...value].length >= MIN_LENGTH,
            upper: /[A-Z]/.test(value),
            lower: /[a-z]/.test(value),
            digit: /[0-9]/.test(value),
            punct: /[^A-Za-z0-9]/.test(value),
            get ok() {
                return this.length && this.upper && this.lower && this.digit && this.punct;
            }
        };
    }

    /**
     * Local mirror of the server's structural rejections. Returns `{rule}` for
     * the first rule that fails, or `null` when the candidate is acceptable.
     */
    function structuralFailure(value) {
        if (longestRepeatRun(value) > MAX_REPEAT_RUN) return { rule: 'P9' };
        if (new Set([...value]).size < MIN_DISTINCT) return { rule: 'P10' };

        const lower = value.toLowerCase();
        const unfolded = leetUnfold(lower);
        for (const stem of WEAK_STEMS) {
            if (lower.includes(stem) || unfolded.includes(stem)) return { rule: 'P7b' };
        }
        for (const sequence of WEAK_SEQUENCES) {
            if (lower.includes(sequence)) return { rule: 'P7b' };
        }
        if (longestMonotonicRun(lower) >= SEQUENCE_MIN_LENGTH) return { rule: 'P7b' };
        if (WEAK_STRUCTURE.test(value)) return { rule: 'P7b' };
        return null;
    }

    /**
     * The buyer-facing submit gate. Mirrors only what the buyer can fix
     * (length + four classes); everything else is the server's call so the
     * client can never become the reason a weak password is accepted.
     */
    function policyFailure(rawPassword) {
        const value = foldFullwidth(rawPassword);
        if ([...value].length < MIN_LENGTH) return { rule: 'P1', reason: 'too_short' };
        if (!/[A-Z]/.test(value)) return { rule: 'P2a', reason: 'missing_uppercase' };
        if (!/[a-z]/.test(value)) return { rule: 'P2b', reason: 'missing_lowercase' };
        if (!/[0-9]/.test(value)) return { rule: 'P2c', reason: 'missing_digit' };
        if (!/[^A-Za-z0-9]/.test(value)) return { rule: 'P2d', reason: 'missing_punctuation' };
        const structural = structuralFailure(value);
        if (structural) return { rule: structural.rule, reason: 'weak_pattern' };
        return null;
    }

    function generate(options = {}) {
        const attempts = Math.max(1, Math.min(64, Number(options.attempts) || 48));
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            const chars = [];
            for (const pool of CLASS_LIST) chars.push(pool[randomInt(pool.length)]);
            while (chars.length < GENERATED_LENGTH) {
                chars.push(ALPHABET[randomInt(ALPHABET.length)]);
            }
            // Fisher-Yates with crypto randomness: the class-guaranteed
            // characters must not stay in a fixed position, or the shape itself
            // leaks which four characters satisfy which class.
            for (let index = chars.length - 1; index > 0; index -= 1) {
                const swap = randomInt(index + 1);
                [chars[index], chars[swap]] = [chars[swap], chars[index]];
            }
            const candidate = chars.join('');
            if (!structuralFailure(candidate)) return candidate;
        }
        throw new Error('无法生成查询密码，请手动设置一个');
    }

    globalThis.GuestQueryPassword = Object.freeze({
        GENERATED_LENGTH,
        CLASSES,
        MIN_LENGTH,
        foldFullwidth,
        generate,
        inspect,
        policyFailure
    });
})();
