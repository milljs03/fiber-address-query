import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, updateDoc, doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- CONFIGURATION ---
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
const provider = new GoogleAuthProvider();
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nptel-map-portal';

// State
let map;
let drawingManager;
let selectedShape;
let allShapes = [];
let campaigns = [];
let globalDefaultCampaign = null; 
let editingCampaignId = null;     
let isUserAdmin = false;
let searchMarker;

// Chart Instances
let planChartInstance = null;
let activityChartInstance = null;

// Data Cache & View State
let cachedData = {
    orders: [],
    leads: [],
    activity: []
};
let currentView = 'orders';

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authMessage = document.getElementById('auth-message');
const userDisplay = document.getElementById('user-display');

// Modal Elements
const modalOverlay = document.getElementById('campaign-modal');
const btnCreateCampaign = document.getElementById('btn-create-campaign');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelModal = document.getElementById('btn-cancel-modal');

// --- HELPER: DEDUPLICATE BY ADDRESS ---
function getUniqueByAddress(items, addressKey = 'address', dateKey = null) {
    const seen = new Set();
    const unique = [];
    
    // 1. Sort descending by date (Newest first) so we keep the latest entry
    if (dateKey) {
        items.sort((a, b) => {
            const dateA = a[dateKey] && a[dateKey].toDate ? a[dateKey].toDate() : (a[dateKey] ? new Date(a[dateKey]) : new Date(0));
            const dateB = b[dateKey] && b[dateKey].toDate ? b[dateKey].toDate() : (b[dateKey] ? new Date(b[dateKey]) : new Date(0));
            return dateB - dateA;
        });
    }

    // 2. Filter duplicates
    for (const item of items) {
        const addr = item[addressKey] ? item[addressKey].toString().trim().toLowerCase() : null;
        if (addr) {
            if (!seen.has(addr)) {
                seen.add(addr);
                unique.push(item);
            }
        } else {
            unique.push(item); 
        }
    }
    return unique;
}

// --- AUTH LOGIC ---
const initAuth = async () => {
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        }
    } catch (e) { console.warn("Auth check failed:", e); }
};
initAuth();

loginBtn.addEventListener('click', () => {
    signInWithPopup(auth, provider).catch((error) => {
        authMessage.textContent = "Error: " + error.message;
    });
});

logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => { window.location.reload(); });
});

onAuthStateChanged(auth, (user) => {
    if (user && user.email) {
        if (!user.email.endsWith('@nptel.com')) {
            signOut(auth);
            authMessage.textContent = "Access Denied: @nptel.com email required.";
            return;
        }

        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex'; 
        userDisplay.textContent = user.email;

        // --- SECURITY FIX: CORRECT COMPARISON ---
        const email = user.email.toLowerCase();
        isUserAdmin = (email === 'jmiller@nptel.com' || email === 'ppenrose@nptel.com');
        
        initTabs();
        loadAnalyticsData(); 
        
        // Export Listener (Dynamic)
        document.getElementById('export-current-btn').addEventListener('click', () => {
            if(currentView === 'orders') exportOrdersToCSV();
            else if(currentView === 'leads') exportLeadsToCSV();
            else if(currentView === 'activity') exportActivityToCSV();
        });

        document.getElementById('campaign-form').addEventListener('submit', handleCampaignSave);
        document.getElementById('add-plan-btn').addEventListener('click', () => addPlanRow());
        
        // Modal Listeners
        if(btnCreateCampaign) btnCreateCampaign.addEventListener('click', () => openCampaignModal());
        if(btnCloseModal) btnCloseModal.addEventListener('click', closeCampaignModal);
        if(btnCancelModal) btnCancelModal.addEventListener('click', closeCampaignModal);
        
        loadCampaigns(); 

        if (window.mapLogicReadyCallback) window.mapLogicReadyCallback(isUserAdmin);
        else window.currentUserIsAdmin = isUserAdmin;

    } else {
        loginScreen.style.display = 'flex';
        appContainer.style.display = 'none';
    }
});

