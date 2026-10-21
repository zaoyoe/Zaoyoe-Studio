import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import {
    clickPlanUpgrade,
    pageShowsTargetRegionPricing,
    selectPricingRegion,
    switchToPersonalPlans,
    resolveChatGptProUsageTier,
    ensureChatGptProUsageTier
} from '../pricing-checkout.js';

let browser;

beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
    await browser?.close();
});

async function newPage(html) {
    const page = await browser.newPage();
    await page.context().route('**/*', route => route.abort());
    await page.setContent(html);
    return page;
}

describe('pricing plan selector compatibility', () => {
    it('switches from a direct Business/Personal tablist', async () => {
        const page = await newPage(`
            <div role="tablist">
                <button role="tab" aria-selected="true" id="business">Business</button>
                <button role="tab" aria-selected="false" id="personal">Personal</button>
            </div>
            <section id="plans"><h2>ChatGPT Business</h2></section>
            <script>
                personal.onclick = () => {
                    business.setAttribute('aria-selected', 'false');
                    personal.setAttribute('aria-selected', 'true');
                    plans.innerHTML = '<h2>ChatGPT Plus</h2><button>Upgrade to Plus</button>';
                };
            </script>
        `);

        await switchToPersonalPlans(page);
        expect(await page.getByText('ChatGPT Plus', { exact: true }).isVisible()).toBe(true);
        expect(await page.getByRole('button', { name: 'Upgrade to Plus' }).isVisible()).toBe(true);
        await page.close();
    });

    it('opens a Business dropdown and selects Personal', async () => {
        const page = await newPage(`
            <button id="switcher" aria-haspopup="menu" aria-expanded="false">Business</button>
            <div id="menu" role="menu" hidden>
                <div role="menuitem" id="personal">Personal</div>
            </div>
            <section id="plans"><h2>ChatGPT Business</h2></section>
            <script>
                switcher.onclick = () => {
                    switcher.setAttribute('aria-expanded', 'true');
                    menu.hidden = false;
                };
                personal.onclick = () => {
                    switcher.setAttribute('aria-expanded', 'false');
                    menu.hidden = true;
                    plans.innerHTML = '<h2>ChatGPT Pro</h2><button>Get Pro</button>';
                };
            </script>
        `);

        await switchToPersonalPlans(page);
        expect(await page.getByText('ChatGPT Pro', { exact: true }).isVisible()).toBe(true);
        expect(await page.getByRole('button', { name: 'Get Pro' }).isVisible()).toBe(true);
        await page.close();
    });

    it('accepts Individual as the personal label', async () => {
        const page = await newPage(`
            <button role="button" aria-pressed="true">Business</button>
            <button role="button" aria-pressed="false" id="individual">Individual</button>
            <section id="plans"><h2>ChatGPT Business</h2></section>
            <script>
                individual.onclick = () => {
                    document.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', button.textContent === 'Individual' ? 'true' : 'false'));
                    plans.innerHTML = '<h2>ChatGPT Plus</h2><button>Subscribe to Plus</button>';
                };
            </script>
        `);

        await switchToPersonalPlans(page);
        expect(await page.getByText('ChatGPT Plus', { exact: true }).isVisible()).toBe(true);
        await page.close();
    });
});


