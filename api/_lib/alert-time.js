const EXTERNAL_ALERT_TIMEZONE = 'Asia/Shanghai';
const EXTERNAL_ALERT_TIMEZONE_LABEL = '北京时间';
const EXTERNAL_ALERT_TIMESTAMP_IN_TEXT_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})\b/g;
const EXTERNAL_ALERT_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: EXTERNAL_ALERT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
});

function normalizeText(value) {
    return String(value || '').trim();
}

function formatAlertTimestamp(value) {
    const normalized = normalizeText(value);
    if (!normalized) return '';

    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed)) {
        return normalized;
    }

    const parts = Object.create(null);
    for (const part of EXTERNAL_ALERT_TIMESTAMP_FORMATTER.formatToParts(new Date(parsed))) {
        if (part.type !== 'literal') {
            parts[part.type] = part.value;
        }
    }

    if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute || !parts.second) {
        return normalized;
    }

    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${EXTERNAL_ALERT_TIMEZONE_LABEL}`;
}

function formatAlertTimestampsInsideText(value) {
    const normalized = normalizeText(value);
    if (!normalized) return '';

    return normalized.replace(EXTERNAL_ALERT_TIMESTAMP_IN_TEXT_PATTERN, (matched) => formatAlertTimestamp(matched) || matched);
}

module.exports = {
    formatAlertTimestamp,
    formatAlertTimestampsInsideText
};
