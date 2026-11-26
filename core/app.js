// Escape user-entered text before putting it into innerHTML / print HTML
function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Round money to 2 decimals (avoids 0.8999999999999999 style values)
// Debt an invoice created for the customer by itself:
// invoice total minus the older balance it carried (prevBalance), plus anything later returned
// (returns shrink inv.total, and are listed as their own credit lines).
function invoiceOwnDebit(inv, allReturns) {
    const returned = (allReturns || [])
        .filter(r => r.invoiceId == inv.id)
        .reduce((s, r) => s + (Number(r.total) || 0), 0);
    return Math.max(0, round2((Number(inv.total) || 0) + returned - (Number(inv.prevBalance) || 0)));
}

// Sales value of an invoice = what was sold, WITHOUT the customer's older balance (prevBalance)
function invSales(inv) {
    return Math.max(0, round2((Number(inv?.total) || 0) - (Number(inv?.prevBalance) || 0)));
}
// Debt created by this invoice alone (remaining minus the older balance it carried)
function invOwnRemaining(inv) {
    return Math.max(0, round2((Number(inv?.remaining) || 0) - (Number(inv?.prevBalance) || 0)));
}
// Invoices store UTC ISO dates; all day/month grouping must use the local day (Egypt is UTC+2/+3)
function invDate(inv) {
    if (!inv || !inv.date) return '';
    const d = new Date(inv.date);
    return isNaN(d) ? String(inv.date).slice(0, 10) : d.toLocaleDateString('en-CA');
}
// Profit of an invoice: item margins minus the discount given
function invProfit(inv) {
    const items = Array.isArray(inv?.items) ? inv.items : [];
    const margin = items.reduce((s, it) => s + ((Number(it.salePrice) || 0) - (Number(it.purchasePrice) || 0)) * (Number(it.qty) || 0), 0);
    return round2(margin - (Number(inv?.discount) || 0));
}

// Cash handed back to customers for returned goods on a given local day (optionally for one agent)
function cashRefundsOn(returns, date, agentId = null) {
    return round2((returns || [])
        .filter(r => (Number(r.cashRefund) || 0) > 0 && invDate(r) === date && (agentId === null || r.agentId == agentId))
        .reduce((s, r) => s + (Number(r.cashRefund) || 0), 0));
}

function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// --- Global Guard & Error Handling (MUST BE FIRST) ---
window.onerror = function(msg, url, lineNo, columnNo, error) {
    // Ignore cross-origin script errors (line 0 from CDNs)
    if (lineNo === 0 || msg === 'Script error.') return false;
    const errorMsg = `خطأ في النظام: ${msg} \nالسطر: ${lineNo}`;
    console.error(errorMsg, error);
    return false;
};
window.onunhandledrejection = function(event) {
    console.error('Unhandled promise rejection:', event.reason);
};

// Main App State
const state = {
    currentPage: 'dashboard',
    theme: 'dark',
    user: { name: 'Admin', role: 'admin' },
    cache: {
        products: [],
        customers: [],
        agents: []
    }
};

// Debounce helper to prevent excessive function calls
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// DOM Elements
const sidebarItems = document.querySelectorAll('.nav-item');
const contentArea = document.getElementById('content-area');
const themeToggle = document.getElementById('theme-toggle');
const sidebar = document.getElementById('sidebar');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');

// Initialize App
async function init() {

    try {
        await db.init();
        if (db.isRemote) azApplyUser();

        // Pre-load static-ish data into cache for instant searching
        await refreshGlobalCache();
        
        setupGlobalGuards();
        setupEventListeners();
        if (db.isRemote) azSetupOnlineBanner();
        const firstPage = (state.user.role === 'seller') ? 'pos' : 'dashboard';
        document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.getAttribute('data-page') === firstPage));
        loadPage(firstPage);
    } catch (err) {
        console.error('Initialization failed:', err);
        alert('فشل بدء التشغيل: ' + err.message);
    }
}

async function refreshGlobalCache(store = null) {
    if (!store || store === 'products') state.cache.products = await db.getAll('products');
    if (!store || store === 'customers') state.cache.customers = await db.getAll('customers');
    if (!store || store === 'agents') state.cache.agents = await db.getAll('agents');
}

function setupGlobalGuards() {
    // Close any open dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        const customerResults = document.getElementById('customer-results');
        const productResults = document.getElementById('product-results');
        const customerInput = document.getElementById('pos-customer-name');
        const productInput = document.getElementById('pos-product-search');

        const inCustomerBox = customerResults && (customerResults.contains(e.target) || (customerInput && customerInput.contains(e.target)));
        const inProductBox = productResults && (productResults.contains(e.target) || (productInput && productInput.contains(e.target)));

        if (customerResults && !inCustomerBox) customerResults.style.display = 'none';
        if (productResults && !inProductBox) productResults.style.display = 'none';
    });

    // Log unexpected runtime errors to help long-term stability
    window.addEventListener('error', (event) => {
        console.error('Unhandled error:', event.error || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
    });

    // Global visible error handler for debugging
    window.onerror = function(msg, url, lineNo, columnNo, error) {
        // Ignore cross-origin script errors (line 0 from CDNs like Chart.js, XLSX)
        if (lineNo === 0 || msg === 'Script error.') return false;
        const errorMsg = `خطأ في النظام: ${msg} \nالسطر: ${lineNo}`;
        console.error(errorMsg, error);
        return false;
    };

    // Close mobile sidebar when tapping outside
    document.addEventListener('click', (e) => {
        if (!document.body.classList.contains('sidebar-open')) return;
        const sidebarEl = document.getElementById('sidebar');
        const btn = document.getElementById('mobile-menu-btn');
        const inSidebar = sidebarEl && sidebarEl.contains(e.target);
        const inBtn = btn && btn.contains(e.target);
        if (!inSidebar && !inBtn) document.body.classList.remove('sidebar-open');
    });

    // Initialize global keyboard navigation
    setupKeyboardNavigation();
}

function setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        // Skip if modifier key is pressed (except Shift for reverse tab)
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        
        const activeEl = document.activeElement;
        if (!activeEl) return;
        
        const isInput = ['INPUT', 'SELECT', 'BUTTON'].includes(activeEl.tagName) || activeEl.classList.contains('result-item');
        if (!isInput) return;

        if (e.key === 'Enter') {
            if (activeEl.classList.contains('result-item')) {
                e.preventDefault();
                activeEl.click();
                return;
            }
            if (activeEl.id === 'pos-product-search' || activeEl.id === 'sup-product-search') return;
            if (activeEl.tagName === 'BUTTON') return;

            e.preventDefault();
            const focusables = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([disabled]):not([readonly]), select:not([disabled]), button:not([disabled])'))
                .filter(el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden');
                
            let index = focusables.indexOf(activeEl);
            if (index > -1) {
                let direction = e.shiftKey ? -1 : 1;
                let nextIndex = index + direction;
                
                while(nextIndex >= 0 && nextIndex < focusables.length) {
                    const nextEl = focusables[nextIndex];
                    if (nextEl.tagName === 'BUTTON' && nextEl.className.includes('btn-delete')) {
                        nextIndex += direction;
                        continue;
                    }
                    nextEl.focus();
                    if (nextEl.select && typeof nextEl.select === 'function') setTimeout(() => nextEl.select(), 10);
                    return;
                }
            }
        }
        
        // DROPDOWN NAVIGATION
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (activeEl.classList.contains('result-item')) {
                e.preventDefault();
                const nextItem = e.key === 'ArrowDown' ? activeEl.nextElementSibling : activeEl.previousElementSibling;
                if (nextItem && nextItem.classList.contains('result-item')) {
                    nextItem.focus();
                } else if (e.key === 'ArrowUp' && !activeEl.previousElementSibling) {
                    const wrapper = activeEl.closest('.search-results-dropdown');
                    if (wrapper && wrapper.previousElementSibling && wrapper.previousElementSibling.tagName === 'INPUT') {
                        wrapper.previousElementSibling.focus();
                    }
                }
                return;
            } else if (activeEl.tagName === 'INPUT') {
                const drop = activeEl.nextElementSibling;
                if (drop && drop.classList.contains('search-results-dropdown') && drop.style.display === 'block') {
                    if (e.key === 'ArrowDown') {
                        const first = drop.querySelector('.result-item');
                        if (first) {
                            e.preventDefault();
                            first.focus();
                            return;
                        }
                    }
                }
            }
        }
        
        // GRID NAVIGATION FOR TABLES
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            const td = activeEl.closest('td');
            if (td) {
                const tr = td.parentElement;
                const tbody = tr.parentElement;
                
                // Allow left/right inside text inputs natively unless at boundaries
                if (activeEl.type === 'text' || activeEl.type === 'search') {
                    if (e.key === 'ArrowLeft' && activeEl.selectionStart !== 0) return;
                    if (e.key === 'ArrowRight' && activeEl.selectionEnd !== activeEl.value.length) return;
                }
                
                const colIndex = Array.from(tr.children).indexOf(td);
                const rowIndex = Array.from(tbody.children).indexOf(tr);
                
                let targetRowIndex = rowIndex;
                // RTL logic: ArrowLeft = next column, ArrowRight = prev column
                let targetColIndex = colIndex;
                
                if (e.key === 'ArrowDown') targetRowIndex++;
                else if (e.key === 'ArrowUp') targetRowIndex--;
                else if (e.key === 'ArrowLeft') targetColIndex++;
                else if (e.key === 'ArrowRight') targetColIndex--;
                
                if (targetRowIndex >= 0 && targetRowIndex < tbody.children.length) {
                    const targetRow = tbody.children[targetRowIndex];
                    let targetTd = targetRow.children[targetColIndex];
                    
                    // If target cell exists, find input inside it
                    if (targetTd) {
                        const targetInput = targetTd.querySelector('input:not([type="hidden"]), select, button');
                        if (targetInput) {
                            e.preventDefault();
                            targetInput.focus();
                            if (targetInput.select && typeof targetInput.select === 'function') setTimeout(() => targetInput.select(), 10);
                        }
                    }
                }
            }
        }
    });
}

function setupEventListeners() {
    // Sidebar Navigation
    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            const page = item.getAttribute('data-page');
            loadPage(page);
            
            // Update UI
            sidebarItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');

            // Auto close sidebar on mobile
            if (document.body.classList.contains('sidebar-open')) {
                document.body.classList.remove('sidebar-open');
            }
        });
    });

    // Mobile sidebar toggle
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.body.classList.toggle('sidebar-open');
        });
    }

    // Theme Toggle
    themeToggle.addEventListener('click', () => {
        state.theme = state.theme === 'dark' ? 'light' : 'dark';
        document.body.className = state.theme + '-mode';
        
        const icon = themeToggle.querySelector('i');
        const span = themeToggle.querySelector('span');
        
        if (state.theme === 'light') {
            icon.className = 'fas fa-moon';
            span.innerText = 'الوضع الليلي';
        } else {
            icon.className = 'fas fa-sun';
            span.innerText = 'الوضع المضيء';
        }
    });
}

async function loadPage(page) {
    if (db.isRemote && !azCanOpen(page)) page = 'pos';
    state.currentPage = page;
    document.body.classList.toggle('pos-page', page === 'pos');
    contentArea.innerHTML = '<div class="loader-wrapper"><div class="loader"></div></div>';
    
    // Using try-catch to ensure loader is replaced by content or error
    try {
        switch(page) {
            case 'dashboard': await renderDashboard(); break;
            case 'pos': await renderPOS(); break;
            case 'products': await renderProducts(); break;
            case 'warehouse': await renderWarehouse(); break;
            case 'audit': await renderAudit(); break;
            case 'customers': await renderCustomers(); break;
            case 'suppliers': await renderSuppliers(); break;
            case 'agents': await renderAgents(); break;
            case 'expenses': await renderExpenses(); break;
            case 'reports': await renderReports(); break;
            case 'settlement': await renderSettlement(); break;
            case 'settings': await renderSettings(); break;
            case 'my-invoices': await renderMyInvoices(); break;
            case 'barcodes': await renderBarcodes(); break;
            case 'customer-ledger': {
                const urlParams = new URLSearchParams(window.location.search);
                const id = urlParams.get('id');
                if (id) await showCustomerLedger(parseInt(id));
                else await renderCustomers();
                break;
            }
            case 'supplier-ledger': {
                const urlParams = new URLSearchParams(window.location.search);
                const id = urlParams.get('id');
                if (id) await showSupplierLedger(parseInt(id));
                else await renderSuppliers();
                break;
            }
            default: await renderDashboard();
        }
    } catch (err) {
        console.error('Page Load Error:', err);
        contentArea.innerHTML = `
            <div class="card error-card" style="text-align:center; padding: 3rem;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: var(--danger); margin-bottom: 1rem;"></i>
                <h3>حدث خطأ أثناء تحميل الصفحة</h3>
                <p>${err.message}</p>
                <button class="btn btn-new" style="margin-top: 1rem;" onclick="loadPage('dashboard')">العودة للرئيسية</button>
            </div>
        `;
    }
}


// --- Renderers ---

async function renderDashboard() {
    // Optimized Dashboard: Use cache for products/customers/agents
    const products = state.cache.products;
    const customers = state.cache.customers;
    const agents = state.cache.agents;
    
    // Date ranges
    const today = new Date().toLocaleDateString('en-CA');
    const monthPrefix = today.substring(0, 7); 
    const startDate = monthPrefix + '-01';
    const endDate = monthPrefix + '-31';
    // Invoice dates are stored in UTC, so widen the fetch by a day and filter by local day below
    const prevDay = new Date(new Date(startDate + 'T12:00:00').getTime() - 86400000).toLocaleDateString('en-CA');

    // Fetch only necessary data for the month
    const [invoicesRaw, expenses, dayClosures] = await Promise.all([
        db.getByDateRange('invoices', prevDay, endDate),
        db.getByDateRange('expenses', startDate, endDate),
        db.getByDateRange('dayClosures', startDate, endDate)
    ]);
    const invoices = (invoicesRaw || []).filter(inv => invDate(inv).startsWith(monthPrefix));
    
    // Stats Calculations
    const isClosedToday = (dayClosures || []).some(c => c?.date === today);
    const invoicesToday = isClosedToday ? [] : (invoices || []).filter(inv => invDate(inv) === today);
    const salesToday = isClosedToday ? 0 : invoicesToday.reduce((sum, inv) => sum + invSales(inv), 0);
    
    const salesMonth = (invoices || []).reduce((sum, inv) => sum + invSales(inv), 0);
    const totalExpenses = (expenses || []).reduce((sum, exp) => sum + (Number(exp?.amount) || 0), 0);
    
    // Profit Calc Optimization: reduce redundant calculations
    let actualProfit = 0;
    (invoices || []).forEach(inv => { actualProfit += invProfit(inv); });
    actualProfit -= totalExpenses;
    
    const lowStock = products.filter(p => p.stock <= p.minStock);
    
    // Top Products
    const productSalesMap = {};
    (invoices || []).forEach(inv => {
        inv.items.forEach(item => {
            productSalesMap[item.id] = (productSalesMap[item.id] || 0) + (Number(item.qty) || 0);
        });
    });
    
    const topProducts = products
        .map(p => ({ ...p, soldQty: productSalesMap[p.id] || 0 }))
        .filter(p => p.soldQty > 0)
        .sort((a, b) => b.soldQty - a.soldQty)
        .slice(0, 5);

    contentArea.innerHTML = `
        <div class="dashboard-grid">
            <div class="stats-grid">
                ${renderStatCard('مبيعات اليوم', salesToday.toFixed(2), 'fas fa-shopping-cart', 'primary')}
                ${renderStatCard('مبيعات الشهر', salesMonth.toFixed(2), 'fas fa-chart-bar', 'secondary')}
                ${renderStatCard('صافي الأرباح', actualProfit.toFixed(2), 'fas fa-money-bill-trend-up', 'success')}
                ${renderStatCard('فواتير اليوم', invoicesToday.length, 'fas fa-receipt', 'accent')}
                ${renderStatCard('العملاء', customers.length, 'fas fa-users', 'primary')}
                ${renderStatCard('المنتجات', products.length, 'fas fa-box', 'secondary')}
            </div>
            
            <div class="charts-row">
                <div class="card chart-card">
                    <h3>أداء المبيعات</h3>
                    <canvas id="salesChart"></canvas>
                </div>
                <div class="card alerts-card">
                    <h3>تنبيهات المخزون ⚠️</h3>
                    <div id="stock-alerts-list">
                        ${lowStock.length > 0 ? lowStock.slice(0, 10).map(p => `
                            <div class="alert-item error">
                                <i class="fas fa-exclamation-triangle"></i>
                                <span>${esc(p.name)} (${p.stock} قطعة)</span>
                            </div>
                        `).join('') : '<p class="empty-msg">لا يوجد تنبيهات حالياً</p>'}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    initDashboardCharts(invoices);
}

function renderStatCard(title, value, icon, colorClass) {
    return `
        <div class="card stat-card ${colorClass}">
            <div class="stat-icon"><i class="${icon}"></i></div>
            <div class="stat-details">
                <p class="stat-title">${title}</p>
                <h2 class="stat-value">${value}</h2>
            </div>
        </div>
    `;
}

// Dashboard Charts
function initDashboardCharts(data = []) {
    const ctx = document.getElementById('salesChart');
    if (!ctx) return;
    
    const width = ctx.parentElement.clientWidth || 300;
    const height = 200;
    ctx.width = width;
    ctx.height = height;
    
    const context = ctx.getContext('2d');
    context.clearRect(0, 0, width, height);

    // Aggregate daily sales
    const dailyData = {};
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    
    // Initialize days
    for (let i = 1; i <= daysInMonth; i++) {
        dailyData[i] = 0;
    }

    data.forEach(inv => {
        if (inv && inv.date) {
            const d = new Date(inv.date).getDate();
            dailyData[d] = (dailyData[d] || 0) + invSales(inv);
        }
    });

    const points = Object.values(dailyData);
    const maxVal = Math.max(...points, 500); // 500 is baseline min scale
    const step = width / (points.length - 1);
    
    // Draw Line
    context.strokeStyle = '#00c6ff';
    context.lineWidth = 3;
    context.lineJoin = 'round';
    context.beginPath();
    
    points.forEach((p, i) => {
        const x = i * step;
        const y = height - ((p / (maxVal * 1.2)) * height) - 10;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    });
    context.stroke();
    
    // Gradient Fill
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(0, 198, 255, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 198, 255, 0)');
    context.lineTo(width, height);
    context.lineTo(0, height);
    context.fillStyle = gradient;
    context.fill();
}

// POS System State
let cart = [];
let selectedCustomer = null;
let isSavingInvoice = false;
let editingInvoiceId = null;
let editingInvoiceData = null;

async function renderPOS() {
    if (db.isRemote) await refreshGlobalCache(); // live stock and balances from the shared database
    if (!editingInvoiceId) {
        cart = []; // Reset cart on page load if not editing
        selectedCustomer = null; // Reset selected customer for new invoice
    }
    const today = new Date().toLocaleDateString('en-CA');
    const isClosed = !!(await db.getById('dayClosures', today));
    contentArea.innerHTML = `
        <div class="pos-wrapper" id="pos-wrapper">
            <div class="pos-main">
                <div class="card pos-billing-card">
                    ${isClosed ? `
                        <div class="alert-item error" style="margin-bottom: 0.75rem;">
                            <i class="fas fa-lock"></i>
                            <span>اليوم مُقفول. لا يمكن حفظ فواتير جديدة قبل فتح يوم جديد.</span>
                        </div>
                    ` : ''}
                    <div class="pos-customer-section">
                        <div class="input-group">
                            <label><i class="fas fa-user"></i> اسم العميل</label>
                            <input type="text" id="pos-customer-name" placeholder="بحث أو إضافة عميل..." autocomplete="off">
                            <div id="customer-results" class="search-results-dropdown"></div>
                        </div>
                        <button type="button" class="pos-more-toggle" onclick="this.parentElement.classList.toggle('open')"><i class="fas fa-address-card"></i> بيانات إضافية (هاتف / عنوان / مندوب)</button>
                        <div class="input-group pos-extra-field">
                            <label><i class="fas fa-phone"></i> رقم الهاتف</label>
                            <input type="text" id="pos-customer-phone" placeholder="أدخل رقم الهاتف">
                        </div>
                        <div class="input-group pos-extra-field">
                            <label><i class="fas fa-user-tie"></i> المندوب</label>
                            <select id="pos-agent-select">
                                <option value="">اختر المندوب...</option>
                            </select>
                        </div>
                        <div class="input-group pos-extra-field" style="grid-column: span 3">
                            <label><i class="fas fa-map-marker-alt"></i> العنوان</label>
                            <input type="text" id="pos-customer-address" placeholder="أدخل عنوان العميل">
                        </div>
                    </div>

                    <div class="pos-search-section">
                        <div class="search-box">
                            <input type="text" id="pos-product-search" placeholder="ابحث بالاسم أو الباركود..." autocomplete="off">
                            <div id="product-results" class="search-results-dropdown"></div>
                        </div>
                        <div id="pos-recent" class="pos-recent"></div>
                    </div>

                    <div class="pos-table-section">
                        <table class="modern-table no-stack" id="pos-table">
                            <thead>
                                <tr>
                                    <th>المنتج</th>
                                    <th>الوحدة</th>
                                    <th>السعر</th>
                                    <th>الكمية</th>
                                    <th>الإجمالي</th>
                                    <th>إجراء</th>
                                </tr>
                            </thead>
                            <tbody id="pos-items-list"></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <aside class="pos-sidebar">
                <div class="card pos-summary-card">
                    <h3>ملخص الفاتورة</h3>
                    <div class="summary-item">
                        <span>المجموع:</span>
                        <span id="pos-total-before">0.00</span>
                    </div>
                    <div class="summary-item" id="pos-prev-balance-row" style="display:none; color: var(--accent);">
                        <span>حساب سابق:</span>
                        <span id="pos-prev-balance">0.00</span>
                    </div>
                    <button type="button" class="pos-more-toggle pos-extra-toggle" onclick="this.parentElement.classList.toggle('open')"><i class="fas fa-percent"></i> خصم / ضريبة</button>
                    <div class="summary-item pos-extra-row">
                        <span>الخصم:</span>
                        <input type="number" id="pos-discount" value="0" step="0.01" min="0" oninput="calculateTotals()">
                    </div>
                    <div class="summary-item pos-extra-row">
                        <span>الضريبة (%):</span>
                        <input type="number" id="pos-tax" value="0" min="0" oninput="calculateTotals()">
                    </div>
                    <div class="summary-item" style="border-top: 1px solid #444; padding-top: 0.5rem; margin-top: 0.5rem;">
                        <span>المبلغ المدفوع:</span>
                        <input type="number" id="pos-paid-amount" value="0" step="0.01" oninput="calculateTotals()">
                    </div>
                    <div class="pos-pay-quick">
                        <button type="button" class="btn" onclick="posQuickPay('cash')"><i class="fas fa-money-bill-wave"></i> كاش كامل</button>
                        <button type="button" class="btn" onclick="posQuickPay('credit')"><i class="fas fa-clock"></i> آجل</button>
                    </div>
                    <hr>
                    <div class="summary-total">
                        <span>الإجمالي النهائي:</span>
                        <span id="pos-final-total">0.00</span>
                    </div>
                    
                    <div class="pos-actions">
                        <button class="btn btn-save" ${isClosed ? 'disabled' : ''} onclick="handleSaveInvoice(false)"><i class="fas fa-save"></i> حفظ الفاتورة</button>
                        <button class="btn btn-print" ${isClosed ? 'disabled' : ''} onclick="handleSaveInvoice(true)"><i class="fas fa-print"></i> حفظ وطباعة</button>
                        <button class="btn btn-new" onclick="printLastInvoice()" title="طباعة آخر فاتورة"><i class="fas fa-history"></i> آخر فاتورة</button>
                        <button class="btn btn-new" onclick="createNewInvoice()"><i class="fas fa-plus"></i> فاتورة جديدة</button>
                    </div>
                </div>
            </aside>
            <div class="pos-savebar">
                <div class="pos-bar-total"><small>الإجمالي</small><b id="pos-bar-total">0.00</b></div>
                <button class="btn btn-save" ${isClosed ? 'disabled' : ''} onclick="handleSaveInvoice(false)"><i class="fas fa-save"></i> حفظ الفاتورة</button>
            </div>
        </div>
    `;
    
    setupPOSListeners();
    renderRecentChips();
    // original POS layout kept on phones too (quick-sale screen disabled by request)
    await loadAgentsToSelect();

    if (editingInvoiceId && editingInvoiceData) {
        const inv = editingInvoiceData;
        document.getElementById('pos-customer-name').value = inv.customer?.name || '';
        document.getElementById('pos-customer-phone').value = inv.customer?.phone || '';
        document.getElementById('pos-customer-address').value = inv.customer?.address || '';
        document.getElementById('pos-agent-select').value = inv.agentId || '';
        document.getElementById('pos-discount').value = inv.discount || 0;
        document.getElementById('pos-tax').value = inv.tax || 0;
        document.getElementById('pos-paid-amount').value = inv.paid || 0;

        if (inv.prevBalance > 0) {
            document.getElementById('pos-prev-balance-row').style.display = 'flex';
            document.getElementById('pos-prev-balance').innerText = inv.prevBalance.toFixed(2);
        }
        
        renderCart();
    }
}

function createNewInvoice() {
    editingInvoiceId = null;
    editingInvoiceData = null;
    cart = [];
    selectedCustomer = null;
    loadPage('pos');
}

async function editInvoice(id) {
    const inv = await db.getById('invoices', id);
    if (!inv) return showToast('الفاتورة غير موجودة', 'error');

    editingInvoiceId = id;
    editingInvoiceData = inv;
    cart = [...inv.items];
    selectedCustomer = inv.customer;
    
    loadPage('pos');
}

async function loadAgentsToSelect() {
    const agents = state.cache.agents;
    const select = document.getElementById('pos-agent-select');
    if (!select) return;
    select.innerHTML = '<option value="">اختر المندوب...</option>';
    agents.forEach(agent => {
        const opt = document.createElement('option');
        opt.value = agent.id;
        opt.innerText = agent.name;
        select.appendChild(opt);
    });
    if (db.isRemote && state.user.role === 'seller' && state.user.agentId) {
        select.value = String(state.user.agentId);
        select.disabled = true;
    }
}

function setupPOSListeners() {
    const productSearch = document.getElementById('pos-product-search');
    const productResults = document.getElementById('product-results');
    const customerSearch = document.getElementById('pos-customer-name');
    const customerResults = document.getElementById('customer-results');

    // Debounced SEARCH logic: near-instant with cache
    const debouncedProductSearch = debounce(async (query) => {
        query = query.trim();
        if (query.length >= 1) {
            const starts = [], inc = [];
            for (const p of state.cache.products) {
                const n = (p.name || '').toLowerCase();
                if (p.barcode && p.barcode === query) starts.unshift(p);
                else if (n.startsWith(query)) starts.push(p);
                else if (n.includes(query) || (p.barcode && String(p.barcode).startsWith(query))) inc.push(p);
                if (starts.length + inc.length >= 60) break;
            }
            renderSearchResults(starts.concat(inc), productResults, 'product');
        } else {
            productResults.style.display = 'none';
        }
    }, 120);

    const debouncedCustomerSearch = debounce(async (query) => {
        if (query.length >= 2) {
            const filtered = state.cache.customers.filter(c => 
                c.name.toLowerCase().startsWith(query) || 
                (c.phone && c.phone.startsWith(query))
            );
            renderSearchResults(filtered, customerResults, 'customer');
        } else {
            customerResults.style.display = 'none';
        }
    }, 300);

    productSearch.addEventListener('input', (e) => debouncedProductSearch(e.target.value.toLowerCase()));
    customerSearch.addEventListener('input', (e) => debouncedCustomerSearch(e.target.value.toLowerCase()));

    // Fast Path for Barcode Scanner (No debounce!)
    productSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const query = productSearch.value;
            const p = state.cache.products.find(p => p.barcode === query);
            if (p) {
                addToCart(p);
                productSearch.value = '';
                productResults.style.display = 'none';
            }
        }
    });
}

function renderSearchResults(items, container, type) {
    if (items.length === 0) {
        container.style.display = 'none';
        return;
    }
    const shown = items.slice(0, 20);
    container._items = shown;
    container.innerHTML = shown.map((item, i) => `
        <div class="result-item" tabindex="0" onclick="pickResult(this, '${type}', ${i})">
            ${type === 'product'
                ? `<span class="ri-name">${esc(item.name)}</span><span class="ri-meta"><b>${item.salePrice}</b> ج.م · مخزون ${item.stock}</span>`
                : `<span class="ri-name">${esc(item.name)}</span><span class="ri-meta">${esc(item.phone || '')}</span>`}
        </div>
    `).join('') + (items.length > shown.length ? '<div class="result-more">في نتايج أكتر، اكتب حروف أكتر للتحديد</div>' : '');
    container.style.display = 'block';
}

function pickResult(el, type, i) {
    const c = el.parentElement;
    if (c && c._items && c._items[i]) selectResult(type, c._items[i]);
}

function recentIds() { try { return JSON.parse(localStorage.getItem('az_recent_products') || '[]'); } catch (e) { return []; } }
function renderRecentChips() {
    const box = document.getElementById('pos-recent');
    if (!box) return;
    const byId = new Map(state.cache.products.map(p => [String(p.id), p]));
    const list = recentIds().map(id => byId.get(String(id))).filter(Boolean).slice(0, 8);
    box.innerHTML = list.length ? '<span class="pos-recent-label">الأخيرة:</span>' + list.map(p => `<button type="button" class="pos-chip" onclick="addRecent('${String(p.id).replace(/'/g, '')}')">${esc(p.name)}</button>`).join('') : '';
}
function addRecent(id) {
    const p = state.cache.products.find(x => String(x.id) === String(id));
    if (p) addToCart(p);
}
function posQuickPay(mode) {
    const subtotal = cart.reduce((sum, item) => sum + (item.actualPrice * item.qty), 0);
    const discount = parseFloat(document.getElementById('pos-discount').value) || 0;
    const taxPercent = parseFloat(document.getElementById('pos-tax').value) || 0;
    const inv = (subtotal - discount) * (1 + taxPercent / 100);
    document.getElementById('pos-paid-amount').value = mode === 'cash' ? inv.toFixed(2) : 0;
    calculateTotals();
}
function stepQty(index, d) {
    if (!cart[index]) return;
    cart[index].qty = Math.max(1, (parseInt(cart[index].qty) || 1) + d);
    renderCart();
}

function selectResult(type, item) {
    if (type === 'product') {
        addToCart(item);
        document.getElementById('pos-product-search').value = '';
        document.getElementById('product-results').style.display = 'none';
    } else {
        selectedCustomer = item;
        if (db.isRemote && item && item.id) {
            // another phone may have changed this customer's balance: re-read it
            db.getById('customers', item.id).then(fresh => {
                if (!fresh || !selectedCustomer || selectedCustomer.id !== fresh.id) return;
                selectedCustomer = fresh;
                const be = document.getElementById('pos-prev-balance');
                const br = document.getElementById('pos-prev-balance-row');
                if (be && br) {
                    if (fresh.balance && fresh.balance > 0) { br.style.display = 'flex'; be.innerText = fresh.balance.toFixed(2); }
                    else { br.style.display = 'none'; be.innerText = '0.00'; }
                    calculateTotals();
                }
            }).catch(() => {});
        }
        document.getElementById('pos-customer-name').value = item.name;
        document.getElementById('pos-customer-phone').value = item.phone;
        document.getElementById('pos-customer-address').value = item.address || '';
        document.getElementById('customer-results').style.display = 'none';
        
        // Show previous balance
        const balanceRow = document.getElementById('pos-prev-balance-row');
        const balanceEl = document.getElementById('pos-prev-balance');
        if (item.balance && item.balance > 0) {
            balanceRow.style.display = 'flex';
            balanceEl.innerText = item.balance.toFixed(2);
        } else {
            balanceRow.style.display = 'none';
            balanceEl.innerText = '0.00';
        }
        calculateTotals();
    }
}

function addToCart(product) {
    try {
        const r = recentIds().filter(id => String(id) !== String(product.id));
        r.unshift(product.id);
        localStorage.setItem('az_recent_products', JSON.stringify(r.slice(0, 12)));
        const fq = JSON.parse(localStorage.getItem('az_freq') || '{}'); fq[product.id] = (fq[product.id] || 0) + 1; localStorage.setItem('az_freq', JSON.stringify(fq));
    } catch (e) {}
    const existing = cart.find(item => item.id === product.id && item.selectedUnit === (product.unit || 'قطعة'));
    let addedIndex = -1;
    if (existing) {
        existing.qty++;
        addedIndex = cart.indexOf(existing);
    } else {
        cart.push({ 
            ...product, 
            qty: 1, 
            selectedUnit: product.unit || 'قطعة',
            actualPrice: product.salePrice,
            originalPrice: product.salePrice
        });
        addedIndex = cart.length - 1;
    }
    renderCart();

    // Auto-focus on unit (not on phones: it would pop the keyboard)
    if (window.matchMedia('(max-width: 768px)').matches) { const sb = document.getElementById('pos-recent'); if (sb) renderRecentChips(); return; }
    setTimeout(() => {
        const units = document.querySelectorAll('.pos-unit-input');
        if (units && units[addedIndex]) {
            units[addedIndex].focus();
        }
    }, 50);
}

function removeFromCart(index) {
    cart.splice(index, 1);
    renderCart();
}

// Product Management
async function renderProducts() {
    const products = state.cache.products;
    const initialLimit = window.matchMedia('(max-width: 768px)').matches ? 30 : 100;
    const displayProducts = products.slice(0, initialLimit);

    contentArea.innerHTML = `
        <div class="page-header">
            <h2>إدارة المنتجات</h2>
            <div class="header-actions">
                <button class="btn btn-new" onclick="exportDataToExcel('products')"><i class="fas fa-file-excel"></i> تصدير للإكسل</button>
                <button class="btn btn-save" onclick="showProductModal()"><i class="fas fa-plus"></i> إضافة منتج جديد</button>
            </div>
        </div>

        <div class="card product-list-card">
            <div class="table-actions">
                <input type="text" id="product-list-search" placeholder="بحث في المنتجات..." class="search-input">
            </div>
            <div class="table-responsive">
                <table class="modern-table" id="products-table">
                    <thead>
                        <tr>
                            <th>الباركود</th>
                            <th>الاسم</th>
                            <th>سعر الشراء</th>
                            <th>سعر البيع</th>
                            <th>الوحدة</th>
                            <th>المخزون</th>
                            <th>الحد الأدنى</th>
                            <th>إجراءات</th>
                        </tr>
                    </thead>
                    <tbody id="products-list-body">
                        ${renderProductRows(displayProducts)}
                    </tbody>
                </table>
            </div>
            ${products.length > initialLimit ? `
                <div class="load-more-container">
                    <button class="btn btn-new" id="load-more-products" onclick="loadMoreProducts(${initialLimit})">تحميل المزيد...</button>
                </div>
            ` : ''}
        </div>

        <!-- Modal Code Remains Same -->
        <div id="product-modal" class="modal">
            <div class="modal-content">
                <h3 id="modal-title">إضافة منتج جديد</h3>
                <form id="product-form" onsubmit="saveProduct(event)">
                    <input type="hidden" id="prod-id">
                    <div class="form-grid">
                        <div class="input-group">
                            <label>اسم المنتج</label>
                            <input type="text" id="prod-name" required>
                        </div>
                        <div class="input-group prod-extra">
                            <label>الباركود</label>
                            <input type="text" id="prod-barcode">
                        </div>
                        <div class="input-group">
                            <label>سعر الشراء</label>
                            <input type="number" inputmode="decimal" id="prod-purchase" step="0.01" value="0">
                        </div>
                        <div class="input-group">
                            <label>سعر البيع</label>
                            <input type="number" inputmode="decimal" id="prod-sale" step="0.01" value="0" required>
                        </div>
                        <div class="input-group">
                            <label>المخزون الحالي</label>
                            <input type="number" inputmode="numeric" id="prod-stock" value="0">
                        </div>
                        <button type="button" class="pos-more-toggle prod-more-toggle" onclick="this.parentElement.classList.toggle('open')"><i class="fas fa-sliders"></i> تفاصيل أكتر (باركود / وحدة / حد الطلب)</button>
                        <div class="input-group prod-extra">
                            <label>الوحدة الأساسية</label>
                            <select id="prod-unit">
                                <option value="قطعة">قطعة</option>
                                <option value="علبة">علبة</option>
                                <option value="كيلو">كيلو</option>
                                <option value="متر">متر</option>
                            </select>
                        </div>
                        <div class="input-group prod-extra">
                            <label>عدد القطع في العلبة</label>
                            <input type="number" id="prod-pieces-per-box" value="1">
                        </div>
                        <div class="input-group prod-extra">
                            <label>حد الطلب (الحد الأدنى)</label>
                            <input type="number" id="prod-min" value="5">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-new" onclick="closeModal('product-modal')">إلغاء</button>
                        <button type="submit" class="btn btn-save">حفظ المنتج</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    // Re-attach modal to body if it was inside contentArea previously (simplification)
    // Actually the modal was inside contentArea in the previous version, I'll keep it there but fix the search listener
    
    const searchInput = document.getElementById('product-list-search');
    searchInput.addEventListener('input', debounce((e) => {
        filterProducts(e.target.value);
    }, 300));
}