describe('pricing region selector compatibility', () => {
    it('stops when region selection is unavailable and the displayed price is not the target region', async () => {
        const page = await newPage(`
            <h2>ChatGPT Plus</h2>
            <section id="plans">$20 / month</section>
            <button>Upgrade to Plus</button>
        `);
        await expect(selectPricingRegion(page, 'PH')).rejects.toMatchObject({ code: 'PRICING_REGION_UNCONFIRMED' });
        await page.close();
    });

    it('opens a currency-only billing-country trigger and selects Philippines from a dialog portal', async () => {
        const page = await newPage(`
            <button id="billing" aria-label="Billing country: China">Your current plan ¥</button>
            <h2>Plus</h2><button>Upgrade to Plus</button><section id="plans">¥20 / month</section>
            <div id="picker" role="dialog" hidden>
                <h2>Billing country</h2>
                <button id="ph">Philippines</button>
            </div>
            <script>
                billing.onclick = () => picker.hidden = false;
                ph.onclick = () => {
                    picker.hidden = true;
                    billing.setAttribute('aria-label', 'Billing country: Philippines');
                    plans.textContent = '₱999 / month';
                };
            </script>
        `);

        await selectPricingRegion(page, 'PH');
        expect(await pageShowsTargetRegionPricing(page, 'PH')).toBe(true);
        expect(await page.getByText('₱999 / month', { exact: true }).isVisible()).toBe(true);
        await page.close();
    });

    it('searches a portal listbox when options are rendered as custom role=option nodes', async () => {
        const page = await newPage(`
            <div role="combobox" id="billing" aria-label="Country or region: China">¥</div>
            <h2>Plus</h2><button>Upgrade to Plus</button><section id="plans">¥20 / month</section>
            <div id="picker" role="dialog" hidden>
                <h2>Country or region</h2>
                <input id="search" type="search" placeholder="Search country" />
                <div id="options" role="listbox"></div>
            </div>
            <script>
                billing.onclick = () => { picker.hidden = false; render(''); };
                function render(value) {
                    options.innerHTML = value.toLowerCase().includes('phil')
                        ? '<div role="option">Philippines</div>'
                        : '<div role="option">United States</div><div role="option">China</div>';
                }
                search.oninput = () => render(search.value);
                options.onclick = (event) => {
                    if (event.target.textContent === 'Philippines') {
                        picker.hidden = true;
                        billing.setAttribute('aria-label', 'Country or region: Philippines');
                        plans.textContent = '₱999 / month';
                    }
                };
            </script>
        `);

        await selectPricingRegion(page, 'PH');
        expect(await pageShowsTargetRegionPricing(page, 'PH')).toBe(true);
        await page.close();
    });
});