// --- MODAL LOGIC ---
function openCampaignModal(campaignId = null) {
    editingCampaignId = campaignId;
    const modalTitle = document.getElementById('modal-title');
    const plansContainer = document.getElementById('plans-container');
    const form = document.getElementById('campaign-form');
    
    // Clear previous state
    form.reset();
    plansContainer.innerHTML = '';
    document.getElementById('camp-expires').value = ''; 
    
    if (campaignId) {
        // Edit Mode
        let data;
        if(campaignId === 'global_default') {
            data = globalDefaultCampaign;
            modalTitle.textContent = "Edit Global Defaults";
        } else {
            data = campaigns.find(c => c.id === campaignId);
            modalTitle.textContent = "Edit Campaign";
        }
        
        if(data) {
            document.getElementById('camp-name').value = data.name || '';
            document.getElementById('camp-color').value = data.color || '#ff0000';
            document.getElementById('is-default-pricing').checked = (campaignId === 'global_default');
            
            if (data.expiresAt) {
                const d = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
                if (!isNaN(d.getTime())) {
                   const dateStr = d.toISOString().split('T')[0];
                   document.getElementById('camp-expires').value = dateStr;
                }
            }
            
            if (data.plans) {
                Object.entries(data.plans).forEach(([name, details]) => {
                    addPlanRow(name, details.price, details.speed, details.isPopular, details.promoPrice, details.promoLabel, details.promoEnd, details.stickers);
                });
            } else {
                addPlanRow();
            }
        }
    } else {
        // Create Mode
        modalTitle.textContent = "New Campaign";
        editingCampaignId = null;
        document.getElementById('camp-color').value = '#0066ff'; 
        addPlanRow();
    }
    
    modalOverlay.classList.add('open');
}

function closeCampaignModal() {
    modalOverlay.classList.remove('open');
}

// --- CAMPAIGN LOGIC ---

window.moveRowUp = function(btn) {
    const row = btn.closest('.plan-row-card');
    if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
};

window.moveRowDown = function(btn) {
    const row = btn.closest('.plan-row-card');
    if (row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
};

window.togglePromo = function(btn) {
    const container = btn.closest('.plan-row-card').querySelector('.promo-container');
    if (container.classList.contains('active')) {
        container.classList.remove('active');
        btn.textContent = "+ Add Discount / Promo";
        btn.style.color = "#fa8c16";
    } else {
        container.classList.add('active');
        btn.textContent = "- Remove Promo";
        btn.style.color = "#d4380d";
    }
};

function addPlanRow(name='', price='', speed='', isPopular=false, promoPrice='', promoLabel='', promoEnd='', stickers='') {
    const container = document.getElementById('plans-container');
    const div = document.createElement('div');
    div.className = 'plan-row-card';
    
    const hasPromo = promoPrice || promoLabel || promoEnd;
    const promoClass = hasPromo ? 'active' : '';
    const promoBtnText = hasPromo ? '- Remove Promo' : '+ Add Discount / Promo';
    const promoBtnColor = hasPromo ? '#d4380d' : '#fa8c16';

    div.innerHTML = `
        <div class="plan-header-row">
            <div class="form-col" style="flex:2">
                <label>Plan Name</label>
                <input type="text" class="plan-name" placeholder="e.g. Standard" value="${name}" required>
            </div>
            <div class="form-col" style="flex:1">
                <label>Price</label>
                <input type="text" class="plan-price" placeholder="$65" value="${price}" required>
            </div>
            <div class="form-col" style="flex:1">
                <label>Speed</label>
                <input type="text" class="plan-speed" placeholder="200 Mbps" value="${speed}" required>
            </div>
            <div class="plan-tools">
                <button type="button" class="tool-btn" onclick="window.moveRowUp(this)" title="Move Up"><i class="fa-solid fa-arrow-up"></i></button>
                <button type="button" class="tool-btn" onclick="window.moveRowDown(this)" title="Move Down"><i class="fa-solid fa-arrow-down"></i></button>
                <button type="button" class="tool-btn remove" onclick="this.closest('.plan-row-card').remove()" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>

        <div class="form-row" style="align-items: center;">
             <div class="form-col" style="flex:3;">
                 <label>Stickers / Perks (comma separated)</label>
                 <input type="text" class="plan-stickers" placeholder="e.g. Free Install, $50 Gift Card" value="${stickers}">
             </div>
             <div class="form-col" style="flex:1; align-items:center;">
                <label style="cursor:pointer; display:flex; align-items:center; gap:5px; margin-top:15px;">
                    <input type="radio" name="popular_choice" class="plan-popular" ${isPopular ? 'checked' : ''}>
                    Most Popular
                </label>
             </div>
        </div>

        <button type="button" class="promo-trigger" style="color:${promoBtnColor}" onclick="window.togglePromo(this)">${promoBtnText}</button>
        
        <div class="promo-container ${promoClass}">
            <div class="form-row">
                <div class="form-col">
                    <label>Discount Price</label>
                    <input type="text" class="promo-price" placeholder="$50" value="${promoPrice}">
                </div>
                <div class="form-col">
                    <label>Promo Label</label>
                    <input type="text" class="promo-label" placeholder="Black Friday" value="${promoLabel}">
                </div>
                <div class="form-col">
                    <label>Ends On</label>
                    <input type="date" class="promo-end" value="${promoEnd}">
                </div>
            </div>
        </div>
    `;
    container.appendChild(div);
}

async function handleCampaignSave(e) {
    e.preventDefault();
    if (!auth.currentUser) return;

    const name = document.getElementById('camp-name').value;
    const color = document.getElementById('camp-color').value;
    const isDefault = document.getElementById('is-default-pricing').checked;
    
    const expiresInput = document.getElementById('camp-expires').value;
    let expiresAt = null;
    if (expiresInput) {
        expiresAt = new Date(expiresInput);
    }

    const plans = {};
    const rows = document.querySelectorAll('.plan-row-card');
    rows.forEach(row => {
        const planName = row.querySelector('.plan-name').value.trim();
        const planPrice = row.querySelector('.plan-price').value.trim();
        const planSpeed = row.querySelector('.plan-speed').value.trim();
        const stickers = row.querySelector('.plan-stickers').value.trim();
        const isPopular = row.querySelector('.plan-popular').checked;
        
        const promoContainer = row.querySelector('.promo-container');
        let promoData = {};
        
        if (promoContainer.classList.contains('active')) {
            const pPrice = row.querySelector('.promo-price').value.trim();
            const pLabel = row.querySelector('.promo-label').value.trim();
            const pEnd = row.querySelector('.promo-end').value;
            if (pPrice) {
                promoData = { promoPrice: pPrice, promoLabel: pLabel, promoEnd: pEnd };
            }
        }
        
        if(planName && planPrice && planSpeed) {
            plans[planName] = { price: planPrice, speed: planSpeed, isPopular, stickers, ...promoData };
        }
    });

    if (Object.keys(plans).length === 0) { alert("Please add at least one valid pricing tier."); return; }

    try {
        const payload = { name, color, plans, expiresAt, updatedAt: new Date() };
        if (isDefault) {
            await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', 'global_default'), {
                name: "Global Default", plans: plans, updatedAt: new Date()
            });
            alert('Global Default Pricing Updated!');
        } else if (editingCampaignId && editingCampaignId !== 'global_default') {
            await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', editingCampaignId), payload, { merge: true });
            alert('Campaign Updated!');
        } else {
            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'campaigns'), { ...payload, createdAt: new Date() });
            alert('Campaign Created Successfully!');
        }
        closeCampaignModal();
    } catch (err) { console.error("Error saving:", err); alert(`Failed to save: ${err.message}`); }
}