function loadMoreProducts(offset) {
    const limit = window.matchMedia('(max-width: 768px)').matches ? 30 : 100;
    const products = state.cache.products;
    const nextBatch = products.slice(offset, offset + limit);
    const tbody = document.getElementById('products-list-body');
    const btn = document.getElementById('load-more-products');
    
    tbody.innerHTML += renderProductRows(nextBatch);
    
    if (offset + limit >= products.length) {
        btn.parentElement.remove();
    } else {
        btn.setAttribute('onclick', `loadMoreProducts(${offset + limit})`);
    }
}

function renderProductRows(products) {
    if (products.length === 0) return '<tr><td colspan="7" style="text-align:center">لا توجد منتجات</td></tr>';
    return products.map(p => `
        <tr class="${p.stock <= p.minStock ? 'low-stock-row' : ''}">
            <td>${esc(p.barcode)}</td>
            <td>${esc(p.name)}</td>
            <td>${p.purchasePrice}</td>
            <td>${p.salePrice}</td>
            <td>${esc(p.unit || 'قطعة')} (${p.piecesPerBox || 1})</td>
            <td>${p.stock}</td>
            <td>${p.minStock}</td>
            <td>
                <button class="btn-edit" onclick="editProduct(${JSON.stringify(p).replace(/"/g, '&quot;')})" title="تعديل"><i class="fas fa-edit"></i> تعديل</button>
                <button class="btn-delete" onclick="deleteProduct(${p.id})" title="حذف"><i class="fas fa-trash"></i> حذف</button>
            </td>
        </tr>
    `).join('');
}

async function filterProducts(query) {
    const q = query.toLowerCase();
    const filtered = state.cache.products.filter(p => 
        p.name.toLowerCase().includes(q) || 
        (p.barcode && p.barcode.includes(q))
    );
    document.getElementById('products-list-body').innerHTML = renderProductRows(filtered.slice(0, window.matchMedia('(max-width: 768px)').matches ? 30 : 100));
    
    const loadMoreBtn = document.getElementById('load-more-products');
    if (loadMoreBtn) loadMoreBtn.parentElement.style.display = filtered.length > (window.matchMedia('(max-width: 768px)').matches ? 30 : 100) ? 'flex' : 'none';
}

function showProductModal(product = null) {
    const modal = document.getElementById('product-modal');
    const title = document.getElementById('modal-title');
    const form = document.getElementById('product-form');
    
    if (product) {
        title.innerText = 'تعديل منتج';
        document.getElementById('prod-id').value = product.id;
        document.getElementById('prod-name').value = product.name;
        document.getElementById('prod-barcode').value = product.barcode;
        document.getElementById('prod-purchase').value = product.purchasePrice;
        document.getElementById('prod-sale').value = product.salePrice;
        document.getElementById('prod-stock').value = product.stock;
        document.getElementById('prod-unit').value = product.unit || 'قطعة';
        document.getElementById('prod-pieces-per-box').value = product.piecesPerBox || 1;
        document.getElementById('prod-min').value = product.minStock;
    } else {
        title.innerText = 'إضافة منتج جديد';
        form.reset();
        document.getElementById('prod-id').value = '';
    }
    modal.style.display = 'flex';
}

function editProduct(product) {
    // product can arrive as object from inline onclick JSON
    showProductModal(product || null);
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

async function saveProduct(e) {
    e.preventDefault();
    const id = document.getElementById('prod-id').value;
    const num = (elId, fallback = 0) => {
        const v = parseFloat(document.getElementById(elId).value);
        return Number.isFinite(v) ? v : fallback;
    };
    const p = {
        name: document.getElementById('prod-name').value.trim(),
        barcode: document.getElementById('prod-barcode').value.trim(),
        purchasePrice: Math.max(0, num('prod-purchase')),
        salePrice: num('prod-sale'),
        stock: Math.trunc(num('prod-stock')),
        unit: document.getElementById('prod-unit').value,
        piecesPerBox: Math.max(1, Math.trunc(num('prod-pieces-per-box', 1)) || 1),
        minStock: Math.max(0, Math.trunc(num('prod-min')))
    };

    if (!p.name) return showToast('ادخل اسم المنتج', 'error');
    if (!p.salePrice || p.salePrice < 0) return showToast('ادخل سعر البيع', 'error');

    // Barcodes must be unique (the cashier finds products by barcode)
    if (p.barcode) {
        const all = await db.getAll('products');
        const dup = all.find(x => x.barcode === p.barcode && String(x.id) !== String(id));
        if (dup) return showToast('الباركود ده مستخدم في منتج تاني: ' + dup.name, 'error');
    }

    if (id) {
        p.id = parseInt(id);
        // Keep fields the form does not edit (category etc.)
        const old = await db.getById('products', p.id);
        await db.update('products', { ...(old || {}), ...p });
        showToast('تم تعديل المنتج');
    } else {
        const newId = await db.add('products', p);
        // Log initial stock
        await db.add('inventoryLog', {
            productId: newId,
            date: new Date().toISOString(),
            qty: p.stock,
            type: 'initial',
            ref: 'Initial Inventory'
        });
        showToast('تم إضافة المنتج');
    }

    closeModal('product-modal');
    renderProducts();
}

async function deleteProduct(id) {
    if (confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
        await db.delete('products', id);
        showToast('تم حذف المنتج بنجاح');
        renderProducts();
    }
}


function renderCart() {
    const list = document.getElementById('pos-items-list');
    list.innerHTML = cart.map((item, index) => {
        const itemTotal = (item.actualPrice * item.qty);
        return `
            <tr>
                <td class="c-name">
                    <div style="font-weight:700">${esc(item.name)}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted)">${esc(item.barcode)}</div>
                </td>
                <td class="c-unit" data-label="الوحدة">
                    <select onchange="updateUnit(${index}, this.value)" 
                        class="table-qty-input pos-unit-input" style="width:70px">
                        <option value="قطعة" ${item.selectedUnit === 'قطعة' ? 'selected' : ''}>قطعة</option>
                        <option value="علبة" ${item.selectedUnit === 'علبة' ? 'selected' : ''}>علبة</option>
                    </select>
                </td>
                <td class="c-price" data-label="السعر">
                    <input type="number" inputmode="decimal" value="${item.actualPrice}" 
                        onchange="updatePrice(${index}, this.value)" 
                        onkeydown="if(event.key === 'Enter') { updatePrice(${index}, this.value); setTimeout(() => { const q = document.querySelectorAll('.pos-qty-input')[${index}]; if(q){ q.focus(); q.select(); } }, 0); event.stopPropagation(); event.preventDefault(); }"
                        class="table-qty-input pos-price-input" style="width:70px">
                </td>
                <td class="c-qty" data-label="الكمية">
                    <div class="qty-step">
                        <button type="button" class="qty-btn" onclick="stepQty(${index}, -1)">&minus;</button>
                        <input type="number" inputmode="numeric" value="${item.qty}" 
                            onchange="updateQty(${index}, this.value)" 
                            onkeydown="if(event.key === 'Enter') { updateQty(${index}, this.value); setTimeout(() => { const s = document.getElementById('pos-product-search'); if(s) s.focus(); }, 0); event.stopPropagation(); event.preventDefault(); }"
                            class="table-qty-input pos-qty-input">
                        <button type="button" class="qty-btn" onclick="stepQty(${index}, 1)">+</button>
                    </div>
                </td>
                <td class="c-total" data-label="الإجمالي" style="font-weight:700">${itemTotal.toFixed(2)}</td>
                <td class="c-del"><button type="button" class="btn-delete" onclick="removeFromCart(${index})"><i class="fas fa-trash"></i></button></td>
            </tr>
                `;
    }).join('');
    calculateTotals();
    if (typeof qsRender === 'function') qsRender();
}

function updatePrice(index, val) {
    const price = parseFloat(val) || 0;
    cart[index].actualPrice = price;
    renderCart();
}

function updateUnit(index, unit) {
    const item = cart[index];
    const oldUnit = item.selectedUnit;
    if (oldUnit === unit) return;

    item.selectedUnit = unit;
    
    // Auto-adjust prices when switching units
    if (unit === 'علبة' && oldUnit === 'قطعة') {
        item.actualPrice = item.actualPrice * (item.piecesPerBox || 1);
        if (item.originalPrice != null) item.originalPrice = item.originalPrice * (item.piecesPerBox || 1);
        item.purchasePrice = (Number(item.purchasePrice) || 0) * (item.piecesPerBox || 1);
    } else if (unit === 'قطعة' && oldUnit === 'علبة') {
        item.actualPrice = item.actualPrice / (item.piecesPerBox || 1);
        if (item.originalPrice != null) item.originalPrice = item.originalPrice / (item.piecesPerBox || 1);
        item.purchasePrice = (Number(item.purchasePrice) || 0) / (item.piecesPerBox || 1);
    }
    
    renderCart();
}

function updateQty(index, val) {
    const qty = parseInt(val) || 1;
    cart[index].qty = qty > 0 ? qty : 1;
    renderCart();
}

function calculateTotals() {
    const subtotal = cart.reduce((sum, item) => sum + (item.actualPrice * item.qty), 0);
    const discount = parseFloat(document.getElementById('pos-discount').value) || 0;
    const taxPercent = parseFloat(document.getElementById('pos-tax').value) || 0;
    const prevBalance = parseFloat(document.getElementById('pos-prev-balance').innerText) || 0;
    
    const taxAmount = (subtotal - discount) * (taxPercent / 100);
    const total = subtotal - discount + taxAmount + prevBalance;
    
    document.getElementById('pos-total-before').innerText = subtotal.toFixed(2);
    document.getElementById('pos-final-total').innerText = total.toFixed(2);
    const bt = document.getElementById('pos-bar-total'); if (bt) bt.innerText = total.toFixed(2);
}

async function handleSaveInvoice(print = false) {
    if (isSavingInvoice) return;
    const today = new Date().toLocaleDateString('en-CA');
    const isClosed = !!(await db.getById('dayClosures', today));
    if (isClosed) {
        showToast('اليوم مُقفول. لا يمكن حفظ فواتير جديدة. افتح يوم جديد أو ألغِ الإقفال.', 'error');
        return;
    }
    if (cart.length === 0) {
        showToast('السلة فارغة!', 'warning');
        return;
    }
    if (db.isRemote) {
        // fail fast, before anything is written, when the phone has no internet
        try { await db.rpc('az_me', {}, { retry: false }); }
        catch (e) { showToast('مفيش اتصال بالإنترنت. الفاتورة لم تُحفظ، جرب تاني لما النت يرجع.', 'error', 5000); return; }
    }
    isSavingInvoice = true;

    try {
        // --- EDIT MODE: Revert old invoice effects (stock + balance) ---
        let oldInvBackup = null;
        let editOldCustId = null, editOldDelta = 0;
        if (editingInvoiceId) {
            const oldInv = await db.getById('invoices', editingInvoiceId);
            if (oldInv) {
                oldInvBackup = JSON.parse(JSON.stringify(oldInv)); // Backup for safety
                // 1) Revert Stock
                if (Array.isArray(oldInv.items)) {
                    for (const item of oldInv.items) {
                        const p = await db.getById('products', item.id);
                        if (p) {
                            let qtyToReturn = Number(item.qty) || 0;
                            if (item.selectedUnit === 'علبة') qtyToReturn *= (p.piecesPerBox || 1);
                            p.stock += qtyToReturn;
                            await db.update('products', p);
                        }
                    }
                }
                // 2) Revert Customer Balance
                // The balance is corrected below by the DIFFERENCE between the old and the new invoice
                // (never reset to this invoice's remaining: later invoices and payments must stay in the balance).
                if (oldInv.customer && oldInv.customer.id) {
                    editOldCustId = oldInv.customer.id;
                    editOldDelta = Math.max(0, Number(oldInv.remaining) || 0) - (Number(oldInv.prevBalance) || 0);
                }
                // Note: Old invoice will be overwritten by db.update below (same ID)
            }
        }

        const customerName = document.getElementById('pos-customer-name').value;
    const customerPhone = document.getElementById('pos-customer-phone').value;
    const customerAddress = document.getElementById('pos-customer-address').value;
    const agentId = document.getElementById('pos-agent-select').value;
    const discount = parseFloat(document.getElementById('pos-discount').value) || 0;
    const taxValue = parseFloat(document.getElementById('pos-tax').value) || 0;
    const prevBalance = parseFloat(document.getElementById('pos-prev-balance').innerText) || 0;
    const paidAmount = parseFloat(document.getElementById('pos-paid-amount').value) || 0;
    
    const subTotal = round2(cart.reduce((sum, item) => sum + (item.actualPrice * item.qty), 0)); 
    const taxAmount = round2((subTotal - discount) * (taxValue / 100));
    const finalTotal = round2(subTotal - discount + taxAmount + prevBalance);
    const remainingBalance = round2(finalTotal - paidAmount);

    // Auto-save/update customer
    let customerId = selectedCustomer ? selectedCustomer.id : null;
    let customerData = {
        name: customerName,
        phone: customerPhone,
        address: customerAddress,
        balance: Math.max(0, remainingBalance)
    };

    if (customerId) {
        // Keep every field of the stored customer (initialBalance!) and only change what this sale changes
        const stored = await db.getById('customers', customerId);
        customerData = { ...(stored || {}), name: customerName, phone: customerPhone, address: customerAddress, balance: Math.max(0, remainingBalance) };
        if (editOldCustId && editOldCustId == customerId && stored) {
            const newDelta = Math.max(0, remainingBalance) - prevBalance;
            customerData.balance = round2(Math.max(0, (Number(stored.balance) || 0) - editOldDelta + newDelta));
        }
        customerData.id = customerId;
        await db.update('customers', customerData);
    } else if (customerName) {
        const allCustomers = await db.getAll('customers');
        let existing = null;
        if (customerPhone && customerPhone.trim() !== '') {
            existing = allCustomers.find(c => c.phone === customerPhone);
        }
        if (!existing) {
            existing = allCustomers.find(c => c.name === customerName);
        }

        if (existing) {
            customerData = { ...existing, name: customerData.name, phone: customerData.phone, address: customerData.address, balance: customerData.balance };
            customerData.id = existing.id;
            // Since customer was not selected from dropdown, prevBalance was 0 in UI.
            // So remainingBalance is only this invoice's debt. We must add it.
            customerData.balance = round2((Number(existing.balance) || 0) + Math.max(0, remainingBalance));
            await db.update('customers', customerData);
            customerId = existing.id;
        } else {
            customerId = await db.add('customers', customerData);
        }
    }

        const invoice = {
            date: (editingInvoiceId && editingInvoiceData) ? editingInvoiceData.date : new Date().toISOString(),
            customer: { name: customerName, phone: customerPhone, address: customerAddress, id: customerId },
            agentId: agentId,
            items: cart.map(item => ({
                ...item, 
                salePrice: item.actualPrice, // Use adjusted price
                originalPrice: round2(item.originalPrice != null ? item.originalPrice : item.actualPrice), // master price when the line was added
                soldPrice: round2(item.actualPrice), // price the customer actually paid
                total: round2(item.actualPrice * item.qty)
            })),
            subTotal,
            discount,
            tax: taxValue,
            prevBalance,
            total: finalTotal,
            paid: paidAmount,
            remaining: remainingBalance
        };

        let invoiceId;
        if (editingInvoiceId) {
            invoice.id = editingInvoiceId;
            await db.update('invoices', invoice);
            invoiceId = editingInvoiceId;
        } else {
            invoiceId = await db.add('invoices', invoice);
        }
    
    // Update Stock
    for (const item of cart) {
        const p = await db.getById('products', item.id);
        if (p) {
            // Deduct based on units
            let qtyToDeduct = item.qty;
            if (item.selectedUnit === 'علبة') {
                qtyToDeduct = item.qty * (p.piecesPerBox || 1);
            }
            
            p.stock -= qtyToDeduct;
            await db.update('products', p);
            await db.add('inventoryLog', {
                productId: p.id,
                date: new Date().toISOString(),
                qty: -qtyToDeduct,
                type: 'sale',
                ref: `Invoice #${invoiceId} (${qtyToDeduct} ${p.unit || 'قطعة'})`
            });
        }
    }

    if (print) {
        try {
            await printThermalInvoice(invoice, invoiceId);
        } catch (e) {
            console.error('Print failed:', e);
            showToast('حصلت مشكلة أثناء الطباعة. تم حفظ الفاتورة بنجاح ويمكنك إعادة الطباعة من التقارير.', 'warning');
        }
    }

        showToast(`تم حفظ الفاتورة رقم ${invoiceId} بنجاح`);
        
        // Clear Edit Mode
        editingInvoiceId = null;
        editingInvoiceData = null;
        
        loadPage('pos');

    } catch (e) {
        console.error('Save Invoice Error:', e);
        showToast('حدث خطأ أثناء حفظ الفاتورة', 'error');
    } finally {
        isSavingInvoice = false;
    }
}


// Fallback for other pages
// Customer Management
async function renderCustomers() {
    const customers = state.cache.customers;
    const initialLimit = (window.matchMedia('(max-width: 768px)').matches ? 30 : 100);
    const displayCustomers = customers.slice(0, initialLimit);

    contentArea.innerHTML = `
        <div class="page-header">
            <h2>إدارة العملاء</h2>
            <div class="header-actions">
                <button class="btn btn-new" onclick="exportDataToExcel('customers')"><i class="fas fa-file-excel"></i> تصدير للإكسل</button>
                <button class="btn btn-save" onclick="showCustomerModal()"><i class="fas fa-plus"></i> إضافة عميل جديد</button>
            </div>
        </div>

        <div class="card customer-list-card">
            <div class="table-actions">
                <input type="text" id="customer-list-search" placeholder="بحث في العملاء..." class="search-input">
            </div>
            <div class="table-responsive">
                <table class="modern-table">
                    <thead>
                        <tr>
                            <th>الاسم</th>
                            <th>رقم الهاتف</th>
                            <th>العنوان</th>
                            <th>إجمالي المشتريات</th>
                            <th>الديون</th>
                            <th>إجراءات</th>
                        </tr>
                    </thead>
                    <tbody id="customers-list-body">
                        ${renderCustomerRows(displayCustomers)}
                    </tbody>
                </table>
            </div>
            ${customers.length > initialLimit ? `
                <div class="load-more-container">
                    <button class="btn btn-new" id="load-more-customers" onclick="loadMoreCustomers(${initialLimit})">تحميل المزيد...</button>
                </div>
            ` : ''}
        </div>

        <div id="customer-modal" class="modal">
            <div class="modal-content">
                <h3 id="customer-modal-title">إضافة عميل</h3>
                <form id="customer-form" onsubmit="saveCustomer(event)">
                    <input type="hidden" id="customer-id">
                    <div class="form-grid">
                        <div class="input-group">
                            <label>اسم العميل</label>
                            <input type="text" id="cust-name" required>
                        </div>
                        <div class="input-group">
                            <label>رقم الهاتف</label>
                            <input type="text" id="cust-phone" required>
                        </div>
                        <div class="input-group">
                            <label>العنوان</label>
                            <input type="text" id="cust-address">
                        </div>
                        <div class="input-group">
                            <label>رصيد سابق (مدين)</label>
                            <input type="number" id="cust-initial-balance" value="0" step="0.01">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-new" onclick="closeModal('customer-modal')">إلغاء</button>
                        <button type="submit" class="btn btn-save">حفظ</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    const searchInput = document.getElementById('customer-list-search');
    searchInput.addEventListener('input', debounce((e) => {
        filterCustomers(e.target.value);
    }, 300));
}

function renderCustomerRows(customers) {
    if (customers.length === 0) return '<tr><td colspan="6" style="text-align:center">لا يوجد عملاء</td></tr>';
    return customers.map(c => `
        <tr>
            <td>${esc(c.name)}</td>
            <td>${esc(c.phone)}</td>
            <td>${esc(c.address || '-')}</td>
            <td>0.00</td>
            <td>${(c.balance || 0).toFixed(2)}</td>
            <td style="white-space: nowrap;">
                <button class="btn btn-new" title="كشف الحساب" style="padding: 7px 12px; font-size: 0.9rem; margin-left:4px;" onclick="showCustomerLedger(${c.id})">
                    <i class="fas fa-file-invoice-dollar"></i> كشف
                </button>
                <button class="btn btn-save" title="تسجيل دفعة" style="padding: 7px 12px; font-size: 0.9rem; margin-left:4px;" onclick="showPaymentModal('customer', ${c.id})">
                    <i class="fas fa-hand-holding-dollar"></i> دفعة
                </button>
                <button class="btn-edit" title="تعديل" style="padding: 7px 12px; font-size: 0.9rem; margin-left:4px;" onclick="editCustomer(${JSON.stringify(c).replace(/"/g, '&quot;')})"><i class="fas fa-edit"></i> تعديل</button>
                <button class="btn-delete" title="حذف" style="padding: 7px 12px; font-size: 0.9rem;" onclick="deleteCustomer(${c.id})"><i class="fas fa-trash"></i> حذف</button>
            </td>
        </tr>
    `).join('');
}

function loadMoreCustomers(offset) {
    const limit = (window.matchMedia('(max-width: 768px)').matches ? 30 : 100);
    const customers = state.cache.customers;
    const nextBatch = customers.slice(offset, offset + limit);
    const tbody = document.getElementById('customers-list-body');
    const btn = document.getElementById('load-more-customers');
    
    tbody.innerHTML += renderCustomerRows(nextBatch);
    
    if (offset + limit >= customers.length) {
        btn.parentElement.remove();
    } else {
        btn.setAttribute('onclick', `loadMoreCustomers(${offset + limit})`);
    }
}

async function filterCustomers(query) {
    const q = query.toLowerCase();
    const filtered = state.cache.customers.filter(c => 
        c.name.toLowerCase().includes(q) || 
        (c.phone && c.phone.includes(q))
    );
    document.getElementById('customers-list-body').innerHTML = renderCustomerRows(filtered.slice(0, (window.matchMedia('(max-width: 768px)').matches ? 30 : 100)));
    
    const loadMoreBtn = document.getElementById('load-more-customers');
    if (loadMoreBtn) loadMoreBtn.parentElement.style.display = filtered.length > (window.matchMedia('(max-width: 768px)').matches ? 30 : 100) ? 'flex' : 'none';
}

function showCustomerModal(customer = null) {
    const modal = document.getElementById('customer-modal');
    const title = document.getElementById('customer-modal-title');
    const form = document.getElementById('customer-form');
    
    if (customer) {
        title.innerText = 'تعديل بيانات العميل';
        document.getElementById('customer-id').value = customer.id;
        document.getElementById('cust-name').value = customer.name;
        document.getElementById('cust-phone').value = customer.phone;
        document.getElementById('cust-address').value = customer.address || '';
        document.getElementById('cust-initial-balance').value = customer.initialBalance || 0;
    } else {
        title.innerText = 'إضافة عميل جديد';
        form.reset();
        document.getElementById('customer-id').value = '';
    }
    modal.style.display = 'flex';
}

function editCustomer(customer) {
    showCustomerModal(customer || null);
}

async function saveCustomer(e) {
    e.preventDefault();
    const id = document.getElementById('customer-id').value;
    const newInitial = parseFloat(document.getElementById('cust-initial-balance').value) || 0;
    // Editing a customer must never reset or swap his balance: keep the stored one and only shift it by a changed opening balance
    const stored = id ? await db.getById('customers', parseInt(id)) : null;
    const c = {
        ...(stored || {}),
        name: document.getElementById('cust-name').value,
        phone: document.getElementById('cust-phone').value,
        address: document.getElementById('cust-address').value,
        initialBalance: newInitial,
        balance: stored ? round2((Number(stored.balance) || 0) + (newInitial - (Number(stored.initialBalance) || 0))) : newInitial
    };

    if (!c.name) return showToast('ادخل اسم العميل', 'error');

    if (id) {
        c.id = parseInt(id);
        await db.update('customers', c);
        showToast('تم تعديل العميل');
    } else {
        await db.add('customers', c);
        showToast('تم إضافة العميل');
    }

    await refreshGlobalCache('customers');
    closeModal('customer-modal');
    renderCustomers();
}

async function deleteCustomer(id) {
    if (confirm('هل أنت متأكد من حذف هذا العميل؟')) {
        await db.delete('customers', id);
        await refreshGlobalCache('customers');
        showToast('تم حذف العميل بنجاح');
        renderCustomers();
    }
}


// Warehouse Management
async function renderWarehouse() {
    // Inventory logs can grow huge, use pagination from DB instead of cache
    const limit = 100;
    const logs = await db.getPaginated('inventoryLog', limit, 0, 'prev');
    const products = state.cache.products;
    
    contentArea.innerHTML = `
        <div class="page-header">
            <h2>حركة المخزن</h2>
            <button class="btn btn-save" onclick="showStockEntryModal()"><i class="fas fa-plus"></i> إضافة مخزون (توريد)</button>
        </div>

        <div class="card warehouse-history-card">
            <h3>سجل الحركات الأخير</h3>
            <div class="table-responsive">
                <table class="modern-table">
                    <thead>
                        <tr>
                            <th>التاريخ</th>
                            <th>المنتج</th>
                            <th>الكمية</th>
                            <th>النوع</th>
                            <th>المرجع</th>
                        </tr>
                    </thead>
                    <tbody id="inventory-history-body">
                        ${renderInventoryLogs(logs, products)}
                    </tbody>
                </table>
            </div>
            <div class="load-more-container">
                <button class="btn btn-new" id="load-more-logs" onclick="loadMoreLogs(${limit})">تحميل الحركات السابقة...</button>
            </div>
        </div>

        <!-- Stock Entry Modal -->
        <div id="stock-modal" class="modal">
            <div class="modal-content">
                <h3>إضافة مخزون يدوي</h3>
                <form onsubmit="saveStockEntry(event)">
                    <div class="form-grid">
                        <div class="input-group">
                            <label>المنتج</label>
                            <select id="stock-prod-id" required>
                                ${products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="input-group">
                            <label>الكمية المضافة</label>
                            <input type="number" id="stock-qty" required>
                        </div>
                        <div class="input-group" style="grid-column: span 2">
                            <label>السبب / المرجع</label>
                            <input type="text" id="stock-ref" placeholder="مثلاً: توريد من مورد X">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-new" onclick="closeModal('stock-modal')">إلغاء</button>
                        <button type="submit" class="btn btn-save">حفظ</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

async function loadMoreLogs(offset) {
    const limit = 100;
    const logs = await db.getPaginated('inventoryLog', limit, offset, 'prev');
    const products = state.cache.products;
    const tbody = document.getElementById('inventory-history-body');
    const btn = document.getElementById('load-more-logs');
    
    if (logs.length === 0) {
        btn.parentElement.remove();
        return;
    }
    
    tbody.innerHTML += renderInventoryLogs(logs, products);
    
    if (logs.length < limit) {
        btn.parentElement.remove();
    } else {
        btn.setAttribute('onclick', `loadMoreLogs(${offset + limit})`);
    }
}

async function loadMoreInvoices(offset) {
    const limit = 50;
    // For reports, we might want ALL invoices for searching, but for display we paginate
    // However, currently filterInvoicesInReports uses all invoices. 
    // Let's stick to display pagination for now.
    const invoices = (await db.getAll('invoices')) || [];
    const nextBatch = invoices.slice(-(offset + limit), -offset).reverse();
    const tbody = document.getElementById('invoices-reports-list');
    const btn = document.getElementById('load-more-invoices');
    
    if (nextBatch.length === 0) {
        btn.parentElement.remove();
        return;
    }
    
    tbody.innerHTML += renderInvoiceReportRows(nextBatch);
    
    if (offset + limit >= invoices.length) {
        btn.parentElement.remove();
    } else {
        btn.setAttribute('onclick', `loadMoreInvoices(${offset + limit})`);
    }
}

function renderInventoryLogs(logs, products) {
    if (!logs || logs.length === 0) return '<tr><td colspan="5" style="text-align:center">لا توجد حركات مسجلة</td></tr>';
    // If arriving from getPaginated, they are already sorted as requested (prev = desc)
    // If not, we sort. 
    return logs.map(log => {
        const product = products.find(p => p.id === log.productId || p.barcode === log.productId);
        const typeClass = log.type === 'sale' ? 'text-danger' : 'text-success';
        const typeLabel = log.type === 'sale' ? 'صرف (بيع)' : log.type === 'initial' ? 'رصيد أول' : 'توريد';
        
        return `
            <tr>
                <td>${new Date(log.date).toLocaleString('ar-EG')}</td>
                <td>${esc(product ? product.name : 'منتج محذوف')}</td>
                <td class="${typeClass}">${log.qty > 0 ? '+' : ''}${log.qty}</td>
                <td>${typeLabel}</td>
                <td>${esc(log.ref || '-')}</td>
            </tr>
        `;
    }).join('');
}

function showStockEntryModal() {
    document.getElementById('stock-modal').style.display = 'flex';
}

async function saveStockEntry(e) {
    e.preventDefault();
    const prodId = parseInt(document.getElementById('stock-prod-id').value);
    const qty = parseInt(document.getElementById('stock-qty').value);
    const ref = document.getElementById('stock-ref').value;
    if (!Number.isFinite(qty) || qty === 0) return showToast('أدخل كمية صحيحة', 'error');
    
    const p = await db.getById('products', prodId);
    if (p) {
        p.stock = (Number(p.stock) || 0) + qty;
        await db.update('products', p);
        
        await db.add('inventoryLog', {
            productId: p.id,
            date: new Date().toISOString(),
            qty: qty,
            type: 'entry',
            ref: ref || 'يدوي'
        });
        
        closeModal('stock-modal');
        renderWarehouse();
    }
}
// Agent Management
async function renderAgents() {
    const agents = await db.getAll('agents');
    contentArea.innerHTML = `
        <div class="page-header">
            <h2>إدارة المناديب</h2>
            <button class="btn btn-save" onclick="showAgentModal()"><i class="fas fa-plus"></i> إضافة مندوب جديد</button>
        </div>

        <div class="card agent-list-card">
            <table class="modern-table">
                <thead>
                    <tr>
                        <th>الاسم</th>
                        <th>رقم الهاتف</th>
                        <th>العنوان</th>
                        <th>العمولة (%)</th>
                        <th>إجمالي المبيعات</th>
                        <th>إجراءات</th>
                    </tr>
                </thead>
                <tbody id="agents-list-body">
                    ${renderAgentRows(agents)}
                </tbody>
            </table>
        </div>

        <!-- Agent Modal -->
        <div id="agent-modal" class="modal">
            <div class="modal-content">
                <h3 id="agent-modal-title">إضافة مندوب</h3>
                <form id="agent-form" onsubmit="saveAgent(event)">
                    <input type="hidden" id="agent-id">
                    <div class="form-grid">
                        <div class="input-group">
                            <label>اسم المندوب</label>
                            <input type="text" id="agent-name" required>
                        </div>
                        <div class="input-group">
                            <label>رقم الهاتف</label>
                            <input type="text" id="agent-phone" required>
                        </div>
                        <div class="input-group">
                            <label>العنوان</label>
                            <input type="text" id="agent-address">
                        </div>
                        <div class="input-group">
                            <label>نسبة العمولة (%)</label>
                            <input type="number" id="agent-commission" step="0.1" required>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-new" onclick="closeModal('agent-modal')">إلغاء</button>
                        <button type="submit" class="btn btn-save">حفظ</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderAgentRows(agents) {
    if (agents.length === 0) return '<tr><td colspan="6" style="text-align:center">لا يوجد مناديب</td></tr>';
    return agents.map(a => `
        <tr>
            <td>${esc(a.name)}</td>
            <td>${esc(a.phone)}</td>
            <td>${esc(a.address || '-')}</td>
            <td>${a.commission || 0}%</td>
            <td>0.00</td>
            <td>
                <button class="btn-edit" onclick="editAgent(${JSON.stringify(a).replace(/"/g, '&quot;')})" title="تعديل"><i class="fas fa-edit"></i> تعديل</button>
                <button class="btn-delete" onclick="deleteAgent(${a.id})" title="حذف"><i class="fas fa-trash"></i> حذف</button>
            </td>
        </tr>
    `).join('');
}

function showAgentModal(agent = null) {
    const modal = document.getElementById('agent-modal');
    const title = document.getElementById('agent-modal-title');
    const form = document.getElementById('agent-form');
    
    if (agent) {
        title.innerText = 'تعديل مندوب';
        document.getElementById('agent-id').value = agent.id;
        document.getElementById('agent-name').value = agent.name;
        document.getElementById('agent-phone').value = agent.phone;
        document.getElementById('agent-address').value = agent.address;
        document.getElementById('agent-commission').value = agent.commission || 0;
    } else {
        title.innerText = 'إضافة مندوب جديد';
        form.reset();
        document.getElementById('agent-id').value = '';
    }
    modal.style.display = 'flex';
}

function editAgent(agent) {
    showAgentModal(agent || null);
}

async function saveAgent(e) {
    e.preventDefault();
    const id = document.getElementById('agent-id').value;
    const agent = {
        name: document.getElementById('agent-name').value,
        phone: document.getElementById('agent-phone').value,
        address: document.getElementById('agent-address').value,
        commission: parseFloat(document.getElementById('agent-commission').value) || 0
    };

    if (id) {
        agent.id = parseInt(id);
        await db.update('agents', agent);
        showToast('تم تعديل المندوب');
    } else {
        await db.add('agents', agent);
        showToast('تم إضافة المندوب');
    }

    closeModal('agent-modal');
    renderAgents();
}

async function deleteAgent(id) {
    if (confirm('هل أنت متأكد من حذف هذا المندوب؟')) {
        await db.delete('agents', id);
        showToast('تم حذف المندوب بنجاح');
        renderAgents();
    }
}

// Expenses Management
async function renderExpenses() {
    const expenses = await db.getAll('expenses');
    contentArea.innerHTML = `
        <div class="page-header">
            <h2>إدارة المصاريف</h2>
            <div class="header-actions">
                <button class="btn btn-new" onclick="exportDataToExcel('expenses')"><i class="fas fa-file-excel"></i> تصدير للإكسل</button>
                <button class="btn btn-save" onclick="showExpenseModal()"><i class="fas fa-plus"></i> إضافة مصروف جديد</button>
            </div>
        </div>

        <div class="card expense-list-card">
            <table class="modern-table">
                <thead>
                    <tr>
                        <th>التاريخ</th>
                        <th>البند</th>
                        <th>المبلغ</th>
                        <th>ملاحظات</th>
                        <th>إجراءات</th>
                    </tr>
                </thead>
                <tbody id="expenses-list-body">
                    ${renderExpenseRows(expenses)}
                </tbody>
            </table>
        </div>

        <!-- Expense Modal -->
        <div id="expense-modal" class="modal">
            <div class="modal-content">
                <h3>تسجيل مصروف</h3>
                <form onsubmit="saveExpense(event)">
                    <div class="form-grid">
                        <div class="input-group">
                            <label>البند (السبب)</label>
                            <select id="exp-category" required>
                                <option value="بنزين">بنزين</option>
                                <option value="نقل">نقل</option>
                                <option value="مرتبات">مرتبات</option>
                                <option value="صيانة">صيانة</option>
                                <option value="أخرى">أخرى</option>
                            </select>
                        </div>
                        <div class="input-group">
                            <label>المبلغ</label>
                            <input type="number" id="exp-amount" step="0.01" required>
                        </div>
                        <div class="input-group" style="grid-column: span 2">
                            <label>ملاحظات</label>
                            <input type="text" id="exp-note">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-new" onclick="closeModal('expense-modal')">إلغاء</button>
                        <button type="submit" class="btn btn-save">حفظ</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderExpenseRows(expenses) {
    if (expenses.length === 0) return '<tr><td colspan="5" style="text-align:center">لا توجد مصاريف مسجلة</td></tr>';
    const sorted = expenses.sort((a,b) => new Date(b.date) - new Date(a.date));
    return sorted.map(e => `
        <tr>
            <td>${new Date(e.date).toLocaleDateString('ar-EG')}</td>
            <td>${esc(e.category)}</td>
            <td class="text-danger">${e.amount.toFixed(2)}</td>
            <td>${esc(e.note || '-')}</td>
            <td>
                <button class="btn-delete" onclick="deleteExpense(${e.id})" title="حذف"><i class="fas fa-trash"></i> حذف</button>
            </td>
        </tr>
    `).join('');
}

