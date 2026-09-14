'use strict';

// This endpoint is for a trusted cron/worker only.  It never accepts an order
// id or inventory payload from the caller; the worker scans durable rows in
// Supabase and the database RPCs remain the only authority for stock state.
const admin = require('../../_lib/admin');
const { createGuestShopPaymentAdapter } = require('../../_lib/payments/guest-shop-adapter');
const {
    createGuestShopWorkerHandler
} = require('../../../server/guest-shop-worker');

const paymentAdapter = createGuestShopPaymentAdapter({
    supabase: admin.getOptionalSupabaseAdmin?.() || null,
    env: process.env
});

module.exports = createGuestShopWorkerHandler({
    admin,
    paymentAdapter,
    env: process.env
});

// No request body is required.  Disabling the platform parser avoids an
// unbounded body allocation on a public-facing route.
module.exports.config = { api: { bodyParser: false } };