describe('latest upgrade modal compatibility', () => {
    it('opens the complete plan catalogue before looking for billing country', async () => {
        const page = await newPage(`
            <div role="dialog" id="upgrade">
                <h1>Upgrade your plan</h1>
                <button aria-pressed="true">Personal</button>
                <button id="start">Start now</button>
                <a id="all-plans" href="#all-plans">See all plans</a>
                <div id="price">¥3,000 / month</div>
            </div>
            <script>
                document.getElementById('all-plans').onclick = (event) => {
                    event.preventDefault();
                    document.getElementById('upgrade').innerHTML = "<h1>All plans</h1><button id='billing' aria-label='Billing country: China'>Your current plan ¥</button><div id='price'>¥3,000 / month</div><div id='picker' role='dialog' hidden><h2>Billing country</h2><button id='ph'>Philippines</button></div>"
                    document.getElementById('billing').onclick = () => {
                        const picker = document.getElementById('picker');
                        picker.hidden = false;
                    };
                    document.getElementById('ph').onclick = () => {
                        const picker = document.getElementById('picker');
                        picker.hidden = true;
                        const billing = document.getElementById('billing');
                        billing.setAttribute('aria-label', 'Billing country: Philippines');
                        document.getElementById('price').textContent = '₱999 / month';
                    };
                };
            </script>
        `);

        await selectPricingRegion(page, 'PH');
        expect(await pageShowsTargetRegionPricing(page, 'PH')).toBe(true);
        expect(await page.getByText('₱999 / month', { exact: true }).isVisible()).toBe(true);
        await page.close();
    });

    it('handles 4-card modal with PHP pricing and clicks Upgrade to Plus', async () => {
        const page = await newPage(`
            <div role="dialog" aria-modal="true" id="pricing-modal">
                <h2>Upgrade your plan</h2>
                <div role="radiogroup">
                    <button role="radio" aria-checked="true" aria-pressed="true">Personal</button>
                    <button role="radio" aria-checked="false" aria-pressed="false">Business</button>
                </div>
                <div class="cards">
                    <div class="card">
                        <h3>Free</h3>
                        <div>₱0 / month</div>
                        <button disabled>Your current plan</button>
                    </div>
                    <div class="card">
                        <h3>Go</h3>
                        <div>₱300 / month</div>
                        <button>Upgrade to Go</button>
                    </div>
                    <div class="card" id="plus-card">
                        <h3>Plus</h3>
                        <span>RECOMMENDED</span>
                        <div>₱1,100 / month</div>
                        <button id="upgrade-plus-btn">✦ Upgrade to Plus</button>
                    </div>
                    <div class="card">
                        <h3>Pro</h3>
                        <div>From ₱6,490 / month</div>
                        <button>Upgrade to Pro</button>
                    </div>
                </div>
            </div>
            <script>
                let clicked = false;
                document.getElementById('upgrade-plus-btn').onclick = () => {
                    clicked = true;
                    document.getElementById('upgrade-plus-btn').textContent = 'Opening checkout...';
                };
            </script>
        `);

        expect(await pageShowsTargetRegionPricing(page, 'PH')).toBe(true);
        await selectPricingRegion(page, 'PH');
        await clickPlanUpgrade(page, 'plus', { region: 'PH' });
        expect(await page.locator('#upgrade-plus-btn').textContent()).toBe('Opening checkout...');
        await page.close();
    });

    it('does not click a plan until the target card shows a stable target-region price', async () => {
        const page = await newPage(`
            <div role="dialog"><h2>Upgrade your plan</h2>
                <section><h3>Plus</h3><p>USD 20 / month</p>
                    <button id="upgrade" onclick="window.clicked = true">Upgrade to Plus</button>
                </section>
            </div>
            <script>window.clicked = false;</script>
        `);

        await expect(clickPlanUpgrade(page, 'plus', { region: 'PH', priceConfirmTimeoutMs: 250 }))
            .rejects.toThrow('未能连续确认 Plus 套餐卡片显示 PHP 价格');
        expect(await page.evaluate(() => window.clicked)).toBe(false);
        await page.close();
    });

    it('does not click while the target-card price keeps changing', async () => {
        const page = await newPage(`
            <div role="dialog"><h2>Upgrade your plan</h2>
                <section><h3>Plus</h3><p id="price">₱1,100 / month</p>
                    <button id="upgrade" onclick="window.clicked = true">Upgrade to Plus</button>
                </section>
            </div>
            <script>
                window.clicked = false;
                let local = false;
                setInterval(() => {
                    local = !local;
                    document.getElementById('price').textContent = local ? '₱1,100 / month' : '₱1,101 / month';
                }, 100);
            </script>
        `);

        await expect(clickPlanUpgrade(page, 'plus', { region: 'PH', priceConfirmTimeoutMs: 450 }))
            .rejects.toThrow('未能连续确认 Plus 套餐卡片显示 PHP 价格');
        expect(await page.evaluate(() => window.clicked)).toBe(false);
        await page.close();
    });

    it('rejects a Chile card that still explicitly displays USD despite a Chile region label', async () => {
        const page = await newPage(`
            <div role="dialog"><h2>Upgrade your plan</h2>
                <button aria-label="Billing country: Chile">Chile</button>
                <section><h3>Plus</h3><p>USD $20 / month</p>
                    <button id="upgrade" onclick="window.clicked = true">Upgrade to Plus</button>
                </section>
            </div>
            <script>window.clicked = false;</script>
        `);

        await expect(clickPlanUpgrade(page, 'plus', { region: 'CL', priceConfirmTimeoutMs: 250 }))
            .rejects.toThrow('未能连续确认 Plus 套餐卡片显示 CLP 价格');
        expect(await page.evaluate(() => window.clicked)).toBe(false);
        await page.close();
    });

    it('accepts a stable Chilean peso card when the page identifies Chile', async () => {
        const page = await newPage(`
            <div role="dialog"><h2>Upgrade your plan</h2>
                <button aria-label="Billing country: Chile">Chile</button>
                <section><h3>Plus</h3><p>$ 19,990 / month</p>
                    <button id="upgrade" onclick="window.clicked = true">Upgrade to Plus</button>
                </section>
            </div>
            <script>window.clicked = false;</script>
        `);

        await clickPlanUpgrade(page, 'plus', { region: 'CL', priceConfirmTimeoutMs: 1000 });
        expect(await page.evaluate(() => window.clicked)).toBe(true);
        await page.close();
    });

    it('handles returning subscriber modal with "Rejoin Plus" button', async () => {
        const page = await browser.newPage();
        await page.setContent(`
            <div id="pricing" role="dialog">
                <button>Personal</button>
                <div id="catalog" class="grid-4">
                    <div class="card" id="free-card">
                        <h3>Free</h3>
                        <div>Your current plan</div>
                    </div>
                    <div class="card" id="go-card">
                        <h3>Go</h3>
                        <div>₱300 / month</div>
                        <button id="buy-go-btn">Buy now</button>
                    </div>
                    <div class="card" id="plus-card">
                        <h3>Plus</h3>
                        <div>₱1,100 / month</div>
                        <button id="rejoin-plus-btn">✦ Rejoin Plus</button>
                    </div>
                    <div class="card" id="pro-card">
                        <h3>Pro</h3>
                        <div>₱6,490 / month</div>
                        <button id="buy-pro-btn">Buy now</button>
                    </div>
                </div>
            </div>
            <script>
                document.getElementById('rejoin-plus-btn').onclick = () => {
                    document.getElementById('rejoin-plus-btn').textContent = 'Opening checkout...';
                };
            </script>
        `);

        expect(await pageShowsTargetRegionPricing(page, 'PH')).toBe(true);
        await selectPricingRegion(page, 'PH');
        await clickPlanUpgrade(page, 'plus', { region: 'PH' });
        expect(await page.locator('#rejoin-plus-btn').textContent()).toBe('Opening checkout...');
        await page.close();
    });

    it('expands from 2-card modal via See all plans when upgrading to Pro', async () => {
        const page = await browser.newPage();
        await page.setContent(`
            <div id="pricing" role="dialog">
                <button>Personal</button>
                <div id="catalog" class="grid-2">
                    <div class="card" id="free-card">
                        <h3>Free</h3>
                        <div>Your current plan</div>
                    </div>
                    <div class="card" id="plus-card">
                        <h3>Plus</h3>
                        <span>RECOMMENDED</span>
                        <div>$20 / month</div>
                        <button id="upgrade-plus-btn">Start now</button>
                    </div>
                </div>
                <a href="#" id="see-all-plans-link">See all plans</a>
            </div>
            <script>
                document.getElementById('see-all-plans-link').onclick = (e) => {
                    e.preventDefault();
                    document.getElementById('see-all-plans-link').remove();
                    const proCard = document.createElement('div');
                    proCard.className = 'card';
                    proCard.id = 'pro-card';
                    proCard.innerHTML = '<h3>Pro</h3><div>$200 / month</div><button id="upgrade-pro-btn">Upgrade to Pro</button>';
                    document.getElementById('catalog').appendChild(proCard);
                    document.getElementById('upgrade-pro-btn').onclick = () => {
                        document.getElementById('upgrade-pro-btn').textContent = 'Opening pro checkout...';
                    };
                };
            </script>
        `);

        await clickPlanUpgrade(page, 'pro_200', { region: 'US' });
        expect(await page.locator('#upgrade-pro-btn').textContent()).toBe('Opening pro checkout...');
        await page.close();
    });
});

