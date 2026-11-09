/** Set language and translate the parsed shell before its first paint. */
(function () {
    'use strict';
    let language = 'zh';
    try {
        if (localStorage.getItem('zaoyoe_language') === 'en') language = 'en';
    } catch (_) { /* Storage can be disabled; use the HTML's default language. */ }
    document.documentElement.lang = language;

    // BEGIN GENERATED FIRST-PAINT STRINGS
    const strings = {"common.clickToJoin":"Click to join","common.retry":"Retry","footer.about.tgGroup":"TG Group","footer.about.title":"About","footer.bottom.copyright":"© Zaoyoe Studio 2026. All rights reserved.","footer.bottom.privacy":"Privacy Policy","footer.bottom.support":"Support Us","footer.brand.name":"Zaoyoe Studio","footer.brand.tagline":"AI-Powered Creative Resource Platform","footer.products.gongyi":"Father Key","footer.products.guestbook":"Guestbook","footer.products.prompts":"Prompt Gallery","footer.products.shop":"Resource Store","footer.products.title":"Products","footer.products.verify":"Gemini Pro","footer.resources.privacy":"Privacy Policy","footer.resources.sponsor":"Sponsor Us","footer.resources.title":"Resources","gallery.addComment":"Add a comment...","gallery.attachImage":"Attach image","gallery.featured":"✦ FEATURED","gallery.imagePrompt":"Image prompt","gallery.joinGroup":"Chat Group","gallery.mediaFilter":"Prompt media type","gallery.mediaImage":"Images","gallery.mediaVideo":"Videos","gallery.newest":"Newest","gallery.oldest":"Oldest","gallery.prompt":"Prompt","gallery.sameStyleSubtitle":"Style-matched prompts","gallery.sameStyleTitle":"Same style","gallery.searchPlaceholder":"Search prompts...","gallery.send":"Send","gallery.sortFilter":"Prompt order","gallery.sortHot":"Popular","gallery.sortRandom":"Random","gallery.supportUs":"Support us","gallery.top":"Top","gallery.videoPrompt":"Video prompt","gallery.viewAllComments":"View all comments","guestbook.leaveFirstMessage":"Leave the first message here!","guestbook.newUpdates":"New updates","guestbook.noMessages":"No messages yet","guestbook.placeholder":"Write your thoughts...","guestbook.submit":"Send","guestbook.title":"Guestbook","guestbook.viewMore":"View More","home.entries.gongyi":"Father Key","home.entries.guestbook":"Guestbook","home.entries.prompts":"Prompts","home.entries.shop":"Shop","home.entries.verify":"Gemini Pro","home.gongyi.subtitle":"Subscription to API conversion platform","home.gongyi.title":"Father Key","home.guestbook.subtitle":"Community Voice","home.guestbook.title":"Guestbook","home.prompts.subtitle":"Make creation more efficient, inspiration more free","home.prompts.title":"Prompts","home.shop.subtitle":"Quality resources for growth","home.shop.title":"Resource Store","home.verify.subtitle":"Submit account jobs and unlock access automatically","home.verify.title":"Gemini Pro","nav.gongyi":"Father Key","nav.guestbook":"Guestbook","nav.prompts":"Prompts","nav.shop":"Shop","nav.support":"Support","nav.tgGroup":"TG Group","nav.verify":"Gemini Pro","seo.guestbook.description":"Read community updates, post messages, and join the conversation on Zaoyoe.","seo.guestbook.h1":"Guestbook","seo.guestbook.title":"Guestbook - Zaoyoe","seo.index.description":"Zaoyoe Studio is an AI-powered creative resource platform for prompts, Gemini Pro, resource shopping, and API relay.","seo.index.h1":"Zaoyoe Studio - AI-powered creative resource platform","seo.index.keywords":"AI prompts, Prompt Gallery, Gemini Pro, resource store, Zaoyoe Studio","seo.index.title":"Zaoyoe Studio - Creativity, Efficiency, Endless Possibilities","seo.prompts.description":"Banana Pro Gallery curates high-quality AI prompts and visual inspiration with category filters and fast search.","seo.prompts.h1":"Banana Pro Gallery Prompt Library","seo.prompts.title":"Banana Pro Gallery | Zaoyoe","seo.shop.description":"Browse redeemable digital resources and creative tools with categories, stock status, and a simple purchase flow.","seo.shop.h1":"Resource Store","seo.shop.title":"Resource Store - Zaoyoe","seo.verify.description":"Submit Google account jobs and automatically unlock Google One access.","seo.verify.h1":"Google One","seo.verify.title":"Google One - Zaoyoe","shop.closePurchaseNotes":"Close","shop.discountCode":"Discount Code (Optional)","shop.enterDiscountCode":"Please enter discount code","shop.flashSaleDistanceEndsIn":"Ends in","shop.redeemSuccess":"Redeem Success!","shop.total":"Total","shop.unitPrice":"Unit Price","shop.verify":"Verify","verify.chatGroup":"Chat Group","verify.clickToJoin":"Click to join","verify.supportUs":"Support us"};
    // END GENERATED FIRST-PAINT STRINGS
    const selector = '[data-i18n], [data-i18n-placeholder], [data-i18n-title]';
    function translateElement(el) {
        const text = strings[el.getAttribute('data-i18n')];
        if (text !== undefined) {
            const attr = el.getAttribute('data-i18n-attr');
            if (attr) {
                if (el.getAttribute(attr) !== text) el.setAttribute(attr, text);
            } else if (el.textContent !== text) el.textContent = text;
        }
        for (const attr of ['placeholder', 'title']) {
            const value = strings[el.getAttribute('data-i18n-' + attr)];
            if (value !== undefined && el.getAttribute(attr) !== value) el.setAttribute(attr, value);
        }
    }
    function translate(node) {
        if (language !== 'en') return;
        const el = node.nodeType === 1 ? node : node.parentElement;
        if (!el) return;
        // Parser chunks may append text to an element translated in an earlier chunk.
        const owner = el.closest(selector);
        if (owner) translateElement(owner);
        el.querySelectorAll(selector).forEach(translateElement);
    }
    const observer = language === 'en' ? new MutationObserver(records => {
        for (const record of records) {
            translate(record.target);
            for (const node of record.addedNodes || []) translate(node);
        }
    }) : null;
    observer?.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.__i18nBoot = {
        language, strings: language === 'en' ? strings : {},
        translate,
        stop() { observer?.disconnect(); }
    };
    // Stop parser observation before interactive language changes can start.
    document.addEventListener('DOMContentLoaded', () => {
        translate(document.documentElement);
        observer?.disconnect();
    }, { once: true });
})();
