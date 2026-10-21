'use strict';

/**
 * 信用卡导入数据智能解析模块
 * 支持：
 * 1. 键值多行块格式（如粘贴整段卡片详情）：
 *    卡号：5378727146050159
 *    有效期：11/29
 *    CVV：973
 *    持卡人：Jessica Martinez
 *    国家/州：US / Alaska
 *    城市：Juneau
 *    地址：2459 Glacier Creek Road
 *    邮编：99801
 * 2. 单行分隔符格式（支持 |、逗号、制表符、空格、分号）：
 *    5378727146050159|11/29|973|Jessica Martinez
 *    5378727146050159|11|29|973|Jessica Martinez
 */

function normalizeCardNumber(raw) {
    return String(raw || '').replace(/[\s-]/g, '').trim();
}

function normalizeExpiry(raw) {
    let s = String(raw || '').trim().replace(/\s+/g, '');
    if (!s) return '';

    // Match MM/YYYY or MM-YYYY or MM.YYYY
    let m = s.match(/^(\d{1,2})[\/\-.](\d{4})$/);
    if (m) {
        const month = m[1].padStart(2, '0');
        const year = m[2].slice(-2);
        return `${month}/${year}`;
    }

    // Match MM/YY or MM-YY or MM.YY
    m = s.match(/^(\d{1,2})[\/\-.](\d{2})$/);
    if (m) {
        const month = m[1].padStart(2, '0');
        const year = m[2];
        return `${month}/${year}`;
    }

    // Match MMYY (4 digits)
    m = s.match(/^(\d{2})(\d{2})$/);
    if (m) {
        const month = parseInt(m[1], 10);
        if (month >= 1 && month <= 12) {
            return `${m[1]}/${m[2]}`;
        }
    }

    return s;
}

function normalizeCvc(raw) {
    return String(raw || '').replace(/\D/g, '').trim();
}

function parseStateAndCountry(raw) {
    const s = String(raw || '').trim();
    if (!s) return { state: '', country: '' };
    if (s.includes('/')) {
        const parts = s.split('/').map(p => p.trim());
        // e.g. "US / Alaska" -> country: US, state: Alaska
        if (parts[0].length === 2 && parts[1]) {
            return { country: parts[0].toUpperCase(), state: parts[1] };
        }
        return { country: '', state: parts[parts.length - 1] };
    }
    return { state: s, country: '' };
}

function parseDelimitedCardLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return null;

    let parts = [];
    if (trimmed.includes('|')) {
        parts = trimmed.split('|');
    } else if (trimmed.includes('\t')) {
        parts = trimmed.split('\t');
    } else if (trimmed.includes(',')) {
        parts = trimmed.split(',');
    } else if (trimmed.includes(';')) {
        parts = trimmed.split(';');
    } else {
        parts = trimmed.split(/\s+/);
    }

    parts = parts.map(p => p.trim());
    if (parts.length < 3) return null;

    const cardNumber = normalizeCardNumber(parts[0]);
    if (!/^\d{13,19}$/.test(cardNumber)) return null;

    // Check if format is: number|month|year|cvc|holder (5 parts where part 1 is month 1-12, part 2 is year)
    let expiry = '';
    let cvc = '';
    let holder = '';
    let line1 = '';
    let city = '';
    let state = '';
    let postal = '';

    const p1IsMonth = /^(0?[1-9]|1[0-2])$/.test(parts[1]);
    const p2IsYear = /^(\d{2}|\d{4})$/.test(parts[2]);
    const p3IsCvc = /^\d{3,4}$/.test(parts[3] || '');

    if (parts.length >= 4 && p1IsMonth && p2IsYear && p3IsCvc) {
        expiry = normalizeExpiry(`${parts[1]}/${parts[2]}`);
        cvc = normalizeCvc(parts[3]);
        holder = parts.slice(4).join(' ').trim();
    } else {
        expiry = normalizeExpiry(parts[1]);
        cvc = normalizeCvc(parts[2]);
        holder = parts[3] ? parts[3].trim() : '';
        line1 = parts[4] ? parts[4].trim() : '';
        city = parts[5] ? parts[5].trim() : '';
        state = parts[6] ? parts[6].trim() : '';
        postal = parts[7] ? parts[7].trim() : '';
    }

    if (!cardNumber || !expiry || !cvc) return null;

    return {
        card_number: cardNumber,
        card_expiry: expiry,
        card_cvc: cvc,
        card_holder: holder,
        payment_holder_name: holder,
        payment_address_line1: line1,
        payment_address_city: city,
        payment_address_state: state,
        payment_address_postal: postal
    };
}

