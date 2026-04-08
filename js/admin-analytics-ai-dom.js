// Shared analytics AI DOM and binding helpers.

const ANALYTICS_AI_INSIGHT_BUTTON_ID = 'generateInsightBtn';
const ANALYTICS_AI_INSIGHT_CONTENT_ID = 'aiInsightContent';
const ANALYTICS_AI_PREDICTION_CONTENT_ID = 'aiPredictionContent';
const ANALYTICS_AI_BINDING_FLAG = 'analyticsAiBound';

function getAnalyticsAIInsightElements() {
    return {
        button: document.getElementById(ANALYTICS_AI_INSIGHT_BUTTON_ID),
        content: document.getElementById(ANALYTICS_AI_INSIGHT_CONTENT_ID)
    };
}

function getAnalyticsAIPredictionContainer() {
    return document.getElementById(ANALYTICS_AI_PREDICTION_CONTENT_ID);
}

function bindAnalyticsAIWorkspaceEvents() {
    const { button } = getAnalyticsAIInsightElements();
    if (!button || button.dataset[ANALYTICS_AI_BINDING_FLAG] === '1') {
        return false;
    }

    button.addEventListener('click', generateAIInsight);
    button.dataset[ANALYTICS_AI_BINDING_FLAG] = '1';
    return true;
}

window.AdminAnalyticsAIDom = Object.assign({}, window.AdminAnalyticsAIDom || {}, {
    getAnalyticsAIInsightElements,
    getAnalyticsAIPredictionContainer,
    bindAnalyticsAIWorkspaceEvents
});
