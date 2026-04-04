const {
    parseJsonBody,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    processTicketWithContext
} = require('./process');

function normalizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeTicketIds(ticketIds = []) {
    return Array.from(new Set(
        (Array.isArray(ticketIds) ? ticketIds : [])
            .map((ticketId) => normalizeText(ticketId, 120))
            .filter(Boolean)
    )).slice(0, 50);
}

module.exports = async function adminTicketsBatchProcessHandler(req, res) {
    if (String(req.method || '').toUpperCase() !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'tickets.manage' });
        const body = await parseJsonBody(req);
        const ticketIds = normalizeTicketIds(body.ticketIds);
        const newStatus = normalizeText(body.newStatus, 40).toUpperCase();
        const adminReply = normalizeText(body.adminReply, 2000);
        const internalNote = normalizeText(body.internalNote, 2000);

        if (!ticketIds.length || !newStatus) {
            return sendJson(res, 400, {
                success: false,
                message: 'ticketIds and newStatus are required'
            });
        }

        if (!['RESOLVED', 'REJECTED'].includes(newStatus)) {
            return sendJson(res, 400, {
                success: false,
                message: 'Unsupported ticket status'
            });
        }

        if (!adminReply && newStatus === 'REJECTED') {
            return sendJson(res, 400, {
                success: false,
                message: '拒绝工单时请填写回复理由'
            });
        }

        const processed = [];
        const skipped = [];
        const failed = [];

        for (const ticketId of ticketIds) {
            try {
                const result = await processTicketWithContext({
                    supabase,
                    user,
                    ticketId,
                    newStatus,
                    adminReply,
                    internalNote,
                    doRefund: false,
                    source: 'ticket.batch_process'
                });

                processed.push({
                    ticketId,
                    status: result?.ticket?.status || newStatus
                });
            } catch (error) {
                const statusCode = Number(error?.statusCode || 500);
                const item = {
                    ticketId,
                    statusCode,
                    message: error?.message || 'Ticket processing failed'
                };

                if (statusCode === 404 || statusCode === 409) {
                    skipped.push(item);
                } else {
                    failed.push(item);
                }
            }
        }

        return sendJson(res, 200, {
            success: true,
            processedCount: processed.length,
            skippedCount: skipped.length,
            failedCount: failed.length,
            processed,
            skipped,
            failed
        });
    } catch (error) {
        return sendJson(res, Number(error?.statusCode) || 500, {
            success: false,
            message: error?.message || 'Failed to batch process tickets'
        });
    }
};