async function loadCampaigns() {
    if (!auth.currentUser) return;
    onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'campaigns'), 
        (snapshot) => {
            campaigns = [];
            const container = document.getElementById('campaigns-grid');
            container.innerHTML = '';
            
            const select = document.getElementById('campaign-select');
            while (select.options.length > 1) { select.remove(1); }

            snapshot.forEach(doc => {
                const data = doc.data();
                data.id = doc.id;
                
                if (doc.id === 'global_default') {
                    globalDefaultCampaign = data; 
                    renderGridCard(data, container, true);
                } else {
                    campaigns.push(data);
                    renderGridCard(data, container, false);
                    const opt = document.createElement('option');
                    opt.value = data.id;
                    opt.textContent = data.name;
                    select.appendChild(opt);
                }
            });
            refreshMapColors();
        }, 
        (error) => console.error("Snapshot Error:", error)
    );
}

function renderGridCard(data, container, isDefault) {
    const card = document.createElement('div');
    card.className = isDefault ? 'grid-card default-card' : 'grid-card';
    
    const colorDot = isDefault ? '<i class="fa-solid fa-globe"></i> ' : `<span class="color-dot" style="background-color:${data.color}"></span>`;
    const title = isDefault ? 'Global Defaults' : data.name;

    let expiryLabel = '';
    if (data.expiresAt) {
        const d = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
        if (!isNaN(d.getTime())) {
            const today = new Date();
            const isExpired = today > d;
            const colorStyle = isExpired ? 'color: red;' : 'color: #666;';
            const text = isExpired ? 'Expired' : 'Expires';
            expiryLabel = `<div style="font-size: 0.8rem; margin-bottom: 5px; ${colorStyle}"><i class="fa-regular fa-clock"></i> ${text}: ${d.toLocaleDateString()}</div>`;
        }
    }
    
    let plansHtml = '';
    if (data.plans) {
        plansHtml = '<ul>';
        let count = 0;
        for (const [key, details] of Object.entries(data.plans)) {
            if(count < 3) { 
                const promo = details.promoPrice ? `<span style="color:#d4380d; font-size:0.85em;">(Promo)</span>` : '';
                plansHtml += `<li><strong>${key}:</strong> ${details.price} ${promo}</li>`;
            }
            count++;
        }
        if(count > 3) plansHtml += `<li><em>+ ${count - 3} more...</em></li>`;
        plansHtml += '</ul>';
    }

    card.innerHTML = `
        <div class="card-header">
            <div class="card-title">${colorDot}${title}</div>
            ${isDefault ? '<small>Default</small>' : ''}
        </div>
        <div class="card-body">
            ${expiryLabel}
            ${plansHtml}
        </div>
        <div class="card-actions">
            <button class="card-btn" onclick="window.duplicateCampaign('${data.id}')" title="Copy"><i class="fa-regular fa-copy"></i></button>
            <button class="card-btn" onclick="window.openCampaignModal('${data.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
            ${!isDefault ? `<button class="card-btn delete" onclick="window.deleteCampaign('${data.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
    `;
    container.appendChild(card);
}

// Global functions for inline HTML calls
window.openCampaignModal = openCampaignModal;
window.deleteCampaign = async function(id) {
    if(!confirm("Delete this campaign?")) return;
    try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', id)); } catch (e) { console.error(e); }
};
window.duplicateCampaign = function(id) {
    let campaign;
    if (id === 'global_default') campaign = globalDefaultCampaign;
    else campaign = campaigns.find(c => c.id === id);
    if (!campaign) return;
    
    openCampaignModal(); 
    document.getElementById('camp-name').value = (campaign.name || 'Campaign') + " (Copy)";
    document.getElementById('camp-color').value = campaign.color || '#ff0000';
    
    const container = document.getElementById('plans-container');
    container.innerHTML = '';
    if (campaign.plans) {
        Object.entries(campaign.plans).forEach(([name, details]) => {
            addPlanRow(name, details.price, details.speed, details.isPopular, details.promoPrice, details.promoLabel, details.promoEnd, details.stickers);
        });
    }
};

function initTabs() { 
    const tabs=document.querySelectorAll('.tab-btn');
    tabs.forEach(tab=>{
        tab.addEventListener('click',()=>{
            document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
            tab.classList.add('active');
            const contentId=tab.dataset.tab;
            document.getElementById(contentId).classList.add('active');
            if(contentId==='map-view'&&map)google.maps.event.trigger(map,"resize");
        });
    });
    document.getElementById('refresh-data-btn').addEventListener('click',loadAnalyticsData);
}

// --- ANALYTICS & TABLE LOGIC ---

window.switchTableView = function(viewName) {
    currentView = viewName;
    
    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    // Match button by index or logic. 
    const buttons = document.querySelectorAll('.view-btn');
    if(viewName === 'orders') buttons[0].classList.add('active');
    if(viewName === 'leads') buttons[1].classList.add('active');
    if(viewName === 'activity') buttons[2].classList.add('active');

    const titles = {
        'orders': 'Recent Orders',
        'leads': 'Captured Leads',
        'activity': 'Activity Log'
    };
    document.getElementById('table-title').textContent = titles[viewName];

    renderMainTable();
};

function renderMainTable() {
    const tableHead = document.querySelector('#main-data-table thead');
    const tableBody = document.querySelector('#main-data-table tbody');
    tableHead.innerHTML = '';
    tableBody.innerHTML = '';

    const data = cachedData[currentView] || [];
    const limit = 50; 
    const displayData = data.slice(0, limit);

    if (currentView === 'orders') {
        tableHead.innerHTML = `
            <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Plan</th>
                <th>Address</th>
                <th>Contact</th>
            </tr>
        `;
        displayData.forEach(item => {
            const dateStr = item.submittedAt && item.submittedAt.toDate ? item.submittedAt.toDate().toLocaleDateString() : 'N/A';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${dateStr}</td>
                <td>${item.name || 'Unknown'}</td>
                <td><span style="font-weight:600; color:#1e3c72;">${item.plan || 'None'}</span></td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.address || ''}</td>
                <td>
                    <div>${item.email || ''}</div>
                    <small style="color:#888;">${item.phone || ''}</small>
                </td>`;
            tableBody.appendChild(tr);
        });
    } else if (currentView === 'leads') {
        tableHead.innerHTML = `
            <tr>
                <th>Date</th>
                <th>Name</th>
                <th>Address</th>
                <th>Contact Info</th>
                <th>Type</th>
            </tr>
        `;
        displayData.forEach(item => {
            let dateObj = item.submittedAt || item.checkedAt;
            const dateStr = dateObj && dateObj.toDate ? dateObj.toDate().toLocaleDateString() : 'N/A';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${dateStr}</td>
                <td>${item.name || 'N/A'}</td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.address || ''}</td>
                <td>
                    ${item.email ? `<div><i class="fa-solid fa-envelope" style="font-size:0.8em"></i> ${item.email}</div>` : ''}
                    ${item.phone ? `<div><i class="fa-solid fa-phone" style="font-size:0.8em"></i> ${item.phone}</div>` : ''}
                </td>
                <td><span style="background:#fff0f0; color:#d32f2f; padding:2px 6px; border-radius:4px; font-size:0.8em; font-weight:bold;">Lead</span></td>`;
            tableBody.appendChild(tr);
        });
    } else if (currentView === 'activity') {
        tableHead.innerHTML = `
            <tr>
                <th>Date</th>
                <th>Address</th>
                <th>Status</th>
                <th>Coordinates</th>
            </tr>
        `;
        displayData.forEach(item => {
            let dateObj = item.checkedAt || item.submittedAt;
            const dateStr = dateObj && dateObj.toDate ? dateObj.toDate().toLocaleString() : 'N/A';
            const statusBadge = item.isAvailable 
                ? `<span style="color:#2e7d32; background:#e8f5e9; padding:2px 8px; border-radius:10px; font-weight:bold;">Serviceable</span>` 
                : `<span style="color:#c62828; background:#ffebee; padding:2px 8px; border-radius:10px; font-weight:bold;">Unserviceable</span>`;
            
            const coords = item.location ? `${item.location.lat.toFixed(4)}, ${item.location.lng.toFixed(4)}` : 'N/A';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${dateStr}</td>
                <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.address || ''}</td>
                <td>${statusBadge}</td>
                <td style="font-family:monospace; font-size:0.85em;">${coords}</td>`;
            tableBody.appendChild(tr);
        });
    }
}

