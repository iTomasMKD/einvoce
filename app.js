// ==========================================
// 1. SUPABASE CONFIGURATION
// ==========================================
const SUPABASE_URL = 'https://mdrmbxicdycdjvdebsfd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DBLK0lPDvsKa39_yrUAb6w_lRZm4RCg';

// Користиме supabaseClient за да избегнеме конфликт со CDN глобалната променлива window.supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let invoiceItems = [];
let allInvoices = []; // Локален кеш за пребарување
let editingInvoiceId = null; // null = нова фактура, UUID = измена на постоечка

// ==========================================
// 2. INITIALIZATION & AUTH LOGIC
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Постави денешен датум
    const invDateInput = document.getElementById('invDate');
    if (invDateInput) invDateInput.valueAsDate = new Date();

    // Attach submit listener to login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleSupabaseLogin();
        });
    }

    // Attach logout listener
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            handleSupabaseLogout();
        });
    }

    // Почетна празна ставка за новата фактура
    addItem();

    // Провери статусот за најава преку Supabase сесијата
    checkAuthStatus();
});

// ВИСТИНСКА НАЈАВА ПРЕКУ SUPABASE AUTH
async function handleSupabaseLogin() {
    const emailInput = document.getElementById('authEmail').value;
    const passwordInput = document.getElementById('authPassword').value;

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: emailInput,
        password: passwordInput,
    });

    if (error) {
        showAlert('authAlert', 'Грешка при најава: ' + error.message);
    } else {
        hideAlert('authAlert');
        checkAuthStatus();
    }
}

// ВИСТИНСКА ОДЈАВА ПРЕКУ SUPABASE AUTH
async function handleSupabaseLogout() {
    await supabaseClient.auth.signOut();
    checkAuthStatus();
}

// ПРОВЕРА НА СТАТУС НА НАЈАВА
async function checkAuthStatus() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const authContainer = document.getElementById('authContainer');
    const appContainer = document.getElementById('appContainer');

    if (session) {
        if (authContainer) authContainer.classList.add('hidden');
        if (appContainer) appContainer.classList.remove('hidden');
        
        const userEmailDisplay = document.getElementById('userEmailDisplay');
        if (userEmailDisplay) {
            userEmailDisplay.textContent = session.user.email;
        }
        loadInvoicesFromSupabase();
    } else {
        if (authContainer) authContainer.classList.remove('hidden');
        if (appContainer) appContainer.classList.add('hidden');
    }
}

// ==========================================
// 3. INVOICE CALCULATIONS & UI
// ==========================================
function addItem() {
    const itemId = Date.now();
    invoiceItems.push({ id: itemId, description: '', unit: 'пар', quantity: 1, price: 0, vatRate: 18 });
    renderItems();
}

function removeItem(id) {
    invoiceItems = invoiceItems.filter(item => item.id !== id);
    renderItems();
}

function updateItem(id, field, value) {
    const item = invoiceItems.find(i => i.id === id);
    if (item) {
        item[field] = (field === 'quantity' || field === 'price' || field === 'vatRate') ? parseFloat(value) || 0 : value;
    }
    calculateTotals();
}