function showExpenseModal() {
    document.getElementById('expense-modal').style.display = 'flex';
}

async function saveExpense(e) {
    e.preventDefault();
    const expense = {
        date: new Date().toISOString(),
        category: document.getElementById('exp-category').value,
        amount: parseFloat(document.getElementById('exp-amount').value),
        note: document.getElementById('exp-note').value
    };
    if (!Number.isFinite(expense.amount) || expense.amount <= 0) return showToast('أدخل مبلغ مصروف صحيح', 'error');
    await db.add('expenses', expense);
    closeModal('expense-modal');
    renderExpenses();
}

async function deleteExpense(id) {
    if (confirm('هل أنت متأكد من حذف هذا المصروف؟')) {
        await db.delete('expenses', id);
        showToast('تم حذف المصروف بنجاح');
        renderExpenses();
    }
}


// Reports Module (Simplified)
async function renderReports() {
    // Only fetch current month's data to prevent memory crashes
    const today = new Date().toLocaleDateString('en-CA');
    const monthPrefix = today.substring(0, 7);
    const startDate = monthPrefix + '-01';
    const endDate = monthPrefix + '-31';

    const prevDay = new Date(new Date(startDate + 'T12:00:00').getTime() - 86400000).toLocaleDateString('en-CA');
    const invoices = ((await db.getByDateRange('invoices', prevDay, endDate)) || []).filter(inv => invDate(inv).startsWith(monthPrefix));
    const expenses = (await db.getByDateRange('expenses', startDate, endDate)) || [];
    const payments = (await db.getByDateRange('customerPayments', startDate, endDate)) || [];
    const customers = await db.getAll('customers');
    
    const totalSales = invoices.reduce((sum, inv) => sum + invSales(inv), 0);
    const totalExpenses = expenses.reduce((sum, exp) => sum + (Number(exp?.amount) || 0), 0);
    // Real profit: item margins (sale price minus purchase price) minus discounts, minus expenses
    const netProfit = invoices.reduce((sum, inv) => sum + invProfit(inv), 0) - totalExpenses;
    
    contentArea.innerHTML = `
        <div class="page-header">
            <h2>التقارير المالية والبحث</h2>
            <div class="header-actions">
                <button class="btn btn-save" onclick="exportFullDataExcel()"><i class="fas fa-file-excel"></i> تصدير كل البيانات للإكسل</button>
            </div>
        </div>

        <div class="stats-grid">
            ${renderStatCard('إجمالي المبيعات', totalSales.toFixed(2), 'fas fa-chart-line', 'success')}
            ${renderStatCard('إجمالي المصاريف', totalExpenses.toFixed(2), 'fas fa-hand-holding-dollar', 'danger')}
            ${renderStatCard('صافي الربح تقريباً', netProfit.toFixed(2), 'fas fa-sack-dollar', netProfit >= 0 ? 'primary' : 'danger')}
        </div>

        <div class="card reports-table-card" style="margin-top: 2rem">
            <div class="table-actions" style="margin-bottom: 1rem; display: flex; gap: 10px; align-items: center;">
                <h3 style="margin-bottom: 0">البحث في الفواتير</h3>
                <input type="text" id="search-inv-id" placeholder="رقم الفاتورة..." oninput="filterInvoicesInReports()" class="search-input" style="width: 150px">
                <input type="date" id="search-inv-date" onchange="filterInvoicesInReports()" class="search-input" style="width: 180px">
                <button class="btn btn-new" onclick="exportDataToExcel('invoices')" style="margin-right: auto;"><i class="fas fa-file-csv"></i> تصدير الفواتير</button>
            </div>
            <div class="table-responsive">
                <table class="modern-table" id="invoices-reports-table">
                    <thead>
                        <tr>
                            <th>رقم الفاتورة</th>
                            <th>التاريخ</th>
                            <th>العميل</th>
                            <th>الإجمالي</th>
                            <th>المدفوع</th>
                            <th>المتبقي</th>
                            <th>إجراءات</th>
                        </tr>
                    </thead>
                    <tbody id="invoices-reports-list">
                        ${renderInvoiceReportRows(invoices.slice(-50).reverse())}
                    </tbody>
                </table>
            </div>
            ${invoices.length > 50 ? `
                <div class="load-more-container">
                    <button class="btn btn-new" id="load-more-invoices" onclick="loadMoreInvoices(50)">تحميل الفواتير السابقة...</button>
                </div>
            ` : ''}
        </div>

        ${renderPriceChangesCard(invoices)}

        <div class="card reports-table-card" style="margin-top: 2rem">
            <div class="table-actions" style="margin-bottom: 1rem; display: flex; gap: 10px; align-items: center;">
                <h3 style="margin-bottom: 0">سجل التحصيلات (المدفوعات)</h3>
                <input type="date" id="search-pay-date" onchange="filterPaymentsInReports()" class="search-input" style="width: 180px">
                <button class="btn btn-new" onclick="exportDataToExcel('customerPayments')" style="margin-right: auto;"><i class="fas fa-file-excel"></i> تصدير التحصيلات</button>
            </div>
            <table class="modern-table">
                <thead>
                    <tr>
                        <th>رقم الوصل</th>
                        <th>التاريخ</th>
                        <th>العميل</th>
                        <th>المبلغ</th>
                        <th>ملاحظات</th>
                        <th>إجراء</th>
                    </tr>
                </thead>
                <tbody id="payments-reports-list">
                    ${renderPaymentReportRows(payments.slice(-50).reverse())}
                </tbody>
            </table>
        </div>

        <div class="card report-filters" style="margin-top: 2rem;">
            <h3 style="margin-bottom: 1rem;">تقرير تفصيلي حسب الفترة</h3>
            <div class="form-grid">
                <div class="input-group">
                    <label>من تاريخ</label>
                    <input type="date" id="report-from">
                </div>
                <div class="input-group">
                    <label>إلى تاريخ</label>
                    <input type="date" id="report-to">
                </div>
                <button class="btn btn-save" style="margin-top:20px" onclick="generateDetailedReport()">عرض التقرير</button>
            </div>
            <div id="report-results" class="dashboard-grid" style="margin-top:20px; display:none;"></div>
        </div>
    `;
}

function renderInvoiceReportRows(invoices) {
    if (invoices.length === 0) return '<tr><td colspan="7" style="text-align:center">لا توجد فواتير</td></tr>';
    const fmt2 = (v) => (Number(v) || 0).toFixed(2);
    return invoices.map(inv => `
        <tr>
            <td>#${inv?.id ?? '-'}</td>
            <td>${inv?.date ? new Date(inv.date).toLocaleString('ar-EG') : '-'}</td>
            <td>${esc(inv?.customer?.name || inv?.customerName || 'غير محدد')}</td>
            <td>${fmt2(inv?.total)}</td>
            <td>${fmt2(inv?.paid)}</td>
            <td>${fmt2(inv?.remaining)}</td>
            <td>
                <button class="btn-edit" title="طباعة" onclick="reprintInvoice(${inv.id})"><i class="fas fa-print"></i></button>
                <button class="btn-edit" title="عرض التفاصيل" onclick="viewInvoiceDetails(${inv.id})"><i class="fas fa-eye"></i></button>
                <button class="btn-edit" title="مرتجع" onclick="showReturnModal(${inv.id})"><i class="fas fa-rotate-left"></i></button>
                <button class="btn-edit" style="background: #e67e22" title="تعديل فاتورة" onclick="editInvoice(${inv.id})"><i class="fas fa-pen"></i></button>
                <button class="btn-delete" title="حذف الفاتورة" onclick="voidInvoice(${inv.id})"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

async function voidInvoice(id) {
    const inv = await db.getById('invoices', id);
    if (!inv) return showToast('الفاتورة غير موجودة', 'error');

    if (!confirm(`هل أنت متأكد من حذف الفاتورة رقم #${id} نهائياً؟ \nسيتم استرجاع الأصناف للمخزن وتعديل حساب العميل تلقائياً.`)) return;

    try {
        // 1) Revert Stock
        if (Array.isArray(inv.items)) {
            for (const item of inv.items) {
                const p = await db.getById('products', item.id);
                if (p) {
                    let qtyToReturn = Number(item.qty) || 0;
                    if (item.selectedUnit === 'علبة') {
                        qtyToReturn *= (p.piecesPerBox || 1);
                    }
                    p.stock += qtyToReturn;
                    await db.update('products', p);

                    await db.add('inventoryLog', {
                        productId: p.id,
                        date: new Date().toISOString(),
                        qty: qtyToReturn,
                        type: 'void',
                        ref: `إلغاء فاتورة #${id}`
                    });
                }
            }
        }

        // 2) Revert Customer Balance
        if (inv.customer && inv.customer.id) {
            const customer = await db.getById('customers', inv.customer.id);
            if (customer) {
                // inv.remaining includes the customer's older balance (prevBalance) that was
                // already owed before this invoice. Only revert the debt this invoice created.
                // The invoice moved the balance by (remaining, floored at 0) minus the older balance it
                // carried. That can be negative when the customer paid down old debt, so undo the real delta.
                const balanceDelta = Math.max(0, Number(inv.remaining) || 0) - (Number(inv.prevBalance) || 0);
                customer.balance = round2(Math.max(0, (Number(customer.balance) || 0) - balanceDelta));
                await db.update('customers', customer);
            }
        }

        // 3) Delete the invoice's return records too (their stock is already back, and the
        //    ledger must not keep a return for an invoice that no longer exists)
        const allReturnsForVoid = await db.getAll('returns');
        for (const r of allReturnsForVoid.filter(r => r.invoiceId == id)) {
            await db.delete('returns', r.id);
        }

        // 4) Delete Invoice
        await db.delete('invoices', id);
        
        showToast('تم حذف الفاتورة واسترجاع المخزون وتعديل الحساب بنجاح');
        
        // Refresh 
        if (state.currentPage === 'reports') {
            loadPage('reports');
        }
    } catch (e) {
        console.error('Void Invoice Error:', e);
        showToast('حدث خطأ أثناء حذف الفاتورة', 'error');
    }
}

async function filterInvoicesInReports() {
    const query = document.getElementById('search-inv-id').value.trim().toLowerCase();
    const dateQuery = document.getElementById('search-inv-date').value;
    
    let filtered = [];
    const all = await db.getAll('invoices') || [];
    
    if (query || dateQuery) {
        filtered = all.filter(inv => {
            const matchesId = inv.id.toString() === query;
            const matchesName = (inv.customer?.name || inv.customerName || '').toLowerCase().includes(query);
            const matchesDate = !dateQuery || invDate(inv) === dateQuery;
            const matchesQuery = !query || matchesId || matchesName;
            
            return matchesQuery && matchesDate;
        });
    } else {
        filtered = all.slice(-500); 
    }
    
    document.getElementById('invoices-reports-list').innerHTML = renderInvoiceReportRows(filtered.reverse());
}

function renderPaymentReportRows(payments) {
    return payments.map(p => `
        <tr>
            <td>#${p.id}</td>
            <td>${new Date(p.date).toLocaleString('ar-EG')}</td>
            <td>${esc(p.customer?.name || p.customerName || 'عميل')}</td>
            <td class="text-success" style="font-weight:700">${p.amount.toFixed(2)}</td>
            <td>${esc(p.note || '-')}</td>
            <td>
                <button class="btn-edit" title="تعديل" style="padding: 4px 8px;" onclick="editPayment('customer', ${p.id})"><i class="fas fa-edit"></i></button>
                <button class="btn-edit" title="طباعة الوصل" style="padding: 4px 8px;" onclick="reprintPaymentReceipt(${JSON.stringify(p).replace(/"/g, '&quot;')})"><i class="fas fa-print"></i></button>
                <button class="btn-delete" title="حذف" style="padding: 4px 8px;" onclick="deletePayment('customer', ${p.id})"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join('');
}

async function filterPaymentsInReports() {
    const dateQuery = document.getElementById('search-pay-date').value;
    
    let filtered = [];
    if (dateQuery) {
        filtered = (await db.getByDateRange('customerPayments', dateQuery, dateQuery)) || [];
    } else {
        const all = await db.getAll('customerPayments') || [];
        filtered = all.slice(-500);
    }
    
    document.getElementById('payments-reports-list').innerHTML = renderPaymentReportRows(filtered.reverse());
}

async function reprintPaymentReceipt(payment) {
    await printPaymentReceipt(payment);
}

async function reprintInvoice(id) {
    const inv = await db.getById('invoices', id);
    if (inv) {
        printThermalInvoice(inv, id);
    }
}

async function printLastInvoice() {
    try {
        const all = await db.getAll('invoices');
        const last = all[all.length - 1];
        if (last) {
            printThermalInvoice(last, last.id);
            showToast('جاري طباعة آخر فاتورة...');
        } else {
            showToast('لا توجد فواتير سابقة لطباعتها', 'warning');
        }
    } catch (e) {
        console.error("Print Last Invoice Error: ", e);
        showToast('حدث خطأ أثناء تحميل آخر فاتورة', 'error');
    }
}

async function viewInvoiceDetails(id) {
    const inv = await db.getById('invoices', id);
    if (!inv) return showToast('الفاتورة غير موجودة', 'error');

    const itemsHtml = inv.items.map(it => `
        <tr>
            <td style="padding: 4px 8px; text-align:right;">${esc(it.name)}</td>
            <td style="padding: 4px 8px; text-align:center;">${it.qty}</td>
            <td style="padding: 4px 8px; text-align:center;">${Number(it.salePrice).toFixed(2)}${(it.originalPrice != null && Math.abs(Number(it.originalPrice) - Number(it.salePrice)) > 0.001) ? `<div style="font-size:0.7rem;color:var(--text-muted)">الأصلي ${Number(it.originalPrice).toFixed(2)}</div>` : ''}${it.belowCost ? '<div style="font-size:0.7rem;color:var(--danger)">أقل من التكلفة</div>' : ''}</td>
            <td style="padding: 4px 8px; text-align:center; font-weight:700;">${(it.qty * it.salePrice).toFixed(2)}</td>
        </tr>`).join('');

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:620px; max-height:80vh; overflow-y:auto;">
            <div class="modal-header">
                <h3>تفاصيل الفاتورة #${id}</h3>
                <button class="modal-close" onclick="this.closest('.modal').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <p><strong>العميل:</strong> ${esc(inv.customer?.name || 'نقدي')}</p>
                <p><strong>التاريخ:</strong> ${new Date(inv.date).toLocaleString('ar-EG')}</p>
                <table class="modern-table" style="width:100%; margin-top:1rem;">
                    <thead><tr>
                        <th style="text-align:right;">الصنف</th>
                        <th>الكمية</th>
                        <th>السعر</th>
                        <th>الإجمالي</th>
                    </tr></thead>
                    <tbody>${itemsHtml}</tbody>
                </table>
                <div style="margin-top:1rem; text-align:left; font-size:1.1rem; font-weight:700;">
                    الإجمالي: ${inv.total.toFixed(2)} ج.م
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-print" onclick="reprintInvoice(${id}); this.closest('.modal').remove();"><i class="fas fa-print"></i> إعادة طباعة</button>
                <button class="btn btn-new" onclick="this.closest('.modal').remove()">إغلاق</button>
            </div>
        </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
}

function closeReturnModal() {
    const m = document.getElementById('return-modal');
    if (m) m.remove();
    if (returnModalEscHandler) {
        document.removeEventListener('keydown', returnModalEscHandler);
        returnModalEscHandler = null;
    }
    returnModalState = null;
}

let returnModalState = null;
let returnModalEscHandler = null;

function format2(v) {
    return (Number(v) || 0).toFixed(2);
}

function clamp(n, min, max) {
    const x = Number(n) || 0;
    return Math.max(min, Math.min(max, x));
}

function getReturnMaxQty(idx) {
    const it = returnModalState?.inv?.items?.[idx];
    return Number(it?.qty) || 0;
}

function getReturnPrice(idx) {
    const it = returnModalState?.inv?.items?.[idx];
    return Number(it?.actualPrice ?? it?.salePrice) || 0;
}

function setReturnQty(idx, qty) {
    if (!returnModalState) return;
    const maxQty = getReturnMaxQty(idx);
    const safeQty = clamp(qty, 0, maxQty);
    returnModalState.qtyByIdx[idx] = safeQty;
    const input = document.querySelector(`#return-modal input[data-return-idx="${idx}"]`);
    if (input && Number(input.value) !== safeQty) input.value = safeQty;
    recalcReturnUI();
}

function incReturnQty(idx, delta) {
    if (!returnModalState) return;
    const current = Number(returnModalState.qtyByIdx[idx]) || 0;
    setReturnQty(idx, current + (Number(delta) || 0));
}

function setAllReturnQty(mode) {
    if (!returnModalState) return;
    const items = Array.isArray(returnModalState.inv?.items) ? returnModalState.inv.items : [];
    items.forEach((_, idx) => {
        const maxQty = getReturnMaxQty(idx);
        setReturnQty(idx, mode === 'max' ? maxQty : 0);
    });
    recalcReturnUI();
}

function recalcReturnUI() {
    if (!returnModalState) return;
    const items = Array.isArray(returnModalState.inv?.items) ? returnModalState.inv.items : [];
    let total = 0;
    let count = 0;

    items.forEach((_, idx) => {
        const qty = Number(returnModalState.qtyByIdx[idx]) || 0;
        if (qty > 0) {
            count += qty;
            total += qty * getReturnPrice(idx);
        }
        const rowTotalEl = document.getElementById(`return-row-total-${idx}`);
        if (rowTotalEl) rowTotalEl.innerText = format2(qty * getReturnPrice(idx));
    });

    const totalEl = document.getElementById('return-total');
    if (totalEl) totalEl.value = format2(total);

    const countEl = document.getElementById('return-items-count');
    if (countEl) countEl.innerText = String(count);

    const confirmBtn = document.getElementById('return-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = total <= 0;
}

async function showReturnModal(invoiceId) {
    const inv = await db.getById('invoices', invoiceId);
    if (!inv) return alert('الفاتورة غير موجودة');

    // Reset state
    returnModalState = {
        invoiceId,
        inv,
        qtyByIdx: {}
    };

    // Build modal
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'return-modal';
    modal.style.display = 'flex';
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeReturnModal();
    });

    if (returnModalEscHandler) document.removeEventListener('keydown', returnModalEscHandler);
    returnModalEscHandler = (e) => {
        if (e.key === 'Escape') closeReturnModal();
    };
    document.addEventListener('keydown', returnModalEscHandler);

    const items = Array.isArray(inv.items) ? inv.items : [];
    const rows = items.map((it, idx) => `
        <tr>
            <td style="text-align:right; font-weight:700;">${esc(it.name || '-')}</td>
            <td style="text-align:center">${format2(it.salePrice)}</td>
            <td style="text-align:center">${Number(it.qty) || 0}</td>
            <td style="text-align:center">
                <div class="return-qty-stepper">
                    <button type="button" class="return-qty-btn" onclick="incReturnQty(${idx}, -1)">-</button>
                    <input type="number"
                        min="0"
                        max="${Number(it.qty) || 0}"
                        value="0"
                        inputmode="numeric"
                        class="return-qty-input"
                        oninput="setReturnQty(${idx}, this.value)"
                        data-return-idx="${idx}">
                    <button type="button" class="return-qty-btn" onclick="incReturnQty(${idx}, 1)">+</button>
                </div>
                <div class="return-qty-actions">
                    <button type="button" class="return-chip" onclick="setReturnQty(${idx}, ${Number(it.qty) || 0})">الكل</button>
                    <button type="button" class="return-chip" onclick="setReturnQty(${idx}, 0)">0</button>
                </div>
            </td>
            <td style="text-align:left; font-weight:800;" id="return-row-total-${idx}">0.00</td>
        </tr>
    `).join('');

    modal.innerHTML = `
        <div class="modal-content return-modal-content" style="max-width: 980px;">
            <h3>مرتجع من الفاتورة #${invoiceId}</h3>
            <div style="margin: 0.5rem 0; color: var(--text-muted); font-size: 0.9rem;">
                العميل: <b>${esc(inv?.customer?.name || 'غير محدد')}</b>
                ${inv?.customer?.phone ? ` - هاتف: ${esc(inv.customer.phone)}` : ''}
            </div>
            <div class="return-toolbar">
                <button type="button" class="btn btn-new" onclick="setAllReturnQty('max')"><i class="fas fa-check-double"></i> إرجاع الكل</button>
                <button type="button" class="btn btn-new" onclick="setAllReturnQty('zero')"><i class="fas fa-eraser"></i> مسح الكل</button>
                <div class="return-toolbar-spacer"></div>
                <div class="return-summary">
                    <div>عدد القطع: <b id="return-items-count">0</b></div>
                </div>
            </div>

            <div class="card" style="padding: 1rem; margin: 1rem 0;">
                <table class="modern-table return-table">
                    <thead>
                        <tr>
                            <th>الصنف</th>
                            <th style="text-align:center">سعر</th>
                            <th style="text-align:center">كمية في الفاتورة</th>
                            <th style="text-align:center">كمية مرتجع</th>
                            <th style="text-align:left">إجمالي</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || `<tr><td colspan="5" style="text-align:center">لا توجد أصناف</td></tr>`}
                    </tbody>
                </table>
            </div>

            <div class="form-grid">
                <div class="input-group">
                    <label>إجمالي المرتجع</label>
                    <input type="text" id="return-total" value="0.00" readonly>
                </div>
                <div class="input-group">
                    <label>سبب المرتجع (اختياري)</label>
                    <input type="text" id="return-reason" placeholder="مثلاً: تالف / خطأ / تغيير رأي">
                </div>
            </div>

            <div class="modal-footer">
                <button type="button" class="btn btn-new" onclick="closeReturnModal()">إلغاء</button>
                <button type="button" class="btn btn-save" id="return-confirm-btn" onclick="confirmReturn(${invoiceId})" disabled>تأكيد المرتجع</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    // Focus first qty input for speed
    const firstInput = modal.querySelector('input[data-return-idx="0"]');
    if (firstInput) firstInput.focus();
    recalcReturnUI();
}

async function confirmReturn(invoiceId) {
    const inv = returnModalState?.inv || await db.getById('invoices', invoiceId);
    if (!inv) return alert('الفاتورة غير موجودة');

    const returnItems = [];
    const items = Array.isArray(inv.items) ? inv.items : [];
    items.forEach((it, idx) => {
        const qty = Number(returnModalState?.qtyByIdx?.[idx]) || 0;
        if (qty <= 0) return;
        const maxQty = Number(it.qty) || 0;
        const safeQty = Math.max(0, Math.min(maxQty, qty));
        if (safeQty <= 0) return;
        returnItems.push({
            productId: it.id,
            name: it.name,
            barcode: it.barcode,
            salePrice: Number(it.actualPrice ?? it.salePrice) || 0,
            purchasePrice: Number(it.purchasePrice) || 0,
            qty: safeQty,
            total: round2(safeQty * (Number(it.actualPrice ?? it.salePrice) || 0))
        });
    });

    if (returnItems.length === 0) {
        alert('اختر كميات المرتجع أولاً');
        return;
    }

    const reason = document.getElementById('return-reason')?.value || '';
    const returnTotal = round2(returnItems.reduce((s, it) => s + (Number(it.total) || 0), 0));

    // Split the return: first it cancels the debt THIS invoice created, the rest is cash given back
    const ownDebtLeft = Math.max(0, round2((Number(inv.remaining) || 0) - (Number(inv.prevBalance) || 0)));
    let custForReturn = inv?.customer?.id ? await db.getById('customers', inv.customer.id) : null;
    const custBalance = custForReturn ? (Number(custForReturn.balance) || 0) : 0;
    const debtReduction = round2(Math.min(returnTotal, ownDebtLeft, custForReturn ? custBalance : ownDebtLeft));
    const cashRefund = round2(returnTotal - debtReduction);

    const confirmMsg = cashRefund > 0
        ? `تأكيد مرتجع بقيمة ${returnTotal.toFixed(2)} ؟\nمنهم ${debtReduction.toFixed(2)} بيتخصموا من دين العميل، و ${cashRefund.toFixed(2)} كاش بيترد للعميل من الدرج.`
        : `تأكيد مرتجع بقيمة ${returnTotal.toFixed(2)} ؟\nكله بيتخصم من دين العميل.`;
    if (!confirm(confirmMsg)) return;

    const confirmBtn = document.getElementById('return-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = true;

    // 1) Save return record
    const returnId = await db.add('returns', {
        date: new Date().toISOString(),
        invoiceId,
        customerId: inv?.customer?.id || null,
        customerName: inv?.customer?.name || '',
        agentId: inv?.agentId || null,
        items: returnItems,
        total: returnTotal,
        debtReduction,
        cashRefund,
        reason,
        createdAt: new Date().toISOString()
    });

    // 2) Update stock + inventoryLog
    for (const it of returnItems) {
        const p = await db.getById('products', it.productId);
        if (p) {
            p.stock = (Number(p.stock) || 0) + (Number(it.qty) || 0);
            await db.update('products', p);
        }
        await db.add('inventoryLog', {
            productId: it.productId,
            date: new Date().toISOString(),
            qty: Number(it.qty) || 0,
            type: 'return',
            ref: `Return #${returnId} (Invoice #${invoiceId})`
        });
    }

    // 3) Update customer balance (reduce debt)
    const custId = inv?.customer?.id;
    if (custId) {
        const c = await db.getById('customers', custId);
        if (c) {
            const current = Number(c.balance) || 0;
            c.balance = round2(Math.max(0, current - debtReduction));
            await db.update('customers', c);
        }
    }

    // 4) Update Original Invoice to automatically fix daily sales, profit, and cash drawer
    if (Array.isArray(inv.items)) {
        for (const log of returnItems) {
            const itemMatch = inv.items.find(it => it.id === log.productId);
            if (itemMatch) {
                itemMatch.qty = Math.max(0, (Number(itemMatch.qty) || 0) - (Number(log.qty) || 0));
                itemMatch.total = round2(Math.max(0, (Number(itemMatch.total) || 0) - (Number(log.total) || 0)));
            }
        }
        // Remove fully returned items from the invoice's item list
        inv.items = inv.items.filter(it => it.qty > 0);
    }
    inv.total = round2(Math.max(0, (Number(inv.total) || 0) - returnTotal));
    // Keep the invoice's remaining debt in step with the return so a later void reverts the right amount
    inv.remaining = round2(Math.max(0, (Number(inv.remaining) || 0) - debtReduction));
    // Adjust subtotal to maintain accuracy if reprinted
    inv.subTotal = round2(Math.max(0, (Number(inv.subTotal) || 0) - returnTotal));
    await db.update('invoices', inv);

    closeReturnModal();
    alert(`تم تسجيل المرتجع #${returnId} بنجاح\nوتم تعديل الفاتورة الأصلية لضبط المبيعات تلقائياً` + (cashRefund > 0 ? `\nرد كاش للعميل: ${cashRefund.toFixed(2)} (اتسجل في الدرج وتقفيلة المندوب)` : ''));
    
    // Refresh Reports UI to reflect updated invoice total
    if (typeof loadPage === 'function' && state.currentPage === 'reports') {
        loadPage('reports');
    }
}

