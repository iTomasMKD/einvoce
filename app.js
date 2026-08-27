// ==========================================
// 1. SUPABASE CONFIGURATION
// ==========================================
const SUPABASE_URL = 'https://mdrmbxicdycdjvdebsfd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DBLK0lPDvsKa39_yrUAb6w_lRZm4RCg';

// Користиме supabaseClient за да избегнеме конфликт со CDN глобалната променлива window.supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Hardcoded Login Credentials
const HARDCODED_EMAIL = "admin@example.com";
const HARDCODED_PASS = "admin123";

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
            handleLocalLogin();
        });
    }

    // Attach logout listener
    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            localStorage.removeItem('isLoggedIn');
            checkAuthStatus();
        });
    }

    // Почетна празна ставка за новата фактура
    addItem();

    // Провери статусот за најава
    checkAuthStatus();
});

function handleLocalLogin() {
    const emailInput = document.getElementById('authEmail').value;
    const passwordInput = document.getElementById('authPassword').value;

    if (emailInput === HARDCODED_EMAIL && passwordInput === HARDCODED_PASS) {
        hideAlert('authAlert');
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('userEmail', emailInput);
        checkAuthStatus();
    } else {
        showAlert('authAlert', 'Погрешен е-маил или лозинка! Внесете admin@example.com / admin123');
    }
}

function checkAuthStatus() {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const authContainer = document.getElementById('authContainer');
    const appContainer = document.getElementById('appContainer');

    if (isLoggedIn) {
        if (authContainer) authContainer.classList.add('hidden');
        if (appContainer) appContainer.classList.remove('hidden');
        const userEmailDisplay = document.getElementById('userEmailDisplay');
        if (userEmailDisplay) {
            userEmailDisplay.textContent = localStorage.getItem('userEmail') || HARDCODED_EMAIL;
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
// 4. SUPABASE CRUD OPERATIONS
// ==========================================

// SAVE / UPDATE INVOICE
async function saveInvoice() {
    const clientName = document.getElementById('clientName').value;
    if (!clientName) {
        showAlert('appAlert', 'Ве молиме внесете име на клиент!');
        return;
    }

    // Усогласени полиња со Supabase DB
// Во saveInvoice() функцијата:
const invoicePayload = {
    invoice_number: document.getElementById('invNum').value,
    invoice_date: document.getElementById('invDate').value,
    issue_date: document.getElementById('invDate').value, // <-- Додадено за совпаѓање со базата
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
    items: invoiceItems
};

    let result;

    if (editingInvoiceId) {
        // UPDATE постоечка фактура
        result = await supabaseClient
            .from('invoices')
            .update(invoicePayload)
            .eq('id', editingInvoiceId)
            .select();
    } else {
        // INSERT нова фактура
        result = await supabaseClient
            .from('invoices')
            .insert([invoicePayload])
            .select();
    }

    const { data, error } = result;

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

// LOAD INVOICES FROM SUPABASE
async function loadInvoicesFromSupabase() {
    const tbody = document.getElementById('invoicesListBody');
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="7" class="text-center">Вчитување од Supabase...</td></tr>`;

    const { data, error } = await supabaseClient
        .from('invoices')
        .select('*')
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
// EDIT INVOICE (LOAD INTO FORM)
function editInvoice(id) {
    const inv = allInvoices.find(item => item.id === id);
    if (!inv) return;

    editingInvoiceId = inv.id;

    document.getElementById('invNum').value = inv.invoice_number || inv.number || '';
    
    // Поддршка и за issue_date и за invoice_date
    document.getElementById('invDate').value = inv.issue_date || inv.invoice_date || inv.date || '';
    
    document.getElementById('issuerName').value = inv.issuer_name || '';
    document.getElementById('issuerEdb').value = inv.issuer_edb || '';
    document.getElementById('issuerEmbs').value = inv.issuer_embs || '';
    document.getElementById('issuerAddress').value = inv.issuer_address || '';
    document.getElementById('issuerBank').value = inv.issuer_bank || '';
    document.getElementById('clientName').value = inv.client_name || '';
    document.getElementById('clientEdb').value = inv.client_edb || '';
    document.getElementById('clientAddress').value = inv.client_address || '';

    invoiceItems = Array.isArray(inv.items) && inv.items.length > 0 ? inv.items : [];
    if (invoiceItems.length === 0) addItem();

    renderItems();

    document.getElementById('viewTitle').textContent = 'Измена на Фактура: ' + (inv.invoice_number || inv.number || '');
    switchView('create');
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

// RENDER TABLE WITH EDIT & DELETE BUTTONS
function renderInvoicesTable(list) {
    const tbody = document.getElementById('invoicesListBody');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center">Нема пронајдено фактури.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    list.forEach(inv => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${inv.invoice_number || '-'}</strong></td>
            <td>${inv.invoice_date || '-'}</td>
            <td>${inv.client_name || '-'}</td>
            <td>${inv.client_edb || '-'}</td>
            <td style="text-align:right;"><strong>${inv.grand_total ? Number(inv.grand_total).toFixed(2) : '0.00'}</strong> MKD</td>
            <td style="text-align:center;"><span style="color:var(--success); font-size:12px;">Зачувана</span></td>
            <td style="text-align:center;">
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

    const invNumInput = document.getElementById('invNum');
    if (invNumInput) invNumInput.value = 'ФАК-2026/' + String(allInvoices.length + 1).padStart(3, '0');

    const invDateInput = document.getElementById('invDate');
    if (invDateInput) invDateInput.valueAsDate = new Date();

    const viewTitle = document.getElementById('viewTitle');
    if (viewTitle) viewTitle.textContent = 'Креирање на Е-Фактура';

    invoiceItems = [];
    addItem();
}

// NAVIGATION
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
}

// HELPERS
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