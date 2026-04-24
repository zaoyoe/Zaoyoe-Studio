(function initAdminConfigOpsAlertReports(globalScope) {
    'use strict';

    function notifyOpsAlertReportFeedback(message = '', tone = 'info', feedbackState = 'ready', deps = {}) {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) {
            return null;
        }

        if (typeof deps.showToast === 'function') {
            deps.showToast(normalizedMessage, tone);
        }

        if (typeof deps.emitAdminConfigCommandFeedback === 'function') {
            deps.emitAdminConfigCommandFeedback(normalizedMessage, feedbackState, {
                source: 'ops-alerts-report',
                module: 'ops-alerts',
                tone
            });
        }

        return normalizedMessage;
    }

    async function writeAdminConfigClipboard(text) {
        const normalizedText = String(text || '');
        if (!normalizedText) {
            throw new Error('没有可复制的内容');
        }

        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(normalizedText);
            return true;
        }

        const textarea = document.createElement('textarea');
        textarea.value = normalizedText;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, normalizedText.length);

        try {
            const succeeded = document.execCommand('copy');
            if (!succeeded) {
                throw new Error('浏览器不支持复制到剪贴板');
            }
            return true;
        } finally {
            document.body.removeChild(textarea);
        }
    }

    function escapeCsvCell(value) {
        const normalized = value == null
            ? ''
            : (typeof value === 'string'
                ? value
                : JSON.stringify(value));
        return `"${String(normalized).replace(/"/g, '""')}"`;
    }

    function convertRowsToCsv(rows) {
        if (!Array.isArray(rows) || rows.length === 0) {
            return '';
        }

        const headers = [...rows.reduce((keys, row) => {
            Object.keys(row || {}).forEach((key) => keys.add(key));
            return keys;
        }, new Set())];

        const lines = [
            headers.join(','),
            ...rows.map((row) => headers.map((key) => escapeCsvCell(row?.[key])).join(','))
        ];

        return lines.join('\n');
    }

    function downloadExportBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function buildLocalOpsAlertMonitorChecklistText(rows = [], filters = {}, categoryKey = '', deps = {}) {
        const normalizedCategoryKey = String(categoryKey || '').trim().toLowerCase();
        const categoryLabelMap = {
            payments: '支付与退款',
            tickets: '工单与售后',
            inventory: '库存与补货',
            fulfillment: '履约与死信',
            shop_risk: '商城风控'
        };
        const lines = [
            '第一阶段集中告警处理清单',
            `生成时间：${deps.formatVerifyMonitorDateTime(new Date().toISOString())}`,
            `当前筛选：${deps.getOpsAlertMonitorFilterSummaryLabel(filters)}`
        ];

        if (normalizedCategoryKey && categoryLabelMap[normalizedCategoryKey]) {
            lines.push(`当前模块：${categoryLabelMap[normalizedCategoryKey]}`);
        }

        lines.push(`命中记录：${deps.formatVerifyMonitorInteger(rows.length)} 条`, '');

        rows.forEach((row, index) => {
            lines.push(`${index + 1}. [${row.模块}] ${row.标题}`);
            lines.push(`   状态：${row.状态} · 级别：${row.级别 || 'warning'} · 类型：${row.告警类型 || 'unknown'}`);
            if (row.引用标签 && row.引用值) {
                lines.push(`   ${row.引用标签}：${row.引用值}`);
            }
            if (row.摘要) {
                lines.push(`   摘要：${row.摘要}`);
            }
            if (row.处理入口 || row.处理动作) {
                lines.push(`   处理入口：${row.处理入口 || '—'}${row.处理动作 ? ` · ${row.处理动作}` : ''}`);
            }
            if (row.创建时间) {
                lines.push(`   时间：${deps.formatVerifyMonitorDateTime(row.创建时间)}`);
            }
            lines.push('');
        });

        return lines.join('\n').trim();
    }

    function resolveOpsAlertMonitorChecklistText(rows = [], filters = {}, categoryKey = '', deps = {}) {
        return deps.resolveOpsAlertSharedCallable(
            'buildAdminWorkbenchOpsAlertMonitorChecklistText',
            (resolvedRows = [], resolvedFilters = {}, resolvedCategoryKey = '') => buildLocalOpsAlertMonitorChecklistText(
                resolvedRows,
                resolvedFilters,
                resolvedCategoryKey,
                deps
            ),
            () => ({
                now: new Date().toISOString(),
                formatDateTime: deps.formatVerifyMonitorDateTime,
                formatCount: deps.formatVerifyMonitorInteger,
                getFilterSummaryLabel: deps.getOpsAlertMonitorFilterSummaryLabel
            })
        )(rows, filters, categoryKey);
    }

    function buildOpsAlertMonitorChecklistText(rows = [], filters = {}, categoryKey = '', deps = {}) {
        return resolveOpsAlertMonitorChecklistText(rows, filters, categoryKey, deps);
    }

    function buildLocalOpsAlertMonitorShiftReportSummaryText(report = {}, currentAdminLabel = '', deps = {}) {
        const normalizedReport = deps.normalizeOpsAlertMonitorShiftReport(report);
        const shiftRuntimeState = deps.buildOpsAlertMonitorShiftSharedRuntimeState(currentAdminLabel, {
            includeGeneratedAt: true
        });
        const lines = [
            '第一阶段集中告警交班摘要',
            `生成时间：${deps.formatVerifyMonitorDateTime(shiftRuntimeState.generatedAt)}`,
            `交班视角：${deps.getOpsAlertMonitorShiftResolvedViewLabel(shiftRuntimeState.currentView)}`,
            `班次时长：${deps.formatVerifyMonitorInteger(Math.max(1, Number(normalizedReport.shift_hours || 0)))} 小时`
        ];
        if (shiftRuntimeState.currentAdminLabel) {
            lines.push(`当前值班：${shiftRuntimeState.currentAdminLabel}`);
        }
        if (normalizedReport.window_start || normalizedReport.window_end) {
            lines.push(`班次区间：${deps.formatVerifyMonitorDateTime(normalizedReport.window_start)} 至 ${deps.formatVerifyMonitorDateTime(normalizedReport.window_end)}`);
        }
        return lines.join('\n');
    }

    function resolveOpsAlertMonitorShiftReportSummaryText(report = {}, currentAdminLabel = '', deps = {}) {
        return deps.resolveOpsAlertMonitorShiftRuntimeSharedBuilder(
            'buildAdminWorkbenchOpsAlertMonitorShiftReportSummaryText',
            (resolvedReport = {}, resolvedAdminLabel = '') => buildLocalOpsAlertMonitorShiftReportSummaryText(
                resolvedReport,
                resolvedAdminLabel,
                deps
            ),
            () => ({
                formatDateTime: deps.formatVerifyMonitorDateTime,
                formatCount: deps.formatVerifyMonitorInteger,
                formatMinutes: deps.formatVerifyMonitorMinutes,
                formatSignedCount: deps.formatOpsAlertMonitorSignedCount,
                formatTimeShort: deps.formatOpsAlertMonitorTimeShort
            }),
            (resolvedReport = {}, resolvedAdminLabel = '') => deps.buildOpsAlertMonitorShiftSharedRuntimeState(resolvedAdminLabel, {
                includeGeneratedAt: true
            })
        )(report, currentAdminLabel);
    }

    function buildOpsAlertMonitorShiftReportSummaryText(report = {}, currentAdminLabel = '', deps = {}) {
        return resolveOpsAlertMonitorShiftReportSummaryText(report, currentAdminLabel, deps);
    }

    function buildLocalOpsAlertMonitorShiftReportCsvRows(report = {}, currentAdminLabel = '', deps = {}) {
        const normalizedReport = deps.normalizeOpsAlertMonitorShiftReport(report);
        const shiftRuntimeState = deps.buildOpsAlertMonitorShiftSharedRuntimeState(currentAdminLabel);
        return [{
            section: 'summary',
            item: '班次概览',
            current_admin: shiftRuntimeState.currentAdminLabel || '',
            view_mode: deps.normalizeOpsAlertMonitorShiftReportView(shiftRuntimeState.currentView),
            view_label: deps.getOpsAlertMonitorShiftResolvedViewLabel(shiftRuntimeState.currentView),
            shift_hours: Math.max(1, Number(normalizedReport.shift_hours || 0)),
            bucket_hours: Math.max(1, Number(normalizedReport.bucket_hours || 0)),
            window_start: normalizedReport.window_start || '',
            window_end: normalizedReport.window_end || ''
        }];
    }

    function resolveOpsAlertMonitorShiftReportCsvRows(report = {}, currentAdminLabel = '', deps = {}) {
        return deps.resolveOpsAlertMonitorShiftRuntimeSharedBuilder(
            'buildAdminWorkbenchOpsAlertMonitorShiftReportCsvRows',
            (resolvedReport = {}, resolvedAdminLabel = '') => buildLocalOpsAlertMonitorShiftReportCsvRows(
                resolvedReport,
                resolvedAdminLabel,
                deps
            ),
            () => ({
                formatTimeShort: deps.formatOpsAlertMonitorTimeShort
            }),
            (resolvedReport = {}, resolvedAdminLabel = '') => deps.buildOpsAlertMonitorShiftSharedRuntimeState(resolvedAdminLabel)
        )(report, currentAdminLabel);
    }

    function buildOpsAlertMonitorShiftReportCsvRows(report = {}, currentAdminLabel = '', deps = {}) {
        return resolveOpsAlertMonitorShiftReportCsvRows(report, currentAdminLabel, deps);
    }

    function buildLocalOpsAlertMonitorShiftExportState(report = {}, currentAdminLabel = '', deps = {}) {
        const normalizedReport = deps.normalizeOpsAlertMonitorShiftReport(report);
        const currentView = deps.normalizeOpsAlertMonitorShiftReportView(deps.getOpsAlertMonitorShiftReportViewState());
        const currentViewLabel = deps.getOpsAlertMonitorShiftResolvedViewLabel(currentView);
        return {
            currentView,
            currentViewLabel,
            summaryText: buildOpsAlertMonitorShiftReportSummaryText(normalizedReport, currentAdminLabel, deps),
            csvRows: buildOpsAlertMonitorShiftReportCsvRows(normalizedReport, currentAdminLabel, deps)
        };
    }

    function resolveOpsAlertMonitorShiftExportState(report = {}, currentAdminLabel = '', deps = {}) {
        return buildLocalOpsAlertMonitorShiftExportState(report, currentAdminLabel, deps);
    }

    async function copyOpsAlertMonitorChecklist(categoryKey = '', deps = {}) {
        const filters = deps.getOpsAlertMonitorViewFilters();
        const categories = deps.getOpsAlertMonitorPreparedCategories(filters);
        const rows = deps.buildOpsAlertMonitorBatchRows(categories, filters, categoryKey);
        if (!rows.length) {
            notifyOpsAlertReportFeedback('当前筛选条件下没有可复制的告警清单', 'info', 'ready', deps);
            return false;
        }

        try {
            const text = buildOpsAlertMonitorChecklistText(rows, filters, categoryKey, deps);
            await writeAdminConfigClipboard(text);
            notifyOpsAlertReportFeedback(`已复制 ${rows.length} 条集中告警清单`, 'success', 'saved', deps);
            return true;
        } catch (error) {
            console.error('[Config] Copy ops alert checklist failed:', error);
            notifyOpsAlertReportFeedback('复制失败，请稍后重试', 'error', 'failed', deps);
            return false;
        }
    }

    async function copyOpsAlertMonitorShiftReportSummary(deps = {}) {
        const state = deps.getOpsAlertMonitorState();
        if (state.status !== 'ready') {
            notifyOpsAlertReportFeedback('交班报表仍在加载，请稍后再试', 'info', 'loading', deps);
            return false;
        }

        try {
            const exportState = resolveOpsAlertMonitorShiftExportState(state.summary?.shift_report, state.current_admin_label || '', deps);
            await writeAdminConfigClipboard(exportState.summaryText);
            notifyOpsAlertReportFeedback(`已复制${exportState.currentViewLabel}交班摘要`, 'success', 'saved', deps);
            return true;
        } catch (error) {
            console.error('[Config] Copy ops alert shift report failed:', error);
            notifyOpsAlertReportFeedback('复制交班摘要失败，请稍后重试', 'error', 'failed', deps);
            return false;
        }
    }

    function exportOpsAlertMonitorCsv(categoryKey = '', deps = {}) {
        const filters = deps.getOpsAlertMonitorViewFilters();
        const categories = deps.getOpsAlertMonitorPreparedCategories(filters);
        const rows = deps.buildOpsAlertMonitorBatchRows(categories, filters, categoryKey);
        if (!rows.length) {
            notifyOpsAlertReportFeedback('当前筛选条件下没有可导出的集中告警', 'info', 'ready', deps);
            return false;
        }

        const timestamp = new Date().toISOString().slice(0, 10);
        const suffix = String(categoryKey || '').trim().toLowerCase() || 'all';
        const csv = convertRowsToCsv(rows);
        downloadExportBlob(
            new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }),
            `ops_alert_monitor_${suffix}_${timestamp}.csv`
        );
        notifyOpsAlertReportFeedback(`已导出 ${rows.length} 条集中告警清单`, 'success', 'saved', deps);
        return true;
    }

    function exportOpsAlertMonitorShiftReportCsv(deps = {}) {
        const state = deps.getOpsAlertMonitorState();
        if (state.status !== 'ready') {
            notifyOpsAlertReportFeedback('交班报表仍在加载，请稍后再试', 'info', 'loading', deps);
            return false;
        }

        const exportState = resolveOpsAlertMonitorShiftExportState(state.summary?.shift_report, state.current_admin_label || '', deps);
        const rows = exportState.csvRows;
        if (!rows.length) {
            notifyOpsAlertReportFeedback('当前没有可导出的交班报表', 'info', 'ready', deps);
            return false;
        }

        const timestamp = new Date().toISOString().slice(0, 10);
        const viewKey = exportState.currentView;
        const csv = convertRowsToCsv(rows);
        downloadExportBlob(
            new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }),
            `ops_alert_shift_report_${viewKey}_${timestamp}.csv`
        );
        notifyOpsAlertReportFeedback(`已导出${exportState.currentViewLabel}交班报表`, 'success', 'saved', deps);
        return true;
    }

    globalScope.AdminConfigOpsAlertReports = Object.freeze({
        writeAdminConfigClipboard,
        buildOpsAlertMonitorChecklistText,
        buildOpsAlertMonitorShiftReportSummaryText,
        buildOpsAlertMonitorShiftReportCsvRows,
        resolveOpsAlertMonitorShiftExportState,
        copyOpsAlertMonitorChecklist,
        copyOpsAlertMonitorShiftReportSummary,
        exportOpsAlertMonitorCsv,
        exportOpsAlertMonitorShiftReportCsv
    });
})(typeof window !== 'undefined' ? window : globalThis);