describe('ChatGPT Pro usage tier mapping and checkout card selection', () => {
    it('resolves pro plan types correctly to standard / more / max tiers', () => {
        expect(resolveChatGptProUsageTier('pro_500')?.id).toBe('max');
        expect(resolveChatGptProUsageTier('pro500')?.id).toBe('max');
        expect(resolveChatGptProUsageTier('pro_max')?.id).toBe('max');

        expect(resolveChatGptProUsageTier('pro_200')?.id).toBe('more');
        expect(resolveChatGptProUsageTier('pro200')?.id).toBe('more');
        expect(resolveChatGptProUsageTier('pro_20x')?.id).toBe('more');
        expect(resolveChatGptProUsageTier('pro20x')?.id).toBe('more');
        expect(resolveChatGptProUsageTier('pro_more')?.id).toBe('more');

        expect(resolveChatGptProUsageTier('pro_100')?.id).toBe('standard');
        expect(resolveChatGptProUsageTier('pro100')?.id).toBe('standard');
        expect(resolveChatGptProUsageTier('pro_5x')?.id).toBe('standard');
        expect(resolveChatGptProUsageTier('pro5x')?.id).toBe('standard');
        expect(resolveChatGptProUsageTier('pro')?.id).toBe('standard');

        expect(resolveChatGptProUsageTier('plus')).toBeNull();
        expect(resolveChatGptProUsageTier('claude_pro')).toBeNull();
    });

    it('switches to Max usage (₱32,490) when planType is pro_500', async () => {
        const page = await newPage(`
            <div id="checkout-view">
                <h1>Configure your plan</h1>
                <h2>Pro plan</h2>
                <p>Choose your usage level. Learn more</p>
                <div class="usage-options" role="radiogroup">
                    <button role="radio" id="tier-standard" aria-checked="true" class="tier-card border-black">
                        <div class="price">₱6,490</div>
                        <div class="title">Standard</div>
                    </button>
                    <button role="radio" id="tier-more" aria-checked="false" class="tier-card">
                        <div class="price">₱9,990</div>
                        <div class="title">More usage</div>
                    </button>
                    <button role="radio" id="tier-max" aria-checked="false" class="tier-card">
                        <div class="price">₱32,490</div>
                        <div class="title">Max usage</div>
                    </button>
                </div>
                <div id="due-section">Due today: <span id="due-amount">₱6,490.00</span></div>
            </div>
            <script>
                function selectTier(target, amount) {
                    [document.getElementById('tier-standard'), document.getElementById('tier-more'), document.getElementById('tier-max')].forEach(b => {
                        b.setAttribute('aria-checked', b === target ? 'true' : 'false');
                        if (b === target) {
                            b.classList.add('border-black');
                        } else {
                            b.classList.remove('border-black');
                        }
                    });
                    document.getElementById('due-amount').textContent = amount;
                }
                document.getElementById('tier-standard').onclick = () => selectTier(document.getElementById('tier-standard'), '₱6,490.00');
                document.getElementById('tier-more').onclick = () => selectTier(document.getElementById('tier-more'), '₱9,990.00');
                document.getElementById('tier-max').onclick = () => selectTier(document.getElementById('tier-max'), '₱32,490.00');
            </script>
        `);

        expect(await page.locator('#tier-standard').getAttribute('aria-checked')).toBe('true');
        expect(await page.locator('#tier-max').getAttribute('aria-checked')).toBe('false');

        const result = await ensureChatGptProUsageTier(page, 'pro_500');
        expect(result.handled).toBe(true);
        expect(result.tier).toBe('max');

        expect(await page.locator('#tier-max').getAttribute('aria-checked')).toBe('true');
        expect(await page.locator('#tier-standard').getAttribute('aria-checked')).toBe('false');
        expect(await page.locator('#due-amount').textContent()).toBe('₱32,490.00');
        await page.close();
    });

    it('switches to More usage (₱9,990) when planType is pro_200', async () => {
        const page = await newPage(`
            <div id="checkout-view">
                <h1>Configure your plan</h1>
                <h2>Pro plan</h2>
                <p>Choose your usage level. Learn more</p>
                <div class="cards">
                    <div id="card-standard" class="border-black cursor-pointer" data-state="checked">
                        <div>₱6,490</div>
                        <div>Standard</div>
                    </div>
                    <div id="card-more" class="cursor-pointer" data-state="unchecked">
                        <div>₱9,990</div>
                        <div>More usage</div>
                    </div>
                    <div id="card-max" class="cursor-pointer" data-state="unchecked">
                        <div>₱32,490</div>
                        <div>Max usage</div>
                    </div>
                </div>
            </div>
            <script>
                document.getElementById('card-more').onclick = () => {
                    document.getElementById('card-standard').setAttribute('data-state', 'unchecked');
                    document.getElementById('card-standard').classList.remove('border-black');
                    document.getElementById('card-more').setAttribute('data-state', 'checked');
                    document.getElementById('card-more').classList.add('border-black');
                };
            </script>
        `);

        const result = await ensureChatGptProUsageTier(page, 'pro_200');
        expect(result.handled).toBe(true);
        expect(result.tier).toBe('more');

        expect(await page.locator('#card-more').getAttribute('data-state')).toBe('checked');
        expect(await page.locator('#card-more').evaluate(el => el.classList.contains('border-black'))).toBe(true);
        await page.close();
    });

    it('keeps Standard when planType is pro_100 and it is already selected', async () => {
        const page = await newPage(`
            <div>
                <h1>Configure your plan</h1>
                <button aria-checked="true" class="border-black">
                    <span>₱6,490</span>
                    <span>Standard</span>
                </button>
                <button aria-checked="false">
                    <span>₱9,990</span>
                    <span>More usage</span>
                </button>
                <button aria-checked="false">
                    <span>₱32,490</span>
                    <span>Max usage</span>
                </button>
            </div>
        `);

        const result = await ensureChatGptProUsageTier(page, 'pro_100');
        expect(result.handled).toBe(true);
        expect(result.tier).toBe('standard');
        expect(result.selected).toBe(true);
        await page.close();
    });

    it('immediately confirms Pro More usage when Due today $200.00 is split across newlines', async () => {
        const page = await newPage(`
            <div id="checkout-view">
                <h1>Configure your plan</h1>
                <div class="cards">
                    <button id="btn-standard"><span>$100</span><span>Standard</span></button>
                    <button id="btn-more"><span>$200</span><span>More usage</span></button>
                    <button id="btn-max"><span>$500</span><span>Max usage</span></button>
                </div>
                <div class="sidebar">
                    <div>Due today</div>
                    <div id="due-price">$100.00</div>
                </div>
            </div>
            <script>
                document.getElementById('btn-more').onclick = () => {
                    document.getElementById('due-price').textContent = '$200.00';
                };
            </script>
        `);

        const result = await ensureChatGptProUsageTier(page, 'pro_200');
        expect(result.handled).toBe(true);
        expect(result.tier).toBe('more');
        expect(result.clicked).toBe(true);
        expect(await page.locator('#due-price').textContent()).toBe('$200.00');
        await page.close();
    });
});


