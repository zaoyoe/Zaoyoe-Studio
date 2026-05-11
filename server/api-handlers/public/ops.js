const {
    createRecoveryReadinessSweepHandler
} = require('./ops-recovery-readiness-sweep');
const {
    createExternalMonitoringSmokeHandler
} = require('./ops-external-monitoring-smoke');

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
        })
    };
}

module.exports = {
    createOpsHandlers
};
