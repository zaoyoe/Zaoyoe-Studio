/**
 * Admin Points Module - Redemption Code Management
 */

// Get supabase client (lazy load to ensure it's ready)
function getSupabase() {
    return window.supabaseClient || window.supabase;
}

// ========================================
// GLOBAL UTILITY: Enable horizontal scroll with mouse wheel
// ========================================
function enableHorizontalScroll(container) {
    if (!container || container._horizontalScrollEnabled) return;

    container.addEventListener('wheel', (e) => {
        // Only intercept if content is wider than container (scrollable)
        if (container.scrollWidth > container.clientWidth) {
            e.preventDefault();
            container.scrollLeft += e.deltaY;
        }
    }, { passive: false });

    container._horizontalScrollEnabled = true; // Prevent duplicate listeners
}

// Make it globally available for other modules
window.enableHorizontalScroll = enableHorizontalScroll;

// ========================================
// VIEW SWITCHING
// ========================================
function switchPointsView(viewName) {
    // Hide all views
    document.querySelectorAll('#module-points .view-section').forEach(v => {
        v.classList.remove('active');
    });

    // Show selected view
    const view = document.getElementById(`points-view-${viewName}`);
    if (view) view.classList.add('active');

    // Update tabs
    document.querySelectorAll('#module-points .admin-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.pointsView === viewName);
    });

    // Update tab indicator position
    const activeTab = document.querySelector('#module-points .admin-tab.active');
    const indicator = document.querySelector('#module-points .admin-tab-indicator');
    if (activeTab && indicator) {
        indicator.style.width = `${activeTab.offsetWidth}px`;
        indicator.style.left = `${activeTab.offsetLeft}px`;
    }

    // Load data for specific views
    if (viewName === 'batches') loadBatches();
    if (viewName === 'generate') {
        loadPackagesForSelect();
        initBatchExpiresPicker(); // Initialize Flatpickr when switching to generate view
    }
}

// ========================================
// FLATPICKR INITIALIZATION
// ========================================
let batchExpiresPickerInstance = null;

function initBatchExpiresPicker() {
    const input = document.getElementById('batchExpires');
    if (!input || batchExpiresPickerInstance) return;

    // Check if Flatpickr is loaded
    if (typeof flatpickr === 'undefined') {
        console.warn('Flatpickr not loaded yet');
        return;
    }

    batchExpiresPickerInstance = flatpickr(input, {
        enableTime: true,
        dateFormat: "Y-m-d H:i",
        time_24hr: true,
        locale: "zh",
        allowInput: false,
        minDate: "today",
        // Theme based on current theme
        onOpen: function () {
            // Apply dark theme if needed
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const calendar = this.calendarContainer;
            if (isDark) {
                calendar.classList.add('flatpickr-dark-theme');
            } else {
                calendar.classList.remove('flatpickr-dark-theme');
            }
        }
    });
}

// ========================================
// LOAD BATCHES
// ========================================
let allBatches = [];
let filteredBatches = []; // Batches after applying filters
let selectedBatchIds = new Set();
let batchSelectMode = false;

// Sorting State
let batchSortField = 'created_at';
let batchSortOrder = 'desc'; // 'asc' or 'desc'

// Filtering State
let batchChannelFilterValue = 'all';
let batchPackageFilterValue = 'all';

// Flag to prevent filter during code search
let isCodeSearchInProgress = false;

// Pagination State
let batchCurrentPage = 1;
const batchPageSize = 10;

// All available packages (for filter dropdown)
let allPackages = [];