function renderItems() {
    const tbody = document.getElementById('itemsBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    invoiceItems.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><input type="text" value="${item.description}" oninput="updateItem(${item.id}, 'description', this.value)" placeholder="Опис на услуга/производ"></td>
            <td><input type="text" value="${item.unit}" oninput="updateItem(${item.id}, 'unit', this.value)"></td>
            <td><input type="number" value="${item.quantity}" min="1" oninput="updateItem(${item.id}, 'quantity', this.value)"></td>
            <td><input type="number" value="${item.price}" step="0.01" oninput="updateItem(${item.id}, 'price', this.value)"></td>
            <td>
                <select onchange="updateItem(${item.id}, 'vatRate', this.value)">
                    <option value="18" ${item.vatRate === 18 ? 'selected' : ''}>18%</option>
                    <option value="5" ${item.vatRate === 5 ? 'selected' : ''}>5%</option>
                    <option value="0" ${item.vatRate === 0 ? 'selected' : ''}>0%</option>
                </select>
            </td>
            <td id="total-${item.id}">0.00</td>
            <td class="no-print"><button type="button" onclick="removeItem(${item.id})" style="background:none; border:none; color:var(--danger); cursor:pointer;"><i class="fa-solid fa-trash"></i></button></td>
        `;
        tbody.appendChild(row);
    });

    calculateTotals();
}

function calculateTotals() {
    let subtotal = 0;
    let vatTotal = 0;

    invoiceItems.forEach(item => {
        const lineSubtotal = item.quantity * item.price;
        const lineVat = lineSubtotal * (item.vatRate / 100);
        const lineTotal = lineSubtotal + lineVat;

        subtotal += lineSubtotal;
        vatTotal += lineVat;

        const cell = document.getElementById(`total-${item.id}`);
        if (cell) cell.textContent = lineTotal.toFixed(2);
    });

    const grandTotal = subtotal + vatTotal;

    const subTotalEl = document.getElementById('subTotal');
    const vatTotalEl = document.getElementById('vatTotal');
    const grandTotalEl = document.getElementById('grandTotal');

    if (subTotalEl) subTotalEl.textContent = subtotal.toFixed(2);
    if (vatTotalEl) vatTotalEl.textContent = vatTotal.toFixed(2);
    if (grandTotalEl) grandTotalEl.textContent = grandTotal.toFixed(2);

    const dashSubtotal = document.getElementById('dashSubtotal');
    const dashVat = document.getElementById('dashVat');
    const dashGrand = document.getElementById('dashGrand');

    if (dashSubtotal) dashSubtotal.textContent = subtotal.toFixed(2);
    if (dashVat) dashVat.textContent = vatTotal.toFixed(2);
    if (dashGrand) dashGrand.textContent = grandTotal.toFixed(2);
}

// ==========================================
// 4. SUPABASE CRUD OPERATIONS (MULTITENANT)
// ==========================================

// SAVE / UPDATE INVOICE
async function saveInvoice() {
    const clientName = document.getElementById('clientName').value;
    if (!clientName) {
        showAlert('appAlert', 'Ве молиме внесете име на клиент!');
        return;
    }

    // Земи го корисникот од активната Supabase сесија
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        alert('Сесијата е истечена. Ве молиме најавете се повторно.');
        checkAuthStatus();
        return;
    }

    // Земи го статусот на плаќање од формата (ако елементот постои)
    const paymentStatusEl = document.getElementById('paymentStatus');
    const paymentStatus = paymentStatusEl ? paymentStatusEl.value : 'Неплатена';

    const invoicePayload = {
        user_id: session.user.id, // Поврзување со конкретниот најавен корисник во базата
        invoice_number: document.getElementById('invNum').value,
        invoice_date: document.getElementById('invDate').value,
        issue_date: document.getElementById('invDate').value,
        issuer_name: document.getElementById('issuerName').value,
        issuer_edb: document.getElementById('issuerEdb').value,
        issuer_embs: document.getElementById('issuerEmbs').value,
        issuer_address: document.getElementById('issuerAddress').value,
        issuer_bank: document.getElementById('issuerBank').value,
        client_name: clientName,
        client_edb: document.getElementById('clientEdb').value,
        client_address: document.getElementById('clientAddress').value,
        subtotal: parseFloat(document.getElementById('subTotal').textContent) || 0,
        vat_total: parseFloat(document.getElementById('vatTotal').textContent) || 0,
        grand_total: parseFloat(document.getElementById('grandTotal').textContent) || 0,
        payment_status: paymentStatus, // Зачувување на статусот
        items: invoiceItems
    };

    let result;

    if (editingInvoiceId) {
        result = await supabaseClient
            .from('invoices')
            .update(invoicePayload)
            .eq('id', editingInvoiceId)
            .select();
    } else {
        result = await supabaseClient
            .from('invoices')
            .insert([invoicePayload])
            .select();
    }

    const { error } = result;

    if (error) {
        console.error("Supabase Error:", error);
        showAlert('appAlert', 'Грешка при зачувување: ' + error.message);
    } else {
        const msg = editingInvoiceId ? 'Фактурата е успешно ажурирана!' : 'Фактурата е успешно запишана!';
        showAlert('appAlert', msg, true);
        resetInvoiceForm();
        loadInvoicesFromSupabase();
    }
}

// LOAD INVOICES FROM SUPABASE (Само фактурите на најавениот корисник)
async function loadInvoicesFromSupabase() {
    const tbody = document.getElementById('invoicesListBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="text-center">Вчитување од Supabase...</td></tr>`;

    // 1. Земи го најавениот корисник
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (!session) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Не сте најавени.</td></tr>`;
        return;
    }

    // 2. Побарај ги фактурите САМО за тој корисник (.eq('user_id', session.user.id))
    const { data, error } = await supabaseClient
        .from('invoices')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Supabase Select Error:", error);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--danger)">Грешка: ${error.message}</td></tr>`;
        return;
    }

    allInvoices = data || [];
    renderInvoicesTable(allInvoices);
}