function ensureXlsxAvailable() {
    if (typeof XLSX === 'undefined') {
        alert('مكتبة Excel غير محمّلة. تأكد من الاتصال أو توفرها محلياً.');
        return false;
    }
    return true;
}

function safeString(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
}

function flattenForExcel(storeName, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];

    // Invoices have nested customer/items; export a readable flattened format.
    if (storeName === 'invoices') {
        const flat = [];
        rows.forEach(inv => {
            const base = {
                id: inv.id,
                date: inv.date,
                customerName: inv.customer?.name || '',
                customerPhone: inv.customer?.phone || '',
                customerAddress: inv.customer?.address || '',
                customerId: inv.customer?.id || '',
                agentId: inv.agentId || '',
                subTotal: inv.subTotal ?? '',
                discount: inv.discount ?? '',
                tax: inv.tax ?? '',
                prevBalance: inv.prevBalance ?? '',
                total: inv.total ?? '',
                paid: inv.paid ?? '',
                remaining: inv.remaining ?? ''
            };

            if (Array.isArray(inv.items) && inv.items.length) {
                inv.items.forEach((it, idx) => {
                    flat.push({
                        ...base,
                        itemIndex: idx + 1,
                        itemId: it.id ?? '',
                        itemName: it.name ?? '',
                        itemBarcode: it.barcode ?? '',
                        itemSalePrice: it.salePrice ?? '',
                        itemPurchasePrice: it.purchasePrice ?? '',
                        itemQty: it.qty ?? '',
                        itemTotal: it.total ?? (it.salePrice && it.qty ? (it.salePrice * it.qty) : '')
                    });
                });
            } else {
                flat.push({ ...base, itemIndex: '', itemId: '', itemName: '', itemBarcode: '', itemSalePrice: '', itemPurchasePrice: '', itemQty: '', itemTotal: '' });
            }
        });
        return flat;
    }

    // Generic: stringify nested values.
    return rows.map(r => {
        const out = {};
        Object.keys(r || {}).forEach(k => (out[k] = safeString(r[k])));
        return out;
    });
}

function downloadWorkbook(workbook, fileName) {
    XLSX.writeFile(workbook, fileName);
}

async function exportDataToExcel(storeName) {
    if (!ensureXlsxAvailable()) return;
    const rows = await db.getAll(storeName);
    if (!rows || rows.length === 0) {
        alert('لا توجد بيانات لتصديرها');
        return;
    }

    const wb = XLSX.utils.book_new();
    const sheetRows = flattenForExcel(storeName, rows);
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(wb, ws, storeName);
    downloadWorkbook(wb, `Abuzamel_${storeName}_${new Date().toLocaleDateString('en-CA')}.xlsx`);
}

async function exportFullDataExcel() {
    if (!ensureXlsxAvailable()) return;

    const stores = ['products', 'customers', 'suppliers', 'purchases', 'audits', 'dayClosures', 'agents', 'invoices', 'expenses', 'inventoryLog', 'settlements', 'returns', 'users', 'customerPayments', 'supplierPayments'];
    const wb = XLSX.utils.book_new();

    for (const storeName of stores) {
        const rows = await db.getAll(storeName);
        const sheetRows = flattenForExcel(storeName, rows || []);
        const ws = XLSX.utils.json_to_sheet(sheetRows);
        XLSX.utils.book_append_sheet(wb, ws, storeName);
    }

    downloadWorkbook(wb, `Abuzamel_AllData_${new Date().toLocaleDateString('en-CA')}.xlsx`);
}
// Settings & Backup
async function renderSettings() {
    contentArea.innerHTML = `
        <div class="page-header">
            <h2>إعدادات النظام</h2>
        </div>
        
        <div class="settings-grid">
            <div class="card settings-card">
                <h3>نسخ احتياطي واستعادة البيانات</h3>
                <p>قم بتأمين بياناتك عن طريق تصديرها لملف خارجي أو استعادتها من نسخة سابقة.</p>
                <div class="settings-actions">
                    <button class="btn btn-save" onclick="exportData()"><i class="fas fa-download"></i> تصدير البيانات (Backup)</button>
                    <label class="btn btn-new" style="display: inline-flex; align-items: center; cursor:pointer">
                        <i class="fas fa-upload" style="margin-left: 8px;"></i> استيراد البيانات (Restore)
                        <input type="file" id="import-file" style="display:none" onchange="importData(event)">
                    </label>
                </div>
            </div>

            ${db.isRemote ? `
            <div class="card settings-card" style="grid-column: 1 / -1;">
                <h3>المستخدمون (المدير والبياعين)</h3>
                <p>كل بياع له اسم مستخدم وكلمة سر، ويبيع من موبايله والفواتير بتتسجل في نفس النظام لحظيًا. البياع مش بيقدر يلغي فواتير ولا يعدل سعر المنتج ولا يشوف التكلفة والأرباح.</p>
                <div id="users-card-body">...</div>
            </div>` : ''}

            <div class="card settings-card" style="border: 1px solid var(--danger);">
                <h3 style="color: var(--danger);">تهيئة النظام (ضبط المصنع)</h3>
                <p>سيتم حذف جميع البيانات الموجودة في النظام (المنتجات، العملاء، الفواتير، المصاريف). يرجى التأكد من عمل نسخة احتياطية أولاً.</p>
                <div class="settings-actions">
                    <button class="btn" style="background: var(--danger); color: white;" onclick="handleFactoryReset()">
                        <i class="fas fa-trash-alt"></i> مسح جميع البيانات نهائياً
                    </button>
                </div>
            </div>

            <div class="card settings-card">
                <h3>معلومات النظام</h3>
                <div class="summary-item"><span>اسم النظام:</span><span>AbuZamel Distribution System</span></div>
                <div class="summary-item"><span>إصدار النظام:</span><span>1.4.0 (نظام التحصيل والمدفوعات)</span></div>
                <div class="summary-item"><span>المطور:</span><span>بشمهندس زياد سرور</span></div>
            </div>
        </div>
    `;
    if (db.isRemote) renderUsersCard();
}

