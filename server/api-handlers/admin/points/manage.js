const crypto = require('node:crypto');
const {
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    deductPointsForService
} = require('../../../../api/_lib/payments/rpc');

const BATCH_SELECT_FIELDS = [
    'id',
    'name',
    'site',
    'package_id',
    'channel',
    'total_count',
    'used_count',
    'expires_at',
    'notes',
    'custom_points_amount',
    'created_at'
].join(', ');

const CODE_SELECT_FIELDS = [
    'id',
    'code',
    'site',
    'batch_id',
    'package_id',
    'points_amount',
    'points_granted',
    'status',
    'expires_at',
    'used_by',
    'used_at',
    'revoked_by',
    'revoked_at',
    'revoke_reason'
].join(', ');

const PACKAGE_GENERATE_SELECT_FIELDS = [
    'id',
    'name',
    'points_amount',
    'bonus_points'
].join(', ');

function normalizeString(value, fallback = '') {
    return String(value ?? fallback).trim();
}

function normalizeStringArray(value) {
    const items = Array.isArray(value)
        ? value
        : (typeof value === 'string' && value.trim() ? value.split(',') : []);

    return [...new Set(
        items
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    )];
}

function normalizePositiveInteger(value, fieldName, { max = 1000 } = {}) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        const error = new Error(`${fieldName} must be a positive integer`);
        error.statusCode = 400;
        throw error;
    }

    if (parsed > max) {
        const error = new Error(`${fieldName} must be <= ${max}`);
        error.statusCode = 400;
        throw error;
    }

    return parsed;
}

function normalizeOptionalTimestamp(value, fieldName) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;

    const parsed = new Date(String(value).trim());
    if (Number.isNaN(parsed.getTime())) {
        const error = new Error(`${fieldName} must be a valid datetime`);
        error.statusCode = 400;
        throw error;
    }

    return parsed.toISOString();
}

function normalizeDeleteMode(value) {
    const mode = String(value || 'keep').trim().toLowerCase();
    if (mode === 'keep' || mode === 'block' || mode === 'revoke') {
        return mode;
    }

    const error = new Error('delete_mode must be keep, block, or revoke');
    error.statusCode = 400;
    throw error;
}

function getPointsRequestRpcClient({ requestSupabase, supabase, token = '' } = {}) {
    if (String(token || '').trim() && requestSupabase?.rpc) {
        return requestSupabase;
    }

    return supabase;
}

function shouldFallbackToServiceMutation(error) {
    const message = String(error?.message || '').trim().toLowerCase();
    return message.includes('unauthorized')
        || message.includes('admin only')
        || message.includes('access denied');
}

async function revokePointsCodeViaRpc({
    requestSupabase,
    supabase,
    token = '',
    code = '',
    reason = ''
} = {}) {
    const rpcClient = getPointsRequestRpcClient({ requestSupabase, supabase, token });
    const { data, error } = await rpcClient.rpc('fn_revoke_code', {
        p_code: code,
        p_reason: reason
    });

    if (error) throw error;
    if (data?.success === false) {
        const revokeError = new Error(data?.message || `Failed to revoke code ${code}`);
        revokeError.statusCode = 400;
        throw revokeError;
    }

    return data || { success: true };
}

function shouldFallbackToServiceRevoke(error) {
    return shouldFallbackToServiceMutation(error);
}

function shouldFallbackToServiceGenerate(error) {
    return shouldFallbackToServiceMutation(error);
}

