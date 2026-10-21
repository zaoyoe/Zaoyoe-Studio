import { describe, expect, it } from 'vitest';
const {
    normalizeCardNumber,
    normalizeExpiry,
    normalizeCvc,
    parseDelimitedCardLine,
    parseCardImportText
} = require('../card-parser');

describe('Card Parser Contract', () => {
    it('normalizes card numbers with spaces and dashes', () => {
        expect(normalizeCardNumber('5378 7271 4605 0159')).toBe('5378727146050159');
        expect(normalizeCardNumber('5378-7271-4605-0159')).toBe('5378727146050159');
        expect(normalizeCardNumber('  5378727146050159  ')).toBe('5378727146050159');
    });

    it('normalizes various expiry formats to MM/YY', () => {
        expect(normalizeExpiry('11/29')).toBe('11/29');
        expect(normalizeExpiry('11/2029')).toBe('11/29');
        expect(normalizeExpiry('11-29')).toBe('11/29');
        expect(normalizeExpiry('11.29')).toBe('11/29');
        expect(normalizeExpiry('1129')).toBe('11/29');
        expect(normalizeExpiry('1/28')).toBe('01/28');
        expect(normalizeExpiry('01/28')).toBe('01/28');
        expect(normalizeExpiry('1/2028')).toBe('01/28');
    });

    it('normalizes CVC stripping non-digits', () => {
        expect(normalizeCvc('973')).toBe('973');
        expect(normalizeCvc(' 973 ')).toBe('973');
        expect(normalizeCvc('cvv: 973')).toBe('973');
    });

    it('parses user specific multi-line block format correctly', () => {
        const text = `
卡号：5378727146050159
有效期：11/29
CVV：973
卡余额：$33.38
持卡人：Jessica Martinez
国家/州：US / Alaska
城市：Juneau
地址：2459 Glacier Creek Road
邮编：99801
`;
        const { cards, parseErrors } = parseCardImportText(text);
        expect(parseErrors).toHaveLength(0);
        expect(cards).toHaveLength(1);

        const card = cards[0];
        expect(card.card_number).toBe('5378727146050159');
        expect(card.card_expiry).toBe('11/29');
        expect(card.card_cvc).toBe('973');
        expect(card.card_holder).toBe('Jessica Martinez');
        expect(card.payment_holder_name).toBe('Jessica Martinez');
        expect(card.payment_address_line1).toBe('2459 Glacier Creek Road');
        expect(card.payment_address_city).toBe('Juneau');
        expect(card.payment_address_state).toBe('Alaska');
        expect(card.payment_address_country).toBe('US');
        expect(card.payment_address_postal).toBe('99801');
    });

    it('parses multiple key-value cards in a single paste', () => {
        const text = `
卡号：5378727146050159
有效期：11/29
CVV：973
持卡人：Jessica Martinez

卡号：4111111111111111
有效期：12/28
CVC：123
持卡人：John Doe
`;
        const { cards, parseErrors } = parseCardImportText(text);
        expect(parseErrors).toHaveLength(0);
        expect(cards).toHaveLength(2);

        expect(cards[0].card_number).toBe('5378727146050159');
        expect(cards[0].card_expiry).toBe('11/29');
        expect(cards[0].card_cvc).toBe('973');
        expect(cards[0].card_holder).toBe('Jessica Martinez');

        expect(cards[1].card_number).toBe('4111111111111111');
        expect(cards[1].card_expiry).toBe('12/28');
        expect(cards[1].card_cvc).toBe('123');
        expect(cards[1].card_holder).toBe('John Doe');
    });

    it('parses English labels format', () => {
        const text = `
Card Number: 5378727146050159
Exp Date: 11/29
Security Code: 973
Cardholder: Jessica Martinez
`;
        const { cards, parseErrors } = parseCardImportText(text);
        expect(parseErrors).toHaveLength(0);
        expect(cards).toHaveLength(1);
        expect(cards[0].card_number).toBe('5378727146050159');
        expect(cards[0].card_expiry).toBe('11/29');
        expect(cards[0].card_cvc).toBe('973');
        expect(cards[0].card_holder).toBe('Jessica Martinez');
    });

    it('parses single-line delimited formats (pipe, comma, tab, space)', () => {
        const text = `
5349336392059744|04/31|738|John Doe
5349336383247282,05/30,937,Jane Doe
5349336383247282\t06/29\t111\tAlice
5349336383247282 07/32 222 Bob
`;
        const { cards, parseErrors } = parseCardImportText(text);
        expect(parseErrors).toHaveLength(0);
        expect(cards).toHaveLength(4);
        expect(cards[0].card_number).toBe('5349336392059744');
        expect(cards[0].card_expiry).toBe('04/31');
        expect(cards[0].card_cvc).toBe('738');
        expect(cards[0].card_holder).toBe('John Doe');

        expect(cards[1].card_expiry).toBe('05/30');
        expect(cards[2].card_expiry).toBe('06/29');
        expect(cards[3].card_expiry).toBe('07/32');
    });

    it('parses 5-field single-line with separate month and year', () => {
        const line = '5349336392059744|04|31|738|John Doe';
        const card = parseDelimitedCardLine(line);
        expect(card).not.toBeNull();
        expect(card.card_number).toBe('5349336392059744');
        expect(card.card_expiry).toBe('04/31');
        expect(card.card_cvc).toBe('738');
        expect(card.card_holder).toBe('John Doe');
    });

    it('parses user specific 4-field block format and handles Luhn validation flags', () => {
        const { validateCard } = require('../card-validator');
        const text = `
卡号：5378727146050151
有效期：11/29
CVV：972
持卡人：Jessica Martine
`;
        const { cards, parseErrors } = parseCardImportText(text);
        expect(parseErrors).toHaveLength(0);
        expect(cards).toHaveLength(1);
        expect(cards[0].card_number).toBe('5378727146050151');
        expect(cards[0].card_expiry).toBe('11/29');
        expect(cards[0].card_cvc).toBe('972');
        expect(cards[0].card_holder).toBe('Jessica Martine');

        // Without allowInvalidLuhn, fails Luhn algorithm
        const defaultValidation = validateCard(cards[0]);
        expect(defaultValidation.valid).toBe(false);
        expect(defaultValidation.errors[0]).toContain('Luhn');

        // With allowInvalidLuhn = true, passes
        const permissiveValidation = validateCard(cards[0], { allowInvalidLuhn: true });
        expect(permissiveValidation.valid).toBe(true);
        expect(permissiveValidation.errors).toHaveLength(0);
    });
});