async function exportData() {
    const data = {
        products: await db.getAll('products'),
        customers: await db.getAll('customers'),
        suppliers: await db.getAll('suppliers'),
        purchases: await db.getAll('purchases'),
        audits: await db.getAll('audits'),
        dayClosures: await db.getAll('dayClosures'),
        agents: await db.getAll('agents'),
        invoices: await db.getAll('invoices'),
        expenses: await db.getAll('expenses'),
        inventoryLog: await db.getAll('inventoryLog'),
        settlements: await db.getAll('settlements'),
        returns: await db.getAll('returns'),
        customerPayments: await db.getAll('customerPayments'),
        supplierPayments: await db.getAll('supplierPayments'),
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AbuZamel_Backup_${new Date().toLocaleDateString('en-CA')}.json`;
    a.click();
}

async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () => alert('مقدرتش أقرا الملف. جرّب تختاره تاني.');
    reader.onload = async (e) => {
        let step = 'قراءة الملف';
        try {
            let text = String(e.target.result || '').replace(/^\uFEFF/, '').trim();
            let data;
            try { data = JSON.parse(text); }
            catch (pe) { alert('الملف مش JSON صالح (' + pe.message + '). لازم تختار ملف النسخة الاحتياطية اللي نزل من "تصدير نسخة احتياطية" في النسخة القديمة، بامتداد .json.'); return; }
            // Some exports wrap the data: { data: {...} }
            if (data && !Array.isArray(data) && typeof data === 'object' && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) data = data.data;
            // Validate BEFORE deleting anything: a wrong file must never wipe the current data
            const knownStores = ['products', 'customers', 'suppliers', 'purchases', 'audits', 'dayClosures', 'agents', 'invoices', 'expenses', 'inventoryLog', 'settlements', 'returns', 'users', 'customerPayments', 'supplierPayments'];
            const looksLikeBackup = data && typeof data === 'object' && !Array.isArray(data) &&
                knownStores.some(k => Array.isArray(data[k])) &&
                knownStores.every(k => data[k] === undefined || data[k] === null || Array.isArray(data[k]));
            if (!looksLikeBackup) {
                alert('الملف ده مش نسخة احتياطية صالحة للنظام (مفيش فيه منتجات/عملاء/فواتير بالشكل المعروف). محدش اتمسح.');
                return;
            }
            knownStores.forEach(k => { if (data[k] === null) delete data[k]; });
            const summary = knownStores.filter(k => Array.isArray(data[k]) && data[k].length).map(k => k + ': ' + data[k].length).join('\n');
            if (confirm('سيتم حذف البيانات الحالية واستبدالها بالنسخة الاحتياطية:\n' + summary + '\nهل أنت متأكد؟')) {
                step = 'رفع البيانات';
                if (db.isRemote) {
                    const counts = await db.importAll(data, (st, n, tot) => { try { document.title = 'استعادة ' + st + ' ' + n + '/' + tot; } catch (x) {} });
                    document.title = 'AbuZamel Distribution System';
                    const failed = counts.__failed || []; delete counts.__failed;
                    let msg = 'تمت استعادة البيانات!\n' + Object.entries(counts).filter(([k, v]) => v > 0).map(([k, v]) => k + ': ' + v).join('\n');
                    if (failed.length) msg += '\n\nتعذر استيراد ' + failed.length + ' سجل:\n' + failed.slice(0, 8).map(f => f.store + ' #' + f.key + ' (' + f.error + ')').join('\n');
                    alert(msg);
                    location.reload();
                    return;
                }
                // Clear and rebuild (IndexedDB)
                await db.clearAllStores();

                // Restore with IDs to keep relationships consistent
                for (const store of knownStores) {
                    const rows = Array.isArray(data[store]) ? data[store] : [];
                    for (const item of rows) {
                        // put() keeps provided id when keyPath is id
                        await db.update(store, item);
                    }
                }
                alert('تمت استعادة البيانات بنجاح!');
                location.reload();
            }
        } catch (error) {
            console.error('Import failed at ' + step + ':', error);
            const m = String((error && error.message) || error);
            let why = m;
            if (/owner_only/.test(m)) why = 'الحساب ده مش حساب المدير. الاستعادة للمدير بس.';
            else if (/not_authorized|401/.test(m)) why = 'الجلسة انتهت. سجّل دخول تاني وجرب.';
            else if (/57014|timeout|canceling statement/i.test(m)) why = 'السيرفر أخد وقت طويل. جرّب تاني.';
            alert('فشل استيراد البيانات (' + step + '): ' + why);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// Suppliers (الموردين)
async function renderSuppliers() {
    const [suppliers, purchases, products] = await Promise.all([
        db.getAll('suppliers'),
        db.getAll('purchases'),
        db.getAll('products')
    ]);

    const purchasesBySupplier = {};
    (purchases || []).forEach(p => {
        purchasesBySupplier[p.supplierId] = (purchasesBySupplier[p.supplierId] || 0) + (Number(p.totalCost) || 0);
    });

    // init purchase state for inline form
    window.__supPurchase = {
        products: products || [],
        selectedProduct: null,
        items: []
    };

    const supplierOpts = (suppliers || []).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    const recentPurchases = (purchases || []).slice(-20).reverse();

    contentArea.innerHTML = `
        <div class="page-header">
            <h2>الموردين والتوريد</h2>
            <div class="header-actions">
                <button class="btn btn-new" onclick="exportDataToExcel('suppliers')"><i class="fas fa-file-excel"></i> تصدير الموردين</button>
                <button class="btn btn-new" onclick="exportDataToExcel('purchases')"><i class="fas fa-file-excel"></i> تصدير التوريدات</button>
                <button class="btn btn-save" onclick="showSupplierModal()"><i class="fas fa-plus"></i> إضافة مورد</button>
            </div>
        </div>

        <div class="sup-tabs">
            <button class="sup-tab active" id="sup-tab-suppliers" onclick="switchSupTab('suppliers')">الموردين</button>
            <button class="sup-tab" id="sup-tab-purchase" onclick="switchSupTab('purchase')">توريد جديد</button>
            <button class="sup-tab" id="sup-tab-history" onclick="switchSupTab('history')">سجل التوريدات</button>
        </div>

        <div id="sup-panel-suppliers" class="sup-panel">
            <div class="card">
                <table class="modern-table">
                    <thead>
                        <tr>
                            <th>اسم المورد</th>
                            <th>الهاتف</th>
                            <th>العنوان</th>
                            <th>إجمالي التوريدات</th>
                            <th>المديونية</th>
                            <th>إجراءات</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${(suppliers || []).length ? suppliers.map(s => `
                            <tr>
                                <td style="font-weight:800;">${esc(s.name)}</td>
                                <td>${esc(s.phone || '-')}</td>
                                <td>${esc(s.address || '-')}</td>
                                <td>${(Number(purchasesBySupplier[s.id]) || 0).toFixed(2)}</td>
                                <td style="font-weight:800; color: var(--danger);">${((s.balance || 0) + (s.initialBalance || 0)).toFixed(2)} ج.م</td>
                                <td style="white-space: nowrap;">
                                    <button class="btn btn-new" title="كشف الحساب" style="padding: 7px 12px; font-size: 0.9rem; margin-left:4px;" onclick="showSupplierLedger(${s.id})">
                                        <i class="fas fa-file-invoice-dollar"></i> كشف
                                    </button>
                                    <button class="btn btn-save" title="تسجيل دفعة للمورد" style="padding: 7px 12px; font-size: 0.9rem; margin-left:4px;" onclick="showPaymentModal('supplier', ${s.id})">
                                        <i class="fas fa-hand-holding-dollar"></i> دفعة
                                    </button>
                                    <button class="btn-edit" style="padding: 7px 12px; font-size: 0.9rem; margin-left:4px;" onclick="editSupplier(${JSON.stringify(s).replace(/"/g,'&quot;')})" title="تعديل"><i class="fas fa-edit"></i> تعديل</button>
                                    <button class="btn-delete" style="padding: 7px 12px; font-size: 0.9rem;" onclick="deleteSupplier(${s.id})" title="حذف"><i class="fas fa-trash"></i> حذف</button>
                                </td>
                            </tr>
                        `).join('') : '<tr><td colspan="6" style="text-align:center">لا يوجد موردين</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>

        <div id="sup-panel-purchase" class="sup-panel" style="display:none;">
            <div class="card">
                <h3 style="margin-bottom: 1rem;">توريد جديد (يدخل المخزن تلقائياً)</h3>

                <div class="form-grid">
                    <div class="input-group">
                        <label>المورد</label>
                        <select id="sup-purchase-supplier" required>
                            <option value="">اختر المورد...</option>
                            ${supplierOpts}
                        </select>
                    </div>
                    <div class="input-group">
                        <label>تاريخ التوريد</label>
                        <input type="date" id="sup-purchase-date" value="${new Date().toLocaleDateString('en-CA')}">
                    </div>
                    <div class="input-group" style="grid-column: span 2;">
                        <label>ملاحظات (اختياري)</label>
                        <input type="text" id="sup-purchase-note" placeholder="مثلاً: فاتورة رقم ...">
                    </div>
                </div>

                <div class="sup-addline">
                    <div class="input-group" style="margin:0;">
                        <label>بحث منتج (اسم أو باركود)</label>
                        <input type="text" id="sup-product-search" placeholder="اكتب اسم المنتج أو الباركود..." autocomplete="off" oninput="supSearchProducts(this.value)">
                        <div id="sup-product-results" class="search-results-dropdown" style="position:relative;"></div>
                        <div class="sup-selected" id="sup-selected-product" style="display:none;"></div>
                    </div>
                    <div class="input-group" style="margin:0;">
                        <label>الكمية</label>
                        <input type="number" id="sup-qty" value="1" min="1">
                    </div>
                    <div class="input-group" style="margin:0;">
                        <label>سعر الشراء</label>
                        <input type="number" id="sup-price" step="0.01" value="0">
                    </div>
                    <button class="btn btn-new" type="button" onclick="supAddItem()"><i class="fas fa-plus"></i> إضافة</button>
                </div>

                <div style="margin-top: 1rem; overflow:auto;">
                    <table class="modern-table" style="min-width: 720px;">
                        <thead>
                            <tr>
                                <th>المنتج</th>
                                <th>الكمية</th>
                                <th>سعر الشراء</th>
                                <th>الإجمالي</th>
                                <th>إجراء</th>
                            </tr>
                        </thead>
                        <tbody id="sup-items-body">
                            <tr><td colspan="5" style="text-align:center">ابدأ بإضافة بنود التوريد</td></tr>
                        </tbody>
                    </table>
                </div>

                <div class="sup-footer">
                    <div class="sup-total">
                        <span>إجمالي تكلفة التوريد:</span>
                        <b id="sup-total">0.00</b>
                    </div>
                    <div class="sup-total" style="color: var(--success); margin-right: 15px;">
                        <span>المبلغ المدفوع:</span>
                        <input type="number" id="sup-paid" value="0" step="0.01" style="width:100px; font-weight:bold" oninput="supCalcTotals()">
                    </div>
                    <div class="sup-total" style="color: var(--danger); margin-right: 15px;">
                        <span>المتبقي:</span>
                        <b id="sup-remaining">0.00</b>
                    </div>
                    <div class="sup-actions">
                        <button class="btn btn-new" type="button" onclick="supClearItems()"><i class="fas fa-eraser"></i> مسح البنود</button>
                        <button class="btn btn-save" type="button" id="sup-save-btn" onclick="supSavePurchase()"><i class="fas fa-save"></i> حفظ التوريد</button>
                    </div>
                </div>
            </div>
        </div>

        <div id="sup-panel-history" class="sup-panel" style="display:none;">
            <div class="card">
                <h3 style="margin-bottom: 1rem;">سجل التوريدات (آخر 20)</h3>
                <div style="overflow:auto;">
                    <table class="modern-table" style="min-width: 800px;">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>التاريخ</th>
                                <th>المورد</th>
                                <th>عدد البنود</th>
                                <th>الإجمالي</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentPurchases.length ? recentPurchases.map(p => {
                                const s = (suppliers || []).find(x => x.id == p.supplierId);
                                return `
                                  <tr>
                                    <td>#${p.id}</td>
                                    <td>${p.date ? new Date(p.date).toLocaleDateString('ar-EG') : '-'}</td>
                                    <td>${s ? esc(s.name) : `مورد #${p.supplierId}`}</td>
                                    <td>${Array.isArray(p.items) ? p.items.length : 0}</td>
                                    <td style="font-weight:900;">${(Number(p.totalCost)||0).toFixed(2)}</td>
                                  </tr>
                                `;
                            }).join('') : '<tr><td colspan="5" style="text-align:center">لا توجد توريدات</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div id="supplier-modal" class="modal">
            <div class="modal-content">
                <h3 id="supplier-modal-title">إضافة مورد</h3>
                <form onsubmit="saveSupplier(event)">
                    <input type="hidden" id="supplier-id">
                    <div class="form-grid">
                        <div class="input-group">
                            <label>اسم المورد</label>
                            <input type="text" id="supplier-name" required>
                        </div>
                        <div class="input-group">
                            <label>الهاتف</label>
                            <input type="text" id="supplier-phone">
                        </div>
                        <div class="input-group" style="grid-column: span 2">
                            <label>العنوان</label>
                            <input type="text" id="supplier-address">
                        </div>
                        <div class="input-group" style="grid-column: span 2">
                            <label>ملاحظات</label>
                            <input type="text" id="supplier-note">
                        </div>
                        <div class="input-group">
                            <label>رصيد سابق (علينا له)</label>
                            <input type="number" id="supplier-initial-balance" value="0" step="0.01">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-new" onclick="closeModal('supplier-modal')">إلغاء</button>
                        <button type="submit" class="btn btn-save">حفظ</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function switchSupTab(tab) {
    const tabs = ['suppliers', 'purchase', 'history'];
    tabs.forEach(t => {
        const btn = document.getElementById(`sup-tab-${t}`);
        const panel = document.getElementById(`sup-panel-${t}`);
        if (btn) btn.classList.toggle('active', t === tab);
        if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
    });
    if (tab === 'purchase') {
        const input = document.getElementById('sup-product-search');
        if (input) input.focus();
    }
}

function supSearchProducts(query) {
    const st = window.__supPurchase;
    const results = document.getElementById('sup-product-results');
    if (!st || !results) return;
    const q = (query || '').trim().toLowerCase();
    if (q.length < 2) {
        results.style.display = 'none';
        results.innerHTML = '';
        return;
    }
    const list = st.products.filter(p => (p.name || '').toLowerCase().includes(q) || (p.barcode || '') === q).slice(0, 20);
    if (!list.length) {
        results.style.display = 'none';
        results.innerHTML = '';
        return;
    }
    results.innerHTML = list.map(p => `
      <div class="result-item" onclick="supSelectProduct(${p.id})">
        ${esc(p.name)} <span style="opacity:.7;">(مخزون: ${p.stock})</span>
      </div>
    `).join('');
    results.style.display = 'block';
}

function supSelectProduct(productId) {
    const st = window.__supPurchase;
    const p = st?.products?.find(x => x.id === Number(productId));
    if (!p) return;
    st.selectedProduct = p;

    const results = document.getElementById('sup-product-results');
    const input = document.getElementById('sup-product-search');
    const chip = document.getElementById('sup-selected-product');
    if (results) results.style.display = 'none';
    if (input) input.value = p.name;
    if (chip) {
        chip.style.display = 'block';
        chip.innerHTML = `تم اختيار: <b>${esc(p.name)}</b> <span style="opacity:.7;">(باركود: ${esc(p.barcode || '-')})</span> <button type="button" class="return-chip" style="margin-right:8px;" onclick="supClearSelected()">تغيير</button>`;
    }
    const price = document.getElementById('sup-price');
    if (price && (!Number(price.value) || Number(price.value) === 0)) {
        price.value = Number(p.purchasePrice || 0);
    }
    const qty = document.getElementById('sup-qty');
    if (qty) qty.focus();
}

function supClearSelected() {
    const st = window.__supPurchase;
    if (st) st.selectedProduct = null;
    const chip = document.getElementById('sup-selected-product');
    if (chip) chip.style.display = 'none';
    const input = document.getElementById('sup-product-search');
    if (input) { input.value = ''; input.focus(); }
}

function supAddItem() {
    const st = window.__supPurchase;
    if (!st || !st.selectedProduct) return alert('اختر منتج أولاً من البحث');
    const qty = Math.max(1, Number(document.getElementById('sup-qty')?.value) || 1);
    const price = Math.max(0, Number(document.getElementById('sup-price')?.value) || 0);
    const p = st.selectedProduct;

    st.items.push({ productId: p.id, name: p.name, qty, purchasePrice: price, total: qty * price });
    supRenderItems();

    // reset for quick entry
    document.getElementById('sup-qty').value = 1;
    document.getElementById('sup-price').value = 0;
    supClearSelected();
}

function supRenderItems() {
    const st = window.__supPurchase;
    const body = document.getElementById('sup-items-body');
    const totalEl = document.getElementById('sup-total');
    if (!st || !body || !totalEl) return;

    if (!st.items.length) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center">ابدأ بإضافة بنود التوريد</td></tr>';
        totalEl.innerText = '0.00';
        return;
    }

    body.innerHTML = st.items.map((it, i) => `
      <tr>
        <td style="font-weight:800;">${esc(it.name)}</td>
        <td>${it.qty}</td>
        <td>${Number(it.purchasePrice).toFixed(2)}</td>
        <td style="font-weight:900;">${Number(it.total).toFixed(2)}</td>
        <td><button class="btn-delete" onclick="supRemoveItem(${i})"><i class="fas fa-trash"></i></button></td>
      </tr>
    `).join('');

    const total = st.items.reduce((s, x) => s + (Number(x.total) || 0), 0);
    totalEl.innerText = total.toFixed(2);
    supCalcTotals();
}

function supCalcTotals() {
    const totalEl = document.getElementById('sup-total');
    const paidEl = document.getElementById('sup-paid');
    const remEl = document.getElementById('sup-remaining');
    if (!totalEl || !paidEl || !remEl) return;
    
    const total = parseFloat(totalEl.innerText) || 0;
    const paid = parseFloat(paidEl.value) || 0;
    const remaining = total - paid;
    remEl.innerText = remaining.toFixed(2);
}

function supRemoveItem(i) {
    const st = window.__supPurchase;
    if (!st) return;
    st.items.splice(i, 1);
    supRenderItems();
}

function supClearItems() {
    const st = window.__supPurchase;
    if (!st) return;
    st.items = [];
    supRenderItems();
}

async function supSavePurchase() {
    const st = window.__supPurchase;
    if (!st || !st.items.length) return alert('أضف بنود التوريد أولاً');
    const supplierId = Number(document.getElementById('sup-purchase-supplier')?.value);
    if (!supplierId) return alert('اختر المورد');
    const date = document.getElementById('sup-purchase-date')?.value || new Date().toLocaleDateString('en-CA');
    const note = document.getElementById('sup-purchase-note')?.value || '';
    const totalCost = round2(st.items.reduce((s, x) => s + (Number(x.total) || 0), 0));
    const paidAmount = parseFloat(document.getElementById('sup-paid')?.value) || 0;
    const remainingAmount = totalCost - paidAmount;

    const btn = document.getElementById('sup-save-btn');
    if (btn) btn.disabled = true;

    const purchaseId = await db.add('purchases', {
        date: new Date(date).toISOString(),
        supplierId,
        items: st.items,
        totalCost,
        paidAmount,
        note
    });

    if (paidAmount > 0) {
        await db.add('supplierPayments', {
            supplierId,
            amount: paidAmount,
            date: new Date(date).toISOString(),
            note: `دفعة نقدية أثناء توريد رقم ${purchaseId}`,
            createdAt: new Date().toISOString()
        });
    }

    if (remainingAmount !== 0) {
        const supplier = await db.getById('suppliers', supplierId);
        if (supplier) {
            supplier.balance = round2((supplier.balance || 0) + remainingAmount);
            await db.update('suppliers', supplier);
        }
    }

    // Aggregate quantities per product to avoid multi-updates issues
    const byProduct = new Map();
    for (const it of st.items) {
        const pid = Number(it.productId);
        if (!pid) continue;
        const prev = byProduct.get(pid) || { qty: 0, purchasePrice: 0 };
        prev.qty += Number(it.qty) || 0;
        // keep last non-zero purchase price
        if ((Number(it.purchasePrice) || 0) > 0) prev.purchasePrice = Number(it.purchasePrice) || prev.purchasePrice;
        byProduct.set(pid, prev);
    }

    // Update stock + purchase price + inventory log (robust)
    for (const [pid, agg] of byProduct.entries()) {
        let p = await db.getById('products', pid);

        // Fallback: try find by id in cached products list if getById failed
        if (!p && Array.isArray(st.products)) {
            p = st.products.find(x => Number(x.id) === pid) || null;
        }

        if (p) {
            p.stock = (Number(p.stock) || 0) + (Number(agg.qty) || 0);
            if ((Number(agg.purchasePrice) || 0) > 0) p.purchasePrice = Number(agg.purchasePrice);
            await db.update('products', p);
        } else {
            console.error('Purchase update failed: product not found', pid);
        }

        await db.add('inventoryLog', {
            productId: pid,
            date: new Date().toISOString(),
            qty: Number(agg.qty) || 0,
            type: 'purchase',
            ref: `Purchase #${purchaseId}`
        });
    }

    alert(`تم حفظ التوريد رقم ${purchaseId} وتحديث المخزون`);
    await renderSuppliers();
    switchSupTab('history');
}

function showSupplierModal(supplier = null) {
    const modal = document.getElementById('supplier-modal');
    const title = document.getElementById('supplier-modal-title');
    if (supplier) {
        title.innerText = 'تعديل مورد';
        document.getElementById('supplier-id').value = supplier.id;
        document.getElementById('supplier-name').value = supplier.name || '';
        document.getElementById('supplier-phone').value = supplier.phone || '';
        document.getElementById('supplier-address').value = supplier.address || '';
        document.getElementById('supplier-note').value = supplier.note || '';
        document.getElementById('supplier-initial-balance').value = supplier.initialBalance || 0;
    } else {
        title.innerText = 'إضافة مورد';
        document.getElementById('supplier-id').value = '';
        document.getElementById('supplier-name').value = '';
        document.getElementById('supplier-phone').value = '';
        document.getElementById('supplier-address').value = '';
        document.getElementById('supplier-note').value = '';
    }
    modal.style.display = 'flex';
}

function editSupplier(supplier) {
    showSupplierModal(supplier || null);
}

async function saveSupplier(e) {
    e.preventDefault();
    const id = document.getElementById('supplier-id').value;
    const supplier = {
        name: document.getElementById('supplier-name').value,
        phone: document.getElementById('supplier-phone').value,
        address: document.getElementById('supplier-address').value,
        note: document.getElementById('supplier-note').value,
        initialBalance: parseFloat(document.getElementById('supplier-initial-balance').value) || 0
    };
    if (id) {
        supplier.id = Number(id);
        await db.update('suppliers', supplier);
    } else {
        await db.add('suppliers', supplier);
    }
    closeModal('supplier-modal');
    renderSuppliers();
}

async function deleteSupplier(id) {
    if (!confirm('هل أنت متأكد من حذف هذا المورد؟')) return;
    await db.delete('suppliers', id);
    showToast('تم حذف المورد بنجاح');
    renderSuppliers();
}


// Purchase / توريد (adds stock automatically)
async function showPurchaseModal() {
    const suppliers = await db.getAll('suppliers');
    const products = await db.getAll('products');

    if (!suppliers || suppliers.length === 0) {
        alert('لا يوجد موردين. أضف مورد أولاً.');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'purchase-modal';
    modal.style.display = 'flex';
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    const supplierOpts = suppliers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    const productOpts = products.map(p => `<option value="${p.id}">${esc(p.name)} (مخزون: ${p.stock})</option>`).join('');

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 900px;">
        <h3>تسجيل توريد (يدخل المخزن تلقائياً)</h3>
        <div class="form-grid">
          <div class="input-group">
            <label>المورد</label>
            <select id="purchase-supplier" required>${supplierOpts}</select>
          </div>
          <div class="input-group">
            <label>تاريخ التوريد</label>
            <input type="date" id="purchase-date" value="${new Date().toLocaleDateString('en-CA')}">
          </div>
        </div>

        <div class="card" style="padding: 1rem; margin-top: 1rem;">
          <h4 style="margin-bottom: 0.8rem;">بنود التوريد</h4>
          <div style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 10px; align-items:end;">
            <div class="input-group" style="margin:0;">
              <label>اختر منتج موجود</label>
              <select id="purchase-product-id">
                <option value="">— اختر —</option>
                ${productOpts}
              </select>
            </div>
            <div class="input-group" style="margin:0;">
              <label>الكمية</label>
              <input type="number" id="purchase-qty" value="1" min="1">
            </div>
            <div class="input-group" style="margin:0;">
              <label>سعر الشراء</label>
              <input type="number" id="purchase-price" step="0.01" value="0">
            </div>
            <button class="btn btn-new" type="button" onclick="purchaseAddRow()"><i class="fas fa-plus"></i> إضافة</button>
          </div>

          <div style="margin-top: 1rem; overflow:auto;">
            <table class="modern-table" id="purchase-items-table">
              <thead>
                <tr>
                  <th>المنتج</th><th>الكمية</th><th>سعر الشراء</th><th>الإجمالي</th><th>إجراء</th>
                </tr>
              </thead>
              <tbody id="purchase-items-body">
                <tr><td colspan="5" style="text-align:center">لا توجد بنود</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="form-grid" style="margin-top: 1rem;">
          <div class="input-group" style="grid-column: span 2;">
            <label>ملاحظات (اختياري)</label>
            <input type="text" id="purchase-note" placeholder="مثلاً: فاتورة مورد رقم ...">
          </div>
          <div class="input-group">
            <label>إجمالي تكلفة التوريد</label>
            <input type="text" id="purchase-total" value="0.00" readonly>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-new" onclick="document.getElementById('purchase-modal').remove()">إلغاء</button>
          <button type="button" class="btn btn-save" id="purchase-save-btn" onclick="savePurchase()">حفظ التوريد</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    window.__purchaseState = { items: [], products };
}

function purchaseAddRow() {
    const st = window.__purchaseState;
    if (!st) return;
    const productId = Number(document.getElementById('purchase-product-id').value);
    if (!productId) return showToast('اختر منتج', 'warning');
    const qty = Math.max(1, Number(document.getElementById('purchase-qty').value) || 1);
    const price = Math.max(0, Number(document.getElementById('purchase-price').value) || 0);
    const p = st.products.find(x => x.id === productId);
    if (!p) return showToast('منتج غير موجود', 'error');

    st.items.push({ productId, name: p.name, qty, purchasePrice: price, total: qty * price });
    renderPurchaseItems();
}

function renderPurchaseItems() {
    const st = window.__purchaseState;
    const body = document.getElementById('purchase-items-body');
    const totalEl = document.getElementById('purchase-total');
    if (!st || !body || !totalEl) return;

    if (st.items.length === 0) {
        body.innerHTML = '<tr><td colspan="5" style="text-align:center">لا توجد بنود</td></tr>';
        totalEl.value = '0.00';
        return;
    }

    body.innerHTML = st.items.map((it, i) => `
      <tr>
        <td>${esc(it.name)}</td>
        <td>${it.qty}</td>
        <td>${it.purchasePrice.toFixed(2)}</td>
        <td>${it.total.toFixed(2)}</td>
        <td><button class="btn-delete" onclick="removePurchaseItem(${i})"><i class="fas fa-trash"></i></button></td>
      </tr>
    `).join('');

    const total = st.items.reduce((s, x) => s + (Number(x.total) || 0), 0);
    totalEl.value = total.toFixed(2);
}

function removePurchaseItem(i) {
    const st = window.__purchaseState;
    if (!st) return;
    st.items.splice(i, 1);
    renderPurchaseItems();
}

async function savePurchase() {
    const st = window.__purchaseState;
    if (!st || st.items.length === 0) return alert('أضف بنود التوريد أولاً');

    const supplierId = Number(document.getElementById('purchase-supplier').value);
    const date = document.getElementById('purchase-date').value || new Date().toLocaleDateString('en-CA');
    const note = document.getElementById('purchase-note').value || '';
    const paid = parseFloat(document.getElementById('purchase-paid')?.value) || 0;
    const totalCost = round2(st.items.reduce((s, x) => s + (Number(x.total) || 0), 0));

    const purchase = {
        date: new Date(date).toISOString(),
        supplierId,
        items: st.items,
        totalCost,
        paid,
        note
    };
    const purchaseId = await db.add('purchases', purchase);

    // Update stock + purchase price + inventory log (aggregate by product)
    const byProduct = {};
    for (const it of st.items) {
        if (!byProduct[it.productId]) byProduct[it.productId] = { qty: 0, purchasePrice: 0 };
        byProduct[it.productId].qty += (Number(it.qty) || 0);
        if (Number(it.purchasePrice) > 0) byProduct[it.productId].purchasePrice = Number(it.purchasePrice);
    }
    for (const [pid, agg] of Object.entries(byProduct)) {
        const p = await db.getById('products', Number(pid));
        if (p) {
            p.stock = (Number(p.stock) || 0) + agg.qty;
            if (agg.purchasePrice > 0) p.purchasePrice = agg.purchasePrice;
            await db.update('products', p);
        }
        await db.add('inventoryLog', {
            productId: Number(pid),
            date: new Date().toISOString(),
            qty: agg.qty,
            type: 'purchase',
            ref: `Purchase #${purchaseId}`
        });
    }

    // Update supplier balance
    if (supplierId) {
        const supplier = await db.getById('suppliers', supplierId);
        if (supplier) {
            const remaining = round2(totalCost - paid);
            supplier.balance = round2((Number(supplier.balance) || 0) + Math.max(0, remaining));
            await db.update('suppliers', supplier);
        }
    }

    const modal = document.getElementById('purchase-modal');
    if (modal) modal.remove();
    showToast(`تم حفظ التوريد رقم ${purchaseId} وتحديث المخزون`);
    if (state.currentPage === 'warehouse') renderWarehouse();
    if (state.currentPage === 'suppliers') renderSuppliers();
}

// Inventory Audit (الجرد)
async function renderAudit() {
    const products = await db.getAll('products');
    const today = new Date().toLocaleDateString('en-CA');

    contentArea.innerHTML = `
      <div class="page-header">
        <h2>الجرد</h2>
        <div class="header-actions">
          <input type="date" id="audit-date" value="${today}">
          <button class="btn btn-new" onclick="exportDataToExcel('audits')"><i class="fas fa-file-excel"></i> تصدير الجرد</button>
          <button class="btn btn-save" onclick="saveAudit(false)"><i class="fas fa-save"></i> حفظ الجرد</button>
          <button class="btn btn-print" onclick="saveAudit(true)"><i class="fas fa-check"></i> حفظ + تطبيق الفروقات</button>
        </div>
      </div>

      <div class="card">
        <div style="margin-bottom: 0.8rem; color: var(--text-muted); font-size:0.9rem;">
          اكتب الكمية الفعلية (المعدودة). الفرق = الفعلي - المسجل في النظام.
        </div>
        <div style="overflow:auto;">
          <table class="modern-table" style="min-width: 900px;">
            <thead>
              <tr>
                <th>المنتج</th>
                <th>باركود</th>
                <th>المسجل</th>
                <th>الفعلي (معدود)</th>
                <th>الفرق</th>
              </tr>
            </thead>
            <tbody id="audit-body">
              ${(products || []).length ? products.map((p,i)=>`
                <tr>
                  <td style="font-weight:800;">${esc(p.name)}</td>
                  <td>${esc(p.barcode || '-')}</td>
                  <td id="audit-sys-${p.id}">${Number(p.stock)||0}</td>
                  <td>
                    <input class="table-qty-input" style="width:90px;" type="number" value="${Number(p.stock)||0}"
                      oninput="recalcAuditRow(${p.id})" id="audit-count-${p.id}">
                  </td>
                  <td id="audit-diff-${p.id}" style="font-weight:900;">0</td>
                </tr>
              `).join('') : '<tr><td colspan="5" style="text-align:center">لا توجد منتجات</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
}

async function recalcAuditRow(productId) {
    const sysEl = document.getElementById(`audit-sys-${productId}`);
    const countEl = document.getElementById(`audit-count-${productId}`);
    const diffEl = document.getElementById(`audit-diff-${productId}`);
    if (!sysEl || !countEl || !diffEl) return;
    const sys = Number(sysEl.innerText) || 0;
    const counted = Number(countEl.value) || 0;
    const diff = counted - sys;
    diffEl.innerText = diff;
    diffEl.className = diff < 0 ? 'text-danger' : diff > 0 ? 'text-success' : '';
}

async function saveAudit(applyAdjustments) {
    const date = document.getElementById('audit-date')?.value || new Date().toLocaleDateString('en-CA');
    const products = await db.getAll('products');
    const entries = [];

    for (const p of (products || [])) {
        const sys = Number(p.stock) || 0;
        // An empty box means "not counted": keep the system quantity instead of zeroing the stock
        const rawCount = document.getElementById(`audit-count-${p.id}`)?.value;
        const counted = (rawCount === undefined || rawCount === null || String(rawCount).trim() === '') ? sys : (Number(rawCount) || 0);
        const diff = counted - sys;
        entries.push({ productId: p.id, name: p.name, barcode: p.barcode, system: sys, counted, diff });
    }

    const auditId = await db.add('audits', {
        date: new Date(date).toISOString(),
        entries,
        applyAdjustments: !!applyAdjustments,
        createdAt: new Date().toISOString()
    });

    if (applyAdjustments) {
        for (const e of entries) {
            if (!e.diff) continue;
            const p = await db.getById('products', e.productId);
            if (!p) continue;
            p.stock = (Number(p.stock) || 0) + (Number(e.diff) || 0);
            await db.update('products', p);
            await db.add('inventoryLog', {
                productId: e.productId,
                date: new Date().toISOString(),
                qty: Number(e.diff) || 0,
                type: 'audit-adjust',
                ref: `Audit #${auditId}`
            });
        }
    }

    showToast(applyAdjustments ? `تم حفظ الجرد #${auditId} وتطبيق الفروقات` : `تم حفظ الجرد #${auditId}`);
}

async function handleFactoryReset() {
    if (confirm('هل أنت متأكد من مسح جميع بيانات النظام؟ لا يمكن التراجع عن هذه الخطوة!')) {
        const password = prompt('يرجى كتابة "مسح" للتأكيد:');
        if (password === 'مسح') {
            await db.clearAllStores();
            showToast('تم مسح جميع البيانات بنجاح. سيتم إعادة تحميل النظام.');
            setTimeout(() => location.reload(), 2000);
        } else {
            showToast('لم يتم المسح. الكلمة التأكيدية غير صحيحة.', 'error');
        }
    }
}
// Agent Settlement (تقفيلة المناديب)
async function renderSettlement() {
    const agents = await db.getAll('agents');
    const invoices = await db.getAll('invoices');
    const returns = await db.getAll('returns');
    const today = new Date().toLocaleDateString('en-CA');
    const dayClosures = await db.getAll('dayClosures');
    const isClosed = (dayClosures || []).some(c => c?.date === today);
    
    contentArea.innerHTML = `
        <div class="page-header">
            <h2>تقفيلة المناديب اليومية - ${new Date().toLocaleDateString('ar-EG')}</h2>
            <div class="header-actions">
                <input type="date" id="settlement-date" value="${today}" onchange="refreshSettlement()">
                <button class="btn btn-print" onclick="window.print()"><i class="fas fa-print"></i> طباعة التقرير</button>
                <button class="btn btn-save" ${isClosed ? 'disabled' : ''} onclick="closeDay()"><i class="fas fa-lock"></i> ${isClosed ? 'اليوم مُقفول' : 'إقفال اليوم'}</button>
            </div>
        </div>

        <div id="settlement-stats-container">
            ${renderSettlementStats(agents, invoices, today, returns)}
        </div>

        <div id="settlement-entry-container">
            ${renderSettlementEntryCard(agents, invoices, today)}
        </div>

        <div class="card" style="margin-top: 1.5rem;">
            <h3 style="margin-bottom: 1rem;">سجل التقفيلات (لنفس اليوم)</h3>
            <div id="settlement-history-container" style="overflow:auto;"></div>
        </div>

        <div class="card settlement-card">
            <table class="modern-table settlement-table">
                <thead>
                    <tr>
                        <th style="width: 20%">المندوب</th>
                        <th style="width: 15%">عدد الفواتير اليوم</th>
                        <th style="width: 20%">إجمالي المبيعات</th>
                        <th style="width: 20%">المُحصل (المدفوع)</th>
                        <th style="width: 25%">إجراءات</th>
                    </tr>
                </thead>
                <tbody id="settlement-table-body">
                    ${renderSettlementRows(agents, invoices, today, returns)}
                </tbody>
            </table>
        </div>
    `;

    await refreshSettlementHistory(today);
    await recalcSettlementDiff();
}

async function closeDay() {
    const date = document.getElementById('settlement-date')?.value;
    if (!date) return;
    const existing = await db.getById('dayClosures', date);
    if (existing) {
        showToast('اليوم مُقفول بالفعل', 'warning');
        return;
    }
    if (!confirm(`تأكيد إقفال يوم ${date}؟\nبعد الإقفال ستظهر مبيعات اليوم = 0 في الداشبورد.`)) return;
    await db.update('dayClosures', { date, closedAt: new Date().toISOString() });
    showToast('تم إقفال اليوم بنجاح');
    // Refresh dashboard numbers if user goes back
    renderSettlement();
}

function sumPaidForAgent(invoices, agentId, date, returns = []) {
    const dayInvoices = (invoices || []).filter(inv => inv?.agentId == agentId && invDate(inv) === date);
    // Cash collected on invoices that day, minus cash given back for returns that day
    return round2(dayInvoices.reduce((sum, inv) => sum + (Number(inv?.paid) || 0), 0) - cashRefundsOn(returns, date, agentId));
}

function renderSettlementEntryCard(agents, invoices, date) {
    const opts = (agents || []).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
    return `
        <div class="card" style="margin-top: 1.5rem;">
            <h3 style="margin-bottom: 1rem;">تقفيل مندوب</h3>
            <div class="form-grid">
                <div class="input-group">
                    <label>اختر المندوب</label>
                    <select id="settlement-agent-id" onchange="recalcSettlementDiff()">
                        <option value="">اختر...</option>
                        ${opts}
                    </select>
                </div>
                <div class="input-group">
                    <label>المبلغ المستلم من المندوب</label>
                    <input type="number" id="settlement-received" value="0" step="0.01" oninput="recalcSettlementDiff()">
                </div>
                <div class="input-group">
                    <label>المفروض يتسلم (إجمالي المدفوع في فواتير اليوم)</label>
                    <input type="text" id="settlement-expected" value="0.00" readonly>
                </div>
                <div class="input-group">
                    <label>النتيجة</label>
                    <input type="text" id="settlement-status" value="-" readonly>
                </div>
                <div class="input-group" style="grid-column: span 2">
                    <label>ملاحظات (اختياري)</label>
                    <input type="text" id="settlement-note" placeholder="مثلاً: تسوية، شيك، ناقص...">
                </div>
            </div>
            <div class="settings-actions" style="margin-top: 1rem;">
                <button class="btn btn-save" onclick="saveAgentSettlement()"><i class="fas fa-save"></i> حفظ التقفيل</button>
                <button class="btn btn-new" onclick="exportDataToExcel('settlements')"><i class="fas fa-file-excel"></i> تصدير التقفيلات</button>
            </div>
            <div style="margin-top: 0.75rem; font-size: 0.85rem; color: var(--text-muted);">
                يتم الحساب على أساس <b>المدفوع</b> في فواتير نفس اليوم للمندوب.
            </div>
        </div>
    `;
}

async function recalcSettlementDiff() {
    const date = document.getElementById('settlement-date')?.value;
    const agentId = document.getElementById('settlement-agent-id')?.value;
    const received = Number(document.getElementById('settlement-received')?.value) || 0;

    const expectedEl = document.getElementById('settlement-expected');
    const statusEl = document.getElementById('settlement-status');
    if (!expectedEl || !statusEl) return;

    if (!date || !agentId) {
        expectedEl.value = '0.00';
        statusEl.value = '-';
        return;
    }

    const invoices = await db.getAll('invoices');
    const returns = await db.getAll('returns');
    const expected = sumPaidForAgent(invoices, agentId, date, returns);
    expectedEl.value = expected.toFixed(2);

    const diff = round2(received - expected); // + زيادة / - عجز
    if (Math.abs(diff) < 0.005) {
        statusEl.value = `تمام (0.00)`;
    } else if (diff < 0) {
        statusEl.value = `عجز (${Math.abs(diff).toFixed(2)})`;
    } else {
        statusEl.value = `زيادة (${diff.toFixed(2)})`;
    }
}

async function saveAgentSettlement() {
    const date = document.getElementById('settlement-date')?.value;
    const agentId = document.getElementById('settlement-agent-id')?.value;
    const received = Number(document.getElementById('settlement-received')?.value) || 0;
    const note = document.getElementById('settlement-note')?.value || '';

    if (!date) return alert('اختر تاريخ التقفيلة');
    if (!agentId) return alert('اختر المندوب');

    const invoices = await db.getAll('invoices');
    const returns = await db.getAll('returns');
    const expected = sumPaidForAgent(invoices, agentId, date, returns);
    const diff = round2(received - expected);
    const status = Math.abs(diff) < 0.005 ? 'ok' : diff < 0 ? 'shortage' : 'surplus';

    await db.add('settlements', {
        date,
        agentId: Number(agentId),
        expected,
        received,
        diff,
        status,
        note,
        createdAt: new Date().toISOString()
    });

    showToast('تم حفظ التقفيل');
    await refreshSettlementHistory(date);
}

// sumPaidForAgent defined above (L3559)

function renderSettlementStats(agents, invoices, date, returns = []) {
    const todayInvoices = invoices.filter(inv => invDate(inv) === date);
    const totalSales = todayInvoices.reduce((sum, inv) => sum + invSales(inv), 0);
    const cashRefunds = cashRefundsOn(returns, date);
    const totalPaid = round2(todayInvoices.reduce((sum, inv) => sum + (Number(inv.paid) || 0), 0) - cashRefunds);
    const totalRemaining = todayInvoices.reduce((sum, inv) => sum + invOwnRemaining(inv), 0);

    return `
        <div class="stats-grid" style="margin-bottom: 2rem;">
            ${renderStatCard('مبيعات اليوم', totalSales.toFixed(2), 'fas fa-shopping-cart', 'primary')}
            ${renderStatCard('المُحصل', totalPaid.toFixed(2), 'fas fa-money-bill-wave', 'success')}
            ${renderStatCard('الآجل (المتبقي)', totalRemaining.toFixed(2), 'fas fa-hand-holding-dollar', 'danger')}
        </div>
    `;
}