function buildGeneratedRedemptionCode() {
    const raw = crypto.randomBytes(6).toString('hex').toUpperCase();
    return `ZY-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function isUniqueViolation(error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '').trim().toLowerCase();
    return code === '23505'
        || message.includes('duplicate key')
        || (message.includes('unique') && message.includes('code'));
}

async function revokePointsCodeViaService({
    supabase,
    adminId,
    site,
    code = '',
    reason = '',
    existing = null
} = {}) {
    const codeRow = existing || await loadCodeByValue(supabase, site, code);
    const currentStatus = normalizeString(codeRow?.status).toLowerCase();

    if (currentStatus === 'revoked') {
        const error = new Error('这条兑换码已经撤销，无需重复处理');
        error.statusCode = 400;
        throw error;
    }

    if (currentStatus !== 'used') {
        const error = new Error('只有已使用的兑换码才能撤销');
        error.statusCode = 400;
        throw error;
    }

    const targetUserId = normalizeString(codeRow?.used_by);
    if (!targetUserId) {
        const error = new Error('这条兑换码缺少使用人信息，暂时无法撤销');
        error.statusCode = 400;
        throw error;
    }

    const pointsToDeduct = Math.max(0, Number(codeRow?.points_granted) || Number(codeRow?.points_amount) || 0);
    let pointsDeducted = 0;

    if (pointsToDeduct > 0) {
        const { data, error } = await deductPointsForService({
            supabase,
            userId: targetUserId,
            amount: pointsToDeduct,
            reason: `兑换码撤销: ${code}`,
            referenceId: `redeem_${code}`,
            site
        });

        if (error) throw error;
        pointsDeducted = Math.max(0, Number(data?.deducted) || Number(data?.points_deducted) || 0);
    }

    const revokedAt = new Date().toISOString();
    const { error: updateError } = await supabase
        .from('redemption_codes')
        .update({
            status: 'revoked',
            revoked_at: revokedAt,
            revoked_by: adminId || null,
            revoke_reason: reason || '管理员撤销'
        })
        .eq('id', codeRow.id)
        .eq('site', site);

    if (updateError) throw updateError;

    return {
        success: true,
        points_deducted: pointsDeducted,
        revoked_at: revokedAt,
        row: {
            ...codeRow,
            status: 'revoked',
            revoked_at: revokedAt,
            revoked_by: adminId || null,
            revoke_reason: reason || '管理员撤销'
        }
    };
}

async function revokePointsCode({
    requestSupabase,
    supabase,
    token = '',
    adminId = '',
    site,
    code = '',
    reason = '',
    existing = null
} = {}) {
    if (String(token || '').trim() && requestSupabase?.rpc) {
        try {
            return await revokePointsCodeViaRpc({
                requestSupabase,
                supabase,
                token,
                code,
                reason
            });
        } catch (error) {
            if (!shouldFallbackToServiceRevoke(error)) {
                throw error;
            }
        }
    }

    return revokePointsCodeViaService({
        supabase,
        adminId,
        site,
        code,
        reason,
        existing
    });
}

async function loadBatchRowsByIds(supabase, site, batchIds) {
    const normalizedIds = normalizeStringArray(batchIds);
    if (!normalizedIds.length) {
        return [];
    }

    const { data, error } = await supabase
        .from('redemption_batches')
        .select(BATCH_SELECT_FIELDS)
        .in('id', normalizedIds)
        .eq('site', site);

    if (error) throw error;
    return data || [];
}

async function loadBatchById(supabase, site, batchId) {
    const normalizedId = normalizeString(batchId);
    if (!normalizedId) {
        const error = new Error('batch_id is required');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from('redemption_batches')
        .select(BATCH_SELECT_FIELDS)
        .eq('id', normalizedId)
        .eq('site', site)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            const notFoundError = new Error('Batch not found for the selected site');
            notFoundError.statusCode = 404;
            throw notFoundError;
        }
        throw error;
    }

    return data;
}

async function loadCodeRowsByBatchIds(supabase, site, batchIds, statuses = []) {
    const normalizedIds = normalizeStringArray(batchIds);
    if (!normalizedIds.length) {
        return [];
    }

    let query = supabase
        .from('redemption_codes')
        .select(CODE_SELECT_FIELDS)
        .in('batch_id', normalizedIds)
        .eq('site', site);

    const normalizedStatuses = normalizeStringArray(statuses);
    if (normalizedStatuses.length) {
        query = query.in('status', normalizedStatuses);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

async function loadCodeByValue(supabase, site, code) {
    const normalizedCode = normalizeString(code);
    if (!normalizedCode) {
        const error = new Error('code is required');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from('redemption_codes')
        .select(CODE_SELECT_FIELDS)
        .eq('code', normalizedCode)
        .eq('site', site)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            const notFoundError = new Error('Code not found for the selected site');
            notFoundError.statusCode = 404;
            throw notFoundError;
        }
        throw error;
    }

    return data;
}

async function loadPackageForGeneration(supabase, packageId) {
    const normalizedId = normalizeString(packageId);
    if (!normalizedId) {
        const error = new Error('package_id is required');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from('points_packages')
        .select(PACKAGE_GENERATE_SELECT_FIELDS)
        .eq('id', normalizedId)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            const notFoundError = new Error('Package not found');
            notFoundError.statusCode = 404;
            throw notFoundError;
        }
        throw error;
    }

    return data;
}

function extractGeneratedCodes(data) {
    return (Array.isArray(data) ? data : [])
        .map((row) => normalizeString(row?.code || row))
        .filter(Boolean);
}

async function generateCodesViaService({
    supabase,
    user,
    site,
    batchName,
    count,
    channel,
    expiresAt,
    packageId = '',
    customPointsAmount = null
} = {}) {
    const batchId = crypto.randomUUID();
    const normalizedPackageId = normalizeString(packageId);
    const hasCustomPoints = Number.isFinite(Number(customPointsAmount)) && Number(customPointsAmount) > 0;
    let resolvedPointsAmount = Math.max(0, Math.round(Number(customPointsAmount) || 0));

    if (!hasCustomPoints) {
        const packageRow = await loadPackageForGeneration(supabase, normalizedPackageId);
        resolvedPointsAmount = Math.max(
            0,
            Math.round(Number(packageRow?.points_amount) || 0) + Math.round(Number(packageRow?.bonus_points) || 0)
        );

        if (resolvedPointsAmount <= 0) {
            const error = new Error('Selected package has no points configured');
            error.statusCode = 400;
            throw error;
        }
    }

    const { error: batchInsertError } = await supabase
        .from('redemption_batches')
        .insert({
            id: batchId,
            name: batchName,
            site,
            package_id: hasCustomPoints ? null : normalizedPackageId,
            channel,
            total_count: count,
            used_count: 0,
            expires_at: expiresAt,
            custom_points_amount: hasCustomPoints ? resolvedPointsAmount : null,
            created_by: user?.id || null
        });

    if (batchInsertError) {
        throw batchInsertError;
    }

    const codes = [];

    try {
        for (let index = 0; index < count; index += 1) {
            let inserted = false;

            for (let attempt = 0; attempt < 8; attempt += 1) {
                const generatedCode = buildGeneratedRedemptionCode();
                const { error: codeInsertError } = await supabase
                    .from('redemption_codes')
                    .insert({
                        id: crypto.randomUUID(),
                        code: generatedCode,
                        site,
                        batch_id: batchId,
                        package_id: hasCustomPoints ? null : normalizedPackageId,
                        points_amount: resolvedPointsAmount,
                        status: 'pending',
                        expires_at: expiresAt
                    });

                if (!codeInsertError) {
                    codes.push(generatedCode);
                    inserted = true;
                    break;
                }

                if (!isUniqueViolation(codeInsertError)) {
                    throw codeInsertError;
                }
            }

            if (!inserted) {
                const error = new Error('Failed to generate a unique redemption code');
                error.statusCode = 500;
                throw error;
            }
        }
    } catch (error) {
        await supabase
            .from('redemption_codes')
            .delete()
            .eq('batch_id', batchId)
            .eq('site', site);
        await supabase
            .from('redemption_batches')
            .delete()
            .eq('id', batchId)
            .eq('site', site);
        throw error;
    }

    return codes;
}

async function runGenerateCodesAction({ supabase, requestSupabase, token, user, site, body }) {
    const batchName = normalizeString(body.batch_name || body.batchName);
    if (!batchName) {
        const error = new Error('batch_name is required');
        error.statusCode = 400;
        throw error;
    }

    const count = normalizePositiveInteger(body.count, 'count');
    const channel = normalizeString(body.channel, 'manual') || 'manual';
    const expiresAt = normalizeOptionalTimestamp(body.expires_at ?? body.expiresAt, 'expires_at');
    const packageId = normalizeString(body.package_id || body.packageId);
    const customPointsAmountRaw = body.custom_points_amount ?? body.customPointsAmount;
    const hasCustomPoints = customPointsAmountRaw !== undefined && customPointsAmountRaw !== null && customPointsAmountRaw !== '';
    const rpcClient = getPointsRequestRpcClient({ requestSupabase, supabase, token });
    let customPointsAmount = null;

    let rpcName = 'fn_generate_codes';
    let rpcArgs = {
        p_batch_name: batchName,
        p_package_id: packageId,
        p_count: count,
        p_channel: channel,
        p_expires_at: expiresAt,
        p_site: site
    };

    if (hasCustomPoints) {
        customPointsAmount = normalizePositiveInteger(customPointsAmountRaw, 'custom_points_amount', {
            max: 100000
        });
        rpcName = 'fn_generate_custom_codes';
        rpcArgs = {
            p_batch_name: batchName,
            p_points_amount: customPointsAmount,
            p_count: count,
            p_channel: channel,
            p_expires_at: expiresAt,
            p_site: site
        };
    } else if (!packageId) {
        const error = new Error('package_id is required when custom_points_amount is not provided');
        error.statusCode = 400;
        throw error;
    }

    let codes = [];

    try {
        const { data, error } = await rpcClient.rpc(rpcName, rpcArgs);
        if (error) throw error;
        codes = extractGeneratedCodes(data);
    } catch (error) {
        if (!shouldFallbackToServiceGenerate(error)) {
            throw error;
        }

        codes = await generateCodesViaService({
            supabase,
            user,
            site,
            batchName,
            count,
            channel,
            expiresAt,
            packageId,
            customPointsAmount
        });
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'points',
        site,
        actionType: 'batch.generate',
        details: {
            batch_name: batchName,
            package_id: packageId || null,
            custom_points_amount: hasCustomPoints ? customPointsAmount : null,
            channel,
            count: codes.length || count
        }
    });

    return {
        success: true,
        site,
        batch_name: batchName,
        count: codes.length || count,
        codes
    };
}

async function runUpdateBatchAction({ supabase, user, site, body }) {
    const batchId = normalizeString(body.batch_id || body.batchId);
    const existing = await loadBatchById(supabase, site, batchId);
    const name = normalizeString(body.name, existing.name);
    const notes = normalizeString(body.notes ?? existing.notes, existing.notes || '');
    const expiresAt = normalizeOptionalTimestamp(body.expires_at ?? body.expiresAt, 'expires_at');

    if (!name) {
        const error = new Error('name is required');
        error.statusCode = 400;
        throw error;
    }

    const updatePayload = {
        name,
        notes: notes || null
    };

    if (expiresAt !== undefined) {
        updatePayload.expires_at = expiresAt;
    }

    const { error } = await supabase
        .from('redemption_batches')
        .update(updatePayload)
        .eq('id', existing.id)
        .eq('site', site);

    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'points',
        site,
        actionType: 'batch.update',
        details: {
            batch_id: existing.id,
            batch_name: name,
            updated_fields: Object.keys(updatePayload)
        }
    });

    return {
        success: true,
        message: '批次已更新',
        row: {
            ...existing,
            ...updatePayload
        }
    };
}

async function runDeleteBatchesAction({ supabase, requestSupabase, token, user, site, body }) {
    const batchIds = normalizeStringArray(body.batch_ids ?? body.batchIds);
    if (!batchIds.length) {
        const error = new Error('batch_ids is required');
        error.statusCode = 400;
        throw error;
    }

    const deleteMode = normalizeDeleteMode(body.delete_mode ?? body.deleteMode ?? body.option);
    const batches = await loadBatchRowsByIds(supabase, site, batchIds);
    if (batches.length !== batchIds.length) {
        const error = new Error('One or more batches were not found for the selected site');
        error.statusCode = 404;
        throw error;
    }

    const codeRows = await loadCodeRowsByBatchIds(supabase, site, batchIds);
    const usedCodes = codeRows.filter((row) => row.status === 'used');
    let deletedBatchCount = 0;
    let deletedCodeCount = 0;
    let revokedCount = 0;
    let retainedCount = 0;

    if (deleteMode === 'revoke') {
        for (const row of usedCodes) {
            await revokePointsCode({
                requestSupabase,
                supabase,
                token,
                adminId: user.id,
                site,
                code: row.code,
                reason: '批次删除-自动撤销',
                existing: row
            });
            revokedCount += 1;
        }

        if (codeRows.length) {
            const { error: deleteCodesError } = await supabase
                .from('redemption_codes')
                .delete()
                .in('batch_id', batchIds)
                .eq('site', site);
            if (deleteCodesError) throw deleteCodesError;
            deletedCodeCount = codeRows.length;
        }

        const { error: deleteBatchError } = await supabase
            .from('redemption_batches')
            .delete()
            .in('id', batchIds)
            .eq('site', site);
        if (deleteBatchError) throw deleteBatchError;
        deletedBatchCount = batchIds.length;
    } else if (deleteMode === 'block') {
        const removableStatuses = ['pending', 'disabled', 'locked'];
        const removableCodes = codeRows.filter((row) => removableStatuses.includes(row.status));

        if (removableCodes.length) {
            const { error: deleteCodesError } = await supabase
                .from('redemption_codes')
                .delete()
                .in('id', removableCodes.map((row) => row.id))
                .eq('site', site);
            if (deleteCodesError) throw deleteCodesError;
            deletedCodeCount = removableCodes.length;
        }

        const remainingCodes = await loadCodeRowsByBatchIds(supabase, site, batchIds);
        retainedCount = remainingCodes.length;

        if (!remainingCodes.length) {
            const { error: deleteBatchError } = await supabase
                .from('redemption_batches')
                .delete()
                .in('id', batchIds)
                .eq('site', site);
            if (deleteBatchError) throw deleteBatchError;
            deletedBatchCount = batchIds.length;
        }
    } else {
        if (codeRows.length) {
            const { error: deleteCodesError } = await supabase
                .from('redemption_codes')
                .delete()
                .in('batch_id', batchIds)
                .eq('site', site);
            if (deleteCodesError) throw deleteCodesError;
            deletedCodeCount = codeRows.length;
        }

        const { error: deleteBatchError } = await supabase
            .from('redemption_batches')
            .delete()
            .in('id', batchIds)
            .eq('site', site);
        if (deleteBatchError) throw deleteBatchError;
        deletedBatchCount = batchIds.length;
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'points',
        site,
        actionType: 'batch.delete',
        details: {
            batch_ids: batchIds,
            batch_names: batches.map((row) => row.name),
            delete_mode: deleteMode,
            total_code_count: codeRows.length,
            used_code_count: usedCodes.length,
            revoked_count: revokedCount,
            deleted_code_count: deletedCodeCount,
            retained_code_count: retainedCount
        }
    });

    const message = deleteMode === 'revoke'
        ? `已撤销 ${revokedCount} 个兑换码并删除 ${deletedBatchCount} 个批次`
        : (deleteMode === 'block'
            ? (retainedCount > 0
                ? `已删除未使用兑换码，保留 ${retainedCount} 个已使用兑换码记录`
                : `已删除 ${deletedBatchCount} 个批次`)
            : `已删除 ${deletedBatchCount} 个批次（用户积分保留）`);

    return {
        success: true,
        message,
        delete_mode: deleteMode,
        deleted_batch_count: deletedBatchCount,
        deleted_code_count: deletedCodeCount,
        revoked_count: revokedCount,
        retained_code_count: retainedCount
    };
}

async function runInvalidateBatchesAction({ supabase, user, site, body }) {
    const batchIds = normalizeStringArray(body.batch_ids ?? body.batchIds);
    if (!batchIds.length) {
        const error = new Error('batch_ids is required');
        error.statusCode = 400;
        throw error;
    }

    const batches = await loadBatchRowsByIds(supabase, site, batchIds);
    if (batches.length !== batchIds.length) {
        const error = new Error('One or more batches were not found for the selected site');
        error.statusCode = 404;
        throw error;
    }

    const pendingCodes = await loadCodeRowsByBatchIds(supabase, site, batchIds, ['pending']);
    if (pendingCodes.length) {
        const { error } = await supabase
            .from('redemption_codes')
            .update({ status: 'disabled' })
            .in('id', pendingCodes.map((row) => row.id))
            .eq('site', site);
        if (error) throw error;
    }

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'points',
        site,
        actionType: 'batch.invalidate',
        details: {
            batch_ids: batchIds,
            batch_names: batches.map((row) => row.name),
            disabled_code_count: pendingCodes.length
        }
    });

    return {
        success: true,
        message: `已作废 ${pendingCodes.length} 个未使用兑换码`,
        disabled_code_count: pendingCodes.length
    };
}

async function runSetCodeExpiryAction({ supabase, user, site, body }) {
    const code = normalizeString(body.code);
    const existing = await loadCodeByValue(supabase, site, code);
    const expiresAt = normalizeOptionalTimestamp(body.expires_at ?? body.expiresAt, 'expires_at');

    const { error } = await supabase
        .from('redemption_codes')
        .update({ expires_at: expiresAt })
        .eq('id', existing.id)
        .eq('site', site);

    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'points',
        site,
        actionType: 'code.expiry.update',
        details: {
            code,
            batch_id: existing.batch_id,
            expires_at: expiresAt
        }
    });

    return {
        success: true,
        message: expiresAt
            ? `有效期已设置为 ${new Date(expiresAt).toLocaleDateString('zh-CN')}`
            : '已清除单码有效期，恢复继承批次有效期',
        row: {
            ...existing,
            expires_at: expiresAt
        }
    };
}

async function runSetCodeStatusAction({ supabase, user, site, body }) {
    const code = normalizeString(body.code);
    const nextStatus = normalizeString(body.status).toLowerCase();
    if (!['disabled', 'pending'].includes(nextStatus)) {
        const error = new Error('status must be disabled or pending');
        error.statusCode = 400;
        throw error;
    }

    const existing = await loadCodeByValue(supabase, site, code);
    if (nextStatus === 'disabled' && existing.status !== 'pending') {
        const error = new Error('Only pending codes can be disabled');
        error.statusCode = 400;
        throw error;
    }
    if (nextStatus === 'pending' && existing.status !== 'disabled') {
        const error = new Error('Only disabled codes can be enabled');
        error.statusCode = 400;
        throw error;
    }

    const { error } = await supabase
        .from('redemption_codes')
        .update({ status: nextStatus })
        .eq('id', existing.id)
        .eq('site', site);

    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'points',
        site,
        actionType: nextStatus === 'disabled' ? 'code.disable' : 'code.enable',
        details: {
            code,
            batch_id: existing.batch_id,
            previous_status: existing.status,
            next_status: nextStatus
        }
    });

    return {
        success: true,
        message: nextStatus === 'disabled' ? '已禁用该兑换码' : '已启用该兑换码',
        row: {
            ...existing,
            status: nextStatus
        }
    };
}

async function runRevokeCodeAction({ supabase, requestSupabase, token, user, site, body }) {
    const code = normalizeString(body.code);
    const existing = await loadCodeByValue(supabase, site, code);
    const reason = normalizeString(body.reason, '管理员撤销') || '管理员撤销';

    const data = await revokePointsCode({
        requestSupabase,
        supabase,
        token,
        adminId: user.id,
        site,
        code,
        reason,
        existing
    });

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'points',
        site,
        actionType: 'code.revoke',
        details: {
            code,
            batch_id: existing.batch_id,
            reason,
            points_deducted: Number(data?.points_deducted) || 0
        }
    });

    return {
        success: true,
        message: '撤销成功',
        code,
        points_deducted: Number(data?.points_deducted) || 0,
        result: data || { success: true }
    };
}

module.exports = async (req, res) => {
    if (String(req.method || '').toUpperCase() !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, requestSupabase, token, user } = await requireAdmin(req, { permission: 'points.manage' });
        const body = await parseJsonBody(req);
        const action = normalizeString(body.action).toLowerCase();
        const site = requireWritableAdminSite(body.site || req.adminSite, {
            fieldName: 'site'
        });

        let payload;
        switch (action) {
            case 'generate_codes':
                payload = await runGenerateCodesAction({ supabase, requestSupabase, token, user, site, body });
                break;
            case 'update_batch':
                payload = await runUpdateBatchAction({ supabase, user, site, body });
                break;
            case 'delete_batches':
                payload = await runDeleteBatchesAction({ supabase, requestSupabase, token, user, site, body });
                break;
            case 'invalidate_batches':
                payload = await runInvalidateBatchesAction({ supabase, user, site, body });
                break;
            case 'set_code_expiry':
                payload = await runSetCodeExpiryAction({ supabase, user, site, body });
                break;
            case 'set_code_status':
                payload = await runSetCodeStatusAction({ supabase, user, site, body });
                break;
            case 'revoke_code':
                payload = await runRevokeCodeAction({ supabase, requestSupabase, token, user, site, body });
                break;
            default:
                return sendJson(res, 400, {
                    success: false,
                    message: 'Unsupported points manage action'
                });
        }

        return sendJson(res, 200, payload);
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Points manage request failed'
        });
    }
};
