import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, getDocs, query, orderBy, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "AIzaSyDt4ifOCtdx1NuyrEgGSzg-ON3Cc3y4rkg",
    authDomain: "fiber-service-query.firebaseapp.com",
    projectId: "fiber-service-query",
    storageBucket: "fiber-service-query.firebasestorage.app",
    messagingSenderId: "394137990800",
    appId: "1:394137990800:web:12e6c410abbd99f403ca15",
    measurementId: "G-4Z1285PTRT"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'nptel-map-portal';

let currentUser = null;
let allOrders = [];
let currentStatusTab = 'Pending'; // Default tab
let searchQuery = '';

// Auth Init
const initAuth = async () => {
    // Check for custom token
    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
    }
    // FIXED: Removed forced anonymous sign-in to allow persisting session from Front Office
};

initAuth();

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        console.log("Session restored for:", user.email);
        loadOrders();
    } else {
        console.warn("No user session found.");
        loadOrders();
    }
});

document.getElementById('refresh-btn').addEventListener('click', loadOrders);
document.querySelectorAll('input[name="filter"]').forEach(r => {
    r.addEventListener('change', renderList);
});

// Setup UI Controls (Tabs + Search + Export)
function setupUI() {
    const listContainer = document.getElementById('orders-list');
    if (!listContainer) return;
    
    // Avoid duplicates
    if (document.getElementById('list-controls')) return;

    const controlsDiv = document.createElement('div');
    controlsDiv.id = 'list-controls';
    controlsDiv.style.marginBottom = '20px';
    controlsDiv.style.display = 'flex';
    controlsDiv.style.flexWrap = 'wrap';
    controlsDiv.style.gap = '15px';
    controlsDiv.style.justifyContent = 'space-between';
    controlsDiv.style.alignItems = 'center';
    controlsDiv.style.borderBottom = '1px solid #ccc';
    controlsDiv.style.paddingBottom = '15px';

    // 1. Tabs Container
    const tabsDiv = document.createElement('div');
    tabsDiv.id = 'status-tabs';
    tabsDiv.style.display = 'flex';
    tabsDiv.style.gap = '10px';

    const createTab = (name, statusValue, isActive) => {
        const btn = document.createElement('button');
        btn.textContent = name;
        btn.dataset.status = statusValue;
        btn.style.padding = '8px 20px';
        btn.style.border = 'none';
        btn.style.borderRadius = '20px';
        btn.style.cursor = 'pointer';
        btn.style.fontWeight = 'bold';
        btn.style.transition = 'all 0.2s';
        
        const setStyle = (active) => {
            if (active) {
                btn.style.background = '#0d6efd';
                btn.style.color = 'white';
                btn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
            } else {
                btn.style.background = '#f0f0f0';
                btn.style.color = '#555';
                btn.style.boxShadow = 'none';
            }
        };
        
        setStyle(isActive);

        btn.addEventListener('click', () => {
            currentStatusTab = statusValue;
            // Update UI
            tabsDiv.querySelectorAll('button').forEach(b => {
                b.style.background = '#f0f0f0';
                b.style.color = '#555';
                b.style.boxShadow = 'none';
            });
            setStyle(true);
            renderList();
        });
        
        return btn;
    };

    tabsDiv.appendChild(createTab('Pending / New', 'Pending', true));
    tabsDiv.appendChild(createTab('Processed', 'Processed', false));

    // 2. Search & Export Container
    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '10px';
    actionsDiv.style.alignItems = 'center';

    // Search Input
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search name, address, phone...';
    searchInput.style.padding = '8px 12px';
    searchInput.style.borderRadius = '4px';
    searchInput.style.border = '1px solid #ccc';
    searchInput.style.minWidth = '250px';
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderList();
    });

    // Export Button
    const exportBtn = document.createElement('button');
    exportBtn.innerHTML = '<i class="fa-solid fa-file-csv"></i> Export CSV';
    exportBtn.style.padding = '8px 15px';
    exportBtn.style.background = '#198754'; // Excel Green
    exportBtn.style.color = 'white';
    exportBtn.style.border = 'none';
    exportBtn.style.borderRadius = '4px';
    exportBtn.style.cursor = 'pointer';
    exportBtn.style.fontWeight = 'bold';
    exportBtn.addEventListener('click', exportToCSV);

    actionsDiv.appendChild(searchInput);
    actionsDiv.appendChild(exportBtn);

    controlsDiv.appendChild(tabsDiv);
    controlsDiv.appendChild(actionsDiv);

    listContainer.parentElement.insertBefore(controlsDiv, listContainer);
}