function renderSettlementRows(agents, invoices, date, returns = []) {
    const todayInvoices = invoices.filter(inv => invDate(inv) === date);
    
    const agentSales = {};
    agents.forEach(a => agentSales[a.id] = { name: a.name, total: 0, paid: 0 });
    
    todayInvoices.forEach(inv => {
        const id = inv.agentId;
        if(agentSales[id]) {
            agentSales[id].total += invSales(inv);
            agentSales[id].paid += (Number(inv.paid) || 0);
        }
    });
    // Cash returned to customers that day comes off the agent's cash to hand in
    agents.forEach(a => { agentSales[a.id].paid = round2(agentSales[a.id].paid - cashRefundsOn(returns, date, a.id)); });

    const rowsAsArray = agents.map(a => `
        <tr>
            <td>${esc(a.name)}</td>
            <td>${agentSales[a.id].total.toFixed(2)}</td>
            <td style="font-weight: 700; color: var(--success);">${agentSales[a.id].paid.toFixed(2)}</td>
        </tr>
    `);

    return `
        <div class="card" style="margin-top: 1.5rem;">
            <h3 style="margin-bottom: 1rem;">مبيعات المناديب اليوم</h3>
            <table class="modern-table">
                <thead>
                    <tr>
                        <th>المندوب</th>
                        <th>إجمالي المبيعات</th>
                        <th>المُحصل (المطلوب توريده)</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsAsArray.length > 0 ? rowsAsArray.join('') : '<tr><td colspan="3" style="text-align:center">لا يوجد مناديب مسجلين</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

async function deleteSettlement(id, date) {
    if (confirm('هل أنت متأكد من حذف هذه التقفيلة؟')) {
        await db.delete('settlements', id);
        showToast('تم حذف التقفيلة');
        await refreshSettlementHistory(date);
    }
}

async function refreshSettlementHistory(date) {
    const container = document.getElementById('settlement-history-container');
    if (!container) return;

    const [agents, settlements] = await Promise.all([
        db.getAll('agents'),
        db.getAll('settlements')
    ]);

    const rows = (settlements || [])
        .filter(s => s?.date === date)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (rows.length === 0) {
        container.innerHTML = `<div style="text-align:center; color: var(--text-muted); padding: 1rem;">لا توجد تقفيلات محفوظة لهذا اليوم</div>`;
        return;
    }

    const agentName = (id) => (agents.find(a => a.id == id)?.name) || `مندوب #${id}`;
    const fmt2 = (v) => (Number(v) || 0).toFixed(2);
    const statusLabel = (s) => s === 'ok' ? 'تمام' : s === 'shortage' ? 'عجز' : 'زيادة';
    const statusClass = (s) => s === 'ok' ? 'text-success' : s === 'shortage' ? 'text-danger' : 'text-success';

    container.innerHTML = `
        <table class="modern-table settlement-table">
            <thead>
                <tr>
                    <th>وقت الحفظ</th>
                    <th>المندوب</th>
                    <th>المفروض</th>
                    <th>المستلم</th>
                    <th>الفرق</th>
                    <th>الحالة</th>
                    <th>ملاحظات</th>
                    <th>إجراء</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => {
                    const diff = Number(r.diff) || 0;
                    return `
                        <tr>
                            <td>${r.createdAt ? new Date(r.createdAt).toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'}) : '-'}</td>
                            <td>${esc(agentName(r.agentId))}</td>
                            <td>${fmt2(r.expected)}</td>
                            <td>${fmt2(r.actual)}</td>
                            <td dir="ltr" class="${diff < 0 ? 'text-danger' : diff > 0 ? 'text-success' : 'text-primary'}">${fmt2(diff)}</td>
                            <td class="${statusClass(r.status)}">${statusLabel(r.status)}</td>
                            <td>${esc(r.note || '-')}</td>
                            <td>
                                <button class="btn-delete" onclick="deleteSettlement(${r.id}, '${date}')" title="حذف التقفيلة"><i class="fas fa-trash"></i> حذف</button>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

async function printThermalInvoice(inv, id) {
    const agentName = await getAgentName(inv.agentId);

    const itemsHtml = inv.items.map((item, idx) => `
        <tr class="item-row">
            <td class="item-name">${esc(item.name)}</td>
            <td class="item-unit">${esc(item.selectedUnit || 'قطعة')}</td>
            <td class="item-price">${Number(item.salePrice).toFixed(2)}</td>
            <td class="item-qty">${item.qty}</td>
            <td class="item-total">${(Number(item.salePrice) * Number(item.qty)).toFixed(2)}</td>
        </tr>
    `).join('');

    const generateReceiptContent = (copyLabel) => `
        <div class="receipt-container">
            ${copyLabel ? `<div class="copy-box"><span class="copy-label">${copyLabel}</span></div>` : ''}
            
            <div class="header">
                <div class="brand-block">
                    <div class="brand-name">أبوزامل</div>
                    <div class="brand-subtitle">للتجارة والتوزيع</div>
                </div>
                <table class="contacts-table">
                    <tr><td>أ / محمد :</td><td style="direction: ltr;">01094616746</td></tr>
                    <tr><td>أ / أحمد :</td><td style="direction: ltr;">01012386535</td></tr>
                </table>
            </div>

            <div class="top-line" style="display: none;"></div>
            <div class="store-location text-bold" style="font-size: 11.5px;">أبودراز، فوه، كفر الشيخ</div>
            
            <div class="meta-dashed">
                <div class="meta-row">
                    <span>${new Date(inv.date).toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'})}</span>
                    <span>${new Date(inv.date).toLocaleDateString('ar-EG')}</span>
                    <span>#${id}</span>
                </div>
            </div>

            <div class="customer-section">
                <div class="cust-row-top">
                    <span>إلى أ / : ${esc(inv.customer.name || 'نقدي')}</span>
                    <span style="font-size: 10px;">هاتف: ${esc(inv.customer.phone || '-')}</span>
                </div>
                <div class="cust-row">العنوان: ${esc(inv.customer.address || '-')}</div>
            </div>

            <table class="receipt-table">
                <thead>
                    <tr>
                        <th>الصنف</th>
                        <th>الوحدة</th>
                        <th>سعر</th>
                        <th>كمية</th>
                        <th>إجمالي</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            <div class="totals-section">
                <div class="top-line" style="border-top-width: 1.5px;"></div>
                
                <div class="total-line">
                    <span style="flex-shrink: 0;">إجمالي الفاتورة:</span>
                    <span style="white-space: nowrap;">${(Number(inv.subTotal) || 0).toFixed(2)}</span>
                </div>
                
                ${(Number(inv.prevBalance) || 0) > 0 ? `
                <div class="total-line" style="padding: 1px 0; color: #000; font-weight: 900;">
                    <span style="flex-shrink: 0;">حساب سابق:</span>
                    <span style="white-space: nowrap;">${(Number(inv.prevBalance) || 0).toFixed(2)}</span>
                </div>
                ` : ''}

                <div class="top-line" style="border-top-width: 1.5px;"></div>
                
                ${(Number(inv.discount) || 0) > 0 ? `
                <div class="total-line" style="color: #000; margin-top: 2px;">
                    <span style="flex-shrink: 0;">الخصم:</span>
                    <span style="white-space: nowrap; color: #d32f2f;">${(Number(inv.discount) || 0).toFixed(2)}</span>
                </div>
                ` : ''}

                <div class="total-line text-xbold" style="font-size: 15px; margin-top: 6px; border-top: 1.2px solid #000; padding-top: 4px;">
                    <span style="flex-shrink: 0;">صافي الحساب:</span>
                    <span style="white-space: nowrap;">${((Number(inv.subTotal) || 0) + (Number(inv.prevBalance) || 0) - (Number(inv.discount) || 0)).toFixed(2)}</span>
                </div>
                <div class="total-line">
                    <span style="flex-shrink: 0;">المدفوع:</span>
                    <span style="white-space: nowrap;">${(Number(inv.paid) || 0).toFixed(2)}</span>
                </div>
                <div class="total-line">
                    <span style="flex-shrink: 0;">المتبقي:</span>
                    <span style="white-space: nowrap;">${Math.max(0, Number(inv.remaining) || 0).toFixed(2)}</span>
                </div>
                <div style="text-align: center; margin-top: 5px;">
                    <span style="font-size: 8.5px; font-weight: 900; background: #eee; padding: 1px 5px; border-radius: 3px; border: 0.8px solid #000;">عدد الأصناف: ${inv.items.length}</span>
                </div>
            </div>

            <div class="top-line" style="margin-top: 8px; border-top-width: 2.2px;"></div>
            <div class="agent-row" style="margin-top: 4px;">المندوب: ${esc(agentName)}</div>
            <div class="meta-dashed" style="border-bottom: 0; margin-top: 4px; padding: 2px 0;"></div>
            
            <div class="thanks-msg" style="margin-top: 4px;">شكراً لتعاملكم معنا</div>
            <div class="dev-row">★ تطوير: م / زياد سرور ★</div>
        </div>
    `;

    executeHiddenPrint(`
        <html>
        <head>
            <title>فاتورة #${id}</title>
            <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
            <style>
                @page { margin: 0; }
                * { box-sizing: border-box; font-family: 'Cairo', sans-serif; margin: 0; padding: 0; }
                body { width: 100%; direction: rtl; color: #000; padding: 0; margin: 0; background: #fff; text-align: center; }
                
                .receipt-container { width: 100%; max-width: 290px; margin: 0 auto; display: block; text-align: center; padding-top: 0; padding-bottom: 20px; overflow: hidden; font-size: 9px; line-height: 1.4; font-weight: 700; color: #000; }
                
                .copy-box { margin-bottom: 8px; text-align: center; }
                .copy-label { border: 1.5px solid #000; padding: 2px 8px; font-weight: 800; font-size: 11px; border-radius: 4px; display: inline-block; background: #eee; }

                .header { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; margin: 0 auto 5px auto; width: 100%; border-bottom: 1.5px solid #000; padding-bottom: 5px; }
                .brand-block { text-align: right; }
                .brand-name { font-size: 19px; font-weight: 900; line-height: 1.1; margin-bottom: 2px; }
                .brand-subtitle { font-size: 10px; font-weight: 900; background: #000; color: #fff; padding: 2px 4px; border-radius: 3px; display: inline-block; }
                
                .contacts-table { border-collapse: collapse; font-size: 9px; font-weight: 900; line-height: 1.4; text-align: left; }
                .contacts-table td { padding: 1px 0; }
                .contacts-table td:first-child { padding-left: 8px; white-space: nowrap; text-align: right; }
                .contacts-table td:last-child { text-align: right; font-size: 10px; }

                .store-location { font-size: 10.5px; font-weight: 900; padding: 4px 0; text-align: center; margin-bottom: 2px; }

                .meta-dashed { border-top: 1.5px dashed #000; border-bottom: 1.5px dashed #000; padding: 4px 0; margin: 2px 0 6px 0; }
                .meta-row { display: flex; justify-content: space-between; font-size: 9.5px; font-weight: 900; }
                
                .customer-section { text-align: right; margin-bottom: 6px; font-size: 10px; font-weight: 800; padding: 6px; border: 1.5px solid #000; border-radius: 4px; background: #fbfbfb; }
                .cust-row-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
                .cust-row { margin-bottom: 1px; }

                .receipt-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 10px; border: 1.5px solid #000; table-layout: fixed; word-wrap: break-word; }
                .receipt-table th, .receipt-table td { padding: 5px 1px; border: 1px solid #000; font-weight: 800; text-align: center; }
                .receipt-table thead th { border-bottom: 1.5px solid #000; font-weight: 900; background: #f4f4f4; white-space: nowrap; }
                .receipt-table th:nth-child(1), .receipt-table td:nth-child(1) { width: 38%; text-align: right; padding-right: 2px; } 
                .receipt-table th:nth-child(2), .receipt-table td:nth-child(2) { width: 14%; } 
                .receipt-table th:nth-child(3), .receipt-table td:nth-child(3) { width: 20%; white-space: nowrap; } 
                .receipt-table th:nth-child(4), .receipt-table td:nth-child(4) { width: 10%; } 
                .receipt-table th:nth-child(5), .receipt-table td:nth-child(5) { width: 18%; white-space: nowrap; } 
                .item-name { text-align: right !important; font-weight: 900 !important; font-size: 9px; }

                .totals-section { text-align: right; margin-top: 6px; border-top: 1.5px solid #000; padding-top: 6px; }
                .total-line { display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: 800; margin-bottom: 2px; padding: 2px 0; white-space: nowrap; gap: 8px; }
                .total-line > span:last-child { min-width: 60px; text-align: left; font-size: 11px; }
                
                .agent-row { font-size: 10.5px; font-weight: 900; text-align: center; margin-bottom: 6px; margin-top: 4px; padding-top: 4px; }
                .thanks-msg { font-size: 12px; font-weight: 900; text-align: center; margin-bottom: 6px; background: #000; color: #fff; padding: 4px; border-radius: 4px; }

                .dev-row { font-size: 9px; font-weight: bold; background: #eee; border: 1px dashed #000; padding: 4px; border-radius: 4px; margin-top: 10px; text-align: center; color: #000 !important; }

                .text-bold { font-weight: 800; }
                .text-xbold { font-weight: 900; }

                @media print {
                    body { -webkit-print-color-adjust: exact; width: 100%; margin: 0; padding: 0; }
                    .receipt-container { margin: 0 auto; padding-top: 0; }
                }
            </style>
        </head>
        <body>
            ${generateReceiptContent('')}
        </body>
        </html>
    `);
}

async function printPaymentReceipt(payment) {
    executeHiddenPrint(`
        <html>
        <head>
            <title>وصل استلام - ${esc(payment.customerName)}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
                @page { margin: 0; }
                * { box-sizing: border-box; font-family: 'Cairo', sans-serif; margin: 0; padding: 0; }
                body { direction: rtl; width: 100%; text-align: center; margin: 0; padding: 0; color: #000; background: #fff; }
                
                .receipt-container { padding-top: 0; margin-top: 0; width: 100%; max-width: 290px; margin: 0 auto; text-align: center; border: 1.5px solid #000; padding: 10px; border-radius: 4px; box-sizing: border-box; overflow: hidden; font-size: 11.5px; font-weight: 700; line-height: 1.4; color: #000; }
                
                .header { border-bottom: 1.5px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
                .brand { font-size: 21px; font-weight: 900; }
                .title { font-size: 14px; font-weight: 700; margin: 4px 0; background: #000; color: #fff; display: inline-block; padding: 4px 12px; border-radius: 4px; }
                
                .details { text-align: right; margin: 10px 0; font-size: 11.5px; }
                .row { display: flex; justify-content: space-between; border-bottom: 1px dashed #ccc; padding: 6px 0; }
                
                .amount-box { border: 1.5px solid #000; border-radius: 4px; padding: 12px; margin: 15px 0; font-size: 18px; font-weight: 900; background: #f8f8f8; text-align: center; }
                .footer { border-top: 1.5px dashed #000; margin-top: 10px; padding-top: 8px; font-size: 11.5px; font-weight: 800; }
                .dev-row { font-size: 11px; font-weight: bold; background: #eee; border: 1px dashed #000; padding: 4px; border-radius: 4px; margin-top: 10px; text-align: center; color: #000 !important; }
                
                @media print { 
                    body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; width: 100%; } 
                    .receipt-container { padding-top: 0; margin-top: 0; margin: 0 auto; }
                }
            </style>
        </head>
        <body>
            <div class="receipt-container">
                <div class="header">
                    <div class="brand">أبوزامل للتجارة والتوزيع</div>
                    <div class="title">وصل استلام نقدية</div>
                </div>
                <div class="details">
                    <div class="row"><span>رقم الوصل:</span><span>#${payment.id}</span></div>
                    <div class="row"><span>التاريخ:</span><span>${new Date(payment.date).toLocaleDateString('ar-EG')}</span></div>
                    <div class="row"><span>العميل:</span><span>${esc(payment.customerName)}</span></div>
                </div>
                <div class="amount-box">
                    المبلغ: ${payment.amount.toFixed(2)} ج.م
                </div>
                <div class="details">
                    <div class="row" style="border-bottom: none; font-weight: 900;">
                        <span>إجمالي الحساب المتبقي:</span>
                        <span>${payment.remaining.toFixed(2)} ج.م</span>
                    </div>
                    ${payment.note ? `<div style="margin-top: 5px; font-size: 11px; color: #000; font-weight: 900;">ملاحظات: ${esc(payment.note)}</div>` : ''}
                </div>
                <div class="footer">
                    <div style="font-weight: 800; border-bottom: 1.2px dashed #000; margin-bottom: 4px; padding-bottom: 4px;">توقيع المستلم: .....................</div>
                    <div>شكراً لتعاملكم معنا</div>
                </div>
            </div>
        </body>
        </html>
    `);
    }

async function getAgentName(id) {
    if (!id) return 'غير محدد';
    const agents = await db.getAll('agents');
    const agent = agents.find(a => a.id == id || a.id == parseInt(id));
    return agent ? agent.name : 'غير معروف';
}

// --- Ledger & Account Movements ---

// One place for every customer statement number (screen + print), so they always agree.
// debit = what the customer owes more, credit = what reduces it.
function buildCustomerStatement(customer, invoices, payments, returns, startDate, endDate) {
    const cid = customer.id;
    const allInv = invoices.filter(inv => inv.customer?.id == cid);
    const allPay = payments.filter(p => p.customerId == cid);
    const allRet = returns.filter(r => r.customerId == cid);
    const all = [
        ...allInv.map(inv => ({ date: inv.date, sk: inv.date, type: 'فاتورة مبيعات', id: inv.id, debit: invoiceOwnDebit(inv, returns), credit: Number(inv.paid) || 0, ref: `فاتورة #${inv.id}`, originalType: 'invoice', cat: 'sale' })),
        ...allPay.map(p => {
            const isOut = p.direction === 'out';
            return { date: p.date, sk: p.createdAt || p.date, type: isOut ? 'نقد صادر (له)' : 'نقد وارد (عليه)', id: p.id,
                debit: isOut ? (Number(p.amount) || 0) : 0, credit: isOut ? 0 : (Number(p.amount) || 0),
                ref: p.note || (isOut ? 'مستردات / صادر' : 'سداد نقدي'), originalType: 'payment', direction: p.direction || 'in', cat: isOut ? 'out' : 'in' };
        }),
        ...allRet.map(r => ({ date: r.date, sk: r.date, type: 'مرتجع مبيعات', id: r.id, debit: Number(r.cashRefund) || 0, credit: Number(r.total) || 0,
            ref: `مرتجع #${r.id} (فاتورة #${r.invoiceId})` + ((Number(r.cashRefund) || 0) > 0 ? ` - رد كاش ${(Number(r.cashRefund)).toFixed(2)}` : ''), originalType: 'return', cat: 'ret' }))
    ].sort((a, b) => (new Date(a.sk) - new Date(b.sk)) || (a.originalType + a.id).localeCompare(b.originalType + b.id));

    const initial = Number(customer.initialBalance) || 0;
    let run = initial;
    all.forEach(m => { run = round2(run + m.debit - m.credit); m.running = run; });
    const computed = run;
    // The balance the shop really uses (POS, customers list). If movements do not explain it (data imported from the old app,
    // or a manual change), show the gap as its own line instead of silently ending on a different number.
    const stored = Number(customer.balance) || 0;
    const gap = round2(stored - computed);
    const hasGap = Math.abs(gap) >= 0.01 && !(computed < 0 && stored === 0);
    let adj = null;
    if (hasGap) {
        adj = { date: null, type: 'تسوية رصيد', id: 0, debit: gap > 0 ? gap : 0, credit: gap < 0 ? -gap : 0, ref: 'فرق بين الرصيد المسجل للعميل وحركاته', originalType: 'adjust', running: stored, cat: 'adj' };
    }
    const startKey = startDate || null, endKey = endDate ? endDate + 'T23:59:59' : null;
    const inRange = m => (!startKey || String(m.date) >= startKey) && (!endKey || String(m.date) <= endKey);
    const shown = all.filter(inRange);
    // balance carried into the period = running balance after the last movement before it
    let opening = initial;
    if (startKey) { const before = all.filter(m => String(m.date) < startKey); opening = before.length ? before[before.length - 1].running : initial; }
    let openingShown = null;
    if (startKey) openingShown = { label: 'رصيد سابق قبل الفترة', amount: opening, note: 'الرصيد المرحّل لبداية الفترة المختارة' };
    else if (initial) openingShown = { label: 'رصيد افتتاحي (سابق)', amount: initial, note: 'رصيد مُرحل في بداية التعامل' };
    const movements = shown.slice();
    let finalBalance = shown.length ? shown[shown.length - 1].running : opening;
    if (adj && !endKey) { movements.push(adj); finalBalance = stored; }
    const sumOf = (arr, f) => round2(arr.reduce((t, m) => t + f(m), 0));
    const totals = {
        sales: sumOf(shown.filter(m => m.cat === 'sale'), m => m.debit),
        paid: sumOf(shown.filter(m => m.cat === 'sale'), m => m.credit) + sumOf(shown.filter(m => m.cat === 'in'), m => m.credit),
        returns: sumOf(shown.filter(m => m.cat === 'ret'), m => m.credit),
        cashOut: sumOf(shown.filter(m => m.cat === 'out'), m => m.debit)
    };
    totals.paid = round2(totals.paid);
    return { movements, openingShown, finalBalance: round2(finalBalance), totals, custInvoices: allInv, custReturns: allRet, computed, stored, gap: hasGap ? gap : 0 };
}

async function showCustomerLedger(customerId, startDate = null, endDate = null) {
    const customer = await db.getById('customers', customerId);
    if (!customer) return showToast('العميل غير موجود', 'error');

    // Fetch all related data
    const [invoices, payments, returns] = await Promise.all([
        db.getAll('invoices'),
        db.getAll('customerPayments'),
        db.getAll('returns')
    ]);

    const st = buildCustomerStatement(customer, invoices, payments, returns, startDate, endDate);
    const { movements, openingShown, totals } = st;
    const runningBalance = st.finalBalance;
    const custInvoices = st.custInvoices, custReturns = st.custReturns;

    contentArea.innerHTML = `
        <div class="page-header">
            <div class="header-title">
                <i class="fas fa-book-open" style="color: var(--primary); font-size: 1.5rem;"></i>
                <div>
                    <h2>كشف حساب العميل: ${esc(customer.name)}</h2>
                    <p style="font-size: 0.9rem; color: var(--text-muted);">${esc(customer.phone || 'بدون هاتف')}</p>
                </div>
            </div>
            <div class="header-actions">
                <button class="btn btn-print" onclick="printCustomerStatement(${customerId})"><i class="fas fa-print"></i> كشف</button>
                <button class="btn btn-save" style="background: var(--success);" onclick="showPaymentModal('customer', ${customerId}, null, 'in')">
                    <i class="fas fa-plus-circle"></i> وارد
                </button>
                <button class="btn btn-edit" style="background: var(--danger);" onclick="showPaymentModal('customer', ${customerId}, null, 'out')">
                    <i class="fas fa-minus-circle"></i> صادر
                </button>
                <button class="btn btn-new" style="background: var(--accent);" onclick="recalculateCustomerBalance(${customerId})" title="إعادة حساب من السجل">
                    <i class="fas fa-sync"></i> تحديث
                </button>
                <button class="btn btn-new" onclick="loadPage('customers')">رجوع</button>
            </div>

        </div>

        <div class="filters-card card" style="margin-bottom: 2rem; padding: 1.5rem;">
            <div class="filter-row" style="display: flex; gap: 1.5rem; align-items: flex-end;">
                <div class="input-group" style="margin: 0;">
                    <label>من تاريخ</label>
                    <input type="date" id="ledger-start-date" value="${startDate || ''}">
                </div>
                <div class="input-group" style="margin: 0;">
                    <label>إلى تاريخ</label>
                    <input type="date" id="ledger-end-date" value="${endDate || ''}">
                </div>
                <button class="btn btn-new" style="height: 45px;" onclick="filterLedger('customer', ${customerId})">
                    <i class="fas fa-filter"></i> تصفية
                </button>
                <button class="btn btn-new" style="height: 45px; background: transparent; border: 1px solid #444;" onclick="showCustomerLedger(${customerId})">
                    <i class="fas fa-sync"></i> عرض الكل
                </button>
            </div>
        </div>

        <div class="stats-grid" style="margin-bottom: 2rem;">
            <div class="card stat-card danger">
                <div class="stat-icon"><i class="fas fa-money-bill-wave"></i></div>
                <div class="stat-details">
                    <p class="stat-title">الرصيد النهائي (المتبقي عليه)</p>
                    <h2 class="stat-value">${runningBalance.toFixed(2)} ج.م</h2>
                </div>
            </div>
            ${renderStatCard('إجمالي المبيعات', totals.sales.toFixed(2), 'fas fa-shopping-cart', 'primary')}
            ${renderStatCard('إجمالي المدفوعات', totals.paid.toFixed(2), 'fas fa-check-double', 'success')}
            ${renderStatCard('إجمالي المرتجعات', totals.returns.toFixed(2), 'fas fa-undo', 'accent')}
        </div>

        <div class="card statement-card">
            <table class="modern-table ledger-table">
                <thead>
                    <tr>
                        <th width="120">التاريخ</th>
                        <th>البيان / الحركة</th>
                        <th class="text-danger">مدين (زيادة المديونية)</th>
                        <th class="text-success">دائن (سداد/مرتجع)</th>
                        <th>الرصيد التراكمي</th>
                        <th>ملاحظات / إجراءات</th>
                    </tr>
                </thead>
                <tbody>
                    ${openingShown ? `
                        <tr class="initial-row">
                            <td>-</td>
                            <td style="font-weight:700">${esc(openingShown.label)}</td>
                            <td class="text-danger">${openingShown.amount > 0 ? openingShown.amount.toFixed(2) : '-'}</td>
                            <td class="text-success">${openingShown.amount < 0 ? (-openingShown.amount).toFixed(2) : '-'}</td>
                            <td style="font-weight:900">${openingShown.amount.toFixed(2)}</td>
                            <td>${esc(openingShown.note)}</td>
                        </tr>
                    ` : ''}
                    ${movements.map(m => `
                        <tr class="${m.originalType}-row">
                            <td>${m.date ? new Date(m.date).toLocaleDateString('ar-EG', { year:'numeric', month:'short', day:'numeric' }) : '-'}</td>
                            <td>
                                <span class="badge-type ${m.originalType}">${esc(m.type)}</span>
                            </td>
                            <td class="text-danger font-bold">${m.debit > 0 ? m.debit.toFixed(2) : '-'}</td>
                            <td class="text-success font-bold">${m.credit > 0 ? m.credit.toFixed(2) : '-'}</td>
                            <td style="font-weight:900; color: var(--primary); background: rgba(var(--primary-rgb), 0.05);">${m.running.toFixed(2)}</td>
                            <td>
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span>${esc(m.ref)}</span>
                                    <div class="row-actions">
                                        ${m.originalType === 'payment' ? `
                                            <button class="btn-icon edit" title="تعديل" onclick="editPayment('customer', ${m.id})"><i class="fas fa-edit"></i></button>
                                            <button class="btn-icon delete" title="حذف" onclick="deletePayment('customer', ${m.id})"><i class="fas fa-trash"></i></button>
                                        ` : ''}
                                        ${m.originalType === 'invoice' ? `
                                            <button class="btn-icon view" title="تعديل الفاتورة" onclick="editInvoice(${m.id})"><i class="fas fa-pen"></i></button>
                                            <button class="btn-icon print" title="طباعة" onclick="reprintInvoice(${m.id})"><i class="fas fa-print"></i></button>
                                        ` : ''}
                                    </div>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                    ${movements.length === 0 && !openingShown ? '<tr><td colspan="6" style="text-align:center; padding: 3rem; color: #666;">لا توجد حركات مسجلة لهذا العميل</td></tr>' : ''}
                </tbody>
            </table>
        </div>
        <div class="dev-row" style="text-align:center; margin-top:2rem; opacity:0.5;">★ نظام أبوزامل لإدارة المبيعات والتوزيع - كشف حساب الكتروني ★</div>
    `;
}

function filterLedger(type, id) {
    const start = document.getElementById('ledger-start-date').value;
    const end = document.getElementById('ledger-end-date').value;
    if (type === 'customer') showCustomerLedger(id, start, end);
    else showSupplierLedger(id, start, end);
}


async function editPayment(type, id) {
    const store = type === 'customer' ? 'customerPayments' : 'supplierPayments';
    const payment = await db.getById(store, id);
    if (!payment) return showToast('الدفعة غير موجودة', 'error');

    showPaymentModal(type, type === 'customer' ? payment.customerId : payment.supplierId, payment);
}

function showPaymentModal(type, entityId, editingPayment = null, forceDirection = null) {
    // Remove any existing standalone modal
    const existing = document.getElementById('payment-modal-global');
    if (existing) existing.remove();

    const title = editingPayment ? 'تعديل حركة نقدية' : (forceDirection === 'out' ? 'تسجيل صادر نقدي' : 'تسجيل وارد نقدي');
    const submitHandler = editingPayment ? `handleUpdatePayment(event, '${type}', ${editingPayment.id})` : 'handleSavePaymentGlobal()';
    const amount = editingPayment ? editingPayment.amount : '';
    const date = editingPayment ? editingPayment.date : new Date().toLocaleDateString('en-CA');
    const note = editingPayment ? editingPayment.note : '';
    const direction = editingPayment ? (editingPayment.direction || (type === 'customer' ? 'in' : 'out')) : (forceDirection || (type === 'customer' ? 'in' : 'out'));

    // Create a standalone modal and inject into body
    const modal = document.createElement('div');
    modal.id = 'payment-modal-global';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); display: flex; align-items: center;
        justify-content: center; z-index: 9999;
    `;
    modal.innerHTML = `
        <div style="min-width: 360px; max-width: 480px; background: var(--sidebar-dark, #0d1630); border-radius: 12px; padding: 2rem; border: 1px solid var(--border-dark, #1e2d4d);">
            <h3 style="margin-bottom: 1.2rem; color: var(--text-light, #fff); font-size:1.2rem;">
                <i class="fas fa-hand-holding-dollar" style="margin-left:8px; color: ${direction === 'in' ? 'var(--success,#22c55e)' : 'var(--danger,#ef4444)'};"></i>
                ${title}
            </h3>
            <input type="hidden" id="pay-type" value="${type}">
            <input type="hidden" id="pay-entity-id" value="${entityId}">
            <input type="hidden" id="pay-direction" value="${direction}">
            ${editingPayment ? `<input type="hidden" id="pay-old-amount" value="${editingPayment.amount}">` : ''}
            <div style="display: grid; gap: 1rem;">
                <div>
                    <label style="color: var(--text-muted, #aaa); display:block; margin-bottom:6px; font-size:0.9rem;">المبلغ (ج.م)</label>
                    <input type="number" id="pay-amount" value="${amount}" step="0.01" min="0" placeholder="0.00" style="width:100%; padding:12px; border-radius:8px; border:1px solid var(--border-dark,#1e2d4d); background:var(--bg-dark,#050a1f); color:#fff; font-size:1.4rem; font-weight:bold; box-sizing:border-box;">
                </div>
                <div>
                    <label style="color: var(--text-muted, #aaa); display:block; margin-bottom:6px; font-size:0.9rem;">التاريخ</label>
                    <input type="date" id="pay-date" value="${date}" style="width:100%; padding:12px; border-radius:8px; border:1px solid var(--border-dark,#1e2d4d); background:var(--bg-dark,#050a1f); color:#fff; font-size:1rem; box-sizing:border-box;">
                </div>
                <div>
                    <label style="color: var(--text-muted, #aaa); display:block; margin-bottom:6px; font-size:0.9rem;">ملاحظات / البيان</label>
                    <input type="text" id="pay-note" value="${esc(note)}" placeholder="مثلاً: سداد نقدي، دفعة تحت الحساب..." style="width:100%; padding:12px; border-radius:8px; border:1px solid var(--border-dark,#1e2d4d); background:var(--bg-dark,#050a1f); color:#fff; font-size:1rem; box-sizing:border-box;">
                </div>
            </div>
            <div style="display:flex; gap:1rem; margin-top:1.5rem; justify-content:flex-end;">
                <button class="btn btn-new" style="padding:10px 20px; font-size:1rem;" onclick="document.getElementById('payment-modal-global').remove()">
                    <i class="fas fa-times"></i> إلغاء
                </button>
                <button class="btn btn-save" style="padding:10px 20px; font-size:1rem; background: ${direction === 'in' ? 'var(--success)' : 'var(--danger)'};" onclick="${submitHandler}">
                    <i class="fas fa-save"></i> ${editingPayment ? 'تحديث' : 'حفظ الحركة'}
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    if (window.matchMedia('(max-width: 768px)').matches) {
        modal.classList.add('pay-phone');
        const box = modal.firstElementChild;
        const amt = document.getElementById('pay-amount');
        const rows = box.querySelectorAll('div[style*="display: grid"] > div');
        if (rows[1]) rows[1].classList.add('pay-extra');
        if (rows[2]) rows[2].classList.add('pay-extra');
        const ent = type === 'customer' ? state.cache.customers.find(c => String(c.id) === String(entityId)) : null;
        const bal = ent ? Number(ent.balance) || 0 : 0;
        const q = document.createElement('div');
        q.className = 'pay-quick';
        let html = '';
        if (!editingPayment && bal > 0 && direction === 'in') {
            html += `<div class="pay-bal">الدين: <b>${qsNum(bal)} ج</b></div><button type="button" class="pay-full" onclick="document.getElementById('pay-amount').value=${bal};">سداد كامل ${qsNum(bal)}</button>`;
        }
        html += `<button type="button" class="pay-more" onclick="this.closest('.pay-phone').classList.toggle('show-extra')">التاريخ والملاحظات</button>`;
        q.innerHTML = html;
        box.querySelector('div[style*="display: grid"]').before(q);
        if (amt) { amt.setAttribute('inputmode', 'decimal'); amt.addEventListener('keydown', e => { if (e.key === 'Enter') box.querySelector('.btn-save').click(); }); setTimeout(() => amt.focus(), 80); }
    }
}

async function deletePayment(type, id) {
    if (!confirm('هل أنت متأكد من حذف هذه الحركة؟ سيتم تعديل الرصيد تلقائياً.')) return;

    const store = type === 'customer' ? 'customerPayments' : 'supplierPayments';
    const entityStore = type === 'customer' ? 'customers' : 'suppliers';
    
    // 1. Get Payment Data
    const payment = await db.getById(store, id);
    if (!payment) return showToast('الحركة غير موجودة', 'error');

    const entityId = type === 'customer' ? payment.customerId : payment.supplierId;
    const amount = payment.amount;
    const direction = payment.direction || (type === 'customer' ? 'in' : 'out');

    // 2. Adjust Balance
    const entity = await db.getById(entityStore, entityId);
    if (entity) {
        // If we delete an IN (payment received), balance increases (debt goes up)
        // If we delete an OUT (refund sent), balance decreases (debt goes down)
        if (type === 'customer') {
            entity.balance = round2((entity.balance || 0) + (direction === 'in' ? amount : -amount));
        } else {
            // Supplier: delete OUT (we paid them) -> balance increases (we owe more)
            // delete IN (refund received) -> balance decreases (we owe less)
            entity.balance = round2((entity.balance || 0) + (direction === 'out' ? amount : -amount));
        }
        await db.update(entityStore, entity);
    }

    // 3. Delete Record
    await db.delete(store, id);
    showToast('✅ تم الحذف وتعديل الرصيد');

    // 4. Refresh View
    if (type === 'customer') {
        await refreshGlobalCache('customers');
        showCustomerLedger(entityId);
    } else {
        await refreshGlobalCache('suppliers');
        showSupplierLedger(entityId);
    }
}

async function recalculateCustomerBalance(customerId) {
    try {
        const customer = await db.getById('customers', customerId);
        if (!customer) return;

        const [invoices, payments, returns] = await Promise.all([
            db.getAll('invoices'),
            db.getAll('customerPayments'),
            db.getAll('returns')
        ]);

        const custInvoices = invoices.filter(inv => inv.customer?.id == customerId);
        const custPayments = payments.filter(p => p.customerId == customerId);
        const custReturns = returns.filter(r => r.customerId == customerId);

        let debit = Number(customer.initialBalance || 0);
        let credit = 0;

        custInvoices.forEach(inv => {
            debit += invoiceOwnDebit(inv, returns);
            credit += (Number(inv.paid) || 0);
        });

        custPayments.forEach(p => {
            if (p.direction === 'out') debit += (Number(p.amount) || 0);
            else credit += (Number(p.amount) || 0);
        });

        custReturns.forEach(r => {
            credit += (Number(r.total) || 0);
            debit += (Number(r.cashRefund) || 0);
        });

        const newBalance = Math.max(0, round2(debit - credit));
        if (Math.abs(newBalance - (Number(customer.balance) || 0)) >= 0.01 &&
            !confirm(`الرصيد المسجل للعميل: ${(Number(customer.balance) || 0).toFixed(2)}\nالرصيد المحسوب من الحركات: ${newBalance.toFixed(2)}\nهل تريد استبدال الرصيد المسجل بالمحسوب؟`)) return;
        customer.balance = newBalance;
        await db.update('customers', customer, { absolute: true });
        
        showToast('تم إعادة حساب الرصيد بنجاح');
        showCustomerLedger(customerId);
    } catch (e) {
        console.error('Recalculate Customer Balance Error:', e);
        showToast('حدث خطأ أثناء إعادة الحساب', 'error');
    }
}

async function recalculateSupplierBalance(supplierId) {
    try {
        const supplier = await db.getById('suppliers', supplierId);
        if (!supplier) return;

        const [purchases, payments] = await Promise.all([
            db.getAll('purchases'),
            db.getAll('supplierPayments')
        ]);

        const supPurchases = purchases.filter(p => p.supplierId == supplierId);
        const supPayments = payments.filter(p => p.supplierId == supplierId);

        let credit = Number(supplier.initialBalance || 0);
        let debit = 0;

        supPurchases.forEach(p => {
            const total = p.totalCost !== undefined ? p.totalCost : (p.total || 0);
            credit += Number(total);
            debit += Number(p.paid) || 0; // paid at purchase time
        });

        supPayments.forEach(p => {
            if (p.direction === 'in') credit += Number(p.amount);
            else debit += Number(p.amount);
        });

        const newBalance = Math.max(0, round2(credit - debit));
        supplier.balance = newBalance;
        await db.update('suppliers', supplier, { absolute: true });
        
        showToast('تم إعادة حساب الرصيد بنجاح');
        showSupplierLedger(supplierId);
    } catch (e) {
        console.error('Recalculate Supplier Balance Error:', e);
        showToast('حدث خطأ أثناء إعادة الحساب', 'error');
    }
}


async function handleUpdatePayment(event, type, paymentId) {
    const entityId = parseInt(document.getElementById('pay-entity-id').value);
    const oldAmount = parseFloat(document.getElementById('pay-old-amount').value);
    const newAmount = parseFloat(document.getElementById('pay-amount').value);
    const date = document.getElementById('pay-date').value;
    const note = document.getElementById('pay-note').value;
    const direction = document.getElementById('pay-direction').value;

    if (!newAmount || newAmount <= 0) { showToast('أدخل مبلغ صحيح', 'error'); return; }

    const store = type === 'customer' ? 'customerPayments' : 'supplierPayments';
    const entityStore = type === 'customer' ? 'customers' : 'suppliers';
    
    // 1. Update Payment Record
    const payment = await db.getById(store, paymentId);
    payment.amount = newAmount;
    payment.date = date;
    payment.note = note;
    payment.direction = direction;
    await db.update(store, payment);

    // 2. Adjust Entity Balance
    const entity = await db.getById(entityStore, entityId);
    if (entity) {
        const diff = newAmount - oldAmount;
        if (type === 'customer') {
            // Customer: In increases credit (decreases debt), Out increases debt
            entity.balance = round2((entity.balance || 0) - (direction === 'in' ? diff : -diff));
        } else {
            // Supplier: Out decreases debt, In decreases bank (increases debt)
            entity.balance = round2((entity.balance || 0) - (direction === 'out' ? diff : -diff));
        }
        await db.update(entityStore, entity);
    }

    // 3. Cleanup and Refresh
    const modal = document.getElementById('payment-modal-global');
    if (modal) modal.remove();
    showToast('✅ تم التعديل وتحديث الرصيد');
    
    if (type === 'customer') {
        await refreshGlobalCache('customers');
        showCustomerLedger(entityId);
    } else {
        showSupplierLedger(entityId);
    }
}

async function handleSavePaymentGlobal() {
    const type = document.getElementById('pay-type')?.value;
    const entityId = parseInt(document.getElementById('pay-entity-id')?.value);
    const amount = parseFloat(document.getElementById('pay-amount')?.value);
    const date = document.getElementById('pay-date')?.value;
    const note = document.getElementById('pay-note')?.value || '';
    const direction = document.getElementById('pay-direction')?.value;

    if (!amount || amount <= 0) { showToast('أدخل مبلغ صحيح', 'error'); return; }
    if (!date) { showToast('أدخل تاريخ', 'error'); return; }

    if (type === 'customer') {
        await db.add('customerPayments', { 
            customerId: entityId, amount, date, note, direction, createdAt: new Date().toISOString() 
        });
        const customer = await db.getById('customers', entityId);
        if (customer) {
            customer.balance = round2((customer.balance || 0) - (direction === 'in' ? amount : -amount));
            await db.update('customers', customer);
        }
        const modal = document.getElementById('payment-modal-global');
        if (modal) modal.remove();
        showToast('✅ تم تسجيل الحركة بنجاح');
        
        await refreshGlobalCache('customers');
        if (state.currentPage === 'customer-ledger') showCustomerLedger(entityId);
        else loadPage('customers');
    } else {
        await db.add('supplierPayments', { 
            supplierId: entityId, amount, date, note, direction, createdAt: new Date().toISOString() 
        });
        const supplier = await db.getById('suppliers', entityId);
        if (supplier) {
            supplier.balance = round2((supplier.balance || 0) - (direction === 'out' ? amount : -amount));
            await db.update('suppliers', supplier);
        }
        const modal = document.getElementById('payment-modal-global');
        if (modal) modal.remove();
        showToast('✅ تم تسجيل الحركة بنجاح');
        
        if (state.currentPage === 'supplier-ledger') showSupplierLedger(entityId);
        else loadPage('suppliers');
    }
}


async function showSupplierLedger(supplierId, startDate = null, endDate = null) {
    const supplier = await db.getById('suppliers', supplierId);
    if (!supplier) return showToast('المورد غير موجود', 'error');

    const [purchases, payments] = await Promise.all([
        db.getAll('purchases'),
        db.getAll('supplierPayments')
    ]);

    let supPurchases = purchases.filter(p => p.supplierId == supplierId);
    let supPayments = payments.filter(p => p.supplierId == supplierId);

    if (startDate) {
        supPurchases = supPurchases.filter(p => p.date >= startDate);
        supPayments = supPayments.filter(p => p.date >= startDate);
    }
    if (endDate) {
        supPurchases = supPurchases.filter(p => p.date <= endDate + 'T23:59:59');
        supPayments = supPayments.filter(p => p.date <= endDate + 'T23:59:59');
    }

    const movements = [
        ...supPurchases.map(p => ({
            date: p.date,
            type: 'فاتورة شراء',
            id: p.id,
            debit: Number(p.paid) || 0,
            credit: Number(p.totalCost !== undefined ? p.totalCost : (p.total || 0)),
            ref: `فاتورة #${p.id}`,
            originalType: 'purchase'
        })),
        ...supPayments.map(p => {
            const isIn = p.direction === 'in';
            return {
                date: p.date,
                sk: p.createdAt,
                type: isIn ? 'نقد وارد (من المورد)' : 'نقد صادر (للمورد)',
                id: p.id,
                debit: isIn ? 0 : Number(p.amount),
                credit: isIn ? Number(p.amount) : 0,
                ref: p.note || (isIn ? 'مرتجع نقدي' : 'دفعة سداد'),
                originalType: 'payment',
                direction: p.direction || 'out'
            };
        })
    ].sort((a, b) => new Date(a.sk || a.date) - new Date(b.sk || b.date));

    // Calculate running balance
    let runningBalance = supplier.initialBalance || 0;
    movements.forEach(m => {
        runningBalance += (m.credit - m.debit);
        m.running = runningBalance;
    });

    contentArea.innerHTML = `
        <div class="page-header">
            <div class="header-title">
                <i class="fas fa-truck-ramp-box" style="color: var(--secondary); font-size: 1.5rem;"></i>
                <div>
                    <h2>كشف حساب المورد: ${esc(supplier.name)}</h2>
                    <p style="font-size: 0.9rem; color: var(--text-muted);">${esc(supplier.phone || 'بدون هاتف')}</p>
                </div>
            </div>
            <div class="header-actions">
                <button class="btn btn-print" onclick="printSupplierStatement(${supplierId})"><i class="fas fa-print"></i> كشف</button>
                <button class="btn btn-save" style="background: var(--danger);" onclick="showPaymentModal('supplier', ${supplierId}, null, 'out')">
                    <i class="fas fa-minus-circle"></i> صادر
                </button>
                <button class="btn btn-edit" style="background: var(--success);" onclick="showPaymentModal('supplier', ${supplierId}, null, 'in')">
                    <i class="fas fa-plus-circle"></i> وارد
                </button>
                <button class="btn btn-new" style="background: var(--accent);" onclick="recalculateSupplierBalance(${supplierId})" title="إعادة حساب من السجل">
                    <i class="fas fa-sync"></i> تحديث
                </button>
                <button class="btn btn-new" onclick="loadPage('suppliers')">رجوع</button>
            </div>


        </div>

        <div class="filters-card card" style="margin-bottom: 2rem; padding: 1.5rem;">
            <div class="filter-row" style="display: flex; gap: 1.5rem; align-items: flex-end;">
                <div class="input-group" style="margin: 0;">
                    <label>من تاريخ</label>
                    <input type="date" id="ledger-start-date" value="${startDate || ''}">
                </div>
                <div class="input-group" style="margin: 0;">
                    <label>إلى تاريخ</label>
                    <input type="date" id="ledger-end-date" value="${endDate || ''}">
                </div>
                <button class="btn btn-new" style="height: 45px;" onclick="filterLedger('supplier', ${supplierId})">
                    <i class="fas fa-filter"></i> تصفية
                </button>
                <button class="btn btn-new" style="height: 45px; background: transparent; border: 1px solid #444;" onclick="showSupplierLedger(${supplierId})">
                    <i class="fas fa-sync"></i> عرض الكل
                </button>
            </div>
        </div>

        <div class="stats-grid" style="margin-bottom: 2rem;">
            <div class="card stat-card danger">
                <div class="stat-icon"><i class="fas fa-file-invoice-dollar"></i></div>
                <div class="stat-details">
                    <p class="stat-title">المستحق للمورد حالياً</p>
                    <h2 class="stat-value">${runningBalance.toFixed(2)} ج.م</h2>
                </div>
            </div>
            ${renderStatCard('إجمالي المشتريات', supPurchases.reduce((sum, p) => sum + (p.totalCost !== undefined ? p.totalCost : (p.total || 0)), 0).toFixed(2), 'fas fa-truck-loading', 'primary')}
            ${renderStatCard('إجمالي المدفوعات', supPayments.filter(p=>p.direction!=='in').reduce((sum, p) => sum + p.amount, 0).toFixed(2), 'fas fa-money-check-dollar', 'success')}
        </div>

        <div class="card statement-card">
            <table class="modern-table ledger-table">
                <thead>
                    <tr>
                        <th width="120">التاريخ</th>
                        <th>البيان</th>
                        <th class="text-danger">مدين (دفعات صادرة/مرتجعات)</th>
                        <th class="text-success">دائن (مشتريات/وارد نقد)</th>
                        <th>الرصيد التراكمي</th>
                        <th>ملاحظات</th>
                    </tr>
                </thead>
                <tbody>
                    ${supplier.initialBalance ? `
                        <tr class="initial-row">
                            <td>-</td>
                            <td style="font-weight:700">رصيد سابق</td>
                            <td>-</td>
                            <td class="text-success font-bold">${supplier.initialBalance.toFixed(2)}</td>
                            <td style="font-weight:900; color: var(--primary);">${supplier.initialBalance.toFixed(2)}</td>
                            <td>رصيد مُرحل</td>
                        </tr>
                    ` : ''}
                    ${movements.map(m => `
                        <tr>
                            <td>${new Date(m.date).toLocaleDateString('ar-EG', { year:'numeric', month:'short', day:'numeric' })}</td>
                            <td><span class="badge-type ${m.originalType}">${esc(m.type)}</span></td>
                            <td class="text-danger font-bold">${m.debit > 0 ? m.debit.toFixed(2) : '-'}</td>
                            <td class="text-success font-bold">${m.credit > 0 ? m.credit.toFixed(2) : '-'}</td>
                            <td style="font-weight:900; color: var(--primary); background: rgba(var(--primary-rgb), 0.05);">${m.running.toFixed(2)}</td>
                            <td>
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span>${esc(m.ref)}</span>
                                    <div class="row-actions">
                                        ${m.type.includes('نقد') ? `
                                            <button class="btn-icon edit" title="تعديل" onclick="editPayment('supplier', ${m.id})"><i class="fas fa-edit"></i></button>
                                            <button class="btn-icon delete" title="حذف" onclick="deletePayment('supplier', ${m.id})"><i class="fas fa-trash"></i></button>
                                        ` : ''}
                                    </div>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                    ${movements.length === 0 && !supplier.initialBalance ? '<tr><td colspan="6" style="text-align:center; padding: 2rem;">لا توجد حركات مسجلة للمورد</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;
}