function parseCardImportText(rawText) {
    const text = String(rawText || '').trim();
    if (!text) return { cards: [], parseErrors: [] };

    const lines = text.split(/\r?\n/).map(l => l.trim());
    const cards = [];
    const parseErrors = [];

    // Check if input has key-value labels like "卡号：" / "Card Number:" / "有效期：" / "CVV："
    const hasKeyValuePattern = lines.some(line =>
        /^(?:卡号|信用卡号|有效期|到期日|到期时间|cvv|cvc|安全码|持卡人|card\s*number|card\s*no|exp|holder)[:：]/i.test(line)
    );

    if (hasKeyValuePattern) {
        let currentCard = null;

        function commitCard() {
            if (!currentCard) return;
            if (currentCard.card_number) {
                // Set default payment_holder_name if not already set
                if (!currentCard.payment_holder_name && currentCard.card_holder) {
                    currentCard.payment_holder_name = currentCard.card_holder;
                }
                cards.push(currentCard);
            }
            currentCard = null;
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) {
                commitCard();
                continue;
            }

            // Check if this line is a single delimited line outside a block
            if (!currentCard && /^\d{13,19}[|, \t]/.test(line)) {
                const parsedLine = parseDelimitedCardLine(line);
                if (parsedLine) {
                    cards.push(parsedLine);
                    continue;
                }
            }

            // 1. 卡号 / Card Number
            const cardNumMatch = line.match(/^(?:卡号|信用卡号|卡\s*号|card\s*number|card\s*no|card|pan|account)[:：\s]\s*(.+)$/i);
            if (cardNumMatch) {
                if (currentCard && currentCard.card_number) {
                    commitCard();
                }
                currentCard = currentCard || {};
                currentCard.card_number = normalizeCardNumber(cardNumMatch[1]);
                continue;
            }

            // Check if line is just a 13-19 digit number starting a card
            if (!currentCard) {
                const cleanNum = line.replace(/[\s-]/g, '');
                if (/^\d{13,19}$/.test(cleanNum)) {
                    currentCard = { card_number: cleanNum };
                    continue;
                }
            }

            if (!currentCard) {
                continue;
            }

            // 2. 有效期 / Expiry
            const expMatch = line.match(/^(?:有效期|到期日|到期时间|过期时间|有效时间|exp(?:iration)?\s*date|exp(?:iry)?|expiration|expiry|date)[:：\s]\s*(.+)$/i);
            if (expMatch) {
                currentCard.card_expiry = normalizeExpiry(expMatch[1]);
                continue;
            }

            // 3. CVC / CVV
            const cvcMatch = line.match(/^(?:cvv2?|cvc2?|安全码|安全代码|后三位|cvv|cvc|security\s*code|csc|cvn)[:：\s]\s*(.+)$/i);
            if (cvcMatch) {
                currentCard.card_cvc = normalizeCvc(cvcMatch[1]);
                continue;
            }

            // 4. 持卡人 / Holder
            const holderMatch = line.match(/^(?:持卡人|持卡人姓名|姓名|名字|card\s*holder|cardholder|holder|name)[:：\s]\s*(.+)$/i);
            if (holderMatch) {
                currentCard.card_holder = holderMatch[1].trim();
                continue;
            }

            // 5. 地址 / Address
            const addrMatch = line.match(/^(?:地址|街道地址|街道|账单地址|address|street|billing\s*address)[:：\s]\s*(.+)$/i);
            if (addrMatch) {
                currentCard.payment_address_line1 = addrMatch[1].trim();
                continue;
            }

            // 6. 城市 / City
            const cityMatch = line.match(/^(?:城市|市|city|town)[:：\s]\s*(.+)$/i);
            if (cityMatch) {
                currentCard.payment_address_city = cityMatch[1].trim();
                continue;
            }

            // 7. 国家/州 / State
            const stateMatch = line.match(/^(?:国家\s*[\/\-]?\s*州|国家|州|省|省份|state|country|country\s*[\/\-]?\s*state|region)[:：\s]\s*(.+)$/i);
            if (stateMatch) {
                const { state, country } = parseStateAndCountry(stateMatch[1]);
                if (state) currentCard.payment_address_state = state;
                if (country) currentCard.payment_address_country = country;
                continue;
            }

            // 8. 邮编 / Zip
            const zipMatch = line.match(/^(?:邮编|邮政编码|zip|postal|postal\s*code|zip\s*code)[:：\s]\s*(.+)$/i);
            if (zipMatch) {
                currentCard.payment_address_postal = zipMatch[1].trim();
                continue;
            }
        }
        commitCard();
    } else {
        // Delimited lines parsing
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            const parsed = parseDelimitedCardLine(line);
            if (parsed) {
                cards.push(parsed);
            } else {
                parseErrors.push(`第 ${i + 1} 行格式无法识别：${line.slice(0, 40)}`);
            }
        }
    }

    return { cards, parseErrors };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizeCardNumber,
        normalizeExpiry,
        normalizeCvc,
        parseDelimitedCardLine,
        parseCardImportText
    };
}
if (typeof window !== 'undefined') {
    window.CardParser = {
        normalizeCardNumber,
        normalizeExpiry,
        normalizeCvc,
        parseDelimitedCardLine,
        parseCardImportText
    };
}