// Load Data
async function loadOrders() {
    setupUI(); // Init Tabs & Search

    const listDiv = document.getElementById('orders-list');
    const loadingDiv = document.getElementById('loading-msg');
    
    loadingDiv.style.display = 'block';
    listDiv.innerHTML = '';
    
    try {
        const q = collection(db, 'artifacts', appId, 'public', 'data', 'office_signups');
        const snap = await getDocs(q);
        
        allOrders = [];
        snap.forEach(doc => {
            allOrders.push({ id: doc.id, ...doc.data() });
        });

        // Sort by date descending
        allOrders.sort((a, b) => {
            const da = a.createdAt ? a.createdAt.seconds : 0;
            const db = b.createdAt ? b.createdAt.seconds : 0;
            return db - da; 
        });

        renderList();
    } catch (e) {
        console.error(e);
        listDiv.innerHTML = '<div style="color:red; padding:20px;">Error loading orders. Ensure you are logged in.</div>';
    } finally {
        loadingDiv.style.display = 'none';
    }
}

function renderList() {
    const filterEl = document.querySelector('input[name="filter"]:checked');
    const ownerFilter = filterEl ? filterEl.value : 'all';
    const listDiv = document.getElementById('orders-list');
    listDiv.innerHTML = '';

    const filtered = allOrders.filter(o => {
        // 1. Filter by Ownership
        if (ownerFilter === 'mine' && currentUser) {
            if (o.createdById !== currentUser.uid) return false;
        }

        // 2. Filter by Status (Tab)
        if (currentStatusTab === 'Processed') {
            if (o.status !== 'Processed') return false;
        } else {
            if (o.status === 'Processed') return false;
        }

        // 3. Search Filter
        if (searchQuery) {
            const searchStr = `${o.customer.name} ${o.customer.address} ${o.customer.mobile} ${o.customer.email}`.toLowerCase();
            if (!searchStr.includes(searchQuery)) return false;
        }

        return true;
    });

    if (filtered.length === 0) {
        listDiv.innerHTML = `<div style="padding:20px; color:#666;">No orders found matching criteria.</div>`;
        return;
    }

    filtered.forEach(order => {
        const dateStr = order.createdAt ? new Date(order.createdAt.seconds * 1000).toLocaleDateString() : 'N/A';
        const card = document.createElement('div');
        card.className = `order-card status-${order.status}`;
        card.innerHTML = `
            <div class="order-main">
                <div class="order-name">${order.customer.name}</div>
                <div class="order-addr">${order.customer.address}</div>
                <div class="order-meta">
                    <i class="fa-regular fa-calendar"></i> ${dateStr} &bull; 
                    <i class="fa-solid fa-user-pen"></i> ${order.createdBy || 'Unknown'}
                </div>
            </div>
            <div style="text-align:right;">
                <div class="order-price">${order.plan.price}</div>
                <div style="font-size:0.8rem;">${order.plan.originalPlanName || order.plan.selectedTier}</div>
            </div>
        `;
        card.addEventListener('click', () => openDetail(order));
        listDiv.appendChild(card);
    });

    // Store current filtered list for export
    window.currentFilteredOrders = filtered;
}