async function printSupplierPaymentReceipt(payment) {
    executeHiddenPrint(`
        <html>
        <head>
            <title>وصل دفع للمورد - ${esc(payment.supplierName)}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
                @page { margin: 0; }
                * { box-sizing: border-box; font-family: 'Cairo', sans-serif; margin: 0; padding: 0; }
                body { direction: rtl; width: 100%; text-align: center; margin: 0; padding: 0; color: #000; background: #fff; }
                
                .receipt-container { padding-top: 0; margin-top: 0; width: 100%; max-width: 290px; margin: 0 auto; text-align: center; border: 1.5px solid #000; padding: 10px; border-radius: 4px; box-sizing: border-box; overflow: hidden; font-size: 11.5px; font-weight: 700; line-height: 1.4; color: #000; }
                
                .header { border-bottom: 1.5px solid #000; padding-bottom: 8px; margin-bottom: 10px; }
                .brand { font-size: 21px; font-weight: 900; }
                .title { font-size: 14px; font-weight: 700; margin: 4px 0; background: #000; color: #fff; display: inline-block; padding: 4px 12px; border-radius: 4px; }
                
                .details { text-align: right; margin: 10px 0; font-size: 11.5px; }
                .row { display: flex; justify-content: space-between; border-bottom: 1px dashed #ccc; padding: 6px 0; }
                
                .amount-box { border: 1.5px solid #000; border-radius: 4px; padding: 12px; margin: 15px 0; font-size: 18px; font-weight: 900; background: #f8f8f8; text-align: center; }
                .footer { border-top: 1.5px dashed #000; margin-top: 10px; padding-top: 8px; font-size: 11.5px; font-weight: 800; }
                .dev-row { font-size: 11px; font-weight: bold; background: #eee; border: 1px dashed #000; padding: 4px; border-radius: 4px; margin-top: 10px; text-align: center; color: #000 !important; }
                
                @media print { 
                    body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; width: 100%; } 
                    .receipt-container { padding-top: 0; margin-top: 0; margin: 0 auto; }
                }
            </style>
        </head>
        <body>
            <div class="receipt-container">
                <div class="header">
                    <div class="brand">أبوزامل للتجارة والتوزيع</div>
                    <div class="title">وصل دفع للمورد</div>
                </div>
                <div class="details">
                    <div class="row"><span>رقم الوصل:</span><span>#${payment.id}</span></div>
                    <div class="row"><span>التاريخ:</span><span>${new Date(payment.date).toLocaleDateString('ar-EG')}</span></div>
                    <div class="row"><span>المورد:</span><span>${esc(payment.supplierName)}</span></div>
                </div>
                <div class="amount-box">المبلغ المدفوع: ${payment.amount.toFixed(2)} ج.م</div>
                <div class="details">
                    <div class="row" style="border-bottom: none; font-weight: 900;">
                        <span>المتبقي للمورد:</span>
                        <span>${(payment.remaining || 0).toFixed(2)} ج.م</span>
                    </div>
                    ${payment.note ? `<div style="margin-top: 5px; font-size: 11px; color: #000; font-weight: 900;">ملاحظات: ${esc(payment.note)}</div>` : ''}
                </div>
                <div class="footer">
                    <div style="font-weight: 800; border-bottom: 1.2px dashed #000; margin-bottom: 4px; padding-bottom: 4px;">توقيع المستلم: .....................</div>
                    <div>أبوزامل للتجارة والتوزيع</div>
                </div>
            </div>
        </body>
        </html>
    `);
}

