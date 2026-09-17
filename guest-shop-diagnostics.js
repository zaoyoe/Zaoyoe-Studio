// Guest Shop Performance Diagnostics Tool
// 使用方法：在浏览器 Console 中粘贴并运行此脚本
// 然后进行一次完整的购买流程（支付 → 等待发货）

(function() {
    'use strict';

    console.log('🔍 Guest Shop Performance Diagnostics Loaded');
    console.log('📊 Monitoring: Polling intervals, API latency, fulfillment time');
    console.log('');

    const diagnostics = {
        events: [],
        pollIntervals: [],
        apiCalls: [],
        startTime: null,
        paymentConfirmedAt: null,
        fulfilledAt: null
    };

    // Monitor polling intervals
    let lastPollTime = 0;
    const originalFetch = window.fetch;

    window.fetch = function(...args) {
        const url = args[0];
        const isStatusCall = typeof url === 'string' && url.includes('/api/shop/guest/status');

        if (isStatusCall) {
            const now = Date.now();

            if (lastPollTime > 0) {
                const interval = now - lastPollTime;
                diagnostics.pollIntervals.push({
                    time: now,
                    interval: interval,
                    relativeTime: diagnostics.startTime ? now - diagnostics.startTime : 0
                });

                const status = interval < 1000 ? '✅ 快速' :
                             interval < 2000 ? '⚠️  中等' : '❌ 缓慢';
                console.log(`⏱️  轮询间隔: ${interval}ms ${status} (${Math.round((now - diagnostics.startTime) / 1000)}s)`);
            }

            lastPollTime = now;

            // Track API call timing
            const callStart = now;
            return originalFetch.apply(this, args).then(response => {
                const callEnd = Date.now();
                const latency = callEnd - callStart;

                // Clone response to read it
                return response.clone().json().then(data => {
                    const paymentStatus = data?.order?.payment_status;
                    const fulfillmentStatus = data?.order?.fulfillment_status;

                    diagnostics.apiCalls.push({
                        time: callEnd,
                        latency: latency,
                        paymentStatus: paymentStatus,
                        fulfillmentStatus: fulfillmentStatus,
                        relativeTime: diagnostics.startTime ? callEnd - diagnostics.startTime : 0
                    });

                    console.log(`📡 API响应: ${latency}ms | 支付=${paymentStatus} | 发货=${fulfillmentStatus}`);

                    // Track payment confirmation
                    if (paymentStatus === 'confirmed' && !diagnostics.paymentConfirmedAt) {
                        diagnostics.paymentConfirmedAt = callEnd;
                        diagnostics.events.push({
                            type: 'payment_confirmed',
                            time: callEnd,
                            relativeTime: callEnd - diagnostics.startTime
                        });
                        console.log('');
                        console.log('💰 支付确认！开始监控发货速度...');
                        console.log('');
                    }

                    // Track fulfillment completion
                    if (fulfillmentStatus === 'delivered' && !diagnostics.fulfilledAt) {
                        diagnostics.fulfilledAt = callEnd;
                        diagnostics.events.push({
                            type: 'fulfilled',
                            time: callEnd,
                            relativeTime: callEnd - diagnostics.startTime
                        });
                        console.log('');
                        console.log('📦 发货完成！');
                        printReport();
                    }

                    return response;
                }).catch(() => response);
            });
        }

        return originalFetch.apply(this, args);
    };

    // Start tracking when payment begins
    diagnostics.startTime = Date.now();

    function printReport() {
        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('📊 Performance Diagnostic Report');
        console.log('═══════════════════════════════════════════════════');
        console.log('');

        if (!diagnostics.paymentConfirmedAt || !diagnostics.fulfilledAt) {
            console.log('⚠️  测试未完成，请完成完整的支付→发货流程');
            return;
        }

        const totalTime = diagnostics.fulfilledAt - diagnostics.paymentConfirmedAt;
        console.log(`⏱️  总耗时: ${(totalTime / 1000).toFixed(1)}秒 (支付确认 → 发货完成)`);
        console.log('');

        // Phase 1: Polling Analysis
        console.log('📡 Phase 1: 前端轮询分析');
        const pollsAfterPayment = diagnostics.pollIntervals.filter(p =>
            p.time >= diagnostics.paymentConfirmedAt && p.time <= diagnostics.fulfilledAt
        );

        if (pollsAfterPayment.length > 0) {
            const avgInterval = pollsAfterPayment.reduce((sum, p) => sum + p.interval, 0) / pollsAfterPayment.length;
            const minInterval = Math.min(...pollsAfterPayment.map(p => p.interval));
            const maxInterval = Math.max(...pollsAfterPayment.map(p => p.interval));

            console.log(`   轮询次数: ${pollsAfterPayment.length}`);
            console.log(`   平均间隔: ${avgInterval.toFixed(0)}ms`);
            console.log(`   最小间隔: ${minInterval}ms`);
            console.log(`   最大间隔: ${maxInterval}ms`);

            if (avgInterval < 1000) {
                console.log('   ✅ 智能轮询已生效（间隔 < 1秒）');
            } else if (avgInterval < 2000) {
                console.log('   ⚠️  轮询间隔中等（1-2秒）');
            } else {
                console.log('   ❌ 轮询间隔过慢（> 2秒），可能未启用智能轮询');
            }
        }
        console.log('');

        // Phase 2: Backend Query Analysis
        console.log('🔄 Phase 2: 后端查询分析');
        const apiCallsAfterPayment = diagnostics.apiCalls.filter(c =>
            c.time >= diagnostics.paymentConfirmedAt && c.time <= diagnostics.fulfilledAt
        );

        if (apiCallsAfterPayment.length > 0) {
            const avgLatency = apiCallsAfterPayment.reduce((sum, c) => sum + c.latency, 0) / apiCallsAfterPayment.length;
            const maxLatency = Math.max(...apiCallsAfterPayment.map(c => c.latency));

            console.log(`   API调用次数: ${apiCallsAfterPayment.length}`);
            console.log(`   平均延迟: ${avgLatency.toFixed(0)}ms`);
            console.log(`   最大延迟: ${maxLatency}ms`);

            if (maxLatency > 3000) {
                console.log('   ⚠️  存在慢查询，可能触发了节流或数据库延迟');
            } else {
                console.log('   ✅ API响应速度正常');
            }
        }
        console.log('');

        // Phase 3: Worker Fulfillment Analysis
        console.log('🚀 Phase 3: Worker 发货分析');
        const firstPollAfterPayment = diagnostics.apiCalls.find(c =>
            c.time >= diagnostics.paymentConfirmedAt && c.paymentStatus === 'confirmed'
        );

        if (firstPollAfterPayment) {
            const detectionDelay = firstPollAfterPayment.time - diagnostics.paymentConfirmedAt;
            console.log(`   支付检测延迟: ${detectionDelay}ms`);

            const workerTime = diagnostics.fulfilledAt - firstPollAfterPayment.time;
            console.log(`   Worker处理时间: ${(workerTime / 1000).toFixed(1)}秒`);

            if (workerTime > 8000) {
                console.log('   ❌ Worker处理过慢（> 8秒）');
                console.log('   可能原因:');
                console.log('      - Worker未立即触发');
                console.log('      - 仍在等待回退延迟');
                console.log('      - 数据库/RPC性能问题');
            } else if (workerTime > 5000) {
                console.log('   ⚠️  Worker处理中等（5-8秒）');
            } else {
                console.log('   ✅ Worker处理快速（< 5秒）');
            }
        }
        console.log('');

        // Timeline breakdown
        console.log('📅 详细时间线:');
        console.log(`   T+0.0s   支付确认`);

        if (pollsAfterPayment.length > 0) {
            const firstPoll = pollsAfterPayment[0];
            console.log(`   T+${((firstPoll.time - diagnostics.paymentConfirmedAt) / 1000).toFixed(1)}s   首次轮询`);
        }

        if (firstPollAfterPayment) {
            console.log(`   T+${((firstPollAfterPayment.time - diagnostics.paymentConfirmedAt) / 1000).toFixed(1)}s   后端确认`);
        }

        console.log(`   T+${(totalTime / 1000).toFixed(1)}s   发货完成 ✅`);
        console.log('');

        // Recommendations
        console.log('💡 优化建议:');
        const avgInterval = pollsAfterPayment.length > 0
            ? pollsAfterPayment.reduce((sum, p) => sum + p.interval, 0) / pollsAfterPayment.length
            : 0;

        if (avgInterval > 1500) {
            console.log('   1. 强制刷新浏览器 (Cmd+Shift+R) 清除JS缓存');
        }

        if (firstPollAfterPayment && (diagnostics.fulfilledAt - firstPollAfterPayment.time) > 8000) {
            console.log('   2. 检查服务器日志确认Worker是否立即触发');
            console.log('   3. 验证环境变量 GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED');
        }

        if (totalTime < 5000) {
            console.log('   ✨ 性能优秀！所有优化已生效');
        } else if (totalTime < 10000) {
            console.log('   ✅ 性能良好！大部分优化已生效');
        } else {
            console.log('   ⚠️  仍有优化空间');
        }

        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('');

        // Export raw data for further analysis
        console.log('📋 原始数据（可复制用于进一步分析）:');
        console.log(JSON.stringify({
            totalTime: totalTime,
            pollIntervals: pollsAfterPayment,
            apiCalls: apiCallsAfterPayment
        }, null, 2));
    }

    // Manual report trigger
    window.guestShopDiagnostics = {
        printReport: printReport,
        data: diagnostics,
        reset: function() {
            diagnostics.events = [];
            diagnostics.pollIntervals = [];
            diagnostics.apiCalls = [];
            diagnostics.startTime = Date.now();
            diagnostics.paymentConfirmedAt = null;
            diagnostics.fulfilledAt = null;
            lastPollTime = 0;
            console.log('🔄 诊断数据已重置');
        }
    };

    console.log('✅ 诊断工具已启动！');
    console.log('💡 提示: 现在进行一次完整的购买测试，完成后会自动显示报告');
    console.log('📝 手动查看报告: window.guestShopDiagnostics.printReport()');
    console.log('🔄 重置数据: window.guestShopDiagnostics.reset()');
    console.log('');
})();
