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

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authMessage = document.getElementById('auth-message');
const userDisplay = document.getElementById('user-display');

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
        isUserAdmin = (user.email.toLowerCase() === 'jmiller@nptel.com');
        
        initTabs();
        loadAnalyticsData(); 
        
        // Listeners
        document.getElementById('export-orders-btn').addEventListener('click', exportOrdersToCSV);
        document.getElementById('export-activity-btn').addEventListener('click', exportActivityToCSV);
        document.getElementById('campaign-form').addEventListener('submit', handleCampaignSave);
        document.getElementById('add-plan-btn').addEventListener('click', () => addPlanRow());
        
        injectDefaultCheckbox();

        if(document.getElementById('plans-container').children.length === 0) {
            addPlanRow(); 
        }

        loadCampaigns(); 

        if (window.mapLogicReadyCallback) window.mapLogicReadyCallback(isUserAdmin);
        else window.currentUserIsAdmin = isUserAdmin;

    } else {
        loginScreen.style.display = 'flex';
        appContainer.style.display = 'none';
    }
});

// --- UI HELPERS ---
function injectDefaultCheckbox() {
    const formSection = document.querySelector('#campaign-form .form-section:first-child');
    if (!document.getElementById('is-default-pricing')) {
        const div = document.createElement('div');
        div.style.marginTop = "15px";
        div.style.padding = "10px";
        div.style.backgroundColor = "#e8f5e9";
        div.style.borderRadius = "4px";
        div.innerHTML = `
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
                <input type="checkbox" id="is-default-pricing"> 
                <strong>Save as Global Default Pricing</strong> 
            </label>
            <small style="color:#666; display:block; margin-top:5px; margin-left:22px;">
                If checked, these plans will appear for ALL users who are not in a specific campaign zone. 
                (Campaign Name & Color will be ignored).
            </small>
        `;
        formSection.appendChild(div);
    }
}

// --- CAMPAIGN MANAGER LOGIC ---

window.moveRowUp = function(btn) {
    const row = btn.closest('.plan-row');
    if (row.previousElementSibling) {
        row.parentNode.insertBefore(row, row.previousElementSibling);
    }
};

window.moveRowDown = function(btn) {
    const row = btn.closest('.plan-row');
    if (row.nextElementSibling) {
        row.parentNode.insertBefore(row.nextElementSibling, row);
    }
};

// Toggle Promo Section visibility
window.togglePromo = function(btn) {
    const section = btn.closest('.plan-row').querySelector('.promo-section');
    if (section.style.display === 'block') {
        section.style.display = 'none';
        btn.textContent = '+ Add Deal/Promo';
    } else {
        section.style.display = 'block';
        btn.textContent = '- Remove Deal';
    }
};

function addPlanRow(name='', price='', speed='', isPopular=false, promoPrice='', promoLabel='', promoEnd='') {
    const container = document.getElementById('plans-container');
    const div = document.createElement('div');
    div.className = 'plan-row';
    
    // Check if promo data exists to auto-expand
    const hasPromo = promoPrice || promoLabel || promoEnd;
    const promoDisplay = hasPromo ? 'block' : 'none';
    const promoBtnText = hasPromo ? '- Remove Deal' : '+ Add Deal/Promo';

    div.innerHTML = `
        <div class="form-row" style="margin-bottom: 5px;">
            <div class="form-col">
                <label>Plan Name</label>
                <input type="text" class="plan-name" placeholder="e.g. Standard" value="${name}" required>
            </div>
            <div class="form-col">
                <label>Regular Price</label>
                <input type="text" class="plan-price" placeholder="$65" value="${price}" required>
            </div>
            <div class="form-col">
                <label>Speed</label>
                <input type="text" class="plan-speed" placeholder="200 Mbps" value="${speed}" required>
            </div>
            <div class="form-col narrow" style="text-align:center;">
                <label>Popular</label>
                <input type="radio" name="popular_choice" class="plan-popular" ${isPopular ? 'checked' : ''}>
            </div>
            <div class="form-col" style="flex: 0 0 110px; display:flex; gap:5px; align-items:flex-end;">
                <button type="button" class="action-btn small" onclick="window.moveRowUp(this)" title="Move Up"><i class="fa-solid fa-arrow-up"></i></button>
                <button type="button" class="action-btn small" onclick="window.moveRowDown(this)" title="Move Down"><i class="fa-solid fa-arrow-down"></i></button>
                <button type="button" class="btn-remove-row" onclick="this.closest('.plan-row').remove()" title="Remove Tier"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>
        <div style="text-align: left; padding-left: 5px;">
            <button type="button" class="promo-toggle-btn" onclick="window.togglePromo(this)">${promoBtnText}</button>
        </div>
        <div class="promo-section" style="display: ${promoDisplay};">
            <h4 style="margin:0 0 10px 0; color:#856404; font-size: 0.9rem;">Discount / Promo Settings</h4>
            <div class="form-row">
                <div class="form-col">
                    <label>Discounted Price</label>
                    <input type="text" class="promo-price" placeholder="$50" value="${promoPrice}">
                </div>
                <div class="form-col">
                    <label>Label text (e.g. Holiday Deal)</label>
                    <input type="text" class="promo-label" placeholder="Black Friday Deal" value="${promoLabel}">
                </div>
                <div class="form-col">
                    <label>Ends On (Optional)</label>
                    <input type="date" class="promo-end" value="${promoEnd}">
                </div>
            </div>
        </div>
    `;
    container.appendChild(div);
}