async function loadAnalyticsData() {
    if(!auth.currentUser) return;
    try {
        const refreshBtn = document.getElementById('refresh-data-btn');
        if(refreshBtn) refreshBtn.classList.add('fa-spin');

        // 1. Fetch Orders
        const ordersSnap = await getDocs(collection(db,'artifacts',appId,'public','data','orders'));
        let rawOrders = [];
        ordersSnap.forEach(doc => { rawOrders.push({ id: doc.id, ...doc.data() }); });
        cachedData.orders = getUniqueByAddress(rawOrders, 'address', 'submittedAt');

        // 2. Fetch Checks (Activity)
        const checksSnap = await getDocs(collection(db,'artifacts',appId,'public','data','service_requests'));
        let rawChecks = [];
        checksSnap.forEach(doc => { rawChecks.push(doc.data()); });
        cachedData.activity = getUniqueByAddress(rawChecks, 'address', 'checkedAt');

        // 3. Process Leads (Subset of Activity)
        let rawLeads = [];
        rawChecks.forEach(data => {
            if (data.type === 'manual_check' || (data.name && (data.phone || data.email))) {
                rawLeads.push(data);
            }
        });
        cachedData.leads = getUniqueByAddress(rawLeads, 'address', 'submittedAt');

        // 4. Update Stats UI
        updateStatsUI(cachedData.orders, cachedData.activity, cachedData.leads);

        // 5. Render Table (Current View)
        renderMainTable();

        if(refreshBtn) refreshBtn.classList.remove('fa-spin');

    } catch(e) { 
        console.error("Error loading analytics:", e); 
    }
}