// EDIT INVOICE (LOAD INTO FORM)
function editInvoice(id) {
    const inv = allInvoices.find(item => item.id === id);
    if (!inv) return;

    editingInvoiceId = inv.id;

    document.getElementById('invNum').value = inv.invoice_number || inv.number || '';
    document.getElementById('invDate').value = inv.issue_date || inv.invoice_date || inv.date || '';
    
    document.getElementById('issuerName').value = inv.issuer_name || '';
    document.getElementById('issuerEdb').value = inv.issuer_edb || '';
    document.getElementById('issuerEmbs').value = inv.issuer_embs || '';
    document.getElementById('issuerAddress').value = inv.issuer_address || '';
    document.getElementById('issuerBank').value = inv.issuer_bank || '';
    document.getElementById('clientName').value = inv.client_name || '';
    document.getElementById('clientEdb').value = inv.client_edb || '';
    document.getElementById('clientAddress').value = inv.client_address || '';

    // Постави го статусот на плаќање во формата доколку постои селектор
    const paymentStatusEl = document.getElementById('paymentStatus');
    if (paymentStatusEl && inv.payment_status) {
        paymentStatusEl.value = inv.payment_status;
    }

    invoiceItems = Array.isArray(inv.items) && inv.items.length > 0 ? inv.items : [];
    if (invoiceItems.length === 0) addItem();

    renderItems();

    document.getElementById('viewTitle').textContent = 'Измена на Фактура: ' + (inv.invoice_number || inv.number || '');
    switchView('create');
}

// DIRECT UPDATE PAYMENT STATUS FROM TABLE
async function updateInvoiceStatus(id, newStatus) {
    const { error } = await supabaseClient
        .from('invoices')
        .update({ payment_status: newStatus })
        .eq('id', id);

    if (error) {
        console.error("Status Update Error:", error);
        alert('Грешка при ажурирање на статусот: ' + error.message);
    } else {
        // Ажурирај локално во кешот за да нема потреба од повторно превземање од база
        const inv = allInvoices.find(item => item.id === id);
        if (inv) inv.payment_status = newStatus;
    }
}

// DELETE INVOICE
async function deleteInvoice(id) {
    if (!confirm('Дали сте сигурни дека сакате да ја избришете оваа фактура?')) {
        return;
    }

    const { error } = await supabaseClient
        .from('invoices')
        .delete()
        .eq('id', id);

    if (error) {
        console.error("Delete Error:", error);
        alert('Грешка при бришење: ' + error.message);
    } else {
        allInvoices = allInvoices.filter(inv => inv.id !== id);
        renderInvoicesTable(allInvoices);
        showAlert('appAlert', 'Фактурата е успешно избришана!', true);
    }
}

