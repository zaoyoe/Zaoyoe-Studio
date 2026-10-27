'use strict';

import { describe, it, expect, vi } from 'vitest';
const {
    isUsTaxFreeState,
    resolveCardBillingProfile,
    normalizeUsStateName
} = require('../tax-free-address');

describe('Card AVS matching and billing address prioritization', () => {
    it('accurately detects US tax-free states (Alaska, Oregon, Delaware, Montana, New Hampshire)', () => {
        expect(isUsTaxFreeState('Alaska')).toBe(true);
        expect(isUsTaxFreeState('AK')).toBe(true);
        expect(isUsTaxFreeState('Oregon')).toBe(true);
        expect(isUsTaxFreeState('OR')).toBe(true);
        expect(isUsTaxFreeState('Delaware')).toBe(true);
        expect(isUsTaxFreeState('DE')).toBe(true);
        expect(isUsTaxFreeState('Montana')).toBe(true);
        expect(isUsTaxFreeState('MT')).toBe(true);
        expect(isUsTaxFreeState('New Hampshire')).toBe(true);
        expect(isUsTaxFreeState('NH')).toBe(true);

        // Taxable states
        expect(isUsTaxFreeState('California')).toBe(false);
        expect(isUsTaxFreeState('CA')).toBe(false);
        expect(isUsTaxFreeState('New York')).toBe(false);
        expect(isUsTaxFreeState('Texas')).toBe(false);
        expect(isUsTaxFreeState(null)).toBe(false);
        expect(isUsTaxFreeState('')).toBe(false);
    });

    it('prioritizes card-bound AVS address and cardholder name over pool addresses', () => {
        const cardWithAvs = {
            id: 6,
            card_number: '5378727144540565',
            card_expiry: '10/28',
            card_cvc: '017',
            card_holder: 'Jessica Martinez',
            payment_holder_name: 'Jessica Martinez',
            payment_address_line1: '2459 Glacier Creek Road',
            payment_address_city: 'Juneau',
            payment_address_state: 'Alaska',
            payment_address_postal: '99801'
        };

        const poolAddress = {
            id: 145,
            name: 'Sarah Smith',
            line1: '4755 SW Griffith Dr',
            city: 'Beaverton',
            state: 'Oregon',
            postal_code: '97005',
            country: 'US'
        };

        const profile = resolveCardBillingProfile(cardWithAvs, poolAddress, { email: 'user@example.com' });

        expect(profile.isCardAvs).toBe(true);
        expect(profile.source).toBe('card_avs');
        expect(profile.name).toBe('Jessica Martinez');
        expect(profile.line1).toBe('2459 Glacier Creek Road');
        expect(profile.city).toBe('Juneau');
        expect(profile.state).toBe('Alaska');
        expect(profile.postal_code).toBe('99801');
        expect(profile.zip).toBe('99801');
        expect(profile.country).toBe('US');
        expect(profile.email).toBe('user@example.com');
    });

    it('normalizes abbreviated state codes in card AVS address (e.g. AK -> Alaska)', () => {
        const cardAbbr = {
            card_number: '5378727144540565',
            payment_holder_name: 'Jessica Martinez',
            payment_address_line1: '2459 Glacier Creek Road',
            payment_address_city: 'Juneau',
            payment_address_state: 'AK',
            payment_address_postal: '99801'
        };

        const poolAddress = {
            id: 145,
            state: 'Oregon',
            postal_code: '97005',
            country: 'US'
        };

        const profile = resolveCardBillingProfile(cardAbbr, poolAddress);
        expect(profile.isCardAvs).toBe(true);
        expect(profile.state).toBe('Alaska');
        expect(profile.postal_code).toBe('99801');
    });

    it('replaces holder name when card has no address but has card_holder', () => {
        const cardOnlyHolder = {
            id: 10,
            card_number: '5378727148722714',
            card_holder: 'Lisa Sanchez',
            payment_holder_name: 'Lisa Sanchez'
        };

        const poolAddress = {
            id: 145,
            name: 'Sarah Smith',
            line1: '4755 SW Griffith Dr',
            city: 'Beaverton',
            state: 'Oregon',
            postal_code: '97005',
            country: 'US'
        };

        const profile = resolveCardBillingProfile(cardOnlyHolder, poolAddress);
        expect(profile.isCardAvs).toBe(false);
        expect(profile.name).toBe('Lisa Sanchez');
        expect(profile.line1).toBe('4755 SW Griffith Dr');
        expect(profile.state).toBe('Oregon');
        expect(profile.postal_code).toBe('97005');
    });

    it('gracefully uses pool address when card has neither address nor holder', () => {
        const rawCard = {
            card_number: '4000000000008043'
        };

        const poolAddress = {
            id: 145,
            name: 'Sarah Smith',
            line1: '4755 SW Griffith Dr',
            city: 'Beaverton',
            state: 'Oregon',
            postal_code: '97005',
            country: 'US'
        };

        const profile = resolveCardBillingProfile(rawCard, poolAddress);
        expect(profile.isCardAvs).toBe(false);
        expect(profile.name).toBe('Sarah Smith');
        expect(profile.line1).toBe('4755 SW Griffith Dr');
    });
});
