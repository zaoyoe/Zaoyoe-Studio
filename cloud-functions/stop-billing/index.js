/**
 * Cloud Function: 预算超限自动停止计费
 * Budget Auto-Stop Function
 * 
 * 当预算通知触发时，自动禁用项目计费，防止超支
 */

const { CloudBillingClient } = require('@google-cloud/billing');

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const PROJECT_NAME = `projects/${PROJECT_ID}`;

const billing = new CloudBillingClient();

/**
 * 禁用项目计费
 */
async function disableBilling(projectName) {
    try {
        const [billingInfo] = await billing.updateProjectBillingInfo({
            name: projectName,
            projectBillingInfo: {
                billingAccountName: '', // 设为空 = 禁用计费
            },
        });
        console.log(`✅ 已禁用项目计费: ${projectName}`);
        return billingInfo;
    } catch (error) {
        console.error(`❌ 禁用计费失败: ${error.message}`);
        throw error;
    }
}

/**
 * Cloud Function 入口
 * 由 Pub/Sub 预算通知触发
 */
exports.stopBillingOnBudgetExceeded = async (pubsubEvent, context) => {
    // 解析预算通知数据
    const pubsubData = JSON.parse(
        Buffer.from(pubsubEvent.data, 'base64').toString()
    );

    console.log('📧 收到预算通知:', JSON.stringify(pubsubData));

    // 检查是否超过预算阈值
    const costAmount = pubsubData.costAmount;
    const budgetAmount = pubsubData.budgetAmount;
    const percentUsed = (costAmount / budgetAmount) * 100;

    console.log(`💰 当前花费: $${costAmount} / $${budgetAmount} (${percentUsed.toFixed(1)}%)`);

    // 如果超过 100%，禁用计费
    if (costAmount >= budgetAmount) {
        console.log('⚠️ 预算超限！正在禁用计费...');
        await disableBilling(PROJECT_NAME);
        return '已禁用计费';
    }

    return '预算正常';
};