// RENDER TABLE WITH STATUS SELECT, EDIT & DELETE BUTTONS
// RENDER TABLE WITH SUMMARY CALCULATION
function renderInvoicesTable(list) {
    const tbody = document.getElementById('invoicesListBody');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">Нема пронајдено фактури.</td></tr>`;
        updateSummary([]); // Ресетирај суми на 0
        return;
    }

    tbody.innerHTML = '';
    list.forEach(inv => {
        const currentStatus = inv.payment_status || 'Неплатена';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${inv.invoice_number || '-'}</strong></td>
            <td>${inv.invoice_date || inv.issue_date || '-'}</td>
            <td>${inv.client_name || '-'}</td>
            <td>${inv.client_edb || '-'}</td>
            <td style="text-align:right;"><strong>${inv.grand_total ? Number(inv.grand_total).toFixed(2) : '0.00'}</strong> MKD</td>
            <td style="text-align:center;" class="no-print">
                <select onchange="updateInvoiceStatus('${inv.id}', this.value)" style="padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); font-size: 12px; font-weight: 600; background: white; cursor: pointer;">
                    <option value="Неплатена" ${currentStatus === 'Неплатена' ? 'selected' : ''}>❌ Неплатена</option>
                    <option value="Платена" ${currentStatus === 'Платена' ? 'selected' : ''}>✅ Платена</option>
                </select>
            </td>
            <td style="text-align:center; display: none;" class="print-only">${currentStatus}</td> <!-- При печатење покажува само текст -->
            <td style="text-align:center;" class="no-print">
                <div style="display:flex; gap:6px; justify-content:center;">
                    <button class="btn btn-secondary" onclick="editInvoice('${inv.id}')" title="Измени">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="btn btn-secondary" onclick="deleteInvoice('${inv.id}')" style="color:var(--danger);" title="Избриши">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Пресметај ги сумите за тековната (филтрирана) листа
    updateSummary(list);
}

// ФУНКЦИЈА ЗА ПРЕСМЕТКА НА СУМИ
function updateSummary(list) {
    let totalPaid = 0;
    let totalUnpaid = 0;

    list.forEach(inv => {
        const amount = Number(inv.grand_total) || 0;
        const status = inv.payment_status || 'Неплатена';

        if (status === 'Платена') {
            totalPaid += amount;
        } else {
            totalUnpaid += amount;
        }
    });

    const sumPaidEl = document.getElementById('sumPaid');
    const sumUnpaidEl = document.getElementById('sumUnpaid');

    if (sumPaidEl) sumPaidEl.textContent = totalPaid.toFixed(2) + ' MKD';
    if (sumUnpaidEl) sumUnpaidEl.textContent = totalUnpaid.toFixed(2) + ' MKD';
}

// ФУНКЦИЈА ЗА ПЕЧАТЕЊЕ И ЗАЧУВУВАЊЕ КАКО PDF
function printFilteredInvoices() {
    // Позиви ја стандардната функција за печатење на прелистувачот
    // Во print дијалогот корисникот може да одбере "Save as PDF"
    window.print();
}

// ФУНКЦИЈА ЗА ПРЕСМЕТКА НА СУМИ
// ФИЛТРИРАЊЕ НА ФАКТУРИ (ПО КЛИЕНТ ИЛИ БРОЈ)
function filterInvoices() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    
    // Филтрирај ја локалната листа според клиентот или бројот на фактурата
    const filtered = allInvoices.filter(inv => 
        (inv.invoice_number && inv.invoice_number.toLowerCase().includes(query)) ||
        (inv.client_name && inv.client_name.toLowerCase().includes(query))
    );
    
    // Прикажи ги филтрираните резултати во табелата и автоматски пресметај ги сумите долу
    renderInvoicesTable(filtered);
}