function resetForm() {
    document.getElementById('campaign-form').reset();
    document.getElementById('plans-container').innerHTML = ''; 
    addPlanRow(); 
    editingCampaignId = null;
    
    const submitBtn = document.querySelector('#campaign-form button[type="submit"]');
    if(submitBtn) submitBtn.textContent = "Save Campaign";
    
    const cancelBtn = document.getElementById('btn-cancel-edit');
    if(cancelBtn) cancelBtn.remove();
    
    const defaultCheck = document.getElementById('is-default-pricing');
    if(defaultCheck) defaultCheck.checked = false;
}

async function handleCampaignSave(e) {
    e.preventDefault();
    if (!auth.currentUser) return;

    const name = document.getElementById('camp-name').value;
    const color = document.getElementById('camp-color').value;
    const isDefault = document.getElementById('is-default-pricing').checked;
    
    const plans = {};
    const rows = document.querySelectorAll('.plan-row');
    rows.forEach(row => {
        const planName = row.querySelector('.plan-name').value.trim();
        const planPrice = row.querySelector('.plan-price').value.trim();
        const planSpeed = row.querySelector('.plan-speed').value.trim();
        const isPopular = row.querySelector('.plan-popular').checked;
        
        // Promo fields
        const promoSection = row.querySelector('.promo-section');
        let promoData = {};
        
        if (promoSection.style.display !== 'none') {
            const pPrice = row.querySelector('.promo-price').value.trim();
            const pLabel = row.querySelector('.promo-label').value.trim();
            const pEnd = row.querySelector('.promo-end').value;
            
            if (pPrice) {
                promoData = {
                    promoPrice: pPrice,
                    promoLabel: pLabel,
                    promoEnd: pEnd
                };
            }
        }
        
        if(planName && planPrice && planSpeed) {
            plans[planName] = { 
                price: planPrice, 
                speed: planSpeed,
                isPopular: isPopular,
                ...promoData
            };
        }
    });

    if (Object.keys(plans).length === 0) {
        alert("Please add at least one valid pricing tier.");
        return;
    }

    try {
        const payload = { name, color, plans, updatedAt: new Date() };
        
        if (isDefault) {
            await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', 'global_default'), {
                name: "Global Default",
                plans: plans,
                updatedAt: new Date()
            });
            alert('Global Default Pricing Updated!');
        } else if (editingCampaignId && editingCampaignId !== 'global_default') {
            await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', editingCampaignId), payload, { merge: true });
            alert('Campaign Updated!');
        } else {
            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'campaigns'), {
                ...payload, createdAt: new Date()
            });
            alert('Campaign Created Successfully!');
        }
        
        resetForm();
    } catch (err) {
        console.error("Error saving:", err);
        alert(`Failed to save: ${err.message}`);
    }
}