// CSV Export Function
function exportToCSV() {
    if (!window.currentFilteredOrders || window.currentFilteredOrders.length === 0) {
        alert("No data to export.");
        return;
    }

    const orders = window.currentFilteredOrders;
    // Define Headers
    const headers = ["Order ID", "Date", "Status", "Customer Name", "Address", "Mobile", "Email", "Plan", "Price", "Speed", "Created By", "Internal Notes"];
    
    // Map Data
    const rows = orders.map(o => {
        const dateStr = o.createdAt ? new Date(o.createdAt.seconds * 1000).toLocaleDateString() : '';
        // Escape commas for CSV
        const safe = (str) => `"${(str || '').toString().replace(/"/g, '""')}"`;
        
        return [
            safe(o.id),
            safe(dateStr),
            safe(o.status),
            safe(o.customer.name),
            safe(o.customer.address),
            safe(o.customer.mobile),
            safe(o.customer.email),
            safe(o.plan.selectedTier),
            safe(o.plan.price),
            safe(o.plan.speed),
            safe(o.createdBy),
            safe(o.internalNotes) // New Field
        ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `ServiceOrders_${currentStatusTab}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Global functions for modal
window.closeModal = () => {
    document.getElementById('detail-modal').style.display = 'none';
};

window.copyToClip = (elementId) => {
    const el = document.getElementById(elementId);
    if(el) {
        el.select();
        el.setSelectionRange(0, 99999); // Mobile
        document.execCommand('copy');
        
        // Visual feedback
        const btn = el.nextElementSibling;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check" style="color:green"></i>';
        setTimeout(() => { btn.innerHTML = originalHtml; }, 1500);
    }
};

function openDetail(order) {
    const reportDiv = document.getElementById('report-view');
    const joint = order.customer.joint || {};
    
    // Inline Styles for the edit form
    const styles = `
        <style>
            .edit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px; }
            .edit-group { margin-bottom: 10px; display: flex; flex-direction: column; }
            .edit-group label { font-size: 0.8rem; font-weight: bold; color: #555; margin-bottom: 4px; }
            .input-wrapper { display: flex; gap: 5px; align-items: center; }
            .input-wrapper input, .input-wrapper select, .input-wrapper textarea { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; font-family: inherit; }
            .btn-copy { background: #f0f0f0; border: 1px solid #ccc; cursor: pointer; padding: 8px 10px; border-radius: 4px; display: flex; align-items: center; justify-content: center; }
            .btn-copy:hover { background: #e0e0e0; }
            .section-title { grid-column: 1 / -1; margin-top: 20px; margin-bottom: 10px; border-bottom: 2px solid #0d6efd; padding-bottom: 5px; font-weight: bold; color: #0d6efd; text-transform: uppercase; font-size: 0.9rem; }
            .edit-actions { text-align: right; margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; display: flex; justify-content: flex-end; gap: 10px; }
            
            .btn-save { background: #198754; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: bold; }
            .btn-save:hover { background: #157347; }
            
            .btn-process { background: #0d6efd; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: bold; display: flex; align-items: center; gap: 8px; }
            .btn-process:hover { background: #0b5ed7; }
            
            .btn-cancel { background: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }

            .btn-delete { background: #dc3545; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: bold; }
            .btn-delete:hover { background: #bb2d3b; }
            
            .btn-print { background: #212529; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: bold; }
            .btn-print:hover { background: #495057; }

            .full-width { grid-column: 1 / -1; }
        </style>
    `;

    const mkField = (id, label, value, widthClass = '') => `
        <div class="edit-group ${widthClass}">
            <label>${label}</label>
            <div class="input-wrapper">
                <input type="text" id="edt-${id}" value="${(value || '').replace(/"/g, '&quot;')}" />
                <button type="button" class="btn-copy" onclick="copyToClip('edt-${id}')" title="Copy">
                    <i class="fa-regular fa-copy"></i>
                </button>
            </div>
        </div>
    `;

    const html = `
        ${styles}
        <div class="detail-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <div>
                <h3 style="margin:0;">Order: ${order.id.substr(0,8).toUpperCase()}</h3>
                <small style="color:#666;">Created: ${order.createdAt ? new Date(order.createdAt.seconds * 1000).toLocaleString() : 'N/A'}</small>
            </div>
            <span class="status-badge status-${order.status}" style="padding: 5px 10px; border-radius: 4px; font-weight: bold;">${order.status}</span>
        </div>

        <div id="save-feedback" style="display:none; padding:10px; margin-bottom:15px; border-radius:4px; text-align:center;"></div>

        <div class="edit-grid">
            <div class="section-title">Primary Customer</div>
            ${mkField('custName', 'Customer Name', order.customer.name)}
            ${mkField('custDob', 'Date of Birth', order.customer.dob)}
            ${mkField('custSsn', 'SSN (Last 4)', order.customer.ssn4)}
            ${mkField('custMobile', 'Mobile Phone', order.customer.mobile)}
            ${mkField('custEmail', 'Email Address', order.customer.email)}
            
            <div class="section-title">Service Location</div>
            ${mkField('homeAddress', 'Service Address', order.customer.address, 'full-width')}
            ${mkField('mailAddress', 'Mailing Address', order.customer.mailingAddress, 'full-width')}
            
            <div class="section-title">Joint Applicant</div>
            ${mkField('jointName', 'Joint Name', joint.name)}
            ${mkField('jointDob', 'Joint DOB', joint.dob)}
            ${mkField('jointSsn', 'Joint SSN', joint.ssn4)}
            ${mkField('jointMobile', 'Joint Mobile', joint.mobile)}
            ${mkField('jointEmail', 'Joint Email', joint.email)}

            <div class="section-title">Plan & Service Details</div>
            ${mkField('planName', 'Plan Tier', order.plan.selectedTier)}
            ${mkField('planPrice', 'Monthly Price', order.plan.price)}
            ${mkField('planSpeed', 'Speed', order.plan.speed)}
            ${mkField('planStickers', 'Promos/Stickers', order.plan.stickers)}
            
            <div class="section-title">Agent Notes</div>
            <div class="edit-group full-width">
                <label>Internal Notes</label>
                <div class="input-wrapper">
                    <textarea id="edt-internalNotes" rows="3" placeholder="Enter notes here...">${(order.internalNotes || '').replace(/"/g, '&quot;')}</textarea>
                </div>
            </div>

            <div class="section-title">Order Meta</div>
            ${mkField('surveyContact', 'Survey Contact', order.surveyContact)}
            ${mkField('status', 'Status', order.status)}
        </div>

        <div class="edit-actions">
            <button type="button" class="btn-delete" id="btn-delete-order" style="margin-right: auto;">
                <i class="fa-solid fa-trash"></i> Delete
            </button>
            <button type="button" class="btn-print" id="btn-print-order">
                <i class="fa-solid fa-print"></i> Print
            </button>
            <button onclick="closeModal()" class="btn-cancel">Close</button>
            <button type="button" class="btn-save" id="btn-save-order">Save Changes</button>
            ${order.status !== 'Processed' ? 
                `<button type="button" class="btn-process" id="btn-process-order">
                    <i class="fa-solid fa-check-double"></i> Confirm & Process
                 </button>` : 
                `<button disabled class="btn-process" style="opacity:0.6; cursor:default;">
                    <i class="fa-solid fa-check"></i> Processed
                 </button>`
            }
        </div>
    `;

    reportDiv.innerHTML = html;
    document.getElementById('detail-modal').style.display = 'flex';

    // Helper to get form values
    const getFormValues = () => {
        const getVal = (id) => document.getElementById(`edt-${id}`).value;
        return {
            'customer.name': getVal('custName'),
            'customer.dob': getVal('custDob'),
            'customer.ssn4': getVal('custSsn'),
            'customer.mobile': getVal('custMobile'),
            'customer.email': getVal('custEmail'),
            'customer.address': getVal('homeAddress'),
            'customer.mailingAddress': getVal('mailAddress'),
            'customer.joint.name': getVal('jointName'),
            'customer.joint.dob': getVal('jointDob'),
            'customer.joint.ssn4': getVal('jointSsn'),
            'customer.joint.mobile': getVal('jointMobile'),
            'customer.joint.email': getVal('jointEmail'),
            'plan.selectedTier': getVal('planName'),
            'plan.price': getVal('planPrice'),
            'plan.speed': getVal('planSpeed'),
            'plan.stickers': getVal('planStickers'),
            'surveyContact': getVal('surveyContact'),
            'status': getVal('status'),
            'internalNotes': getVal('internalNotes') // New field
        };
    };

    // Save Logic
    document.getElementById('btn-save-order').addEventListener('click', async () => {
        const btn = document.getElementById('btn-save-order');
        const feedback = document.getElementById('save-feedback');
        
        btn.disabled = true;
        btn.textContent = "Saving...";
        
        try {
            const updatedData = getFormValues();
            const orderRef = doc(db, 'artifacts', appId, 'public', 'data', 'office_signups', order.id);
            await updateDoc(orderRef, updatedData);

            feedback.style.display = 'block';
            feedback.style.background = '#d1e7dd';
            feedback.style.color = '#0f5132';
            feedback.textContent = "Changes saved successfully!";
            
            // Refresh list in background
            loadOrders();

        } catch (e) {
            console.error(e);
            feedback.style.display = 'block';
            feedback.style.background = '#f8d7da';
            feedback.style.color = '#842029';
            feedback.textContent = "Error saving changes: " + e.message;
        } finally {
            btn.disabled = false;
            btn.textContent = "Save Changes";
        }
    });

    // Print Logic
    document.getElementById('btn-print-order').addEventListener('click', () => {
        const data = getFormValues();
        // Use live values from form for printing
        const created = order.createdAt ? new Date(order.createdAt.seconds * 1000).toLocaleDateString() : 'N/A';
        
        const printWindow = window.open('', '_blank');
        const content = `
            <html>
            <head>
                <title>Service Order - ${order.id}</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; line-height: 1.5; }
                    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
                    .section { margin-bottom: 25px; }
                    .section-title { font-weight: bold; border-bottom: 1px solid #ccc; margin-bottom: 10px; font-size: 1.1em; }
                    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
                    .label { font-weight: bold; color: #555; }
                    .value { margin-bottom: 5px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div>
                        <h2>NPTECH SERVICE ORDER</h2>
                        <div>Order ID: ${order.id.toUpperCase()}</div>
                    </div>
                    <div style="text-align:right">
                        <div>Date: ${created}</div>
                        <div>Status: ${data['status']}</div>
                        <div>Agent: ${order.createdBy}</div>
                    </div>
                </div>

                <div class="grid">
                    <div class="section">
                        <div class="section-title">CUSTOMER</div>
                        <div><span class="label">Name:</span> ${data['customer.name']}</div>
                        <div><span class="label">Address:</span> ${data['customer.address']}</div>
                        <div><span class="label">Mailing:</span> ${data['customer.mailingAddress']}</div>
                        <div><span class="label">Phone:</span> ${data['customer.mobile']}</div>
                        <div><span class="label">Email:</span> ${data['customer.email']}</div>
                        <div><span class="label">DOB:</span> ${data['customer.dob']}</div>
                        <div><span class="label">SSN(4):</span> ${data['customer.ssn4']}</div>
                    </div>

                    <div class="section">
                         <div class="section-title">PLAN DETAILS</div>
                         <div><span class="label">Plan:</span> ${data['plan.selectedTier']}</div>
                         <div><span class="label">Price:</span> ${data['plan.price']}</div>
                         <div><span class="label">Speed:</span> ${data['plan.speed']}</div>
                         <div><span class="label">Promos:</span> ${data['plan.stickers']}</div>
                         <div style="margin-top:10px;"><span class="label">Survey Contact:</span> ${data['surveyContact']}</div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">JOINT APPLICANT</div>
                     <div class="grid">
                        <div><span class="label">Name:</span> ${data['customer.joint.name']}</div>
                        <div><span class="label">Phone:</span> ${data['customer.joint.mobile']}</div>
                     </div>
                </div>

                <div class="section">
                    <div class="section-title">INTERNAL NOTES</div>
                    <div style="border:1px solid #ddd; padding:10px; min-height:50px;">
                        ${data['internalNotes'] || 'None'}
                    </div>
                </div>

                <div style="margin-top:40px; border-top:1px dashed #000; padding-top:10px; font-size:0.8em; text-align:center;">
                    Printed on ${new Date().toLocaleString()} from Front Office System
                </div>
                <script>
                    window.onload = function() { window.print(); }
                </script>
            </body>
            </html>
        `;
        printWindow.document.write(content);
        printWindow.document.close();
    });


    // Process Logic
    const procBtn = document.getElementById('btn-process-order');
    if(procBtn && order.status !== 'Processed') {
        procBtn.addEventListener('click', async () => {
            if(confirm("Have you successfully transferred all customer data to the Work Order System?\n\nThis will move the order to the 'Processed' tab. It will still be accessible there.")) {
                
                procBtn.disabled = true;
                procBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
                
                try {
                    // Update Status to Processed (and save any pending edits)
                    const updatedData = getFormValues();
                    updatedData.status = 'Processed';
                    
                    const orderRef = doc(db, 'artifacts', appId, 'public', 'data', 'office_signups', order.id);
                    await updateDoc(orderRef, updatedData);
                    
                    alert("Order marked as Processed.");
                    window.closeModal();
                    loadOrders(); // Refresh list to move it to other tab

                } catch (e) {
                    alert("Error processing order: " + e.message);
                    procBtn.disabled = false;
                    procBtn.innerHTML = '<i class="fa-solid fa-check-double"></i> Confirm & Process';
                }
            }
        });
    }

    // Delete Logic
    document.getElementById('btn-delete-order').addEventListener('click', async () => {
        if(confirm("Are you sure you want to PERMANENTLY delete this order? This cannot be undone.")) {
            const btn = document.getElementById('btn-delete-order');
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
            
            try {
                const orderRef = doc(db, 'artifacts', appId, 'public', 'data', 'office_signups', order.id);
                await deleteDoc(orderRef);
                
                window.closeModal();
                loadOrders();
            } catch (e) {
                console.error(e);
                alert("Error deleting order: " + e.message);
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-trash"></i> Delete';
            }
        }
    });
}