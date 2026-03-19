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
            const tbody = document.getElementById('ticketsTableBody');
            if (tbody) {
                const row = document.createElement('tr');
                const cell = document.createElement('td');
                cell.colSpan = 6;
                cell.style.textAlign = 'center';
                cell.style.color = '#ef4444';
                cell.textContent = `加载失败: ${this.safeText(err?.message, '未知错误')}`;
                row.appendChild(cell);
                tbody.replaceChildren(row);
            }
        }
    },

    applyFilters: function () {
        let result = this.tickets;

        if (this.currentStatus !== 'all') {
            result = result.filter(t => {
                const s = (t.status || 'PENDING').toUpperCase();
                // Treat OPEN and PENDING as the same "pending" state
                const normalized = (s === 'OPEN') ? 'PENDING' : s;
                return normalized === this.currentStatus.toUpperCase();
            });
        }

        if (this.searchQuery) {
            const q = this.searchQuery.toLowerCase();
            result = result.filter(t =>
                (t.id && t.id.toLowerCase().includes(q)) ||
                (t.order_id && t.order_id.toLowerCase().includes(q)) ||
                (t.user_id && t.user_id.toLowerCase().includes(q)) ||
                (t.reason && t.reason.toLowerCase().includes(q)) ||
                (t.description && t.description.toLowerCase().includes(q))
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

    safeText: function (value, fallback = '') {
        if (value === null || value === undefined || value === '') return fallback;
        return String(value);
    },

    truncateText: function (value, maxLength) {
        const text = this.safeText(value);
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    },

    createStatusBadge: function (status) {
        const badge = document.createElement('span');
        badge.className = 'status-badge';
        badge.style.display = 'inline-flex';
        badge.style.alignItems = 'center';
        badge.style.justifyContent = 'center';

        if (status === 'PENDING') {
            badge.style.background = 'rgba(234, 179, 8, 0.2)';
            badge.style.color = '#eab308';
            badge.style.borderColor = 'rgba(234, 179, 8, 0.5)';
            badge.textContent = '待处理';
        } else if (status === 'RESOLVED') {
            badge.style.background = 'rgba(74, 222, 128, 0.2)';
            badge.style.color = '#4ade80';
            badge.style.borderColor = 'rgba(74, 222, 128, 0.5)';
            badge.textContent = '已解决';
        } else if (status === 'REJECTED') {
            badge.style.background = 'rgba(239, 68, 68, 0.2)';
            badge.style.color = '#ef4444';
            badge.style.borderColor = 'rgba(239, 68, 68, 0.5)';
            badge.textContent = '已拒绝';
        } else {
            badge.textContent = status;
        }

        return badge;
    },

    createActionButton: function ({ icon, title, color, background, borderColor, hoverBackground, hoverShadow, hoverBorderColor, onClick }) {
        const button = document.createElement('button');
        button.className = 'action-btn';
        button.type = 'button';
        button.title = title;
        button.innerHTML = `<i class="fas ${icon}"></i>`;
        button.style.color = color;
        button.style.background = background;
        button.style.border = `1px solid ${borderColor}`;
        button.style.width = '34px';
        button.style.height = '34px';
        button.style.borderRadius = '10px';
        button.style.cursor = 'pointer';
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.fontSize = '14px';
        button.style.transition = 'all 0.25s ease';
        button.addEventListener('click', onClick);
        button.addEventListener('mouseenter', () => {
            button.style.transform = 'scale(1.15)';
            button.style.background = hoverBackground;
            button.style.boxShadow = hoverShadow;
            button.style.borderColor = hoverBorderColor;
        });
        button.addEventListener('mouseleave', () => {
            button.style.transform = 'scale(1)';
            button.style.background = background;
            button.style.boxShadow = 'none';
            button.style.borderColor = borderColor;
        });
        return button;
    },

    filter: function (status, btnElement) {
        this.currentStatus = status;

        // Fix: Use .filter-btn as defined in the HTML
        const buttons = document.querySelectorAll('#module-tickets .filter-btn');
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

        tbody.replaceChildren();

        currentData.forEach(ticket => {
            const dateStr = new Date(ticket.created_at).toLocaleString('zh-CN', { hour12: false });
            const rawStatus = (ticket.status || 'PENDING').toUpperCase();
            // Normalize: treat OPEN as PENDING
            const status = (rawStatus === 'OPEN') ? 'PENDING' : rawStatus;

            // Support both 'reason' and 'description' fields (WalletModal writes to 'description')
            const reasonText = this.safeText(ticket.reason || ticket.description, '无描述');
            const reasonPreview = this.truncateText(reasonText, 20);

            // Truncate admin reply for table display
            const adminNotesText = this.safeText(ticket.admin_notes);
            const adminNotesPreview = this.truncateText(adminNotesText, 20);

            const row = document.createElement('tr');

            const metaCell = document.createElement('td');
            metaCell.style.whiteSpace = 'nowrap';
            const idDiv = document.createElement('div');
            idDiv.style.fontFamily = 'monospace';
            idDiv.style.fontSize = '12px';
            idDiv.style.color = 'rgba(255,255,255,0.8)';
            idDiv.textContent = `${this.safeText(ticket.id).substring(0, 8)}...`;
            const dateDiv = document.createElement('div');
            dateDiv.style.fontSize = '11px';
            dateDiv.style.color = 'rgba(255,255,255,0.4)';
            dateDiv.style.marginTop = '4px';
            dateDiv.textContent = dateStr;
            metaCell.appendChild(idDiv);
            metaCell.appendChild(dateDiv);

            const orderCell = document.createElement('td');
            orderCell.style.whiteSpace = 'nowrap';
            const orderDiv = document.createElement('div');
            orderDiv.style.fontFamily = 'monospace';
            orderDiv.style.fontSize = '12px';
            orderDiv.style.cursor = 'pointer';
            orderDiv.style.color = '#60a5fa';
            orderDiv.title = '点击复制';
            const orderId = this.safeText(ticket.order_id);
            orderDiv.textContent = orderId ? `${orderId.substring(0, 18)}...` : '-';
            orderDiv.addEventListener('click', () => this.copyText(orderId));
            orderCell.appendChild(orderDiv);

            const userCell = document.createElement('td');
            userCell.style.whiteSpace = 'nowrap';
            const userDiv = document.createElement('div');
            userDiv.style.fontFamily = 'monospace';
            userDiv.style.fontSize = '12px';
            userDiv.style.cursor = 'pointer';
            userDiv.title = '点击复制';
            const userId = this.safeText(ticket.user_id);
            userDiv.textContent = userId ? `${userId.substring(0, 8)}...` : '-';
            userDiv.addEventListener('click', () => this.copyText(userId));
            userCell.appendChild(userDiv);

            const reasonCell = document.createElement('td');
            const reasonDiv = document.createElement('div');
            reasonDiv.style.maxWidth = '220px';
            reasonDiv.style.overflow = 'hidden';
            reasonDiv.style.textOverflow = 'ellipsis';
            reasonDiv.style.whiteSpace = 'nowrap';
            reasonDiv.title = reasonText;
            reasonDiv.textContent = reasonPreview;
            reasonCell.appendChild(reasonDiv);

            if (adminNotesText) {
                const notesDiv = document.createElement('div');
                notesDiv.style.fontSize = '11px';
                notesDiv.style.color = '#4ade80';
                notesDiv.style.marginTop = '4px';
                notesDiv.style.borderLeft = '2px solid #4ade80';
                notesDiv.style.paddingLeft = '4px';
                notesDiv.style.maxWidth = '220px';
                notesDiv.style.overflow = 'hidden';
                notesDiv.style.textOverflow = 'ellipsis';
                notesDiv.style.whiteSpace = 'nowrap';
                notesDiv.style.cursor = 'pointer';
                notesDiv.title = `点击复制回复: ${adminNotesText}`;
                notesDiv.textContent = `回复: ${adminNotesPreview}`;
                notesDiv.addEventListener('click', () => this.copyText(adminNotesText));
                reasonCell.appendChild(notesDiv);
            }

            const statusCell = document.createElement('td');
            statusCell.className = 'ticket-status-cell';
            statusCell.appendChild(this.createStatusBadge(status));

            const actionCell = document.createElement('td');
            const actionWrap = document.createElement('div');
            actionWrap.style.display = 'flex';
            actionWrap.style.gap = '8px';

            if (status === 'PENDING') {
                actionWrap.appendChild(this.createActionButton({
                    icon: 'fa-check',
                    title: '解决工单',
                    color: '#4ade80',
                    background: 'rgba(74, 222, 128, 0.1)',
                    borderColor: 'rgba(74, 222, 128, 0.15)',
                    hoverBackground: 'rgba(74, 222, 128, 0.25)',
                    hoverShadow: '0 0 12px rgba(74, 222, 128, 0.3)',
                    hoverBorderColor: 'rgba(74, 222, 128, 0.4)',
                    onClick: () => this.openReplyModal(ticket.id, 'RESOLVED')
                }));
                actionWrap.appendChild(this.createActionButton({
                    icon: 'fa-times',
                    title: '拒绝/关闭',
                    color: '#ef4444',
                    background: 'rgba(239, 68, 68, 0.1)',
                    borderColor: 'rgba(239, 68, 68, 0.15)',
                    hoverBackground: 'rgba(239, 68, 68, 0.25)',
                    hoverShadow: '0 0 12px rgba(239, 68, 68, 0.3)',
                    hoverBorderColor: 'rgba(239, 68, 68, 0.4)',
                    onClick: () => this.openReplyModal(ticket.id, 'REJECTED')
                }));
            } else {
                const processedText = document.createElement('span');
                processedText.style.fontSize = '12px';
                processedText.style.color = 'rgba(255,255,255,0.3)';
                processedText.textContent = '已处理';
                actionWrap.appendChild(processedText);
            }

            actionCell.appendChild(actionWrap);

            row.appendChild(metaCell);
            row.appendChild(orderCell);
            row.appendChild(userCell);
            row.appendChild(reasonCell);
            row.appendChild(statusCell);
            row.appendChild(actionCell);
            tbody.appendChild(row);
        });

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
        modal.style.visibility = 'visible';
        modal.style.opacity = '1';
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

            // Option: Automatic refund via points_balance + points_ledger
            if (doRefund) {
                // Get refund amount from shop_orders
                const { data: orderData, error: orderErr } = await window.supabaseClient
                    .from('shop_orders')
                    .select('total_price')
                    .eq('id', ticket.order_id)
                    .single();

                if (orderErr) throw new Error("未找到对应的订单号来提取退款积分额: " + orderErr.message);
                const refundAmount = orderData.total_price;

                if (refundAmount > 0) {
                    // Read current balance, then update
                    const { data: balData, error: balErr } = await window.supabaseClient
                        .from('points_balance')
                        .select('bonus_balance')
                        .eq('user_id', ticket.user_id)
                        .single();

                    if (balErr) throw new Error("无法读取用户积分余额: " + balErr.message);

                    const newBalance = (balData.bonus_balance || 0) + refundAmount;
                    const { error: updateErr } = await window.supabaseClient
                        .from('points_balance')
                        .update({ bonus_balance: newBalance, updated_at: new Date().toISOString() })
                        .eq('user_id', ticket.user_id);
                    if (updateErr) throw new Error("退款失败: " + updateErr.message);

                    // Log in points_ledger
                    await window.supabaseClient.from('points_ledger').insert({
                        user_id: ticket.user_id,
                        amount: refundAmount,
                        reason: `工单退款 (订单号: ${ticket.order_id.substring(0, 8)})`,
                        reference_id: 'TICKET_REFUND_' + ticketId.substring(0, 8)
                    });
                }
            }

            // Update ticket status (column is admin_notes, not admin_reply)
            const { data: updateData, error: tUpdateErr } = await window.supabaseClient
                .from('shop_tickets')
                .update({
                    status: newStatus,
                    admin_notes: adminReply || null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', ticketId)
                .select(); // Ensure we get the updated row back

            if (tUpdateErr) throw tUpdateErr;
            if (!updateData || updateData.length === 0) {
                throw new Error("更新失败：工单不存在或您没有管理员权限修改它");
            }

            // Notify User via existing notification system
            const notifTitle = newStatus === 'RESOLVED' ? '工单已解决' : '工单已被拒绝';
            const notifType = newStatus === 'RESOLVED' ? 'success' : 'warning';
            let notifContent = `您的提问 (订单ID: ${ticket.order_id.substring(0, 8)}) 已经处理完毕。\n`;
            if (adminReply) {
                notifContent += `管理员回复: ${adminReply}`;
            }

            // Insert notification without throwing on error (non-critical)
            try {
                await window.supabaseClient.from('system_notifications').insert({
                    user_id: ticket.user_id,
                    title: notifTitle,
                    content: notifContent,
                    type: notifType,
                    is_read: false
                });
            } catch (notifErr) {
                console.warn("Failed to insert user notification:", notifErr);
            }

            // Close modal
            const modal = document.getElementById('ticketReplyModal');
            modal.style.display = 'none';
            modal.style.visibility = 'hidden';
            modal.style.opacity = '0';

            alert("已完成工单处理" + (doRefund ? " 并退还积分" : ""));

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
            if (typeof window.showToast === 'function') {
                window.showToast('已复制', 'success');
            } else {
                const toast = document.createElement('div');
                toast.textContent = '已复制';
                toast.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.8); color:#fff; padding:8px 16px; border-radius:4px; z-index:10000;';
                document.body.appendChild(toast);
                setTimeout(() => toast.remove(), 2000);
            }
        });
    }
};

window.AdminTickets = AdminTickets;