async function printCustomerStatement(customerId) {
    const customer = await db.getById('customers', customerId);
    const invoices = await db.getAll('invoices');
    const payments = await db.getAll('customerPayments');
    const allReturns = await db.getAll('returns');
    const st = buildCustomerStatement(customer, invoices, payments, allReturns);
    const movements = st.movements.map(m => ({ date: m.date, desc: m.originalType === 'payment' || m.originalType === 'adjust' ? (m.originalType === 'adjust' ? m.type + ': ' + m.ref : m.ref) : m.ref, debit: m.debit, credit: m.credit, running: m.running }));

    executeHiddenPrint(`
        <html>
        <head>
            <title>كشف حساب - ${esc(customer.name)}</title>
            <style>
                body { direction: rtl; font-family: 'Cairo', sans-serif; padding: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: right; }
                th { background-color: #f4f4f4; }
                .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
                .summary { margin-top: 20px; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>أبوزامل للتجارة والتوزيع</h1>
                <h2>كشف حساب عميل</h2>
                <p>العميل: ${esc(customer.name)} | الهاتف: ${esc(customer.phone)}</p>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>التاريخ</th>
                        <th>البيان</th>
                        <th>مدين (عليه)</th>
                        <th>دائن (له)</th>
                        <th>الرصيد</th>
                    </tr>
                </thead>
                <tbody>
                    ${st.openingShown ? `
                        <tr style="background:#f9f9f9; font-weight:bold;">
                            <td>-</td>
                            <td>${esc(st.openingShown.label)}</td>
                            <td>${st.openingShown.amount > 0 ? st.openingShown.amount.toFixed(2) : '-'}</td>
                            <td>${st.openingShown.amount < 0 ? (-st.openingShown.amount).toFixed(2) : '-'}</td>
                            <td>${st.openingShown.amount.toFixed(2)}</td>
                        </tr>
                    ` : ''}
                    ${movements.map(m => `
                        <tr>
                            <td>${m.date ? new Date(m.date).toLocaleDateString('ar-EG') : '-'}</td>
                            <td>${esc(m.desc)}</td>
                            <td>${m.debit > 0 ? m.debit.toFixed(2) : '-'}</td>
                            <td>${m.credit > 0 ? m.credit.toFixed(2) : '-'}</td>
                            <td>${m.running.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="summary">
                <p>إجمالي المبيعات: ${st.totals.sales.toFixed(2)} | إجمالي المدفوعات: ${st.totals.paid.toFixed(2)} | إجمالي المرتجعات: ${st.totals.returns.toFixed(2)}</p>
                <p>الرصيد المتبقي: ${st.finalBalance.toFixed(2)} ج.م</p>
            </div>
        </body>
        </html>
    `);
    }

async function printSupplierStatement(supplierId) {
    const supplier = await db.getById('suppliers', supplierId);
    const purchases = await db.getAll('purchases');
    const payments = await db.getAll('supplierPayments');
    const supPurchases = purchases.filter(p => p.supplierId == supplierId);
    const supPayments = payments.filter(p => p.supplierId == supplierId);

    const movements = [
        ...supPurchases.map(p => ({ date: p.date, desc: `فاتورة شراء #${p.id}`, debit: Number(p.paid) || 0, credit: p.totalCost !== undefined ? p.totalCost : (p.total || 0) })),
        ...supPayments.map(p => ({ date: p.date, desc: p.note || 'دفعة سداد', debit: p.amount, credit: 0 }))
    ].sort((a, b) => new Date(a.sk || a.date) - new Date(b.sk || b.date));

    // Reliable iframe printing
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    iframe.contentDocument.write(`
        <html>
        <head>
            <title>كشف حساب مورد - ${esc(supplier.name)}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');
                body { direction: rtl; font-family: 'Cairo', sans-serif; padding: 20px; color: #000; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
                th, td { border: 1px solid #ddd; padding: 10px; text-align: right; }
                th { background-color: #f4f4f4; font-weight: bold; }
                .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
                .header h1 { margin: 0; font-size: 21px; font-weight: bold; }
                .header h2 { margin: 5px 0; font-size: 18px; }
                .summary { margin-top: 20px; font-weight: bold; font-size: 16px; border: 2px solid #333; padding: 10px; display: inline-block; }
                @media print {
                    body { -webkit-print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>أبوزامل للتجارة والتوزيع</h1>
                <h2>كشف حساب المورد</h2>
                <p><strong>المورد:</strong> ${esc(supplier.name)} | <strong>الهاتف:</strong> ${esc(supplier.phone || '-')}</p>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>التاريخ</th>
                        <th>البيان</th>
                        <th>مدين (عليه)</th>
                        <th>دائن (له)</th>
                    </tr>
                </thead>
                <tbody>
                    ${supplier.initialBalance ? `
                        <tr style="background:#f9f9f9; font-weight:bold;">
                            <td>-</td>
                            <td>رصيد افتتاحي (سابق)</td>
                            <td>-</td>
                            <td>${supplier.initialBalance.toFixed(2)}</td>
                        </tr>
                    ` : ''}
                    ${movements.map(m => `
                        <tr>
                            <td>${new Date(m.date).toLocaleDateString('ar-EG')}</td>
                            <td>${esc(m.desc)}</td>
                            <td>${m.debit > 0 ? Number(m.debit).toFixed(2) : '-'}</td>
                            <td>${m.credit > 0 ? Number(m.credit).toFixed(2) : '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="summary">
                المستحق للمورد: ${(supplier.balance || 0).toFixed(2)} ج.م
            </div>
        </body>
        </html>
    `);
    
    iframe.contentDocument.close();
    iframe.focus();
    
    // Give time for font and content to load
    setTimeout(() => {
        iframe.contentWindow.print();
        setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 500);
}

// Start the app
window.onload = init;

// --- Auxiliary Renderers & Logic ---

function showToast(message, type = 'success', duration = 3000) {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-circle';
    if (type === 'warning') icon = 'fa-exclamation-triangle';

    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

async function renderBestAgent(invoices, agents) {
    if (agents.length === 0 || invoices.length === 0) return '<p class="empty-msg">لا توجد بيانات</p>';
    
    const agentSales = {};
    invoices.forEach(inv => {
        if(inv && inv.agentId) agentSales[inv.agentId] = (agentSales[inv.agentId] || 0) + ((Number(inv.subTotal) || 0) - (Number(inv.discount) || 0));
    });
    
    let bestId = null;
    let max = -1;
    for (const id in agentSales) {
        if (agentSales[id] > max) {
            max = agentSales[id];
            bestId = id;
        }
    }
    
    if (!bestId) return '<p class="empty-msg">لا يوجد مبيعات للمناديب</p>';
    const agent = agents.find(a => a.id == bestId);
    
    return `
        <div class="best-agent-card">
            <i class="fas fa-crown"></i>
            <h4>${esc(agent ? agent.name : 'غير معروف')}</h4>
            <p>إجمالي المبيعات: ${max.toFixed(2)} ج.م</p>
        </div>
    `;
}

async function generateDetailedReport() {
    const from = document.getElementById('report-from').value;
    const to = document.getElementById('report-to').value;
    const container = document.getElementById('report-results');
    
    const invoices = await db.getAll('invoices');
    const expenses = await db.getAll('expenses');
    
    const filteredInvoices = invoices.filter(inv => {
        const d = inv.date.split('T')[0];
        return (!from || d >= from) && (!to || d <= to);
    });
    
    const filteredExpenses = expenses.filter(exp => {
        const d = exp.date.split('T')[0];
        return (!from || d >= from) && (!to || d <= to);
    });

    const totalSales = filteredInvoices.reduce((sum, inv) => sum + ((Number(inv.subTotal) || 0) - (Number(inv.discount) || 0)), 0);
    const totalExp = filteredExpenses.reduce((sum, exp) => sum + (Number(exp.amount) || 0), 0);
    const profit = totalSales - totalExp;

    container.innerHTML = `
        <div class="stats-grid" style="grid-column: 1 / -1">
            ${renderStatCard('مبيعات الفترة', totalSales.toFixed(2), 'fas fa-shopping-cart', 'primary')}
            ${renderStatCard('مصاريف الفترة', totalExp.toFixed(2), 'fas fa-money-bill-transfer', 'danger')}
            ${renderStatCard('صافي الربح', profit.toFixed(2), 'fas fa-sack-dollar', 'success')}
        </div>
    `;
    container.style.display = 'grid';
}

function executeHiddenPrint(htmlContent) {
    let iframe = document.getElementById('hidden-print-iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'hidden-print-iframe';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);
    }
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    }, 500);
}

function loadAgentIntoSettlement(agentId) {
    const select = document.getElementById('settlement-agent-id');
    if (select) {
        select.value = agentId;
        recalcSettlementDiff();
        // Scroll to the entry card for better UX
        const card = document.getElementById('settlement-entry-container');
        if (card) card.scrollIntoView({ behavior: 'smooth' });
    }
}

// Start Application
window.onload = init;


// ================= Online mode (multi-user) =================
function azCanOpen(page) {
    if (!state.user || state.user.role !== 'seller') return page !== 'my-invoices';
    return ['pos', 'products', 'customers', 'my-invoices', 'customer-ledger'].includes(page);
}

function azApplyUser() {
    const me = db.me;
    if (!me) return;
    state.user = { name: me.name, role: me.role === 'owner' ? 'admin' : 'seller', username: me.username, agentId: me.agent_id };
    const isSeller = state.user.role === 'seller';
    document.body.classList.toggle('role-seller', isSeller);
    document.querySelectorAll('.nav-item').forEach(li => {
        const page = li.getAttribute('data-page');
        li.style.display = azCanOpen(page) ? '' : 'none';
    });
    const prof = document.querySelector('.user-profile span');
    if (prof) prof.textContent = (isSeller ? 'بياع: ' : 'المدير: ') + me.name;
    const logout = document.getElementById('logout-btn');
    if (logout) logout.style.display = 'inline-flex';
}

function azSetupOnlineBanner() {
    let bar = document.getElementById('offline-banner');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'offline-banner';
        bar.textContent = 'مفيش اتصال بالإنترنت. لازم النت يكون شغال عشان تحفظ أي فاتورة.';
        document.body.appendChild(bar);
    }
    const update = () => { bar.style.display = navigator.onLine ? 'none' : 'block'; };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
}

function azLogout() {
    if (db.signOut) db.signOut();
    location.reload();
}
window.azOnAuthLost = () => { location.reload(); };

window.azShowLogin = function (database) {
    return new Promise(async (resolve) => {
        let needsSetup = false;
        try { needsSetup = !!(await database.rpc('az_needs_setup', {}, { retry: false })); } catch (e) { /* offline: show the login form */ }
        const wrap = document.createElement('div');
        wrap.id = 'login-overlay';
        wrap.innerHTML = `
            <form class="login-card" id="login-form" autocomplete="on">
                <h2>أبوزامل للتجارة والتوزيع</h2>
                <p class="login-sub">${needsSetup ? 'أول تشغيل: أنشئ حساب المدير' : 'تسجيل الدخول'}</p>
                ${needsSetup ? '<input id="lg-name" type="text" placeholder="الاسم" autocomplete="name">' : ''}
                <input id="lg-user" type="text" placeholder="اسم المستخدم" autocomplete="username" autocapitalize="none" required>
                <input id="lg-pass" type="password" placeholder="كلمة السر" autocomplete="${needsSetup ? 'new-password' : 'current-password'}" required>
                ${needsSetup ? '<input id="lg-pass2" type="password" placeholder="أعد كتابة كلمة السر" autocomplete="new-password" required>' : ''}
                <div id="lg-err" class="login-err"></div>
                <button type="submit" class="btn btn-save" id="lg-btn">${needsSetup ? 'إنشاء الحساب ودخول' : 'دخول'}</button>
            </form>`;
        document.body.appendChild(wrap);
        const form = wrap.querySelector('#login-form');
        const err = wrap.querySelector('#lg-err');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            err.textContent = '';
            const u = wrap.querySelector('#lg-user').value.trim();
            const p = wrap.querySelector('#lg-pass').value;
            const btn = wrap.querySelector('#lg-btn');
            btn.disabled = true;
            try {
                if (needsSetup) {
                    const p2 = wrap.querySelector('#lg-pass2').value;
                    if (p !== p2) throw new Error('كلمتا السر غير متطابقتين');
                    if (p.length < 6) throw new Error('كلمة السر لازم تكون 6 حروف على الأقل');
                    await database.rpc('az_setup_owner', { p_username: u, p_password: p, p_name: (wrap.querySelector('#lg-name').value || u) }, { retry: false });
                }
                await database.signIn(u, p);
                wrap.remove();
                resolve(database.me);
            } catch (ex) {
                const m = ex && ex.code === 'bad_username' ? 'اسم المستخدم: حروف إنجليزي وأرقام فقط (3 حروف على الأقل)' : (ex.message || 'حصل خطأ');
                err.textContent = m;
                btn.disabled = false;
            }
        });
        wrap.querySelector('#lg-user').focus();
    });
};

function renderPriceChangesCard(invoices) {
    const rows = [];
    (invoices || []).forEach(inv => {
        (inv.items || []).forEach(it => {
            if (it.originalPrice == null) return;
            const diff = round2((Number(it.salePrice) || 0) - (Number(it.originalPrice) || 0));
            if (Math.abs(diff) < 0.005 && !it.belowCost) return;
            rows.push({ inv, it, diff });
        });
    });
    rows.sort((a, b) => String(b.inv.date).localeCompare(String(a.inv.date)));
    const body = rows.length === 0
        ? '<tr><td colspan="8" style="text-align:center">لا توجد تعديلات أسعار هذا الشهر</td></tr>'
        : rows.slice(0, 100).map(({ inv, it, diff }) => `
            <tr>
                <td>#${inv.id}</td>
                <td>${inv.date ? new Date(inv.date).toLocaleDateString('ar-EG') : '-'}</td>
                <td>${esc(inv.createdByName || '-')}</td>
                <td>${esc(inv.customer?.name || 'نقدي')}</td>
                <td>${esc(it.name)}</td>
                <td>${(Number(it.originalPrice) || 0).toFixed(2)}</td>
                <td>${(Number(it.salePrice) || 0).toFixed(2)}</td>
                <td style="color:${diff < 0 ? 'var(--danger)' : 'var(--success, #2ecc71)'}">${diff > 0 ? '+' : ''}${diff.toFixed(2)}${it.belowCost ? ' <b title="أقل من التكلفة">⚠ أقل من التكلفة</b>' : ''}</td>
            </tr>`).join('');
    return `
        <div class="card reports-table-card" style="margin-top: 2rem">
            <h3 style="margin-bottom: 1rem">تعديلات الأسعار على الفواتير (هذا الشهر)</h3>
            <table class="modern-table">
                <thead><tr><th>الفاتورة</th><th>التاريخ</th><th>البياع</th><th>العميل</th><th>الصنف</th><th>السعر الأصلي</th><th>سعر البيع</th><th>الفرق</th></tr></thead>
                <tbody>${body}</tbody>
            </table>
        </div>`;
}

async function renderMyInvoices() {
    const since = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-CA');
    const to = new Date().toLocaleDateString('en-CA');
    const all = (await db.getByDateRange('invoices', since, to)) || [];
    const mine = all.filter(inv => !state.user.username || inv.createdBy === state.user.username).reverse();
    contentArea.innerHTML = `
        <div class="page-header"><h2>فواتيري (آخر 7 أيام)</h2></div>
        <div class="card reports-table-card">
            <table class="modern-table">
                <thead><tr><th>رقم</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>إجراء</th></tr></thead>
                <tbody>${renderInvoiceReportRows(mine)}</tbody>
            </table>
        </div>`;
}

function azLoadUsers() { return db.rpc('az_list_users', {}); }

async function renderUsersCard() {
    const box = document.getElementById('users-card-body');
    if (!box) return;
    try {
        const users = await azLoadUsers();
        box.innerHTML = `
            <table class="modern-table">
                <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>الحالة</th><th>إجراء</th></tr></thead>
                <tbody>${users.map(u => `
                    <tr>
                        <td>${esc(u.name)}</td><td dir="ltr">${esc(u.username)}</td>
                        <td>${u.role === 'owner' ? 'مدير' : 'بياع'}</td>
                        <td>${u.active ? 'شغال' : 'موقوف'}</td>
                        <td>
                            <button class="btn-edit" onclick="azChangePassword('${esc(u.username)}')">تغيير كلمة السر</button>
                            ${u.role !== 'owner' ? `<button class="btn-delete" onclick="azToggleUser('${esc(u.username)}', ${u.active ? 'false' : 'true'})">${u.active ? 'إيقاف' : 'تشغيل'}</button>` : ''}
                        </td>
                    </tr>`).join('')}</tbody>
            </table>
            <h4 style="margin:1rem 0 .5rem">إضافة بياع</h4>
            <div class="form-grid">
                <div class="input-group"><label>الاسم</label><input id="nu-name" type="text"></div>
                <div class="input-group"><label>اسم المستخدم (إنجليزي)</label><input id="nu-user" type="text" dir="ltr" autocapitalize="none"></div>
                <div class="input-group"><label>كلمة السر (6 حروف على الأقل)</label><input id="nu-pass" type="text" dir="ltr" autocomplete="off"></div>
                <button class="btn btn-save" style="margin-top:20px" onclick="azAddSeller()">إضافة البياع</button>
            </div>`;
    } catch (e) {
        box.innerHTML = '<p>تعذر تحميل المستخدمين: ' + esc(e.message) + '</p>';
    }
}

async function azAddSeller() {
    const name = document.getElementById('nu-name').value.trim();
    const user = document.getElementById('nu-user').value.trim();
    const pass = document.getElementById('nu-pass').value;
    if (!name || !user || pass.length < 6) return showToast('اكتب الاسم واسم المستخدم وكلمة سر 6 حروف على الأقل', 'error');
    try {
        // each seller is also a representative (مندوب) so his invoices show in the settlement screen
        const agentId = await db.add('agents', { name, phone: '', notes: 'حساب بياع: ' + user });
        await db.rpc('az_create_user', { p_username: user, p_password: pass, p_name: name, p_agent: agentId }, { retry: false });
        await refreshGlobalCache('agents');
        showToast('تمت إضافة البياع');
        renderUsersCard();
    } catch (e) {
        const msg = e.code === 'username_taken' ? 'اسم المستخدم مستخدم قبل كده' : e.code === 'bad_username' ? 'اسم المستخدم: حروف إنجليزي وأرقام فقط' : e.message;
        showToast(msg, 'error');
    }
}

async function azChangePassword(username) {
    const pass = prompt('كلمة السر الجديدة لـ ' + username + ' (6 حروف على الأقل):');
    if (!pass) return;
    try { await db.rpc('az_set_password', { p_username: username, p_password: pass }, { retry: false }); showToast('تم تغيير كلمة السر'); }
    catch (e) { showToast(e.code === 'weak_password' ? 'كلمة السر قصيرة' : e.message, 'error'); }
}

async function azToggleUser(username, active) {
    try { await db.rpc('az_set_active', { p_username: username, p_active: active }, { retry: false }); renderUsersCard(); }
    catch (e) { showToast(e.message, 'error'); }
}

// Mobile: compact rows. Tables turn into 1-2 line rows (title + key values + icon actions);
// tap a row for the rest. Long tables get a search box and "show more" paging.
(function azMobileTables() {
    const PAGE = 30;
    const isAct = h => h === '' || /^(إجراء|العمليات|ملاحظات \/ إجراءات)/.test(h);
    function classify(heads) {
        const n = heads.length;
        const cols = heads.map(() => 'more');
        let title = heads.findIndex(h => /^(الاسم|اسم|المنتج|العميل|المورد|المندوب|البيان|البند|الصنف)/.test(h));
        if (title < 0) title = heads.findIndex(h => !isAct(h) && !/باركود|^رقم|^#|التاريخ/.test(h));
        if (title < 0) title = 0;
        heads.forEach((h, i) => { if (isAct(h)) cols[i] = 'act'; });
        cols[title] = 'title';
        let keys = 0;
        heads.forEach((h, i) => {
            if (cols[i] !== 'more') return;
            if (keys < 2 && /سعر البيع|^السعر|المخزون|الرصيد|المتبقي|الإجمالي|إجمالي|المبلغ|القيمة|الصافي|العمولة|الكمية|الديون|المديونية/.test(h)) { cols[i] = 'key'; keys++; }
        });
        heads.forEach((h, i) => { if (cols[i] === 'more' && /التاريخ|^رقم|الباركود/.test(h)) cols[i] = 'sub'; });
        return cols;
    }
    function setup(t) {
        if (t.classList.contains('no-stack')) return;
        const heads = [...t.querySelectorAll('thead th')].map(h => h.textContent.trim());
        if (!heads.length) return;
        t.classList.add('az-stack');
        const rows = [...t.querySelectorAll('tbody tr')];
        const compact = heads.length >= 5 && !t.querySelector('tbody input, tbody select, tbody textarea');
        const cols = compact ? classify(heads) : null;
        t.classList.toggle('az-compact', !!compact);
        rows.forEach(tr => {
            const tds = [...tr.children];
            const full = tds.every(td => td.tagName === 'TD' && !td.hasAttribute('colspan'));
            tds.forEach((td, i) => {
                if (td.tagName !== 'TD' || td.hasAttribute('colspan')) return;
                const l = heads[i] || '';
                if (td.getAttribute('data-label') !== l) td.setAttribute('data-label', l);
                if (cols && full) {
                    const c = 'az-' + (cols[i] || 'more');
                    if (!td.classList.contains(c)) { td.classList.remove('az-title', 'az-key', 'az-sub', 'az-act', 'az-more'); td.classList.add(c); }
                }
            });
            if (cols && full && !tr.classList.contains('az-row')) tr.classList.add('az-row');
        });
        if (t.id !== 'products-table') paging(t, rows);
    }
    function paging(t, rows) {
        const st = t._az || (t._az = { q: '', limit: PAGE });
        if (t.closest('.card') && t.closest('.card').querySelector('.load-more-container, .search-input')) { remove(t); return; }
        const real = rows.filter(tr => !tr.querySelector('td[colspan]'));
        if (real.length <= PAGE && !st.q) { rows.forEach(tr => tr.classList.remove('az-hide')); remove(t); return; }
        ensureControls(t);
        const q = st.q.trim().toLowerCase();
        let shown = 0, matches = 0;
        real.forEach(tr => {
            if (tr._t === undefined) tr._t = tr.textContent.toLowerCase();
            const ok = !q || tr._t.includes(q);
            if (ok) matches++;
            const vis = ok && shown < st.limit;
            if (vis) shown++;
            tr.classList.toggle('az-hide', !vis);
        });
        const more = t._azMore;
        if (more) { more.style.display = matches > shown ? '' : 'none'; more.textContent = 'عرض المزيد (' + (matches - shown) + ')'; }
        if (t._azCount) t._azCount.textContent = matches + ' من ' + real.length;
    }
    function remove(t) { if (t._azBox) { t._azBox.remove(); t._azBox = null; } if (t._azMore) { t._azMore.remove(); t._azMore = null; } }
    function ensureControls(t) {
        if (t._azBox && t._azBox.isConnected) return;
        const host = t.closest('.table-responsive') || t;
        const box = document.createElement('div');
        box.className = 'az-tools';
        box.innerHTML = '<input type="search" class="az-tfilter" placeholder="ابحث في القائمة..."><span class="az-count"></span>';
        host.parentNode.insertBefore(box, host);
        const inp = box.querySelector('input');
        inp.addEventListener('input', () => { t._az.q = inp.value; t._az.limit = PAGE; paging(t, [...t.querySelectorAll('tbody tr')]); });
        t._azBox = box; t._azCount = box.querySelector('.az-count');
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'btn btn-new az-more-btn';
        btn.addEventListener('click', () => { t._az.limit += PAGE; paging(t, [...t.querySelectorAll('tbody tr')]); });
        host.parentNode.insertBefore(btn, host.nextSibling);
        t._azMore = btn;
    }
    function label(root) {
        (root || document).querySelectorAll('table').forEach(t => {
            setup(t);
        });
    }
    document.addEventListener('click', (e) => {
        const tr = e.target.closest && e.target.closest('tr.az-row');
        if (!tr || e.target.closest('button, a, input, select, textarea, label')) return;
        if (tr.querySelector('.az-more')) tr.classList.toggle('open');
    });
    let timer = null;
    const obs = new MutationObserver((muts) => {
        if (muts.every(m => (m.target.closest && m.target.closest('.az-tools')) )) return;
        clearTimeout(timer); timer = setTimeout(() => label(), 60);
    });
    const start = () => { label(); obs.observe(document.body, { childList: true, subtree: true }); };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

// Mobile bottom navigation (sell / customers / invoices / more)
(function azBottomNav() {
    function build() {
        if (document.getElementById('bottom-nav')) return;
        const nav = document.createElement('nav');
        nav.id = 'bottom-nav'; nav.className = 'bottom-nav';
        nav.innerHTML = [
            ['pos', 'fa-cash-register', 'بيع', 'bn-all'],
            ['products', 'fa-boxes-stacked', 'المنتجات', 'bn-owner'],
            ['customers', 'fa-users', 'العملاء', 'bn-all'],
            ['my-invoices', 'fa-receipt', 'فواتيري', 'bn-seller'],
            ['reports', 'fa-file-contract', 'التقارير', 'bn-owner'],
            ['__more', 'fa-bars', 'المزيد', 'bn-all']
        ].map(([go, ic, t, cls]) => `<button type="button" class="${cls}" data-go="${go}"><i class="fas ${ic}"></i><span>${t}</span></button>`).join('');
        document.body.appendChild(nav);
        nav.addEventListener('click', (e) => {
            const b = e.target.closest('button'); if (!b) return;
            e.stopPropagation();
            const go = b.getAttribute('data-go');
            if (go === '__more') { document.body.classList.toggle('sidebar-open'); return; }
            document.body.classList.remove('sidebar-open');
            const item = document.querySelector('.nav-item[data-page="' + go + '"]');
            if (item) item.click();
        });
        const sync = () => {
            const a = document.querySelector('.nav-item.active');
            const page = a ? a.getAttribute('data-page') : '';
            nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.getAttribute('data-go') === page));
        };
        const side = document.querySelector('.sidebar-nav');
        if (side) new MutationObserver(sync).observe(side, { attributes: true, subtree: true, attributeFilter: ['class'] });
        sync();
    }
    if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();


// ================= Phone quick-sale screen (tiles, one screen, two big pay buttons) =================
function qsFreq() { try { return JSON.parse(localStorage.getItem('az_freq') || '{}'); } catch (e) { return {}; } }
function qsRecentCustomers() { try { return JSON.parse(localStorage.getItem('az_recent_customers') || '[]'); } catch (e) { return []; } }
function qsNum(n) { n = Number(n) || 0; return Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2); }

function azQuickPOS() {
    const wrap = document.getElementById('pos-wrapper');
    if (!wrap) return;
    wrap.classList.add('qs-on');
    const box = document.createElement('div');
    box.id = 'qs'; box.className = 'qs';
    box.innerHTML = `
        <div class="qs-cust-row" id="qs-cust-row"></div>
        <div id="qs-cart" class="qs-cart"></div>
        <div class="qs-find"><input id="qs-search" type="search" inputmode="search" autocomplete="off" placeholder="دوّر على منتج أو اسكان باركود..."></div>
        <div id="qs-grid" class="qs-grid"></div>
        <div class="qs-bar">
            <div class="qs-total"><small>الإجمالي</small><b id="qs-total">0</b></div>
            <button type="button" class="qs-btn qs-cash" onclick="qsPay('cash')"><i class="fas fa-money-bill-wave"></i> كاش</button>
            <button type="button" class="qs-btn qs-credit" onclick="qsPay('credit')"><i class="fas fa-clock"></i> آجل</button>
        </div>
        <div id="qs-sheet" class="qs-sheet" style="display:none"></div>`;
    wrap.prepend(box);
    const inp = box.querySelector('#qs-search');
    inp.addEventListener('input', () => qsGrid());
    inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const q = inp.value.trim();
        const p = state.cache.products.find(x => x.barcode && String(x.barcode) === q);
        if (p) { addToCart(p); inp.value = ''; qsGrid(); }
    });
    qsCustomers(); qsGrid(); qsRender();
}

function qsCustomers() {
    const row = document.getElementById('qs-cust-row');
    if (!row) return;
    const byId = new Map(state.cache.customers.map(c => [String(c.id), c]));
    const recents = qsRecentCustomers().map(id => byId.get(String(id))).filter(Boolean).slice(0, 3);
    const sel = selectedCustomer ? String(selectedCustomer.id) : null;
    const typed = !selectedCustomer && (document.getElementById('pos-customer-name') || {}).value;
    let html = `<button type="button" class="qs-chip ${!sel && !typed ? 'on' : ''}" onclick="qsPickCash()"><i class="fas fa-money-bill"></i> نقدي</button>`;
    const list = recents.slice();
    if (selectedCustomer && !list.find(c => String(c.id) === sel)) list.unshift(selectedCustomer);
    list.slice(0, 3).forEach(c => {
        html += `<button type="button" class="qs-chip ${String(c.id) === sel ? 'on' : ''}" onclick="qsPickCustomer('${String(c.id).replace(/'/g, '')}')">${esc(c.name)}</button>`;
    });
    if (typed) html += `<button type="button" class="qs-chip on">${esc(typed)}</button>`;
    html += `<button type="button" class="qs-chip qs-chip-more" onclick="qsCustomerSheet()"><i class="fas fa-user-plus"></i> عميل آخر</button>`;
    row.innerHTML = html;
}

function qsPickCash() {
    selectedCustomer = null;
    ['pos-customer-name', 'pos-customer-phone', 'pos-customer-address'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    const br = document.getElementById('pos-prev-balance-row'); if (br) br.style.display = 'none';
    const be = document.getElementById('pos-prev-balance'); if (be) be.innerText = '0.00';
    calculateTotals(); qsCustomers(); qsCloseSheet();
}
function qsPickCustomer(id, then) {
    const c = state.cache.customers.find(x => String(x.id) === String(id));
    if (!c) return;
    selectResult('customer', c);
    try {
        const r = qsRecentCustomers().filter(x => String(x) !== String(c.id)); r.unshift(c.id);
        localStorage.setItem('az_recent_customers', JSON.stringify(r.slice(0, 8)));
    } catch (e) {}
    qsCustomers(); qsCloseSheet();
    if (then) qsPay(then);
}
function qsCloseSheet() { const sh = document.getElementById('qs-sheet'); if (sh) { sh.style.display = 'none'; sh.innerHTML = ''; } }
function qsOpenSheet(html) {
    const sh = document.getElementById('qs-sheet');
    sh.innerHTML = '<div class="qs-backdrop" onclick="qsCloseSheet()"></div><div class="qs-panel">' + html + '</div>';
    sh.style.display = 'block';
}

function qsCustomerSheet(then) {
    qsOpenSheet(`
        <h3>اختار العميل</h3>
        <input id="qs-cs-input" type="search" class="qs-big-input" placeholder="اكتب اسم العميل أو رقمه..." autocomplete="off">
        <div id="qs-cs-list" class="qs-cs-list"></div>`);
    const inp = document.getElementById('qs-cs-input');
    const draw = () => {
        const q = inp.value.trim().toLowerCase();
        const all = state.cache.customers;
        let list;
        if (q) list = all.filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone && String(c.phone).includes(q))).slice(0, 15);
        else {
            const byId = new Map(all.map(c => [String(c.id), c]));
            list = qsRecentCustomers().map(id => byId.get(String(id))).filter(Boolean);
            all.forEach(c => { if (list.length < 10 && !list.includes(c)) list.push(c); });
        }
        let html = list.map(c => `<button type="button" class="qs-row" onclick="qsPickCustomer('${String(c.id).replace(/'/g, '')}', ${then ? `'${then}'` : 'null'})"><span>${esc(c.name)}</span><small class="${c.balance > 0 ? 'debt' : ''}">${c.balance > 0 ? 'عليه ' + qsNum(c.balance) : esc(c.phone || '')}</small></button>`).join('');
        if (q && !all.find(c => (c.name || '').toLowerCase() === q)) html += `<button type="button" class="qs-row qs-new" data-name="${esc(inp.value.trim())}" onclick="qsNewCustomer(this.dataset.name, ${then ? `'${then}'` : 'null'})"><span>+ عميل جديد: ${esc(inp.value.trim())}</span></button>`;
        document.getElementById('qs-cs-list').innerHTML = html;
    };
    inp.addEventListener('input', draw); draw();
    setTimeout(() => inp.focus(), 50);
}
function qsNewCustomer(name, then) {
    selectedCustomer = null;
    document.getElementById('pos-customer-name').value = name;
    document.getElementById('pos-customer-phone').value = '';
    document.getElementById('pos-customer-address').value = '';
    const br = document.getElementById('pos-prev-balance-row'); if (br) br.style.display = 'none';
    document.getElementById('pos-prev-balance').innerText = '0.00';
    calculateTotals(); qsCustomers(); qsCloseSheet();
    if (then) qsPay(then);
}

function qsGrid() {
    const grid = document.getElementById('qs-grid');
    if (!grid) return;
    const q = ((document.getElementById('qs-search') || {}).value || '').trim().toLowerCase();
    const fq = qsFreq();
    let list;
    if (q) {
        const a = [], b = [];
        for (const p of state.cache.products) {
            const n = (p.name || '').toLowerCase();
            if (n.startsWith(q)) a.push(p); else if (n.includes(q) || (p.barcode && String(p.barcode).includes(q))) b.push(p);
            if (a.length + b.length >= 30) break;
        }
        list = a.concat(b);
    } else {
        list = state.cache.products.slice().sort((x, y) => (fq[y.id] || 0) - (fq[x.id] || 0)).slice(0, 12);
    }
    grid.innerHTML = list.length ? list.map(p => {
        const inCart = cart.filter(i => String(i.id) === String(p.id)).reduce((s, i) => s + i.qty, 0);
        return `<button type="button" class="qs-tile ${p.stock <= 0 ? 'out' : ''}" onclick="qsAdd('${String(p.id).replace(/'/g, '')}')">${inCart ? `<span class="qs-badge">${inCart}</span>` : ''}<span class="qs-tn">${esc(p.name)}</span><span class="qs-tp">${qsNum(p.salePrice)} ج</span></button>`;
    }).join('') : '<div class="qs-empty">مفيش منتج بالاسم ده</div>';
}
function qsAdd(id) {
    const p = state.cache.products.find(x => String(x.id) === String(id));
    if (p) addToCart(p);
}

function qsRender() {
    const c = document.getElementById('qs-cart');
    if (!c) return;
    c.innerHTML = cart.length ? cart.map((it, i) => {
        const changed = it.originalPrice != null && Math.abs(it.actualPrice - it.originalPrice) > 0.004;
        return `<div class="qs-line" data-i="${i}">
            <div class="ql-name">${esc(it.name)}${it.selectedUnit === 'علبة' ? ' <small>(علبة)</small>' : ''}</div>
            <button type="button" class="ql-price ${changed ? 'changed' : ''}" onclick="qsEditPrice(${i})">${qsNum(it.actualPrice)} ج <i class="fas fa-pen"></i></button>
            <div class="ql-qty"><button type="button" onclick="qsStep(${i}, -1)">${it.qty <= 1 ? '<i class="fas fa-trash"></i>' : '&minus;'}</button><b>${it.qty}</b><button type="button" onclick="qsStep(${i}, 1)">+</button></div>
            <div class="ql-total">${qsNum(it.actualPrice * it.qty)}</div>
        </div>`;
    }).join('') : '<div class="qs-hint">اضغط على المنتج عشان يتضاف</div>';
    const t = cart.reduce((s, it) => s + it.actualPrice * it.qty, 0);
    const el = document.getElementById('qs-total'); if (el) el.textContent = qsNum(t);
    qsGrid();
    // swipe a line sideways to remove it
    c.querySelectorAll('.qs-line').forEach(line => {
        let x0 = null;
        line.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
        line.addEventListener('touchend', e => {
            if (x0 === null) return;
            const dx = e.changedTouches[0].clientX - x0; x0 = null;
            if (Math.abs(dx) > 90) removeFromCart(+line.dataset.i);
        });
    });
}
function qsStep(i, d) {
    if (!cart[i]) return;
    if (cart[i].qty + d < 1) { removeFromCart(i); return; }
    cart[i].qty += d; renderCart();
}
function qsEditPrice(i) {
    const it = cart[i]; if (!it) return;
    qsOpenSheet(`
        <h3>${esc(it.name)}</h3>
        <div class="qs-sub">السعر الأصلي: ${qsNum(it.originalPrice != null ? it.originalPrice : it.actualPrice)} ج</div>
        <input id="qs-price-input" type="number" inputmode="decimal" class="qs-big-input qs-num" value="${it.actualPrice}">
        <button type="button" class="qs-ok" onclick="qsSetPrice(${i})">تم</button>`);
    const inp = document.getElementById('qs-price-input');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') qsSetPrice(i); });
    setTimeout(() => { inp.focus(); inp.select(); }, 60);
}
function qsSetPrice(i) {
    const v = parseFloat(document.getElementById('qs-price-input').value);
    if (!isNaN(v) && v >= 0 && cart[i]) { cart[i].actualPrice = v; }
    qsCloseSheet(); renderCart();
}

function qsPay(mode) {
    if (!cart.length) return showToast('اختار منتج الأول', 'warning');
    const hasCust = !!selectedCustomer || !!document.getElementById('pos-customer-name').value.trim();
    if (mode === 'credit' && !hasCust) { qsCustomerSheet('credit'); return; }
    const sub = cart.reduce((s, it) => s + it.actualPrice * it.qty, 0);
    const prev = parseFloat(document.getElementById('pos-prev-balance').innerText) || 0;
    const name = (selectedCustomer && selectedCustomer.name) || document.getElementById('pos-customer-name').value.trim();
    qsOpenSheet(`
        <h3>${mode === 'cash' ? 'بيع كاش' : 'بيع آجل'}${name ? ' - ' + esc(name) : ''}</h3>
        <div class="qs-sum"><span>${cart.reduce((s, it) => s + it.qty, 0)} قطعة / ${cart.length} صنف</span><b>${qsNum(sub)} ج</b></div>
        ${mode === 'credit' && prev > 0 ? `<div class="qs-sub">حسابه السابق ${qsNum(prev)} ج، هيبقى ${qsNum(prev + sub)} ج</div>` : ''}
        ${mode === 'credit' ? `<div class="qs-part"><label>دفع جزء دلوقتي؟</label><input id="qs-part" type="number" inputmode="decimal" placeholder="0"></div>` : ''}
        <button type="button" class="qs-ok ${mode}" id="qs-confirm">${mode === 'cash' ? 'تأكيد وحفظ (كاش)' : 'تأكيد وحفظ (آجل)'}</button>
        <button type="button" class="qs-cancel" onclick="qsCloseSheet()">رجوع</button>`);
    document.getElementById('qs-confirm').onclick = async () => {
        let paid = mode === 'cash' ? sub : 0;
        const part = document.getElementById('qs-part');
        if (part && parseFloat(part.value) > 0) paid = Math.min(sub, parseFloat(part.value));
        document.getElementById('pos-paid-amount').value = paid.toFixed(2);
        calculateTotals();
        qsCloseSheet();
        await handleSaveInvoice(false);
    };
}

// Calm phone look: hide secondary export buttons; light by default, night button saved across reloads
(function azCalm() {
    if (!window.matchMedia || !window.matchMedia('(max-width: 768px)').matches) return;
    const saved = () => { try { return localStorage.getItem('az_theme') === 'light' ? 'light' : 'dark'; } catch (e) { return 'light'; } };
    function apply(th) {
        const b = document.body; if (!b) return;
        b.classList.remove('dark-mode', 'light-mode'); b.classList.add(th + '-mode');
        try { state.theme = th; } catch (e) {}
        const btn = document.getElementById('az-night');
        if (btn) btn.innerHTML = th === 'dark' ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        const t = document.getElementById('theme-toggle');
        if (t) { const i = t.querySelector('i'), sp = t.querySelector('span'); if (i) i.className = th === 'dark' ? 'fas fa-sun' : 'fas fa-moon'; if (sp) sp.innerText = th === 'dark' ? 'الوضع المضيء' : 'الوضع الليلي'; }
    }
    function toggle(e) {
        if (e) { e.preventDefault(); e.stopImmediatePropagation(); }
        const th = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
        try { localStorage.setItem('az_theme', th); } catch (x) {}
        apply(th);
    }
    function build() {
        const bar = document.querySelector('.top-bar'); if (!bar || document.getElementById('az-night')) return;
        const b = document.createElement('button'); b.id = 'az-night'; b.type = 'button'; b.setAttribute('aria-label', 'الوضع الليلي');
        b.addEventListener('click', toggle); bar.insertBefore(b, bar.firstChild);
        apply(saved());
    }
    function mark() {
        build();
        document.querySelectorAll('.page-header button, .page-header .btn, .table-actions button').forEach(b => {
            if (/تصدير|استيراد|Excel|إكسل/.test(b.textContent) && !b.classList.contains('az-secondary')) b.classList.add('az-secondary');
        });
    }
    document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('#theme-toggle'); if (t) toggle(e); }, true);
    apply(saved());
    let tm = null;
    new MutationObserver(() => { clearTimeout(tm); tm = setTimeout(mark, 80); }).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => { mark(); apply(saved()); });
})();