async function loadBatches() {
    const tbody = document.getElementById('batchesTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">加载中...</td></tr>';

    try {
        // Load batches
        const { data, error } = await getSupabase()
            .from('redemption_batches')
            .select(`
                *,
                points_packages(id, name, points_amount)
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;

        allBatches = data || [];

        // Also load packages for filter dropdown (if not already loaded)
        if (allPackages.length === 0) {
            await loadPackagesForFilter();
        }

        applyBatchFilters();

        // Enable horizontal scroll with mouse wheel (like users module)
        initBatchTableHorizontalScroll();

    } catch (err) {
        console.error('Failed to load batches:', err);
        tbody.innerHTML = `<tr><td colspan="8" class="error-cell">加载失败: ${err.message}</td></tr>`;
    }
}

// Enable horizontal scroll with mouse wheel on the batch table
function initBatchTableHorizontalScroll() {
    const tablePanel = document.querySelector('#points-view-batches .glass-panel.users-table-panel');
    enableHorizontalScroll(tablePanel);
}

// Load packages for filter dropdown
async function loadPackagesForFilter() {
    try {
        const { data, error } = await getSupabase()
            .from('points_packages')
            .select('id, name')
            .order('name');

        if (error) throw error;
        allPackages = data || [];

        // Populate package filter dropdown
        const popup = document.getElementById('batchPackagePopup');
        if (popup) {
            const existingOptions = popup.querySelectorAll('.filter-option:not([data-value="all"])');
            existingOptions.forEach(o => o.remove());

            allPackages.forEach(pkg => {
                const opt = document.createElement('div');
                opt.className = 'filter-option';
                opt.dataset.value = pkg.id;
                opt.textContent = pkg.name;
                opt.onclick = () => filterBatchByPackage(pkg.id);
                popup.appendChild(opt);
            });
        }
    } catch (err) {
        console.error('Failed to load packages for filter:', err);
    }
}

function renderBatches() {
    const tbody = document.getElementById('batchesTableBody');
    const colCount = batchSelectMode ? 8 : 7;

    if (filteredBatches.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${colCount}" class="empty-cell">暂无批次</td></tr>`;
        updatePaginationUI();
        return;
    }

    const channelLabels = {
        xianyu: '闲鱼',
        taobao: '淘宝',
        manual: '手动',
        promotion: '促销',
        test: '测试'
    };

    // Apply pagination
    const start = (batchCurrentPage - 1) * batchPageSize;
    const end = start + batchPageSize;
    const pageBatches = filteredBatches.slice(start, end);

    tbody.innerHTML = pageBatches.map(batch => {
        const pkg = batch.points_packages;
        const usedPercent = batch.total_count > 0 ? Math.round((batch.used_count / batch.total_count) * 100) : 0;
        const createdAt = new Date(batch.created_at).toLocaleString('zh-CN', {
            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const isSelected = selectedBatchIds.has(batch.id);
        const checkboxCell = batchSelectMode ? `
            <td class="checkbox-col" onclick="event.stopPropagation()">
                <label class="custom-checkbox">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleBatchSelection('${batch.id}')">
                    <span class="checkmark"></span>
                </label>
            </td>
        ` : '';

        return `
            <tr data-batch-id="${batch.id}" class="${isSelected ? 'selected' : ''}" onclick="viewBatchCodes('${batch.id}')" style="cursor:pointer;">
                ${checkboxCell}
                <td><strong>${batch.name}</strong></td>
                <td>${pkg?.name || '-'}</td>
                <td><span class="channel-badge ${batch.channel}">${channelLabels[batch.channel] || batch.channel}</span></td>
                <td>${batch.total_count}</td>
                <td>
                    <div class="usage-cell">
                        <span>${batch.used_count}</span>
                        <div class="usage-bar"><div class="usage-fill" style="width: ${usedPercent}%"></div></div>
                    </div>
                </td>
                <td>${createdAt}</td>
                <td class="actions-cell" onclick="event.stopPropagation()">
                    <button class="btn-icon" onclick="openBatchEditModal('${batch.id}')" title="编辑批次">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon" onclick="exportBatchCodes('${batch.id}')" title="导出Excel">
                        <i class="fas fa-download"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    updatePaginationUI();
    updateSelectAllCheckbox();
}

// ========================================
// LOAD PACKAGES FOR SELECT
// ========================================
async function loadPackagesForSelect() {
    const optionsContainer = document.getElementById('packageOptions');
    const displayText = document.querySelector('#packageSelectDropdown .select-text');
    const hiddenInput = document.getElementById('batchPackageId');

    if (!optionsContainer) return;

    displayText.textContent = '加载中...';

    try {
        let packages = [];

        // Always load from points_packages table (has UUID IDs required by fn_generate_codes)
        const { data, error } = await getSupabase()
            .from('points_packages')
            .select('id, name, points_amount, bonus_points')
            .eq('is_active', true)
            .order('points_amount');

        if (error) throw error;
        packages = data || [];

        // Build options with custom option at the end
        let optionsHtml = packages.map((pkg, index) => {
            const total = pkg.points_amount + (pkg.bonus_points || 0);
            const isFirst = index === 0;
            return `<div class="select-option${isFirst ? ' selected' : ''}" data-value="${pkg.id}">${pkg.name} (${total}分)</div>`;
        }).join('');

        // Add custom points option
        optionsHtml += `<div class="select-option custom-option" data-value="custom">✏️ 自定义积分</div>`;

        optionsContainer.innerHTML = optionsHtml;

        // Select first option by default
        if (packages.length > 0) {
            const firstPkg = packages[0];
            const total = firstPkg.points_amount + (firstPkg.bonus_points || 0);
            displayText.textContent = `${firstPkg.name} (${total}分)`;
            hiddenInput.value = firstPkg.id;
        } else {
            displayText.textContent = '暂无套餐';
        }

        // Hide custom input initially
        const customInputWrapper = document.getElementById('customPointsWrapper');
        if (customInputWrapper) customInputWrapper.style.display = 'none';

        // Initialize dropdown handlers
        initPointsDropdowns();

    } catch (err) {
        console.error('Failed to load packages:', err);
        displayText.textContent = '加载失败';
    }
}

// ========================================
// CUSTOM DROPDOWN HANDLERS
// ========================================
function initPointsDropdowns() {
    const dropdowns = document.querySelectorAll('#module-points .points-select');

    dropdowns.forEach(dropdown => {
        const display = dropdown.querySelector('.select-display');
        const options = dropdown.querySelector('.select-options');
        const hiddenInput = dropdown.querySelector('input[type="hidden"]');
        const displayText = dropdown.querySelector('.select-text');

        // Toggle dropdown on click
        display.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close all other dropdowns
            dropdowns.forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });
            dropdown.classList.toggle('open');
        });

        // Handle option selection
        options.querySelectorAll('.select-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const value = option.dataset.value;
                const text = option.textContent;

                // Update display
                displayText.textContent = text;
                hiddenInput.value = value;

                // Update selected state
                options.querySelectorAll('.select-option').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');

                // Handle custom points option
                const customWrapper = document.getElementById('customPointsWrapper');
                if (dropdown.id === 'packageSelectDropdown' && customWrapper) {
                    if (value === 'custom') {
                        customWrapper.style.display = 'block';
                        // Focus the input
                        setTimeout(() => {
                            document.getElementById('customPointsAmount')?.focus();
                        }, 100);
                    } else {
                        customWrapper.style.display = 'none';
                    }
                }

                // Close dropdown
                dropdown.classList.remove('open');
            });
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', () => {
        dropdowns.forEach(d => d.classList.remove('open'));
    });
}

// ========================================
// GENERATE CODES
// ========================================
let generatedCodes = [];

async function generateCodes(event) {
    event.preventDefault();

    const batchName = document.getElementById('batchName').value.trim();
    const packageIdValue = document.getElementById('batchPackageId').value;
    const count = parseInt(document.getElementById('batchCount').value);
    const channel = document.getElementById('batchChannel').value;
    const expiresInput = document.getElementById('batchExpires').value;
    const expiresAt = expiresInput ? new Date(expiresInput).toISOString() : null;

    // Check if using custom points
    const isCustomPoints = packageIdValue === 'custom';
    let customPointsAmount = null;

    if (isCustomPoints) {
        customPointsAmount = parseInt(document.getElementById('customPointsAmount')?.value);
        if (!customPointsAmount || customPointsAmount <= 0) {
            alert('请输入有效的自定义积分数量');
            return;
        }
    }

    if (!batchName || (!isCustomPoints && !packageIdValue) || !count) {
        alert('请填写所有必填项');
        return;
    }

    const btn = event.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成中...';
    btn.disabled = true;

    try {
        // Use different RPC call based on whether custom points or package
        let data, error;

        // Get current site from AdminSiteFilter (default to 'cn')
        const currentSite = (window.AdminSiteFilter && AdminSiteFilter.getSiteParam()) || 'cn';

        if (isCustomPoints) {
            // Custom points - use fn_generate_custom_codes
            ({ data, error } = await getSupabase().rpc('fn_generate_custom_codes', {
                p_batch_name: batchName,
                p_points_amount: customPointsAmount,
                p_count: count,
                p_channel: channel,
                p_expires_at: expiresAt,
                p_site: currentSite
            }));
        } else {
            // Standard package - use existing fn_generate_codes
            ({ data, error } = await getSupabase().rpc('fn_generate_codes', {
                p_batch_name: batchName,
                p_package_id: packageIdValue,
                p_count: count,
                p_channel: channel,
                p_expires_at: expiresAt,
                p_site: currentSite
            }));
        }

        if (error) throw error;

        generatedCodes = data.map(row => row.code);
        displayGeneratedCodes();

    } catch (err) {
        console.error('Failed to generate codes:', err);
        alert('生成失败: ' + err.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function displayGeneratedCodes() {
    const resultDiv = document.getElementById('generatedCodesResult');
    const codesList = document.getElementById('codesListDisplay');

    codesList.innerHTML = generatedCodes.map(code =>
        `<div class="code-item" onclick="copySingleCode(this, '${code}')" title="点击复制"><code>${code}</code></div>`
    ).join('');

    // Update display logic for 2-column layout
    const placeholder = document.getElementById('generatePlaceholder');
    if (placeholder) placeholder.style.display = 'none';

    resultDiv.style.display = 'block';
}

// Copy single code to clipboard
function copySingleCode(element, code) {
    navigator.clipboard.writeText(code).then(() => {
        element.classList.add('copied');
        setTimeout(() => element.classList.remove('copied'), 1500);
    });
}

// Search Filter Listener
let codeSearchDebounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    const initPointsPageBindings = () => {
        const searchInput = document.getElementById('batchSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                // Skip filtering if we're clearing input after code search
                if (isCodeSearchInProgress) return;

                const term = e.target.value.trim().toUpperCase();

                // Check if it looks like a complete redemption code (ZY-XXXX-XXXX-XXXX format)
                const isCodeFormat = /^ZY-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(term);

                if (isCodeFormat) {
                    // Debounce code search to avoid too many API calls
                    clearTimeout(codeSearchDebounceTimer);
                    codeSearchDebounceTimer = setTimeout(() => {
                        searchCodeInBatchesNoModal(term);
                    }, 300);
                } else if (term.startsWith('ZY-')) {
                    // Partial code input - show loading hint or wait
                    // Don't filter yet, wait for complete code
                } else {
                    // Regular batch name filter
                    clearTimeout(codeSearchDebounceTimer);
                    applyBatchFilters();
                }
            });
        }

        // Initialize batch date pickers for custom range
        initBatchDatePickers();

        // Close all batch filter dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            const filterIds = ['batchDateFilter', 'batchChannelFilter', 'batchPackageFilter', 'batchExportDropdown'];
            filterIds.forEach(id => {
                const filter = document.getElementById(id);
                if (filter && !filter.contains(e.target)) {
                    filter.classList.remove('open');
                }
            });

            // Also close export popup (uses .show class)
            const exportPopup = document.getElementById('batchExportPopup');
            const exportDropdown = document.getElementById('batchExportDropdown');
            if (exportPopup && exportDropdown && !exportDropdown.contains(e.target)) {
                exportPopup.classList.remove('show');
            }
        });
    };

    if (window.adminStudioAccessGranted) {
        initPointsPageBindings();
        return;
    }
    window.addEventListener('adminStudioAccessGranted', initPointsPageBindings, { once: true });
});

// ========================================
// BATCH DATE FILTER
// ========================================
let batchDateFilterValue = 'all';
let batchCustomDateFrom = null;
let batchCustomDateTo = null;

// Helper: Position fixed popup for mobile
function positionMobilePopup(filterElement) {
    if (window.innerWidth > 768) return; // Desktop uses absolute positioning
    const btn = filterElement.querySelector('.filter-btn');
    // Also support glass-popup (used by export dropdown)
    const popup = filterElement.querySelector('.filter-popup') || filterElement.querySelector('.glass-popup');
    if (btn && popup) {
        const rect = btn.getBoundingClientRect();
        // Set vertical position - place popup directly below button with small gap
        filterElement.style.setProperty('--popup-top', `${rect.bottom + 4}px`);
        // Set horizontal position - align to button's right edge for better fit
        const popupWidth = popup.offsetWidth || 180; // use actual width or estimate
        let left = rect.right - popupWidth; // align right edge of popup with right edge of button
        if (left < 12) left = 12;
        if (left + popupWidth > window.innerWidth - 12) {
            left = window.innerWidth - popupWidth - 12;
        }
        filterElement.style.setProperty('--popup-left', `${left}px`);
    }
}

function toggleBatchDateFilter() {
    const filter = document.getElementById('batchDateFilter');
    const wasOpen = filter.classList.contains('open');
    closeAllBatchDropdowns();
    if (!wasOpen) {
        filter.classList.add('open');
        positionMobilePopup(filter);
    }
}

function filterBatchByDate(value) {
    batchDateFilterValue = value;

    // Update label
    const labels = { all: '日期', today: '今天', week: '本周', month: '本月' };
    document.getElementById('batchDateLabel').textContent = labels[value] || '日期';

    // Update selected class
    document.querySelectorAll('#batchDatePopup .filter-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });

    // Close dropdown
    document.getElementById('batchDateFilter').classList.remove('open');

    // Apply filter
    applyBatchFilters();
}

function applyBatchFilters() {
    const searchTerm = document.getElementById('batchSearchInput')?.value.toLowerCase() || '';

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Filter batches
    filteredBatches = allBatches.filter(batch => {
        // Text search
        const matchesSearch = batch.name.toLowerCase().includes(searchTerm);

        // Date filter
        let matchesDate = true;
        const createdAt = new Date(batch.created_at);

        switch (batchDateFilterValue) {
            case 'today':
                matchesDate = createdAt >= startOfDay;
                break;
            case 'week':
                matchesDate = createdAt >= startOfWeek;
                break;
            case 'month':
                matchesDate = createdAt >= startOfMonth;
                break;
            case 'custom':
                if (batchCustomDateFrom) matchesDate = createdAt >= batchCustomDateFrom;
                if (batchCustomDateTo && matchesDate) matchesDate = createdAt <= batchCustomDateTo;
                break;
        }

        // Channel filter
        const matchesChannel = batchChannelFilterValue === 'all' || batch.channel === batchChannelFilterValue;

        // Package filter
        const matchesPackage = batchPackageFilterValue === 'all' ||
            (batch.points_packages?.id === batchPackageFilterValue);

        return matchesSearch && matchesDate && matchesChannel && matchesPackage;
    });

    // Sort batches
    filteredBatches.sort((a, b) => {
        let aVal, bVal;

        switch (batchSortField) {
            case 'name':
                aVal = a.name.toLowerCase();
                bVal = b.name.toLowerCase();
                break;
            case 'total_count':
                aVal = a.total_count;
                bVal = b.total_count;
                break;
            case 'used_count':
                aVal = a.used_count;
                bVal = b.used_count;
                break;
            case 'created_at':
            default:
                aVal = new Date(a.created_at).getTime();
                bVal = new Date(b.created_at).getTime();
                break;
        }

        if (aVal < bVal) return batchSortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return batchSortOrder === 'asc' ? 1 : -1;
        return 0;
    });

    // Reset to first page when filters change
    batchCurrentPage = 1;

    renderBatches();
}

// Search for redemption code and navigate to its batch
async function searchCodeInBatches() {
    const searchInput = document.getElementById('batchSearchInput');
    const searchTerm = searchInput?.value.trim().toUpperCase();

    if (!searchTerm) return;

    // Check if it looks like a redemption code (ZY- prefix)
    if (!searchTerm.startsWith('ZY-')) {
        // Regular batch name search - just apply filters
        applyBatchFilters();
        return;
    }

    // It's a redemption code - search in database
    try {
        const { data, error } = await getSupabase()
            .from('redemption_codes')
            .select('batch_id, batch:redemption_batches(id, name, channel, total_count, used_count, created_at, expires_at, notes, package_id, points_packages(id, name, points_amount))')
            .eq('code', searchTerm)
            .maybeSingle();

        if (error) throw error;

        if (data && data.batch_id && data.batch) {
            // Found the code - display only this batch in the table
            isCodeSearchInProgress = true;

            // Override the filtered batches to show only this batch
            filteredBatches = [data.batch];
            batchCurrentPage = 1;
            renderBatches();

            isCodeSearchInProgress = false;

            // Then open its batch details modal
            viewBatchCodes(data.batch_id);
        } else {
            alert('❌ 未找到该兑换码，请检查输入是否正确');
        }
    } catch (err) {
        console.error('Code search failed:', err);
        alert('搜索失败: ' + err.message);
    }
}

// Search for code without opening modal (for real-time input search)
async function searchCodeInBatchesNoModal(code) {
    try {
        const { data, error } = await getSupabase()
            .from('redemption_codes')
            .select('batch_id, batch:redemption_batches(id, name, channel, total_count, used_count, created_at, expires_at, notes, package_id, points_packages(id, name, points_amount))')
            .eq('code', code)
            .maybeSingle();

        if (error) throw error;

        if (data && data.batch_id && data.batch) {
            // Found the code - display only this batch in the table
            isCodeSearchInProgress = true;

            filteredBatches = [data.batch];
            batchCurrentPage = 1;
            renderBatches();

            isCodeSearchInProgress = false;
        } else {
            // Code not found - show empty state
            filteredBatches = [];
            renderBatches();
        }
    } catch (err) {
        console.error('Code search failed:', err);
    }
}

// ========================================
// CHANNEL FILTER
// ========================================
function toggleBatchChannelFilter() {
    const filter = document.getElementById('batchChannelFilter');
    const isOpen = filter.classList.contains('open');
    closeAllBatchDropdowns();
    if (!isOpen) {
        filter.classList.add('open');
        positionMobilePopup(filter);
    }
}

function filterBatchByChannel(value) {
    batchChannelFilterValue = value;
    const labels = { all: '渠道', xianyu: '闲鱼', taobao: '淘宝', manual: '手动', promotion: '促销', test: '测试' };
    document.getElementById('batchChannelLabel').textContent = labels[value] || '渠道';
    document.querySelectorAll('#batchChannelPopup .filter-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });
    document.getElementById('batchChannelFilter').classList.remove('open');
    applyBatchFilters();
}

// ========================================
// PACKAGE FILTER
// ========================================
function toggleBatchPackageFilter() {
    const filter = document.getElementById('batchPackageFilter');
    const isOpen = filter.classList.contains('open');
    closeAllBatchDropdowns();
    if (!isOpen) {
        filter.classList.add('open');
        positionMobilePopup(filter);
    }
}

function filterBatchByPackage(value) {
    batchPackageFilterValue = value;
    const pkg = allPackages.find(p => p.id === value);
    document.getElementById('batchPackageLabel').textContent = value === 'all' ? '套餐' : (pkg?.name || '套餐');
    document.querySelectorAll('#batchPackagePopup .filter-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });
    document.getElementById('batchPackageFilter').classList.remove('open');
    applyBatchFilters();
}

function closeAllBatchDropdowns() {
    ['batchDateFilter', 'batchChannelFilter', 'batchPackageFilter'].forEach(id => {
        document.getElementById(id)?.classList.remove('open');
    });
}

// ========================================
// SORTING
// ========================================
function sortBatches(field) {
    if (batchSortField === field) {
        batchSortOrder = batchSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        batchSortField = field;
        batchSortOrder = field === 'created_at' ? 'desc' : 'asc'; // Default desc for dates
    }

    // Update sort icons
    document.querySelectorAll('#batchesTable th.sortable .sort-icon').forEach(icon => {
        icon.classList.remove('fa-sort-up', 'fa-sort-down', 'active');
        icon.classList.add('fa-sort');
    });

    const activeHeader = document.querySelector(`#batchesTable th[data-sort="${field}"] .sort-icon`);
    if (activeHeader) {
        activeHeader.classList.remove('fa-sort');
        activeHeader.classList.add(batchSortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down', 'active');
    }

    applyBatchFilters();
}

// ========================================
// PAGINATION
// ========================================
function updatePaginationUI() {
    let paginationContainer = document.getElementById('batchPagination');

    // Create pagination container if it doesn't exist
    // Place it OUTSIDE the scrollable .glass-panel, directly in #points-view-batches
    if (!paginationContainer) {
        const viewSection = document.getElementById('points-view-batches');
        if (viewSection) {
            paginationContainer = document.createElement('div');
            paginationContainer.id = 'batchPagination';
            paginationContainer.className = 'pagination-controls';
            viewSection.appendChild(paginationContainer);
        }
    }

    if (!paginationContainer) return;

    const totalPages = Math.ceil(filteredBatches.length / batchPageSize);

    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    paginationContainer.innerHTML = `
        <button class="pagination-btn" onclick="goToBatchPage(${batchCurrentPage - 1})" ${batchCurrentPage === 1 ? 'disabled' : ''}>
            <i class="fas fa-chevron-left"></i>
        </button>
        <span class="pagination-info">${batchCurrentPage} / ${totalPages}</span>
        <button class="pagination-btn" onclick="goToBatchPage(${batchCurrentPage + 1})" ${batchCurrentPage >= totalPages ? 'disabled' : ''}>
            <i class="fas fa-chevron-right"></i>
        </button>
        <span class="pagination-total">(共 ${filteredBatches.length} 条)</span>
    `;
}

function goToBatchPage(page) {
    const totalPages = Math.ceil(filteredBatches.length / batchPageSize);
    if (page < 1 || page > totalPages) return;
    batchCurrentPage = page;
    renderBatches();
}

// ========================================
// BATCH SELECTION
// ========================================
function toggleBatchSelectMode() {
    batchSelectMode = !batchSelectMode;

    // Use unique IDs specific to Points module to avoid conflicts with Gallery module
    const checkboxHeader = document.getElementById('batchCheckboxHeader');
    const menuContainer = document.getElementById('pointsBatchMenuContainer');
    const countWrapper = document.getElementById('pointsBatchSelectedCountWrapper');
    const selectBtn = document.getElementById('batchSelectToggle');

    if (batchSelectMode) {
        checkboxHeader.style.display = '';
        menuContainer.style.display = 'flex';
        countWrapper.style.display = 'flex';
        selectBtn.classList.add('active');
    } else {
        checkboxHeader.style.display = 'none';
        menuContainer.style.display = 'none';
        countWrapper.style.display = 'none';
        selectBtn.classList.remove('active');
        selectedBatchIds.clear();
        updateSelectedCount();
    }

    renderBatches();
}

function togglePointsBatchActionsMenu() {
    const menu = document.getElementById('pointsBatchActionsMenu');
    menu.classList.toggle('show');
}

// Close batch menu when clicking outside
document.addEventListener('click', (e) => {
    const container = document.getElementById('pointsBatchMenuContainer');
    const menu = document.getElementById('pointsBatchActionsMenu');
    if (container && menu && !container.contains(e.target)) {
        menu.classList.remove('show');
    }
});

function toggleBatchSelection(batchId) {
    if (selectedBatchIds.has(batchId)) {
        selectedBatchIds.delete(batchId);
    } else {
        selectedBatchIds.add(batchId);
    }
    updateSelectedCount();
    updateSelectAllCheckbox();

    // Update row visual state
    const row = document.querySelector(`tr[data-batch-id="${batchId}"]`);
    if (row) {
        row.classList.toggle('selected', selectedBatchIds.has(batchId));
    }
}

function toggleSelectAllBatches() {
    const checkbox = document.getElementById('selectAllBatches');
    const start = (batchCurrentPage - 1) * batchPageSize;
    const end = start + batchPageSize;
    const pageBatches = filteredBatches.slice(start, end);

    if (checkbox.checked) {
        pageBatches.forEach(b => selectedBatchIds.add(b.id));
    } else {
        pageBatches.forEach(b => selectedBatchIds.delete(b.id));
    }

    updateSelectedCount();
    renderBatches();
}

function updateSelectAllCheckbox() {
    const checkbox = document.getElementById('selectAllBatches');
    if (!checkbox) return;

    const start = (batchCurrentPage - 1) * batchPageSize;
    const end = start + batchPageSize;
    const pageBatches = filteredBatches.slice(start, end);

    const allSelected = pageBatches.length > 0 && pageBatches.every(b => selectedBatchIds.has(b.id));
    checkbox.checked = allSelected;
}

function updateSelectedCount() {
    const countEl = document.getElementById('pointsBatchSelectedCount');
    if (countEl) {
        countEl.textContent = selectedBatchIds.size;
    }
}

function clearBatchSelection() {
    selectedBatchIds.clear();
    updateSelectedCount();
    const checkbox = document.getElementById('selectAllBatches');
    if (checkbox) checkbox.checked = false;

    // If in select mode, exit it
    if (batchSelectMode) {
        toggleBatchSelectMode();
    } else {
        renderBatches();
    }
}

// ========================================
// BULK DELETE WITH OPTIONS
// ========================================
async function batchDeleteBatches() {
    if (selectedBatchIds.size === 0) {
        alert('请先选择要删除的批次');
        return;
    }

    // Close the batch menu
    const menu = document.getElementById('pointsBatchActionsMenu');
    if (menu) menu.classList.remove('show');

    // First, check if any selected batches have used codes
    const idsArray = Array.from(selectedBatchIds);
    let usedCodesCount = 0;
    let totalCodesCount = 0;

    try {
        const { data, error } = await getSupabase()
            .from('redemption_codes')
            .select('status')
            .in('batch_id', idsArray);

        if (error) throw error;

        totalCodesCount = data?.length || 0;
        usedCodesCount = data?.filter(c => c.status === 'used').length || 0;

    } catch (err) {
        alert('查询失败: ' + err.message);
        return;
    }

    // Show delete options modal
    showDeleteOptionsModal(idsArray, usedCodesCount, totalCodesCount);
}

function showDeleteOptionsModal(batchIds, usedCount, totalCount) {
    // Remove existing modal
    document.querySelector('.delete-options-modal-overlay')?.remove();

    const hasUsedCodes = usedCount > 0;
    const batchCount = batchIds.length;

    const modalHtml = `
        <div class="codes-modal-overlay delete-options-modal-overlay" onclick="closeDeleteOptionsModal(event)">
            <div class="codes-modal delete-options-modal" onclick="event.stopPropagation()" style="max-width: 520px; height: auto;">
                <div class="codes-modal-header">
                    <h3>⚠️ 删除批次确认</h3>
                    <button class="modal-close-btn" onclick="closeDeleteOptionsModal()">✕</button>
                </div>
                <div class="codes-modal-body" style="padding: 24px;">
                    <div class="delete-summary">
                        <p>即将删除 <strong>${batchCount}</strong> 个批次，共 <strong>${totalCount}</strong> 个兑换码</p>
                        ${hasUsedCodes ? `<p class="warning-text">⚠️ 其中 <strong>${usedCount}</strong> 个已被用户使用</p>` : '<p class="success-text">✅ 所有兑换码均未使用</p>'}
                    </div>
                    
                    <div class="delete-options">
                        <label class="delete-option ${!hasUsedCodes ? 'recommended' : ''}">
                            <input type="radio" name="deleteOption" value="keep" ${!hasUsedCodes ? 'checked' : ''}>
                            <div class="option-content">
                                <span class="option-title">📋 仅删除记录</span>
                                <span class="option-desc">删除批次和兑换码记录，用户已获得的积分保留不变</span>
                            </div>
                        </label>
                        
                        ${hasUsedCodes ? `
                        <label class="delete-option danger-option">
                            <input type="radio" name="deleteOption" value="revoke">
                            <div class="option-content">
                                <span class="option-title">💸 收回积分并删除</span>
                                <span class="option-desc">撤销所有已使用的兑换码，扣回用户积分，然后删除记录</span>
                            </div>
                        </label>
                        
                        <label class="delete-option safe-option" ${hasUsedCodes ? 'checked' : ''}>
                            <input type="radio" name="deleteOption" value="block" ${hasUsedCodes ? 'checked' : ''}>
                            <div class="option-content">
                                <span class="option-title">🛡️ 仅删除未使用的码</span>
                                <span class="option-desc">保留已使用的兑换码记录（审计用），仅删除未使用的码</span>
                            </div>
                        </label>
                        ` : ''}
                    </div>
                    
                    <div class="delete-actions">
                        <button class="btn-secondary" onclick="closeDeleteOptionsModal()">取消</button>
                        <button class="btn-danger" onclick="executeDeleteWithOption('${batchIds.join(',')}')">
                            <i class="fas fa-trash"></i> 确认删除
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeDeleteOptionsModal(event) {
    if (!event || event.target.classList.contains('delete-options-modal-overlay')) {
        document.querySelector('.delete-options-modal-overlay')?.remove();
    }
}

async function executeDeleteWithOption(batchIdsStr) {
    const batchIds = batchIdsStr.split(',');
    const selectedOption = document.querySelector('input[name="deleteOption"]:checked')?.value;

    if (!selectedOption) {
        alert('请选择一个删除选项');
        return;
    }

    const btn = document.querySelector('.delete-options-modal .btn-danger');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';

    try {
        if (selectedOption === 'revoke') {
            // Option B: Revoke all used codes first
            const { data: usedCodes, error: fetchError } = await getSupabase()
                .from('redemption_codes')
                .select('code')
                .in('batch_id', batchIds)
                .eq('status', 'used');

            if (fetchError) throw fetchError;

            // Revoke each code
            let revokedCount = 0;
            for (const code of (usedCodes || [])) {
                try {
                    await getSupabase().rpc('fn_revoke_code', {
                        p_code: code.code,
                        p_reason: '批次删除-自动撤销'
                    });
                    revokedCount++;
                } catch (e) {
                    console.warn(`Failed to revoke ${code.code}:`, e);
                }
            }

            // Now delete all codes and batches
            await getSupabase().from('redemption_codes').delete().in('batch_id', batchIds);
            await getSupabase().from('redemption_batches').delete().in('id', batchIds);

            alert(`✅ 已撤销 ${revokedCount} 个兑换码的积分，并删除 ${batchIds.length} 个批次`);

        } else if (selectedOption === 'block') {
            // Option C: Only delete unused codes, keep used ones
            // Delete only pending/disabled codes
            await getSupabase()
                .from('redemption_codes')
                .delete()
                .in('batch_id', batchIds)
                .in('status', ['pending', 'disabled', 'locked']);

            // Check if any codes remain
            const { data: remaining } = await getSupabase()
                .from('redemption_codes')
                .select('id')
                .in('batch_id', batchIds);

            if (remaining && remaining.length > 0) {
                alert(`✅ 已删除未使用的兑换码\n\n⚠️ ${remaining.length} 个已使用的码被保留，批次未删除`);
            } else {
                // No codes remain, delete batches too
                await getSupabase().from('redemption_batches').delete().in('id', batchIds);
                alert(`✅ 已删除 ${batchIds.length} 个批次`);
            }

        } else {
            // Option A: Just delete records, keep user points
            await getSupabase().from('redemption_codes').delete().in('batch_id', batchIds);
            await getSupabase().from('redemption_batches').delete().in('id', batchIds);
            alert(`✅ 已删除 ${batchIds.length} 个批次（用户积分保留）`);
        }

        closeDeleteOptionsModal();
        selectedBatchIds.clear();
        updateSelectedCount();
        if (batchSelectMode) toggleBatchSelectMode();
        loadBatches();

    } catch (err) {
        console.error('Delete failed:', err);
        alert('删除失败: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> 确认删除';
    }
}

function initBatchDatePickers() {
    if (typeof flatpickr === 'undefined') return;

    const fromInput = document.getElementById('batchDateFrom');
    const toInput = document.getElementById('batchDateTo');

    if (fromInput) {
        flatpickr(fromInput, {
            locale: 'zh',
            dateFormat: 'Y-m-d',
            onChange: (dates) => {
                batchCustomDateFrom = dates[0] || null;
                if (batchCustomDateFrom) {
                    batchDateFilterValue = 'custom';
                    document.getElementById('batchDateLabel').textContent = '自定义';
                    applyBatchFilters();
                }
            }
        });
    }

    if (toInput) {
        flatpickr(toInput, {
            locale: 'zh',
            dateFormat: 'Y-m-d',
            onChange: (dates) => {
                batchCustomDateTo = dates[0] ? new Date(dates[0].getTime() + 86400000 - 1) : null;
                if (batchCustomDateTo) {
                    batchDateFilterValue = 'custom';
                    document.getElementById('batchDateLabel').textContent = '自定义';
                    applyBatchFilters();
                }
            }
        });
    }
}

function copyAllCodes() {
    const text = generatedCodes.join('\n');
    navigator.clipboard.writeText(text).then(() => {
        alert(`已复制 ${generatedCodes.length} 个兑换码`);
    });
}

function downloadCodesCSV() {
    const csv = 'code\n' + generatedCodes.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `codes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

// ========================================
// VIEW BATCH CODES
// ========================================
// VIEW BATCH CODES MODAL
// ========================================
async function viewBatchCodes(batchId) {
    const batch = allBatches.find(b => b.id === batchId);
    if (!batch) return;

    // Show loading modal immediately
    document.querySelector('.codes-modal-overlay')?.remove();
    const loadingHtml = `
        <div class="codes-modal-overlay" onclick="closeCodesModal(event)">
            <div class="codes-modal" onclick="event.stopPropagation()">
                <div class="codes-modal-header">
                    <h3>📦 ${batch.name}</h3>
                    <span class="codes-count">加载中...</span>
                    <button class="modal-close-btn" onclick="closeCodesModal()">✕</button>
                </div>
                <div class="codes-modal-body loading-state">
                    <div class="loading-text">⏳ 加载兑换码...</div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', loadingHtml);
    window.currentViewBatchId = batchId;

    try {
        // Query with user profile join
        const { data, error } = await getSupabase()
            .from('redemption_codes')
            .select(`
                id, code, status, used_at, used_by, external_order_id, 
                revoke_reason, revoked_at, revoked_by, expires_at,
                profiles:used_by ( username, email )
            `)
            .eq('batch_id', batchId)
            .order('created_at');

        if (error) throw error;

        // Collect unique revoker IDs to fetch their names
        const revokerIds = [...new Set(data.filter(c => c.revoked_by).map(c => c.revoked_by))];
        let revokerMap = {};

        if (revokerIds.length > 0) {
            const { data: revokers } = await getSupabase()
                .from('profiles')
                .select('id, username, email')
                .in('id', revokerIds);

            if (revokers) {
                revokers.forEach(r => {
                    revokerMap[r.id] = r.username || r.email || '未知';
                });
            }
        }

        // Update modal content (replace loading with actual data)
        const modalBody = document.querySelector('.codes-modal-body');
        const modalCount = document.querySelector('.codes-count');
        if (!modalBody) return; // Modal was closed

        modalCount.textContent = `${data.length} 个兑换码`;

        const tableHtml = data.map(c => {
            const statusMap = {
                pending: '<span class="status-badge pending">⏳ 待使用</span>',
                used: '<span class="status-badge used">✅ 已使用</span>',
                revoked: '<span class="status-badge revoked">❌ 已撤销</span>',
                locked: '<span class="status-badge locked">🔒 已锁定</span>',
                disabled: '<span class="status-badge disabled">🚫 已禁用</span>',
                expired: '<span class="status-badge expired">⌛ 已过期</span>'
            };

            // Build detail info
            let detailHtml = '-';
            if (c.status === 'used' && c.profiles) {
                const userName = c.profiles.username || c.profiles.email || '未知用户';
                const usedAt = c.used_at ? new Date(c.used_at).toLocaleString('zh-CN') : '';
                // Make user clickable to navigate to user management
                detailHtml = `<div class="code-detail">
                    <span class="detail-user user-link" onclick="navigateToUser('${c.used_by}')" title="查看用户详情">👤 ${userName}</span>
                    <span class="detail-time">${usedAt}</span>
                </div>`;
            } else if (c.status === 'revoked') {
                const reason = c.revoke_reason || '无原因';
                const revokedAt = c.revoked_at ? new Date(c.revoked_at).toLocaleString('zh-CN') : '';
                const userName = c.profiles ? (c.profiles.username || c.profiles.email) : null;
                const usedAt = c.used_at ? new Date(c.used_at).toLocaleString('zh-CN') : '';
                const revokerName = c.revoked_by ? (revokerMap[c.revoked_by] || '管理员') : '系统';
                detailHtml = `<div class="code-detail revoked-detail">
                    ${userName ? `<span class="detail-user strikethrough user-link" onclick="navigateToUser('${c.used_by}')" title="查看用户详情">👤 ${userName} (${usedAt})</span>` : ''}
                    <span class="detail-reason">📝 撤销: ${reason}</span>
                    <span class="detail-revoker">🛡️ 操作者: ${revokerName}</span>
                    <span class="detail-time">🕐 ${revokedAt}</span>
                </div>`;
            } else if (c.status === 'disabled') {
                detailHtml = '<span class="detail-disabled">管理员禁用</span>';
            }

            // Build action buttons
            let actionHtml = '';

            // Add expiry button for pending codes
            if (c.status === 'pending') {
                const expiryDisplay = c.expires_at
                    ? new Date(c.expires_at).toLocaleDateString('zh-CN')
                    : '无';
                actionHtml += `
                    <button class="btn-icon btn-expiry" onclick="setCodeExpiry('${c.code}', '${c.expires_at || ''}')" title="设置有效期">
                        <i class="fas fa-calendar-alt"></i>
                    </button>`;
                actionHtml += `
                    <button class="btn-revoke" onclick="disableCode('${c.code}')" title="禁用">
                        <i class="fas fa-ban"></i>
                    </button>`;
            } else if (c.status === 'used') {
                actionHtml = `
                    <button class="btn-revoke" onclick="revokeCode('${c.code}')" title="撤销">
                        <i class="fas fa-undo"></i> 撤销
                    </button>`;
            } else if (c.status === 'disabled') {
                actionHtml = `
                    <button class="btn-enable" onclick="enableCode('${c.code}')" title="启用">
                        <i class="fas fa-check"></i> 启用
                    </button>`;
            }

            if (!actionHtml) actionHtml = '-';

            // Format expiry display
            const expiryText = c.expires_at
                ? `<span class="code-expiry ${new Date(c.expires_at) < new Date() ? 'expired' : ''}">${new Date(c.expires_at).toLocaleDateString('zh-CN')}</span>`
                : '<span class="code-expiry-none">继承批次</span>';

            return `<tr class="code-row ${c.status}">
                <td class="code-cell">${c.code}</td>
                <td>${statusMap[c.status] || c.status}</td>
                <td>${expiryText}</td>
                <td>${detailHtml}</td>
                <td class="actions-cell">${actionHtml}</td>
            </tr>`;
        }).join('');

        // Remove loading state class
        modalBody.classList.remove('loading-state');

        modalBody.innerHTML = `
            <table class="codes-table">
                <thead><tr><th>兑换码</th><th>状态</th><th>有效期</th><th>详情</th><th>操作</th></tr></thead>
                <tbody>${tableHtml}</tbody>
            </table>
        `;

        // Reset scroll to top AFTER content is set
        modalBody.scrollTop = 0;

        // Enable horizontal scroll with mouse wheel on modal table
        enableHorizontalScroll(modalBody);

    } catch (err) {
        const modalBody = document.querySelector('.codes-modal-body');
        if (modalBody) {
            modalBody.innerHTML = `<div class="error-text" style="text-align:center;padding:40px;color:#dc2626;">❌ 加载失败: ${err.message}</div>`;
        }
    }
}

// Close codes modal
function closeCodesModal(event) {
    if (!event || event.target.classList.contains('codes-modal-overlay')) {
        document.querySelector('.codes-modal-overlay')?.remove();
        window.currentViewBatchId = null;
    }
}

// ========================================
// SET CODE EXPIRY
// ========================================
async function setCodeExpiry(code, currentExpiry) {
    // Format current expiry for input
    let defaultValue = '';
    if (currentExpiry) {
        const date = new Date(currentExpiry);
        defaultValue = date.toISOString().split('T')[0]; // YYYY-MM-DD format
    }

    const newExpiry = prompt(
        `设置兑换码 ${code} 的有效期\n\n` +
        `当前有效期: ${currentExpiry ? new Date(currentExpiry).toLocaleDateString('zh-CN') : '继承批次'}\n\n` +
        `请输入新的有效期 (格式: YYYY-MM-DD)\n` +
        `留空则清除独立有效期，恢复继承批次有效期:`,
        defaultValue
    );

    if (newExpiry === null) return; // User cancelled

    // Validate date format
    let expiresAt = null;
    if (newExpiry.trim()) {
        const parsed = new Date(newExpiry.trim());
        if (isNaN(parsed.getTime())) {
            alert('❌ 无效的日期格式，请使用 YYYY-MM-DD 格式');
            return;
        }
        // Set to end of day
        parsed.setHours(23, 59, 59, 999);
        expiresAt = parsed.toISOString();
    }

    try {
        const { error } = await getSupabase()
            .from('redemption_codes')
            .update({ expires_at: expiresAt })
            .eq('code', code);

        if (error) throw error;

        alert(`✅ 有效期已${expiresAt ? '设置为 ' + new Date(expiresAt).toLocaleDateString('zh-CN') : '清除'}`);

        // Refresh modal
        if (window.currentViewBatchId) {
            viewBatchCodes(window.currentViewBatchId);
        }
    } catch (err) {
        alert('❌ 设置失败: ' + err.message);
    }
}

// ========================================
// REVOKE CODE
// ========================================
async function revokeCode(code) {
    const reason = prompt(`确定要撤销兑换码 ${code} 吗？\n\n请输入撤销原因（可选）：`);

    if (reason === null) return; // User cancelled

    try {
        const { data, error } = await getSupabase()
            .rpc('fn_revoke_code', {
                p_code: code,
                p_reason: reason || '管理员撤销'
            });

        if (error) throw error;

        if (data.success) {
            const deducted = data.points_deducted || 0;
            alert(`✅ 撤销成功！${deducted > 0 ? `\n已扣除用户 ${deducted} 积分` : ''} `);

            // Refresh modal
            if (window.currentViewBatchId) {
                viewBatchCodes(window.currentViewBatchId);
            }

            // Refresh batch list
            loadBatches();
        } else {
            alert('❌ 撤销失败: ' + data.message);
        }
    } catch (err) {
        alert('❌ 撤销失败: ' + err.message);
    }
}

// ========================================
// EXPORT BATCH CSV
// ========================================
// ========================================
// EXPORT FUNCTIONS (Excel .xlsx)
// ========================================

// Toggle export dropdown menu
function toggleBatchExportMenu() {
    const dropdown = document.getElementById('batchExportDropdown');
    const popup = document.getElementById('batchExportPopup');

    // Close other dropdowns first
    closeAllBatchDropdowns();

    if (dropdown && popup) {
        const wasOpen = dropdown.classList.contains('open');
        dropdown.classList.toggle('open');
        popup.classList.toggle('show');

        // Position for mobile
        if (!wasOpen) {
            positionMobilePopup(dropdown);
        }
    }

    // Show/hide "export selected" option based on selection
    const exportSelectedOption = document.getElementById('exportSelectedOption');
    if (exportSelectedOption) {
        exportSelectedOption.style.display = selectedBatchIds.size > 0 ? 'flex' : 'none';
    }
}

// Export batch list to Excel
async function exportBatchList() {
    // Close menu
    closeAllBatchDropdowns();

    if (allBatches.length === 0) {
        alert('暂无批次可导出');
        return;
    }

    const channelLabels = {
        xianyu: '闲鱼',
        taobao: '淘宝',
        manual: '手动',
        promotion: '促销',
        test: '测试'
    };

    // Prepare data
    const data = allBatches.map(batch => ({
        '批次名称': batch.name,
        '套餐': batch.points_packages?.name || '-',
        '渠道': channelLabels[batch.channel] || batch.channel,
        '总数': batch.total_count,
        '已用': batch.used_count,
        '剩余': batch.total_count - batch.used_count,
        '使用率': `${batch.total_count > 0 ? Math.round((batch.used_count / batch.total_count) * 100) : 0}%`,
        '创建时间': new Date(batch.created_at).toLocaleString('zh-CN'),
        '过期时间': batch.expires_at ? new Date(batch.expires_at).toLocaleString('zh-CN') : '永不过期',
        '备注': batch.notes || ''
    }));

    // Create workbook
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '批次列表');

    // Set column widths
    ws['!cols'] = [
        { wch: 20 }, // 批次名称
        { wch: 15 }, // 套餐
        { wch: 8 },  // 渠道
        { wch: 8 },  // 总数
        { wch: 8 },  // 已用
        { wch: 8 },  // 剩余
        { wch: 8 },  // 使用率
        { wch: 18 }, // 创建时间
        { wch: 18 }, // 过期时间
        { wch: 20 }  // 备注
    ];

    // Export
    const now = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `批次列表_${now}.xlsx`);
}

// Export selected batches (with all codes)
async function exportSelectedBatches() {
    closeAllBatchDropdowns();

    if (selectedBatchIds.size === 0) {
        alert('请先选择要导出的批次');
        return;
    }

    try {
        const wb = XLSX.utils.book_new();
        const usedNames = new Set();
        let index = 1;

        for (const batchId of selectedBatchIds) {
            const batch = allBatches.find(b => b.id === batchId);
            if (!batch) continue;

            const sheetData = await getBatchCodesData(batchId);
            const ws = XLSX.utils.json_to_sheet(sheetData);

            // Truncate sheet name to 31 chars (Excel limit) and ensure uniqueness
            let baseName = batch.name.slice(0, 28).replace(/[\\\\/\*\?\[\]:]/g, '_');
            let sheetName = baseName;

            // If name already used, append index
            while (usedNames.has(sheetName)) {
                sheetName = `${baseName}_${index}`;
                index++;
            }
            usedNames.add(sheetName);

            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }

        const now = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `选中批次_${selectedBatchIds.size}个_${now}.xlsx`);

    } catch (err) {
        alert('导出失败: ' + err.message);
    }
}

// Export single batch codes to Excel
async function exportBatchCodes(batchId) {
    const batch = allBatches.find(b => b.id === batchId);
    if (!batch) return;

    try {
        const data = await getBatchCodesData(batchId);

        // Create workbook
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '兑换码列表');

        // Set column widths
        ws['!cols'] = [
            { wch: 18 }, // 兑换码
            { wch: 10 }, // 状态
            { wch: 18 }, // 创建时间
            { wch: 15 }, // 使用者
            { wch: 18 }, // 使用时间
            { wch: 20 }, // 撤销原因
            { wch: 15 }, // 撤销者
            { wch: 18 }  // 撤销时间
        ];

        // Export
        const now = new Date().toISOString().slice(0, 10);
        const fileName = `${batch.name.replace(/\s+/g, '_')}_兑换码_${now}.xlsx`;
        XLSX.writeFile(wb, fileName);

    } catch (err) {
        alert('导出失败: ' + err.message);
    }
}

// Helper: Get batch codes data for export
async function getBatchCodesData(batchId) {
    const { data, error } = await getSupabase()
        .from('redemption_codes')
        .select(`
            code, status, created_at, used_at, 
            revoke_reason, revoked_at, revoked_by,
            profiles:used_by ( username, email )
        `)
        .eq('batch_id', batchId)
        .order('created_at');

    if (error) throw error;

    // Get revoker info
    const revokerIds = [...new Set(data.filter(c => c.revoked_by).map(c => c.revoked_by))];
    let revokerMap = {};
    if (revokerIds.length > 0) {
        const { data: revokers } = await getSupabase()
            .from('profiles')
            .select('id, username, email')
            .in('id', revokerIds);
        if (revokers) {
            revokers.forEach(r => {
                revokerMap[r.id] = r.username || r.email || '未知';
            });
        }
    }

    const statusMap = { pending: '待使用', used: '已使用', revoked: '已撤销', locked: '已锁定', expired: '已过期', disabled: '已禁用' };

    return data.map(c => ({
        '兑换码': c.code,
        '状态': statusMap[c.status] || c.status,
        '创建时间': c.created_at ? new Date(c.created_at).toLocaleString('zh-CN') : '',
        '使用者': c.profiles ? (c.profiles.username || c.profiles.email || '') : '',
        '使用时间': c.used_at ? new Date(c.used_at).toLocaleString('zh-CN') : '',
        '撤销原因': c.revoke_reason || '',
        '撤销者': c.revoked_by ? (revokerMap[c.revoked_by] || '管理员') : '',
        '撤销时间': c.revoked_at ? new Date(c.revoked_at).toLocaleString('zh-CN') : ''
    }));
}

// Legacy function name for backward compatibility
async function exportBatchCSV(batchId) {
    return exportBatchCodes(batchId);
}

// ========================================
// BATCH EDITING
// ========================================

// Open batch edit modal
function openBatchEditModal(batchId) {
    const batch = allBatches.find(b => b.id === batchId);
    if (!batch) return;

    // Remove existing modal if any
    document.querySelector('.edit-modal-overlay')?.remove();

    const modalHtml = `
        <div class="edit-modal-overlay" onclick="closeBatchEditModal(event)">
            <div class="edit-modal" onclick="event.stopPropagation()">
                <div class="edit-modal-header">
                    <h3>✏️ 编辑批次</h3>
                    <button class="edit-modal-close" onclick="closeBatchEditModal()">✕</button>
                </div>
                <form id="batchEditForm" class="edit-modal-form" onsubmit="saveBatchEdit(event, '${batchId}')">
                    <div class="edit-field">
                        <label>批次名称</label>
                        <input type="text" id="editBatchName" value="${batch.name}" required maxlength="100">
                    </div>
                    <div class="edit-field">
                        <label>备注</label>
                        <textarea id="editBatchNotes" rows="3" placeholder="添加备注信息...">${batch.notes || ''}</textarea>
                    </div>
                    <div class="edit-field">
                        <label>过期时间</label>
                        <input type="text" id="editBatchExpires" class="flatpickr-input" 
                            value="${batch.expires_at ? new Date(batch.expires_at).toISOString().slice(0, 16).replace('T', ' ') : ''}" 
                            placeholder="留空表示永不过期">
                    </div>
                    <button type="submit" class="edit-modal-save">
                        <i class="fas fa-save"></i> 保存修改
                    </button>
                </form>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Initialize flatpickr for expires input
    if (typeof flatpickr !== 'undefined') {
        flatpickr('#editBatchExpires', {
            enableTime: true,
            dateFormat: "Y-m-d H:i",
            time_24hr: true,
            locale: "zh",
            allowInput: true,
            minDate: "today"
        });
    }
}

function closeBatchEditModal(event) {
    if (!event || event.target.classList.contains('edit-modal-overlay')) {
        document.querySelector('.edit-modal-overlay')?.remove();
    }
}

async function saveBatchEdit(event, batchId) {
    event.preventDefault();

    const name = document.getElementById('editBatchName').value.trim();
    const notes = document.getElementById('editBatchNotes').value.trim();
    const expiresInput = document.getElementById('editBatchExpires').value.trim();
    const expiresAt = expiresInput ? new Date(expiresInput).toISOString() : null;

    if (!name) {
        alert('批次名称不能为空');
        return;
    }

    const btn = event.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 保存中...';

    try {
        const { error } = await getSupabase()
            .from('redemption_batches')
            .update({
                name: name,
                notes: notes || null,
                expires_at: expiresAt
            })
            .eq('id', batchId);

        if (error) throw error;

        alert('✅ 保存成功');
        closeBatchEditModal();
        loadBatches();

    } catch (err) {
        alert('保存失败: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> 保存';
    }
}

// ========================================
// CODE STATUS MANAGEMENT
// ========================================

// Disable a single code (mark as disabled/invalid)
async function disableCode(code) {
    const confirmed = confirm(`确定要禁用兑换码 ${code} 吗？\n\n禁用后该码将无法被使用。`);
    if (!confirmed) return;

    try {
        const { error } = await getSupabase()
            .from('redemption_codes')
            .update({ status: 'disabled' })
            .eq('code', code);

        if (error) throw error;

        alert('✅ 已禁用该兑换码');

        // Refresh modal if open
        if (window.currentViewBatchId) {
            viewBatchCodes(window.currentViewBatchId);
        }
        loadBatches();

    } catch (err) {
        alert('禁用失败: ' + err.message);
    }
}

// Enable a previously disabled code
async function enableCode(code) {
    try {
        const { error } = await getSupabase()
            .from('redemption_codes')
            .update({ status: 'pending' })
            .eq('code', code)
            .eq('status', 'disabled');

        if (error) throw error;

        alert('✅ 已启用该兑换码');

        if (window.currentViewBatchId) {
            viewBatchCodes(window.currentViewBatchId);
        }
        loadBatches();

    } catch (err) {
        alert('启用失败: ' + err.message);
    }
}

// Batch invalidate all unused codes in selected batches
async function batchInvalidateCodes() {
    if (selectedBatchIds.size === 0) {
        alert('请先选择要操作的批次');
        return;
    }

    const batchNames = Array.from(selectedBatchIds)
        .map(id => allBatches.find(b => b.id === id)?.name)
        .filter(Boolean)
        .join('、');

    const confirmed = confirm(`确定要作废以下批次中所有未使用的兑换码吗？\n\n批次: ${batchNames}\n\n此操作不可恢复！`);
    if (!confirmed) return;

    try {
        const idsArray = Array.from(selectedBatchIds);

        const { data, error } = await getSupabase()
            .from('redemption_codes')
            .update({ status: 'disabled' })
            .in('batch_id', idsArray)
            .eq('status', 'pending');

        if (error) throw error;

        alert(`✅ 操作完成`);

        // Close menu and refresh
        const menu = document.getElementById('pointsBatchActionsMenu');
        if (menu) menu.classList.remove('show');

        loadBatches();

    } catch (err) {
        alert('操作失败: ' + err.message);
    }
}

// Navigate to user from redemption record
function navigateToUser(userId) {
    if (!userId) return;

    // Close the codes modal first
    document.querySelector('.codes-modal-overlay')?.remove();

    // Switch to users module and open the user
    if (typeof switchModule === 'function') {
        switchModule('users');
        // Wait for module switch then open user modal
        setTimeout(() => {
            if (typeof openUserModal === 'function') {
                openUserModal(userId);
            }
        }, 300);
    }
}

// ========================================
// LOOKUP CODE
// ========================================
async function lookupCode() {
    const input = document.getElementById('lookupCodeInput');
    const code = input.value.trim(); // Do not uppercase immediately, UUIDs might be lowercase
    const resultDiv = document.getElementById('lookupResult');

    if (!code) {
        alert('请输入兑换码或订单号');
        return;
    }

    // Show loading state
    resultDiv.innerHTML = '<div class="lookup-card"><div class="lookup-status">🔍 查询中...</div></div>';
    resultDiv.style.display = 'block';

    try {
        // 1. Try Redeem Code RPC first
        const { data: codeData, error: codeError } = await getSupabase().rpc('fn_check_code_status', {
            p_code: code.toUpperCase() // Codes are usually uppercase
        });

        if (codeData && codeData.valid) {
            renderLookupResult(codeData, 'code');
            return;
        }

        // 2. If not a valid code, check if it is a Transaction ID (UUID) in points_ledger
        // UUID Regex check
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);

        if (isUUID) {
            const { data: ledgerData, error: ledgerError } = await getSupabase()
                .from('points_ledger')
                .select('*, profiles:user_id(username, email)')
                .eq('id', code)
                .maybeSingle();

            if (ledgerData) {
                // If unlock_prompt, try to fetch prompt title
                if (ledgerData.reason === 'unlock_prompt' && ledgerData.reference_id) {
                    const { data: promptData } = await getSupabase()
                        .from('prompts')
                        .select('title')
                        .eq('id', ledgerData.reference_id)
                        .maybeSingle();

                    if (promptData) {
                        ledgerData.prompt_title = promptData.title;
                    }
                }

                renderLookupResult(ledgerData, 'ledger');
                return;
            }
        }

        // If neither found or error
        if (codeError && !isUUID) throw codeError;

        throw new Error('未找到该兑换码/订单号');

    } catch (err) {
        resultDiv.innerHTML = `<div class="lookup-card invalid"><div class="lookup-status">❌ 查询失败</div><p>${err.message}</p></div>`;
        resultDiv.style.display = 'block';
    }
}

function renderLookupResult(data, type) {
    const resultDiv = document.getElementById('lookupResult');

    if (type === 'ledger') {
        const reason = formatLedgerReason ? formatLedgerReason(data.reason, data.created_at, data.reference_id) : data.reason;
        // Extract text from HTML if formatLedgerReason returns HTML
        const reasonText = reason.includes('<') ? reason.replace(/<[^>]+>/g, '') : reason;

        resultDiv.innerHTML = `
            <div class="lookup-card valid">
                <div class="lookup-query-type">🧾 积分流水查询</div>
                <div class="lookup-status">✅ 记录存在</div>
                
                <div class="lookup-detail">
                    <span class="label">流水ID:</span>
                    <span class="value code-value" title="${data.id}">${data.id}</span>
                </div>
                <div class="lookup-detail">
                    <span class="label">类型/原因:</span>
                    <span class="value text-warning">${data.reason}</span>
                </div>
                <div class="lookup-detail">
                    <span class="label">关联ID:</span>
                    <span class="value">
                        <span class="code-value" style="font-size: 0.9rem;">${data.reference_id || '-'}</span>
                        ${data.prompt_title ? `<div class="lookup-prompt-title">Prompt: ${data.prompt_title}</div>` : ''}
                    </span>
                </div>
                <div class="lookup-detail">
                    <span class="label">变动金额:</span>
                    <span class="value ${data.amount >= 0 ? 'text-success' : 'text-danger'}" style="font-size:18px;font-weight:bold;">
                        ${data.amount >= 0 ? '+' : ''}${data.amount}
                    </span>
                </div>
                <div class="lookup-detail">
                    <span class="label">用户:</span>
                    <span class="value">👤 ${data.profiles?.username || data.profiles?.email || '未知用户'}</span>
                </div>
                <div class="lookup-detail">
                    <span class="label">创建时间:</span>
                    <span class="value" style="font-family:var(--font-sans);">${new Date(data.created_at).toLocaleString('zh-CN')}</span>
                </div>
            </div>
        `;
        resultDiv.style.display = 'block';
        return;
    }

    // Default: Redeem Code Result
    const statusLabels = {
        pending: '⏳ 待使用',
        locked: '🔒 已锁定',
        used: '✅ 已使用',
        revoked: '❌ 已撤销',
        disabled: '🚫 已禁用'
    };
    const queryTypeLabel = data.query_type === 'order' ? '📦 订单号查询' : '🎫 兑换码查询';

    resultDiv.innerHTML = `
            <div class="lookup-card ${data.valid ? 'valid' : 'invalid'}">
                <div class="lookup-query-type">${queryTypeLabel}</div>
                <div class="lookup-status">${statusLabels[data.status] || data.status}</div>
                ${data.code ? `
                <div class="lookup-detail">
                    <span class="label">兑换码:</span>
                    <span class="value code-value">${data.code}</span>
                </div>
                ` : ''}
                ${data.external_order_id ? `
                <div class="lookup-detail">
                    <span class="label">订单号:</span>
                    <span class="value">${data.external_order_id}</span>
                </div>
                ` : ''}
                ${data.batch_id ? `
                <div class="lookup-detail">
                    <span class="label">所属批次:</span>
                    <span class="value">
                        <a href="javascript:void(0)" class="batch-link" onclick="navigateToBatch('${data.batch_id}')">
                            📦 ${data.batch_name || '未命名批次'}
                        </a>
                    </span>
                </div>
                ` : ''}
                <div class="lookup-detail">
                    <span class="label">套餐:</span>
                    <span class="value">${data.package_name || '-'}</span>
                </div>
                <div class="lookup-detail">
                    <span class="label">积分:</span>
                    <span class="value">${data.points || 0}</span>
                </div>
                ${data.used_by ? `
                <div class="lookup-detail">
                    <span class="label">使用者:</span>
                    <span class="value">👤 ${data.used_by}</span>
                </div>
                ` : ''}
                ${data.used_at ? `
                <div class="lookup-detail">
                    <span class="label">使用时间:</span>
                    <span class="value">${new Date(data.used_at).toLocaleString('zh-CN')}</span>
                </div>
                ` : ''}
                ${data.revoke_reason ? `
                <div class="lookup-detail">
                    <span class="label">撤销原因:</span>
                    <span class="value" style="color:#dc2626;">📝 ${data.revoke_reason}</span>
                </div>
                ` : ''}
                ${data.revoked_by ? `
                <div class="lookup-detail">
                    <span class="label">撤销者:</span>
                    <span class="value">🛡️ ${data.revoked_by}</span>
                </div>
                ` : ''}
                ${data.revoked_at ? `
                <div class="lookup-detail">
                    <span class="label">撤销时间:</span>
                    <span class="value">${new Date(data.revoked_at).toLocaleString('zh-CN')}</span>
                </div>
                ` : ''}
                ${data.expires_at ? `
                <div class="lookup-detail">
                    <span class="label">过期时间:</span>
                    <span class="value">${new Date(data.expires_at).toLocaleString('zh-CN')}</span>
                </div>
                ` : ''}
            </div>
            `;
    resultDiv.style.display = 'block';
}

// Navigate to batch management and open specific batch
function navigateToBatch(batchId) {
    // Switch to batches tab
    const batchTab = document.querySelector('#module-points .admin-tab[data-tab="points-view-batches"]');
    if (batchTab) {
        batchTab.click();
    }

    // Wait for tab switch, then open batch details
    setTimeout(() => {
        viewBatchCodes(batchId);
    }, 200);
}

// ========================================
// INIT
// ========================================
// Triggered when points module is activated
document.addEventListener('DOMContentLoaded', () => {
    const initPointsIndicator = () => {
        // Initialize tab indicator position for Points module
        setTimeout(() => {
            const activeTab = document.querySelector('#module-points .admin-tab.active');
            const indicator = document.querySelector('#module-points .admin-tab-indicator');
            if (activeTab && indicator) {
                indicator.style.width = `${activeTab.offsetWidth} px`;
                indicator.style.left = `${activeTab.offsetLeft} px`;
            }
        }, 100);
    };

    if (window.adminStudioAccessGranted) {
        initPointsIndicator();
        return;
    }
    window.addEventListener('adminStudioAccessGranted', initPointsIndicator, { once: true });
});
