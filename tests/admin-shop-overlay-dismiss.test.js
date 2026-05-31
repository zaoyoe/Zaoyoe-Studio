const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('shop modal backdrop dismiss only fires for pointer gestures that start and end on the backdrop', () => {
    const bootstrapSource = readRepoFile(path.join('js', 'admin-studio-bootstrap.js'));
    const shopSource = readRepoFile(path.join('js', 'admin-shop.js'));
    const adminStudioHtml = readRepoFile('admin-studio.html');

    assert.equal(
        bootstrapSource.includes('window.AdminOverlayDismissGuard = Object.freeze(adminOverlayDismissGuard);'),
        true,
        'admin bootstrap should expose the shared overlay dismiss guard before feature modules load'
    );
    assert.equal(
        bootstrapSource.includes("document.addEventListener('pointerdown'"),
        true,
        'admin bootstrap should record where overlay pointer gestures start'
    );
    assert.equal(
        bootstrapSource.includes("document.addEventListener('pointerup'"),
        true,
        'admin bootstrap should record where overlay pointer gestures end'
    );
    assert.match(
        bootstrapSource,
        /const startedOnBackdrop = overlay\.dataset\.overlayDismissPointerDownBackdrop === '1';[\s\S]*const endedOnBackdrop = overlay\.dataset\.overlayDismissPointerUpBackdrop === '1';[\s\S]*return startedOnBackdrop && endedOnBackdrop;/,
        'admin overlays should not close when text selection starts inside a modal and releases on the backdrop'
    );
    assert.equal(
        shopSource.includes('window.AdminOverlayDismissGuard?.bind?.(overlay);'),
        true,
        'shop overlays should bind the shared dismiss guard'
    );
    assert.equal(
        shopSource.includes('window.AdminOverlayDismissGuard?.shouldDismiss?.(overlay, event) === true'),
        true,
        'shop overlays should use the shared guarded backdrop-click decision'
    );
    assert.equal(
        shopSource.includes('if (event.target === overlay) {\n                onDismiss?.();'),
        false,
        'shop overlays should no longer close from a raw click target check alone'
    );
    assert.equal(
        adminStudioHtml.includes('shopOverlayDismiss=20260531_SHOP_MODAL_BACKDROP_POINTER_GUARD_1'),
        true,
        'admin studio should cache-bust the guarded shop overlay dismiss runtime'
    );
});

test('admin studio sibling modal systems reuse the guarded backdrop dismiss path', () => {
    const adminStudioHtml = readRepoFile('admin-studio.html');
    const adminStudioSource = readRepoFile('admin-studio.js');
    const pointsSource = readRepoFile('admin-points.js');
    const discountsSource = readRepoFile('admin-discounts.js');
    const usersSource = readRepoFile('admin-users.js');

    assert.equal(
        adminStudioSource.includes('window.AdminOverlayDismissGuard?.shouldDismiss?.(overlay, event)'),
        true,
        'admin-studio delegated overlay close should require the guarded backdrop click'
    );
    assert.equal(
        discountsSource.includes('window.AdminOverlayDismissGuard?.shouldDismiss?.(modal, event)'),
        true,
        'discount generate modal should use the guarded backdrop click'
    );

    for (const marker of [
        'closeDeleteOptionsModal(event);',
        'closeCodesModal(event);',
        'closeBatchEditModal(event);',
        'closePointsPackageDeleteModal(event);',
        'closePointsCodeActionModal(event);',
        'closePointsBatchInvalidateModal(event);'
    ]) {
        assert.equal(pointsSource.includes(marker), true, `admin-points.js should route ${marker} through the guarded event`);
    }

    assert.equal(
        pointsSource.includes('window.AdminOverlayDismissGuard?.shouldDismiss?.(overlay, event)'),
        true,
        'points modals should use the shared guarded backdrop decision'
    );
    assert.equal(
        usersSource.includes('function shouldDismissUsersOverlay(overlay, event)'),
        true,
        'users modals should centralize guarded backdrop decisions'
    );
    assert.equal(
        usersSource.includes('if (event.target === overlay)'),
        false,
        'users overlays should not close from a raw overlay target check'
    );

    for (const marker of [
        'overlayDismissGuard=20260531_ADMIN_OVERLAY_DISMISS_POINTER_GUARD_1',
        'shopOverlayDismiss=20260531_SHOP_MODAL_BACKDROP_POINTER_GUARD_1'
    ]) {
        assert.equal(adminStudioHtml.includes(marker), true, `admin-studio.html should include ${marker}`);
    }
});