// Populate form
window.editCampaign = function(id) {
    let campaign;
    if (id === 'global_default') {
        campaign = globalDefaultCampaign;
    } else {
        campaign = campaigns.find(c => c.id === id);
    }
    
    if (!campaign) return;
    
    editingCampaignId = id;
    
    document.getElementById('camp-name').value = campaign.name || '';
    document.getElementById('camp-color').value = campaign.color || '#ff0000';
    
    const defaultCheck = document.getElementById('is-default-pricing');
    if(defaultCheck) defaultCheck.checked = (id === 'global_default');
    
    const container = document.getElementById('plans-container');
    container.innerHTML = '';
    
    // Sort logic similar to pricing page if needed, but here we likely rely on insertion order if saved that way
    // Since we use object, insertion order is generally preserved in modern JS but not guaranteed in all historical contexts.
    // For now, we iterate.
    if (campaign.plans) {
        Object.entries(campaign.plans).forEach(([name, details]) => {
            addPlanRow(
                name, 
                details.price, 
                details.speed, 
                details.isPopular,
                details.promoPrice || '',
                details.promoLabel || '',
                details.promoEnd || ''
            );
        });
    } else {
        addPlanRow();
    }
    
    const submitBtn = document.querySelector('#campaign-form button[type="submit"]');
    if(submitBtn) submitBtn.textContent = (id === 'global_default') ? "Update Defaults" : "Update Campaign";
    
    if (!document.getElementById('btn-cancel-edit')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'btn-cancel-edit';
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel Edit';
        cancelBtn.className = 'action-btn';
        cancelBtn.style.cssText = "background-color: #6c757d; color: white; border:none; width: 100%; padding: 12px; font-size: 1rem; margin-top: 10px;";
        cancelBtn.onclick = resetForm;
        submitBtn.parentNode.appendChild(cancelBtn);
    }
    
    document.getElementById('campaign-form').scrollIntoView({ behavior: 'smooth' });
};

// Duplicate Functionality
window.duplicateCampaign = function(id) {
    let campaign;
    if (id === 'global_default') campaign = globalDefaultCampaign;
    else campaign = campaigns.find(c => c.id === id);
    
    if (!campaign) return;
    
    // Populate form but keep as NEW
    editingCampaignId = null; 
    
    document.getElementById('camp-name').value = (campaign.name || 'Campaign') + " (Copy)";
    document.getElementById('camp-color').value = campaign.color || '#ff0000';
    document.getElementById('is-default-pricing').checked = false;
    
    const container = document.getElementById('plans-container');
    container.innerHTML = '';
    
    if (campaign.plans) {
        Object.entries(campaign.plans).forEach(([name, details]) => {
            addPlanRow(
                name, 
                details.price, 
                details.speed, 
                details.isPopular,
                details.promoPrice || '',
                details.promoLabel || '',
                details.promoEnd || ''
            );
        });
    }
    
    const submitBtn = document.querySelector('#campaign-form button[type="submit"]');
    if(submitBtn) submitBtn.textContent = "Save as New Campaign";
    
    // Ensure cancel btn exists to clear form
    if (!document.getElementById('btn-cancel-edit')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'btn-cancel-edit';
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel / Clear Form';
        cancelBtn.className = 'action-btn';
        cancelBtn.style.cssText = "background-color: #6c757d; color: white; border:none; width: 100%; padding: 12px; font-size: 1rem; margin-top: 10px;";
        cancelBtn.onclick = resetForm;
        submitBtn.parentNode.appendChild(cancelBtn);
    }
    
    document.getElementById('campaign-form').scrollIntoView({ behavior: 'smooth' });
};

