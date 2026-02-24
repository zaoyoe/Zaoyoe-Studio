const AdminTickets = {
    tickets: [],
    filteredTickets: [],
    currentPage: 1,
    pageSize: 15,
    currentStatus: 'all',
    searchQuery: '',

    init: async function () {
        if (this._initialized) return;
        this._initialized = true;
        console.log('[AdminTickets] Initializing...');
        await this.loadTickets();
    },

    loadTickets: async function () {
        try {
            document.getElementById('ticketsTableBody').innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">加载中...</td></tr>';

            const { data, error } = await window.supabaseClient
                .from('shop_tickets')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            this.tickets = data || [];
            this.applyFilters();
        } catch (err) {
            console.error('[AdminTickets] load error:', err);
            document.getElementById('ticketsTableBody').innerHTML = `<tr><td colspan="6" style="text-align:center; color:#ef4444;">加载失败: ${err.message}</td></tr>`;
        }
    },

    applyFilters: function () {
        let result = this.tickets;

        if (this.currentStatus !== 'all') {
            result = result.filter(t => (t.status || 'PENDING').toUpperCase() === this.currentStatus.toUpperCase());
        }

        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            result = result.filter(t =>
                (t.order_id && t.order_id.toLowerCase().includes(q)) ||
                (t.user_id && t.user_id.toLowerCase().includes(q)) ||
                (t.reason && t.reason.toLowerCase().includes(q))
            );
        }

        this.filteredTickets = result;
        this.currentPage = 1;
        this.render();
    },

    search: function () {
        this.searchQuery = document.getElementById('ticketSearchInput').value.trim();
        this.applyFilters();
    },

    filter: function (status, btnElement) {
        this.currentStatus = status;

        const buttons = document.querySelectorAll('#module-tickets .status-filter .status-btn, #module-tickets .status-filters .status-btn');
        if (buttons.length > 0) {
            buttons.forEach(b => b.classList.remove('active'));
            if (btnElement) btnElement.classList.add('active');
        }

        this.applyFilters();
    },

    render: function () {
        const tbody = document.getElementById('ticketsTableBody');
        if (!tbody) return;

        const totalItems = this.filteredTickets.length;
        const totalPages = Math.ceil(totalItems / this.pageSize) || 1;

        if (this.currentPage > totalPages) this.currentPage = totalPages;

        const startIdx = (this.currentPage - 1) * this.pageSize;
        const endIdx = startIdx + this.pageSize;
        const currentData = this.filteredTickets.slice(startIdx, endIdx);

        if (currentData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; height:300px; vertical-align:middle; color:rgba(255,255,255,0.4);">
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%;">
                    <i class="fas fa-inbox" style="font-size:32px;margin-bottom:16px;opacity:0.5;"></i>
                    <span>暂无符合条件的工单</span>
                </div>
            </td></tr>`;
            this.renderPagination(totalPages);
            return;
        }

        tbody.innerHTML = currentData.map(ticket => {
            const dateStr = new Date(ticket.created_at).toLocaleString('zh-CN', { hour12: false });

            let statusHtml = '';
            const status = (ticket.status || 'PENDING').toUpperCase();
            if (status === 'PENDING') {
                statusHtml = '<span class="status-badge" style="background:rgba(234, 179, 8, 0.2); color:#eab308; border-color:rgba(234, 179, 8, 0.5);">待处理</span>';
            } else if (status === 'RESOLVED') {
                statusHtml = '<span class="status-badge" style="background:rgba(74, 222, 128, 0.2); color:#4ade80; border-color:rgba(74, 222, 128, 0.5);">已解决</span>';
            } else if (status === 'REJECTED') {
                statusHtml = '<span class="status-badge" style="background:rgba(239, 68, 68, 0.2); color:#ef4444; border-color:rgba(239, 68, 68, 0.5);">已拒绝</span>';
            } else {
                statusHtml = `<span class="status-badge">${status}</span>`;
            }

            const safeReason = (ticket.reason || '无描述').replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const reasonPreview = safeReason.length > 30 ? safeReason.substring(0, 30) + '...' : safeReason;

            return `
                <tr>
                    <td>
                        <div style="font-family:monospace; font-size:12px; color:rgba(255,255,255,0.8);">${ticket.id.substring(0, 8)}...</div>
                        <div style="font-size:11px; color:rgba(255,255,255,0.4); margin-top:4px;">${dateStr}</div>
                    </td>
                    <td>
                        <div style="font-family:monospace; font-size:12px; cursor:pointer; color:#60a5fa;" title="点击复制" onclick="AdminTickets.copyText('${ticket.order_id}')">
                            ${(ticket.order_id || '').substring(0, 18) || '-'}...
                        </div>
                    </td>
                    <td>
                        <div style="font-family:monospace; font-size:12px; cursor:pointer;" title="点击复制" onclick="AdminTickets.copyText('${ticket.user_id}')">
                            ${(ticket.user_id || '').substring(0, 8) || '-'}...
                        </div>
                    </td>
                    <td>
                        <div style="max-width: 250px; overflow:hidden;" title="${safeReason}">
                            ${reasonPreview}
                        </div>
                        ${ticket.admin_reply ? `<div style="font-size:11px; color:#4ade80; margin-top:4px; border-left:2px solid #4ade80; padding-left:4px;">回复: ${ticket.admin_reply}</div>` : ''}
                    </td>
                    <td>${statusHtml}</td>
                    <td>
                        <div style="display:flex; gap:8px;">
                            ${status === 'PENDING' ? `
                                <button class="action-btn" onclick="AdminTickets.openReplyModal('${ticket.id}', 'RESOLVED')" title="解决工单" style="color:#4ade80; background:rgba(74, 222, 128, 0.1);">
                                    <i class="fas fa-check"></i>
                                </button>
                                <button class="action-btn" onclick="AdminTickets.openReplyModal('${ticket.id}', 'REJECTED')" title="拒绝/关闭" style="color:#ef4444; background:rgba(239, 68, 68, 0.1);">
                                    <i class="fas fa-times"></i>
                                </button>
                            ` : `<span style="font-size:12px; color:rgba(255,255,255,0.3);">已处理</span>`}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        this.renderPagination(totalPages);
    },

    renderPagination: function (totalPages) {
        const container = document.getElementById('ticketsPagination');
        if (!container) return;

        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 15px; margin-top: 20px;">
                <div class="pagination-control">
                    <button class="pagination-btn" onclick="AdminTickets.changePage(${this.currentPage - 1})" ${this.currentPage <= 1 ? 'disabled' : ''}>−</button>
                    <input type="number" class="pagination-input" value="${this.currentPage}" min="1" max="${totalPages}"
                        onchange="AdminTickets.changePage(parseInt(this.value)||1)">
                    <button class="pagination-btn" onclick="AdminTickets.changePage(${this.currentPage + 1})" ${this.currentPage >= totalPages ? 'disabled' : ''}>+</button>
                </div>
                <div class="pagination-total" style="margin:0;">共 ${totalPages} 页 / ${this.filteredTickets.length} 条</div>
            </div>
        `;
    },

    changePage: function (page) {
        this.currentPage = page;
        this.render();
    },

    openReplyModal: function (ticketId, newStatus) {
        document.getElementById('replyTicketId').value = ticketId;
        document.getElementById('replyNewStatus').value = newStatus;
        document.getElementById('ticketAdminReply').value = '';
        document.getElementById('ticketRefundCheckbox').checked = false;

        const modal = document.getElementById('ticketReplyModal');
        modal.style.display = 'flex';
        modal.querySelector('.modal-title').textContent = newStatus === 'RESOLVED' ? '解决工单' : '拒绝工单';
    },

    submitReply: async function () {
        const ticketId = document.getElementById('replyTicketId').value;
        const newStatus = document.getElementById('replyNewStatus').value;
        const adminReply = document.getElementById('ticketAdminReply').value.trim();
        const doRefund = document.getElementById('ticketRefundCheckbox').checked;

        if (!adminReply && newStatus === 'REJECTED') {
            alert("拒绝工单时请填写回复理由");
            return;
        }

        const btn = document.querySelector('#ticketReplyModal .btn-primary');
        const originText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '处理中...';

        try {
            const ticket = this.tickets.find(t => t.id === ticketId);
            if (!ticket) throw new Error("找不到该工单数据");

            // Option: Automatic refund via points_ledger
            if (doRefund) {
                // Determine refund amount from user_orders if possible
                const { data: orderData, error: orderErr } = await window.supabaseClient
                    .from('user_orders')
                    .select('price_points')
                    .eq('id', ticket.order_id)
                    .single();

                if (orderErr) throw new Error("未找到对应的订单号来提取退款积分额: " + orderErr.message);
                const refundAmount = orderData.price_points;

                if (refundAmount > 0) {
                    // Update user's points (simplified direct update; real app might use stored procedure)
                    // Fetch user current points first
                    const { data: profile, error: profErr } = await window.supabaseClient
                        .from('profiles')
                        .select('points')
                        .eq('id', ticket.user_id)
                        .single();

                    if (profErr) throw profErr;

                    const newPoints = (profile.points || 0) + refundAmount;

                    const { error: refundErr } = await window.supabaseClient
                        .from('profiles')
                        .update({ points: newPoints })
                        .eq('id', ticket.user_id);
                    if (refundErr) throw refundErr;

                    // Log in ledger
                    await window.supabaseClient.from('point_ledger').insert({
                        user_id: ticket.user_id,
                        amount: refundAmount,
                        transaction_type: 'refund',
                        description: `工单退款 (订单号: ${ticket.order_id.substring(0, 8)})`
                    });
                }
            }

            // Update ticket status
            const { error: tUpdateErr } = await window.supabaseClient
                .from('shop_tickets')
                .update({
                    status: newStatus,
                    admin_reply: adminReply || null
                })
                .eq('id', ticketId);

            if (tUpdateErr) throw tUpdateErr;

            document.getElementById('ticketReplyModal').style.display = 'none';
            alert("已完成工单处理" + (doRefund ? "并退还积分" : ""));

            this.loadTickets();

        } catch (err) {
            alert('处理失败: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originText;
        }
    },

    copyText: function (text) {
        navigator.clipboard.writeText(text).then(() => {
            const toast = document.createElement('div');
            toast.textContent = '已复制';
            toast.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.8); color:#fff; padding:8px 16px; border-radius:4px; z-index:10000;';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2000);
        });
    }
};

window.AdminTickets = AdminTickets;