// ПРЕСМЕТКА НА ВКУПНИ СУМИ ЗА ПРИКАЖАНИТЕ (ФИЛТРИРАНИ) ФАКТУРИ
function updateSummary(list) {
    let totalPaid = 0;
    let totalUnpaid = 0;

    list.forEach(inv => {
        // Земи ја вкупната сума со ДДВ (grand_total)
        const amount = Number(inv.grand_total) || 0;
        const status = inv.payment_status || 'Неплатена';

        if (status === 'Платена') {
            totalPaid += amount;
        } else {
            totalUnpaid += amount;
        }
    });

    // Ажурирај ги вредностите во HTML елементите под табелата
    const sumPaidEl = document.getElementById('sumPaid');
    const sumUnpaidEl = document.getElementById('sumUnpaid');

    if (sumPaidEl) sumPaidEl.textContent = totalPaid.toFixed(2) + ' MKD';
    if (sumUnpaidEl) sumUnpaidEl.textContent = totalUnpaid.toFixed(2) + ' MKD';
}

// ФУНКЦИЈА ЗА ПЕЧАТЕЊЕ И ЗАЧУВУВАЊЕ КАКО PDF
function printFilteredInvoices() {
    // Позиви ја стандардната функција за печатење на прелистувачот
    // Во print дијалогот корисникот може да одбере "Save as PDF"
    window.print();
}

// FILTER INVOICES
function filterInvoices() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    const filtered = allInvoices.filter(inv => 
        (inv.invoice_number && inv.invoice_number.toLowerCase().includes(query)) ||
        (inv.client_name && inv.client_name.toLowerCase().includes(query))
    );
    renderInvoicesTable(filtered);
}

// RESET FORM FOR NEW INVOICE
function resetInvoiceForm() {
    editingInvoiceId = null;
    const clientNameInput = document.getElementById('clientName');
    const clientEdbInput = document.getElementById('clientEdb');
    const clientAddressInput = document.getElementById('clientAddress');

    if (clientNameInput) clientNameInput.value = '';
    if (clientEdbInput) clientEdbInput.value = '';
    if (clientAddressInput) clientAddressInput.value = '';

    const paymentStatusEl = document.getElementById('paymentStatus');
    if (paymentStatusEl) paymentStatusEl.value = 'Неплатена';

    const invNumInput = document.getElementById('invNum');
    if (invNumInput) invNumInput.value = 'ФАК-2026/' + String(allInvoices.length + 1).padStart(3, '0');

    const invDateInput = document.getElementById('invDate');
    if (invDateInput) invDateInput.valueAsDate = new Date();

    const viewTitle = document.getElementById('viewTitle');
    if (viewTitle) viewTitle.textContent = 'Креирање на Е-Фактура';

    invoiceItems = [];
    addItem();
}

// ==========================================
// 5. NAVIGATION & UI HELPERS
// ==========================================
function switchView(view) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    if (view === 'create') {
        const viewCreate = document.getElementById('viewCreate');
        const navCreate = document.getElementById('navCreate');
        if (viewCreate) viewCreate.classList.add('active');
        if (navCreate) navCreate.classList.add('active');
        const viewTitle = document.getElementById('viewTitle');
        if (viewTitle && !editingInvoiceId) viewTitle.textContent = 'Креирање на Е-Фактура';
    } else {
        const viewList = document.getElementById('viewList');
        const navList = document.getElementById('navList');
        if (viewList) viewList.classList.add('active');
        if (navList) navList.classList.add('active');
        const viewTitle = document.getElementById('viewTitle');
        if (viewTitle) viewTitle.textContent = 'Листа на сите фактури';
        loadInvoicesFromSupabase();
    }

    // Автоматски затвори го менито на мобилен при клик
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && window.innerWidth <= 768) {
        sidebar.classList.remove('mobile-open');
    }
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.classList.toggle('mobile-open');
    }
}

function showAlert(id, msg, isSuccess = false) {
    const box = document.getElementById(id);
    if (box) {
        box.textContent = msg;
        box.className = `alert ${isSuccess ? 'success' : ''}`;
        box.classList.remove('hidden');
    }
}

function hideAlert(id) {
    const box = document.getElementById(id);
    if (box) box.classList.add('hidden');
}