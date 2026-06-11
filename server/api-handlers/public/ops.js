const {
    createRecoveryReadinessSweepHandler
} = require('./ops-recovery-readiness-sweep');
const {
    createExternalMonitoringSmokeHandler
} = require('./ops-external-monitoring-smoke');
const {
    createWatchdogAlertHandler
} = require('./ops-watchdog-alert');

function createOpsHandlers({
    admin,
    env = process.env
} = {}) {
    return {
        'recovery-readiness-sweep': createRecoveryReadinessSweepHandler({
            admin,
            env
        }),
        'external-monitoring-smoke': createExternalMonitoringSmokeHandler({
            env
        }),
        'watchdog-alert': createWatchdogAlertHandler({
            admin,
            env
        })
    };
}

module.exports = {
    createOpsHandlers
};