function updateStatsUI(orders, activity, leads) {
    const planCounts = {};
    orders.forEach(data => {
        let pName = data.plan || 'Unknown';
        if(pName.includes(' ')) pName = pName.split(' ')[0]; 
        planCounts[pName] = (planCounts[pName] || 0) + 1;
    });

    let available = 0, unavailable = 0;
    activity.forEach(a => a.isAvailable ? available++ : unavailable++);
    
    const orderAddresses = new Set(orders.map(o => o.address ? o.address.trim().toLowerCase() : ''));
    let unconvertedLeads = 0;
    leads.forEach(l => {
        const addr = l.address ? l.address.trim().toLowerCase() : '';
        if(addr && !orderAddresses.has(addr)) unconvertedLeads++;
    });

    const conversionRate = available > 0 ? ((orders.length / available) * 100).toFixed(1) : 0;

    document.getElementById('stat-total-val').textContent = orders.length;
    document.getElementById('stat-serviceable-val').textContent = available;
    document.getElementById('stat-conversion-val').textContent = conversionRate + '%';
    if(document.getElementById('stat-queries-val')) {
        document.getElementById('stat-queries-val').textContent = activity.length;
    }

    renderCharts(planCounts, { available, unavailable });
}

function renderCharts(planCounts, availabilityStats) {
    const ctx1 = document.getElementById('planChart').getContext('2d');
    if (planChartInstance) planChartInstance.destroy();

    const planLabels = Object.keys(planCounts);
    const planData = Object.values(planCounts);

    planChartInstance = new Chart(ctx1, {
        type: 'doughnut',
        data: {
            labels: planLabels,
            datasets: [{
                data: planData,
                backgroundColor: ['#4facfe', '#43e97b', '#a18cd1', '#ff9a9e', '#fbc2eb'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right' }
            }
        }
    });

    const ctx2 = document.getElementById('activityChart').getContext('2d');
    if (activityChartInstance) activityChartInstance.destroy();

    activityChartInstance = new Chart(ctx2, {
        type: 'bar',
        data: {
            labels: ['Serviceable', 'Not Serviceable'],
            datasets: [{
                label: 'Addresses Checked',
                data: [availabilityStats.available, availabilityStats.unavailable],
                backgroundColor: ['#43e97b', '#ff6b6b'],
                borderRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// Export Functions (Using Cached Data)
async function exportOrdersToCSV() { 
    if(!cachedData.orders.length) { alert("No data to export."); return; }
    if(!confirm("Download Orders Report (Unique Addresses Only)?")) return; 

    let csv = "Date,Name,Email,Phone,Address,Plan\n"; 
    cachedData.orders.forEach(d => { 
        const date = d.submittedAt && d.submittedAt.toDate ? d.submittedAt.toDate().toLocaleString() : ''; 
        const row = [`"${date}"`, `"${d.name||''}"`, `"${d.email||''}"`, `"${d.phone||''}"`, `"${d.address||''}"`, `"${d.plan||''}"`].join(","); 
        csv += row + "\n"; 
    }); 
    downloadCSV(csv, "orders_report.csv");
}

async function exportActivityToCSV() { 
    if(!cachedData.activity.length) { alert("No data to export."); return; }
    if(!confirm("Download Activity Log (Unique Addresses Only)?")) return; 

    let csv = "Date,Address,Service Available,Coordinates\n"; 
    cachedData.activity.forEach(d => { 
        let dateObj = d.checkedAt || d.submittedAt;
        const date = dateObj && dateObj.toDate ? dateObj.toDate().toLocaleString() : ''; 
        const coords = d.location ? `${d.location.lat}, ${d.location.lng}` : ''; 
        const row = [`"${date}"`, `"${d.address||''}"`, `"${d.isAvailable?'YES':'NO'}"`, `"${coords}"`].join(","); 
        csv += row + "\n"; 
    }); 
    downloadCSV(csv, "activity_log.csv");
}

async function exportLeadsToCSV() {
    if(!cachedData.leads.length) { alert("No data to export."); return; }
    if(!confirm("Download Leads Report (Unique Addresses Only)?")) return; 

    let csv = "Date,Name,Phone,Email,Address,Type\n";
    cachedData.leads.forEach(d => {
        let dateObj = d.submittedAt || d.checkedAt;
        const date = dateObj && dateObj.toDate ? dateObj.toDate().toLocaleString() : ''; 
        const row = [`"${date}"`, `"${d.name||''}"`, `"${d.phone||''}"`, `"${d.email||''}"`, `"${d.address||''}"`, `"Unserviceable Lead"`].join(",");
        csv += row + "\n";
    });
    downloadCSV(csv, "leads_report.csv");
}

function downloadCSV(content, filename) {
    const encodedUri = encodeURI("data:text/csv;charset=utf-8," + content); 
    const link = document.createElement("a"); 
    link.setAttribute("href", encodedUri); 
    link.setAttribute("download", filename); 
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link); 
}

// Map Logic (Preserved)
function initializeMapLogic() {window.mapLogicReadyCallback=(isAdmin)=>{isUserAdmin=isAdmin;loadMapFeatures();};if(typeof window.currentUserIsAdmin!=='undefined')window.mapLogicReadyCallback(window.currentUserIsAdmin);}
if(window.isGoogleMapsReady)initializeMapLogic();else window.addEventListener('google-maps-ready',initializeMapLogic);
function loadMapFeatures() {if(map)return;initSearchControl();map=new google.maps.Map(document.getElementById('map'),{center:{lat:41.5006,lng:-85.8305},zoom:14,mapTypeId:'hybrid',disableDefaultUI:!isUserAdmin,zoomControl:true,});loadPolygonsFromDatabase();const campaignSelect=document.getElementById('campaign-select');if(campaignSelect){campaignSelect.addEventListener('change',async(e)=>{if(selectedShape&&selectedShape.firebaseId){const campaignId=e.target.value;selectedShape.campaignId=campaignId;updateShapeColor(selectedShape);try{const docRef=doc(db,'artifacts',appId,'public','data','polygons',selectedShape.firebaseId);await updateDoc(docRef,{campaignId:campaignId});}catch(err){console.error("Error assigning campaign:",err);}}});}if(isUserAdmin){document.getElementById('admin-instructions').style.display='block';drawingManager=new google.maps.drawing.DrawingManager({drawingMode:google.maps.drawing.OverlayType.POLYGON,drawingControl:true,drawingControlOptions:{position:google.maps.ControlPosition.TOP_LEFT,drawingModes:['polygon']},polygonOptions:{fillColor:'#ffff00',fillOpacity:0.5,strokeWeight:2,clickable:true,editable:true,zIndex:1}});drawingManager.setMap(map);google.maps.event.addListener(drawingManager,'overlaycomplete',function(e){if(e.type!==google.maps.drawing.OverlayType.MARKER){drawingManager.setDrawingMode(null);const newShape=e.overlay;newShape.type=e.type;newShape.campaignId="";savePolygonToDatabase(newShape).then(id=>{newShape.firebaseId=id;allShapes.push(newShape);attachPolygonListeners(newShape);});google.maps.event.addListener(newShape,'click',function(){setSelection(newShape);});setSelection(newShape);}});google.maps.event.addListener(map,'click',clearSelection);document.addEventListener('keydown',function(e){if(e.key==="Backspace"||e.key==="Delete")deleteSelectedShape();});}document.getElementById('export-btn').addEventListener('click',exporttoJSON);const importBtn=document.getElementById('import-btn');const importInput=document.getElementById('import-input');if(importBtn&&importInput){importBtn.addEventListener('click',()=>importInput.click());importInput.addEventListener('change',async(e)=>{const file=e.target.files[0];if(!file)return;const filename=file.name.toLowerCase();if(filename.endsWith('.json')||filename.endsWith('.geojson')){const reader=new FileReader();reader.onload=(event)=>{try{const geoJson=JSON.parse(event.target.result);loadPolygonsFromGeoJSON(geoJson);}catch(error){console.error(error);}};reader.readAsText(file);}importInput.value='';});}}
function initSearchControl() {const controlDiv=document.createElement("div");controlDiv.style.marginTop="10px";controlDiv.style.display="flex";controlDiv.style.gap="5px";controlDiv.style.zIndex="5";const searchInput=document.createElement("input");searchInput.type="text";searchInput.placeholder="Search Address";searchInput.style.padding="8px";searchInput.style.borderRadius="4px";searchInput.style.border="1px solid #ccc";const searchBtn=document.createElement("button");searchBtn.textContent="Go";searchBtn.style.padding="8px 12px";searchBtn.style.cursor="pointer";controlDiv.appendChild(searchInput);controlDiv.appendChild(searchBtn);if(map)map.controls[google.maps.ControlPosition.TOP_CENTER].push(controlDiv);const geocoder=new google.maps.Geocoder();const performSearch=()=>{const address=searchInput.value;if(!address)return;geocoder.geocode({'address':address},function(results,status){if(status==='OK'){map.setCenter(results[0].geometry.location);map.setZoom(17);if(searchMarker)searchMarker.setMap(null);searchMarker=new google.maps.Marker({map:map,position:results[0].geometry.location});}});};searchBtn.addEventListener("click",performSearch);}
async function savePolygonToDatabase(shape) {if(!auth.currentUser)return;const coordinates=getCoordinatesFromShape(shape);try{const docRef=await addDoc(collection(db,'artifacts',appId,'public','data','polygons'),{coordinates,type:'polygon',campaignId:shape.campaignId||"",createdAt:new Date()});return docRef.id;}catch(e){console.error(e);}}
async function updatePolygonInDatabase(id,shape) {if(!auth.currentUser||!id)return;const coordinates=getCoordinatesFromShape(shape);try{const docRef=doc(db,'artifacts',appId,'public','data','polygons',id);await updateDoc(docRef,{coordinates,campaignId:shape.campaignId||""});}catch(e){console.error(e);}}
async function loadPolygonsFromDatabase() {if(!auth.currentUser)return;try{const querySnapshot=await getDocs(collection(db,'artifacts',appId,'public','data','polygons'));querySnapshot.forEach((doc)=>{const data=doc.data();if(data.type==='polygon'&&data.coordinates){const newPolygon=new google.maps.Polygon({paths:data.coordinates,fillOpacity:0.5,strokeWeight:2,clickable:true,editable:isUserAdmin,zIndex:1});newPolygon.type='polygon';newPolygon.firebaseId=doc.id;newPolygon.campaignId=data.campaignId||"";updateShapeColor(newPolygon);newPolygon.setMap(map);allShapes.push(newPolygon);if(isUserAdmin){attachPolygonListeners(newPolygon);google.maps.event.addListener(newPolygon,'click',function(){setSelection(newPolygon);});}}});}catch(e){console.error(e);}}
function updateShapeColor(shape) {let color='#ffff00';if(shape.campaignId){const campaign=campaigns.find(c=>c.id===shape.campaignId);if(campaign&&campaign.color){color=campaign.color;}}shape.setOptions({fillColor:color});}
function refreshMapColors() {allShapes.forEach(shape=>updateShapeColor(shape));}
async function deletePolygonFromDatabase(id) {if(!auth.currentUser||!id)return;try{await deleteDoc(doc(db,'artifacts',appId,'public','data','polygons',id));}catch(e){console.error(e);}}
function getCoordinatesFromShape(shape) {const path=shape.getPath();const coordinates=[];for(let i=0;i<path.getLength();i++){const xy=path.getAt(i);coordinates.push({lat:xy.lat(),lng:xy.lng()});}return coordinates;}
function attachPolygonListeners(polygon) {if(!isUserAdmin)return;const path=polygon.getPath();const triggerUpdate=()=>{if(polygon.firebaseId)updatePolygonInDatabase(polygon.firebaseId,polygon);};google.maps.event.addListener(path,'set_at',triggerUpdate);google.maps.event.addListener(path,'insert_at',triggerUpdate);google.maps.event.addListener(path,'remove_at',triggerUpdate);google.maps.event.addListener(polygon,'dragend',triggerUpdate);}
function loadPolygonsFromGeoJSON(geoJson) {if(!geoJson.features)return;geoJson.features.forEach(feature=>{if(feature.geometry&&feature.geometry.type==="Polygon"){const coords=feature.geometry.coordinates[0].map(coord=>({lat:coord[1],lng:coord[0]}));const newPolygon=new google.maps.Polygon({paths:coords,fillColor:'#ffff00',fillOpacity:0.5,strokeWeight:2,clickable:true,editable:isUserAdmin,zIndex:1});newPolygon.setMap(map);newPolygon.type='polygon';savePolygonToDatabase(newPolygon).then(id=>{newPolygon.firebaseId=id;allShapes.push(newPolygon);attachPolygonListeners(newPolygon);});if(isUserAdmin){google.maps.event.addListener(newPolygon,'click',function(){setSelection(newPolygon);});}}});}
function setSelection(shape) {if(!isUserAdmin)return;clearSelection();selectedShape=shape;shape.setEditable(true);shape.setOptions({strokeColor:'#FF0000'});const wrapper=document.getElementById('campaign-selector-wrapper');const select=document.getElementById('campaign-select');if(wrapper&&select){wrapper.style.display='flex';select.value=shape.campaignId||"";}}
function clearSelection() {if(selectedShape){selectedShape.setEditable(false);selectedShape.setOptions({strokeColor:'#000000'});selectedShape=null;}const wrapper=document.getElementById('campaign-selector-wrapper');if(wrapper)wrapper.style.display='none';}
function deleteSelectedShape() {if(selectedShape&&isUserAdmin){if(selectedShape.firebaseId)deletePolygonFromDatabase(selectedShape.firebaseId);selectedShape.setMap(null);const index=allShapes.indexOf(selectedShape);if(index>-1)allShapes.splice(index,1);selectedShape=null;const wrapper=document.getElementById('campaign-selector-wrapper');if(wrapper)wrapper.style.display='none';}}
function exporttoJSON() {const features=[];allShapes.forEach(shape=>{if(shape.type==='polygon'){const path=shape.getPath();const coordinates=[];for(let i=0;i<path.getLength();i++){const xy=path.getAt(i);coordinates.push([xy.lng(),xy.lat()]);}if(coordinates.length>0)coordinates.push(coordinates[0]);features.push({"type":"Feature","properties":{campaignId:shape.campaignId||""},"geometry":{"type":"Polygon","coordinates":[coordinates]}});}});const geoJsonData={"type":"FeatureCollection","features":features};const dataStr="data:text/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(geoJsonData));const dl=document.createElement('a');dl.setAttribute("href",dataStr);dl.setAttribute("download","polygons.json");document.body.appendChild(dl);dl.click();dl.remove();}