async function loadCampaigns() {
    if (!auth.currentUser) return;
    
    onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'campaigns'), 
        (snapshot) => {
            campaigns = [];
            const container = document.getElementById('campaigns-container');
            container.innerHTML = '';
            const select = document.getElementById('campaign-select');
            
            while (select.options.length > 1) { select.remove(1); }

            snapshot.forEach(doc => {
                const data = doc.data();
                data.id = doc.id;
                
                if (doc.id === 'global_default') {
                    globalDefaultCampaign = data; 
                    renderDefaultCard(data, container);
                } else {
                    campaigns.push(data);
                    renderCampaignCard(data, container);
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

function renderDefaultCard(data, container) {
    const card = document.createElement('div');
    card.className = 'campaign-card';
    card.style.borderLeftColor = '#333';
    card.style.background = '#f4f6f8';
    
    let plansHtml = '<ul>';
    if (data.plans) {
        for (const [key, details] of Object.entries(data.plans)) {
            const star = details.isPopular ? ' <i class="fa-solid fa-star" style="color:gold;"></i>' : '';
            const promo = details.promoPrice ? ` <span style="color:red; font-size:0.8em;">(Promo: ${details.promoPrice})</span>` : '';
            plansHtml += `<li><strong>${key}:</strong> ${details.price}${promo} / ${details.speed}${star}</li>`;
        }
    }
    plansHtml += '</ul>';
    
    card.innerHTML = `
        <div class="campaign-actions">
            <button class="btn-edit-campaign" onclick="window.duplicateCampaign('global_default')" title="Duplicate" style="color:#28a745; margin-right:10px; border:none; background:none; cursor:pointer;"><i class="fa-solid fa-copy"></i></button>
            <button class="btn-edit-campaign" onclick="window.editCampaign('global_default')" title="Edit Defaults" style="color:#007bff; border:none; background:none; cursor:pointer;"><i class="fa-solid fa-pen"></i></button>
        </div>
        <h4 style="color: #333;"><i class="fa-solid fa-globe"></i> Global Default Pricing</h4>
        <div style="font-size: 0.9rem;">${plansHtml}</div>
    `;
    container.insertBefore(card, container.firstChild);
}

function renderCampaignCard(data, container) {
    const card = document.createElement('div');
    card.className = 'campaign-card';
    card.style.borderLeftColor = data.color || '#ccc';
    
    let plansHtml = '';
    if (data.plans) {
        for (const [key, details] of Object.entries(data.plans)) {
            const star = details.isPopular ? ' <i class="fa-solid fa-star" style="color:gold;"></i>' : '';
            const promo = details.promoPrice ? ` <span style="color:red; font-size:0.8em;">(Promo: ${details.promoPrice})</span>` : '';
            plansHtml += `<p><strong>${key}:</strong> ${details.price}${promo} / ${details.speed}${star}</p>`;
        }
    }
    
    card.innerHTML = `
        <div class="campaign-actions">
            <button class="btn-edit-campaign" onclick="window.duplicateCampaign('${data.id}')" title="Duplicate Campaign" style="color:#28a745; margin-right:10px; border:none; background:none; cursor:pointer;"><i class="fa-solid fa-copy"></i></button>
            <button class="btn-edit-campaign" onclick="window.editCampaign('${data.id}')" title="Edit Campaign" style="margin-right:10px; color:#007bff; border:none; background:none; cursor:pointer;"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-delete-campaign" onclick="window.deleteCampaign('${data.id}')" title="Delete Campaign"><i class="fa-solid fa-trash"></i></button>
        </div>
        <h4 style="color: #2c3e50;">${data.name}</h4>
        <div style="margin-top: 10px; font-size: 0.9rem;">${plansHtml}</div>
    `;
    container.appendChild(card);
}

window.deleteCampaign = async function(id) {
    if(!confirm("Delete this campaign?")) return;
    try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', id)); } catch (e) { console.error(e); }
};

// ... (Rest of file: Tabs, Analytics, Map Logic remains unchanged) ...
function initTabs() { const tabs=document.querySelectorAll('.tab-btn');tabs.forEach(tab=>{tab.addEventListener('click',()=>{document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));tab.classList.add('active');const contentId=tab.dataset.tab;document.getElementById(contentId).classList.add('active');if(contentId==='map-view'&&map)google.maps.event.trigger(map,"resize");});});document.getElementById('refresh-data-btn').addEventListener('click',loadAnalyticsData);}
async function loadAnalyticsData() {if(!auth.currentUser)return;try{const loadingIndicator=document.querySelector('.stat-card.loading');if(loadingIndicator)loadingIndicator.textContent="Updating...";const ordersSnap=await getDocs(collection(db,'artifacts',appId,'public','data','orders'));const orders=[];const uniqueOrderAddresses=new Set();const planCounts={};let pendingCount=0;ordersSnap.forEach(doc=>{const data=doc.data();data.id=doc.id;orders.push(data);if(data.status==='pending')pendingCount++;if(data.address)uniqueOrderAddresses.add(data.address.trim().toLowerCase());if(data.plan)planCounts[data.plan]=(planCounts[data.plan]||0)+1;});const checksSnap=await getDocs(collection(db,'artifacts',appId,'public','data','service_requests'));const uniqueAvailableAddresses=new Set();const uniqueUnavailableAddresses=new Set();checksSnap.forEach(doc=>{const data=doc.data();if(data.address){const normAddr=data.address.trim().toLowerCase();if(data.isAvailable)uniqueAvailableAddresses.add(normAddr);else uniqueUnavailableAddresses.add(normAddr);}});const totalUniqueChecks=uniqueAvailableAddresses.size+uniqueUnavailableAddresses.size;let unconvertedLeads=0;uniqueAvailableAddresses.forEach(addr=>{if(!uniqueOrderAddresses.has(addr))unconvertedLeads++;});const conversionRate=uniqueAvailableAddresses.size>0?((uniqueOrderAddresses.size/uniqueAvailableAddresses.size)*100).toFixed(1):0;updateDashboardUI({totalOrders:orders.length,pendingCount,totalUniqueChecks,uniqueAvailable:uniqueAvailableAddresses.size,uniqueUnavailable:uniqueUnavailableAddresses.size,unconvertedLeads,conversionRate,planCounts});orders.sort((a,b)=>(b.submittedAt?.seconds||0)-(a.submittedAt?.seconds||0));renderOrdersTable(orders);}catch(e){console.error("Error loading analytics:",e);}}
async function exportOrdersToCSV() { if(!confirm("Download Orders Report?")) return; try { const snapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'orders')); let csvContent = "data:text/csv;charset=utf-8,"; csvContent += "Date,Name,Email,Phone,Address,Plan,Status\n"; snapshot.forEach(doc => { const data = doc.data(); const date = data.submittedAt && data.submittedAt.toDate ? data.submittedAt.toDate().toLocaleString() : ''; const row = [ `"${date}"`, `"${data.name || ''}"`, `"${data.email || ''}"`, `"${data.phone || ''}"`, `"${data.address || ''}"`, `"${data.plan || ''}"`, `"${data.status || 'pending'}"` ].join(","); csvContent += row + "\n"; }); const encodedUri = encodeURI(csvContent); const link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", `orders_report_${new Date().toISOString().split('T')[0]}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); } catch (e) { console.error("Export Error:", e); alert("Failed to export orders."); } }
async function exportActivityToCSV() { if(!confirm("Download Activity Log? (This may take a moment)")) return; try { const snapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'service_requests')); let csvContent = "data:text/csv;charset=utf-8,"; csvContent += "Date,Address,Service Available,Coordinates\n"; snapshot.forEach(doc => { const data = doc.data(); const date = data.checkedAt && data.checkedAt.toDate ? data.checkedAt.toDate().toLocaleString() : ''; const coords = data.location ? `${data.location.lat}, ${data.location.lng}` : ''; const row = [ `"${date}"`, `"${data.address || ''}"`, `"${data.isAvailable ? 'YES' : 'NO'}"`, `"${coords}"` ].join(","); csvContent += row + "\n"; }); const encodedUri = encodeURI(csvContent); const link = document.createElement("a"); link.setAttribute("href", encodedUri); link.setAttribute("download", `activity_log_${new Date().toISOString().split('T')[0]}.csv`); document.body.appendChild(link); link.click(); document.body.removeChild(link); } catch (e) { console.error("Export Error:", e); alert("Failed to export activity log."); } }
function updateDashboardUI(stats) { const container=document.querySelector('.stats-row');if(!container)return;let planStatsHtml='';for(const[planName,count]of Object.entries(stats.planCounts)){planStatsHtml+=`<div style="text-align: center;"><div style="font-weight: bold; color: #333;">${count}</div><div style="font-size: 0.7rem;">${planName}</div></div>`;}container.innerHTML=`<div class="stat-card"><h3>Total Orders</h3><p>${stats.totalOrders}</p><small>Pending: ${stats.pendingCount}</small></div><div class="stat-card"><h3>Unique Checks</h3><p>${stats.totalUniqueChecks}</p><div style="font-size: 0.8rem; color: #666; margin-top: 5px;"><span style="color: #28a745;">${stats.uniqueAvailable} OK</span> | <span style="color: #dc3545;">${stats.uniqueUnavailable} No</span></div></div><div class="stat-card"><h3>Conversion</h3><p>${stats.conversionRate}%</p><small style="color: #e67e22;">${stats.unconvertedLeads} Potential</small></div><div class="stat-card"><h3>Plans</h3><div style="display: flex; gap: 15px; margin-top: 10px; font-size: 0.9rem; overflow-x:auto;">${planStatsHtml||'No data'}</div></div>`;}
function renderOrdersTable(orders) { const tbody=document.querySelector('#orders-table tbody');tbody.innerHTML='';orders.forEach(order=>{const tr=document.createElement('tr');let dateStr='N/A';if(order.submittedAt&&order.submittedAt.toDate)dateStr=order.submittedAt.toDate().toLocaleDateString();tr.innerHTML=`<td>${dateStr}</td><td>${order.name||'Unknown'}</td><td><strong>${order.plan||'None'}</strong></td><td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${order.address||''}</td><td><div>${order.email||''}</div><small>${order.phone||''}</small></td>`;tbody.appendChild(tr);});}
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