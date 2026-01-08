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
let mapOverlay; 

// Heatmap State
let heatmapMarkers = [];
let isHeatmapVisible = false;

// Chart Instances
let planChartInstance = null;
let activityChartInstance = null;

// Data Cache & View State
let cachedData = {
    orders: [],
    leads: [],
    activity: []
};
let allReferrals = []; 
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

// --- HELPER FUNCTIONS (DEFINED EARLY) ---
function getUniqueByAddress(items, addressKey = 'address', dateKey = null) {
    const seen = new Set();
    const unique = [];
    
    if (dateKey) {
        items.sort((a, b) => {
            const dateA = a[dateKey] && a[dateKey].toDate ? a[dateKey].toDate() : (a[dateKey] ? new Date(a[dateKey]) : new Date(0));
            const dateB = b[dateKey] && b[dateKey].toDate ? b[dateKey].toDate() : (b[dateKey] ? new Date(b[dateKey]) : new Date(0));
            return dateB - dateA;
        });
    }

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

// Plan Editor Helpers (Must be accessible via window for HTML onclick)
function moveRowUp(btn) {
    const row = btn.closest('.plan-row-card');
    if (row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
}

function moveRowDown(btn) {
    const row = btn.closest('.plan-row-card');
    if (row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
}

function togglePromo(btn) {
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

if(loginBtn) {
    loginBtn.addEventListener('click', () => {
        signInWithPopup(auth, provider).catch((error) => {
            if(authMessage) authMessage.textContent = "Error: " + error.message;
        });
    });
}

if(logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        signOut(auth).then(() => { window.location.reload(); });
    });
}

onAuthStateChanged(auth, (user) => {
    if (user && user.email) {
        if (!user.email.endsWith('@nptel.com')) {
            signOut(auth);
            if(authMessage) authMessage.textContent = "Access Denied: @nptel.com email required.";
            return;
        }

        if(loginScreen) loginScreen.style.display = 'none';
        if(appContainer) appContainer.style.display = 'flex'; 
        if(userDisplay) userDisplay.textContent = user.email;

        const email = user.email.toLowerCase();
        isUserAdmin = (email === 'jmiller@nptel.com' || email === 'ppenrose@nptel.com');
        window.currentUserIsAdmin = isUserAdmin; // EXPOSE TO MAP LOGIC
        
        // Initialize UI
        initTabs();
        loadAnalyticsData(); 
        loadCampaigns();
        
        // Ensure this function is defined before calling
        if (typeof loadReferrals === 'function') {
            loadReferrals();
        } else {
            console.warn("loadReferrals not defined yet, retrying shortly...");
            setTimeout(() => { if(typeof loadReferrals === 'function') loadReferrals(); }, 500);
        }
        
        setupReferralListeners();

        // Initialize Map (if API is ready)
        if (window.isGoogleMapsReady) {
            loadMapFeatures();
        }

        // Export Listener (Dynamic)
        const exportCurrentBtn = document.getElementById('export-current-btn');
        if(exportCurrentBtn) {
            exportCurrentBtn.addEventListener('click', () => {
                if(currentView === 'orders') exportOrdersToCSV();
                else if(currentView === 'leads') exportLeadsToCSV();
                else if(currentView === 'activity') exportActivityToCSV();
            });
        }
        
        // Setup Campaign Modal
        if(btnCreateCampaign) btnCreateCampaign.addEventListener('click', () => openCampaignModal());
        if(btnCloseModal) btnCloseModal.addEventListener('click', closeCampaignModal);
        if(btnCancelModal) btnCancelModal.addEventListener('click', closeCampaignModal);
        
        const campForm = document.getElementById('campaign-form');
        if(campForm) campForm.addEventListener('submit', handleCampaignSave);
        
        const addPlanBtn = document.getElementById('add-plan-btn');
        if(addPlanBtn) {
            addPlanBtn.addEventListener('click', () => addPlanRow());
        }

    } else {
        if(loginScreen) loginScreen.style.display = 'flex';
        if(appContainer) appContainer.style.display = 'none';
    }
});

// --- REFERRAL PROGRAM LOGIC ---

function setupReferralListeners() {
    const processBtn = document.getElementById('process-referral-btn');
    if (processBtn) processBtn.addEventListener('click', handleReferralUpload);
    
    const searchInput = document.getElementById('referral-search');
    if (searchInput) searchInput.addEventListener('keyup', handleReferralSearch);
    
    const exportBtn = document.getElementById('export-referral-btn');
    if (exportBtn) exportBtn.addEventListener('click', exportReferralCsv);

    const refreshBtn = document.getElementById('refresh-referral-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadReferrals);

    const massDeleteBtn = document.getElementById('mass-delete-referral-btn');
    if (massDeleteBtn) massDeleteBtn.addEventListener('click', handleMassDelete);
}

async function handleReferralUpload() {
    const input = document.getElementById('referral-csv-input');
    const statusDiv = document.getElementById('referral-status');
    const file = input.files[0];

    if (!file) {
        statusDiv.innerText = "Please select a CSV file first.";
        statusDiv.style.color = "red";
        return;
    }

    statusDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
    statusDiv.style.color = "#333";

    const reader = new FileReader();
    reader.onload = async function(e) {
        const text = e.target.result;
        try {
            const parsedData = parseCSV(text);
            if (parsedData.length === 0) {
                throw new Error("No valid data found in CSV. Headers must include Name, Address, Account.");
            }

            // Save to Firestore
            await saveReferralsToDb(parsedData);
            
            statusDiv.innerText = `Success! Processed ${parsedData.length} records.`;
            statusDiv.style.color = "green";
            input.value = ''; // Reset
            loadReferrals(); // Refresh table
            
        } catch (err) {
            console.error(err);
            statusDiv.innerText = "Error: " + err.message;
            statusDiv.style.color = "red";
        }
    };
    reader.readAsText(file);
}

function parseCSV(text) {
    const lines = text.split('\n');
    if (lines.length < 2) return [];

    // Simple header normalization
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
    
    const nameIdx = headers.findIndex(h => h.includes('name'));
    const addrIdx = headers.findIndex(h => h.includes('address'));
    const accIdx = headers.findIndex(h => h.includes('account'));

    if (nameIdx === -1 || addrIdx === -1 || accIdx === -1) {
        throw new Error("Missing required columns: Name, Address, or Account");
    }

    const results = [];
    
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Handle quotes loosely
        const row = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
        let colValues = row;
        if (!colValues) colValues = line.split(',');

        if (colValues && colValues.length >= 3) {
            const clean = (val) => val ? val.replace(/^"|"$/g, '').trim() : '';
            
            const name = clean(colValues[nameIdx]);
            const address = clean(colValues[addrIdx]);
            const account = clean(colValues[accIdx]);

            if (account && name) {
                results.push({
                    name,
                    address,
                    account,
                    referralCode: generateReferralCode(name, address)
                });
            }
        }
    }
    return results;
}

function generateReferralCode(name, address) {
    // 1. Get First Name (First word of the name column)
    const nameParts = name.trim().split(/\s+/);
    let firstName = nameParts[0] || "REF";
    
    // Cleanup: Remove non-alpha
    firstName = firstName.replace(/[^a-zA-Z]/g, '');
    if (!firstName) firstName = "REF"; 
    
    // Capitalize first letter
    firstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();

    // 2. Get House Number
    const houseNumMatch = address.trim().match(/^\d+/);
    const houseNum = houseNumMatch ? houseNumMatch[0] : '00';

    return `${firstName}${houseNum}`;
}

async function saveReferralsToDb(data) {
    const ref = collection(db, 'artifacts', appId, 'public', 'data', 'referrals');
    
    // Use Account Number as Doc ID
    const promises = data.map(item => {
        return setDoc(doc(ref, item.account), {
            ...item,
            updatedAt: new Date()
        });
    });

    await Promise.all(promises);
}

async function handleMassDelete() {
    if (!auth.currentUser) return;
    
    if (!confirm("Are you sure you want to delete ALL referral entries? This cannot be undone.")) {
        return;
    }

    const tbody = document.querySelector('#referral-table tbody');
    if(tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Deleting all records... <i class="fa-solid fa-spinner fa-spin"></i></td></tr>';

    try {
        const ref = collection(db, 'artifacts', appId, 'public', 'data', 'referrals');
        const snapshot = await getDocs(ref);
        
        // Firestore doesn't support mass delete of collection, must delete documents individually
        // Batched writes are limited to 500 operations. For simplicity/robustness here we use Promise.all
        // For very large datasets (>500), consider batching in chunks.
        
        const deletePromises = snapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
        await Promise.all(deletePromises);
        
        alert("All referral entries have been deleted.");
        loadReferrals();
        
    } catch (e) {
        console.error("Error mass deleting:", e);
        alert("Failed to delete all entries: " + e.message);
        loadReferrals(); // Reload to show what remains
    }
}

async function loadReferrals() {
    if (!auth.currentUser) return;

    const tbody = document.querySelector('#referral-table tbody');
    if (!tbody) return;
    
    try {
        const ref = collection(db, 'artifacts', appId, 'public', 'data', 'referrals');
        const snap = await getDocs(ref);
        
        allReferrals = snap.docs.map(d => d.data());
        
        // Sort by name
        allReferrals.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        
        renderReferralTable(allReferrals);
    } catch (e) {
        console.error("Error loading referrals", e);
        // If permission error, show simpler message
        if (e.code === 'permission-denied') {
            tbody.innerHTML = '<tr><td colspan="5" style="color:orange">Referral access restricted (Permission Denied).</td></tr>';
        } else {
            tbody.innerHTML = '<tr><td colspan="5" style="color:red">Error loading data.</td></tr>';
        }
    }
}

function renderReferralTable(data) {
    const tbody = document.querySelector('#referral-table tbody');
    if(!tbody) return;
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:#777;">No records found. Upload a list to get started.</td></tr>';
        return;
    }

    // Increase limit for view or implement pagination later
    const displayData = data.slice(0, 500); 

    displayData.forEach(item => {
        const dateStr = item.updatedAt && item.updatedAt.seconds ? new Date(item.updatedAt.seconds * 1000).toLocaleDateString() : '-';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:600;">${item.name}</td>
            <td style="color:#555;">${item.address}</td>
            <td style="font-family:monospace; color:#444;">${item.account}</td>
            <td><span class="code-badge">${item.referralCode}</span></td>
            <td style="color:#777; font-size:0.85rem;">${dateStr}</td>
        `;
        tbody.appendChild(tr);
    });
}

function handleReferralSearch(e) {
    const term = e.target.value.toLowerCase();
    
    if (!term) {
        renderReferralTable(allReferrals);
        return;
    }

    const filtered = allReferrals.filter(item => 
        (item.name && item.name.toLowerCase().includes(term)) ||
        (item.address && item.address.toLowerCase().includes(term)) ||
        (item.referralCode && item.referralCode.toLowerCase().includes(term)) ||
        (item.account && item.account.toString().toLowerCase().includes(term))
    );
    
    renderReferralTable(filtered);
}

function exportReferralCsv() {
    if (allReferrals.length === 0) {
        alert("No data to export.");
        return;
    }

    let csvContent = "Name,Address,Account,Referral Code\n";

    allReferrals.forEach(row => {
        const rowStr = `"${row.name||''}","${row.address||''}","${row.account||''}","${row.referralCode||''}"`;
        csvContent += rowStr + "\n";
    });

    downloadCSV(csvContent, "referral_codes.csv");
}

function openCampaignModal(campaignId) {
    editingCampaignId = campaignId || null;
    
    // Reset Form
    document.getElementById('camp-name').value = '';
    document.getElementById('camp-color').value = '#ff0000';
    document.getElementById('camp-expires').value = '';
    document.getElementById('is-default-pricing').checked = false;
    document.getElementById('plans-container').innerHTML = '';

    let campaign = null;
    if (campaignId === 'global_default') {
        campaign = globalDefaultCampaign;
        document.getElementById('modal-title').textContent = "Edit Global Default Pricing";
        document.getElementById('is-default-pricing').checked = true;
    } else if (campaignId) {
        campaign = campaigns.find(c => c.id === campaignId);
        document.getElementById('modal-title').textContent = "Edit Campaign";
    } else {
        document.getElementById('modal-title').textContent = "New Campaign";
    }

    if (campaign) {
        document.getElementById('camp-name').value = campaign.name || '';
        document.getElementById('camp-color').value = campaign.color || '#ff0000';
        
        if (campaign.expiresAt) {
            const d = campaign.expiresAt.toDate ? campaign.expiresAt.toDate() : new Date(campaign.expiresAt);
            if (!isNaN(d.getTime())) {
                document.getElementById('camp-expires').value = d.toISOString().split('T')[0];
            }
        }

        if (campaign.plans) {
            Object.entries(campaign.plans).forEach(([name, details]) => {
                addPlanRow(
                    name, 
                    details.price, 
                    details.speed, 
                    details.isPopular, 
                    details.promoPrice, 
                    details.promoLabel, 
                    details.promoEnd, 
                    details.stickers,
                    details.description
                );
            });
        }
    } else {
        addPlanRow();
    }

    if(modalOverlay) {
        modalOverlay.classList.add('open');
        modalOverlay.style.display = 'flex';
    }
}

function closeCampaignModal() {
    if(modalOverlay) {
        modalOverlay.classList.remove('open');
        modalOverlay.style.display = 'none';
    }
}

function addPlanRow(name='', price='', speed='', isPopular=false, promoPrice='', promoLabel='', promoEnd='', stickers='', description='') {
    const container = document.getElementById('plans-container');
    if(!container) return;

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

        <div class="form-row">
            <div class="form-col" style="flex:1;">
                 <label>Best For / Description</label>
                 <input type="text" class="plan-description" placeholder="e.g. Great for streaming & smart homes" value="${description}">
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
        
        const description = row.querySelector('.plan-description').value.trim();
        
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
            plans[planName] = { 
                price: planPrice, 
                speed: planSpeed, 
                description: description,
                isPopular, 
                stickers, 
                ...promoData 
            };
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
            if(!container) return;
            container.innerHTML = '';
            
            const select = document.getElementById('campaign-select');
            if(select) {
                while (select.options.length > 1) { select.remove(1); }
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                data.id = doc.id;
                
                if (doc.id === 'global_default') {
                    globalDefaultCampaign = data; 
                    renderGridCard(data, container, true);
                } else {
                    campaigns.push(data);
                    renderGridCard(data, container, false);
                    if(select) {
                        const opt = document.createElement('option');
                        opt.value = data.id;
                        opt.textContent = data.name;
                        select.appendChild(opt);
                    }
                }
            });
            renderCampaignPalette(); 
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

function initTabs() { 
    const tabs=document.querySelectorAll('.tab-btn');
    tabs.forEach(tab=>{
        tab.addEventListener('click',()=>{
            document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
            tab.classList.add('active');
            const contentId=tab.dataset.tab;
            const target = document.getElementById(contentId);
            if(target) target.classList.add('active');
            if(contentId==='map-view'&&map)google.maps.event.trigger(map,"resize");
        });
    });
    const refreshBtn = document.getElementById('refresh-data-btn');
    if(refreshBtn) {
        refreshBtn.addEventListener('click',loadAnalyticsData);
    }
}

// --- ANALYTICS & TABLE LOGIC ---

function switchTableView(viewName) {
    currentView = viewName;
    console.log("Switching view to:", viewName);
    
    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    // Match button by index or logic. 
    const buttons = document.querySelectorAll('.view-btn');
    if(viewName === 'orders' && buttons[0]) buttons[0].classList.add('active');
    if(viewName === 'leads' && buttons[1]) buttons[1].classList.add('active');
    if(viewName === 'activity' && buttons[2]) buttons[2].classList.add('active');

    const titles = {
        'orders': 'Recent Orders',
        'leads': 'Captured Leads',
        'activity': 'Activity Log'
    };
    const titleEl = document.getElementById('table-title');
    if(titleEl) titleEl.textContent = titles[viewName];

    renderMainTable();
};

function renderMainTable() {
    console.log("Rendering table for:", currentView);
    // Explicitly select inside the active context if possible, but IDs are unique.
    // Ensure we are selecting safely.
    const tableHead = document.querySelector('#main-data-table thead');
    const tableBody = document.querySelector('#main-data-table tbody');
    
    if(!tableHead || !tableBody) {
        // Fallback: If table exists but bodies don't (unlikely but robust)
        const table = document.getElementById('main-data-table');
        if (table) {
            console.warn("Table bodies missing, recreating...");
            table.innerHTML = '<thead></thead><tbody></tbody>';
            // Recursively call once to retry with new elements
            return renderMainTable();
        } else {
            console.error("Critical: #main-data-table not found in DOM.");
            return;
        }
    }

    tableHead.innerHTML = '';
    tableBody.innerHTML = '';

    const data = cachedData[currentView] || [];
    console.log(`Rendering ${data.length} rows for ${currentView}`);
    
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
                <th>Type / Interest</th>
            </tr>
        `;
        displayData.forEach(item => {
            let dateObj = item.submittedAt || item.checkedAt;
            const dateStr = dateObj && dateObj.toDate ? dateObj.toDate().toLocaleDateString() : 'N/A';
            
            let typeBadge = '';
            if (item.type === 'saved_quote') {
                typeBadge = `<span style="background:#e3f2fd; color:#1565c0; padding:4px 8px; border-radius:4px; font-size:0.8em; font-weight:bold; display:inline-flex; align-items:center; gap:5px;"><i class="fa-solid fa-cart-arrow-down"></i> Saved Cart</span>`;
            } else if (item.isAvailable === false) {
                 typeBadge = `<span style="background:#fff0f0; color:#d32f2f; padding:4px 8px; border-radius:4px; font-size:0.8em; font-weight:bold;">Unserviceable Lead</span>`;
            } else {
                 typeBadge = `<span style="background:#f3e5f5; color:#7b1fa2; padding:4px 8px; border-radius:4px; font-size:0.8em; font-weight:bold;">Manual Inquiry</span>`;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${dateStr}</td>
                <td>${item.name || 'N/A'}</td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.address || ''}</td>
                <td>
                    ${item.email ? `<div><i class="fa-solid fa-envelope" style="font-size:0.8em"></i> ${item.email}</div>` : ''}
                    ${item.phone ? `<div><i class="fa-solid fa-phone" style="font-size:0.8em"></i> ${item.phone}</div>` : ''}
                </td>
                <td>${typeBadge}</td>`;
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
    if(!auth.currentUser) {
        console.warn("loadAnalyticsData: No current user");
        return;
    }
    const refreshBtn = document.getElementById('refresh-data-btn');
    if(refreshBtn) refreshBtn.classList.add('fa-spin');

    console.log("loadAnalyticsData: Fetching data...");

    try {
        const [ordersSnap, checksSnap] = await Promise.all([
            getDocs(collection(db,'artifacts',appId,'public','data','orders')),
            getDocs(collection(db,'artifacts',appId,'public','data','service_requests'))
        ]);

        console.log(`loadAnalyticsData: Fetched ${ordersSnap.size} orders and ${checksSnap.size} checks`);

        let rawOrders = [];
        ordersSnap.forEach(doc => { rawOrders.push({ id: doc.id, ...doc.data() }); });
        cachedData.orders = getUniqueByAddress(rawOrders, 'address', 'submittedAt');

        let rawChecks = [];
        checksSnap.forEach(doc => { rawChecks.push(doc.data()); });
        cachedData.activity = getUniqueByAddress(rawChecks, 'address', 'checkedAt');

        let rawLeads = [];
        rawChecks.forEach(data => {
            if (data.type === 'manual_check' || (data.name && (data.phone || data.email))) {
                data.sortDate = data.submittedAt || data.checkedAt;
                rawLeads.push(data);
            }
        });
        cachedData.leads = getUniqueByAddress(rawLeads, 'address', 'sortDate');

        updateStatsUI(cachedData.orders, cachedData.activity, cachedData.leads);
        
        // Wait a tick to ensure DOM is ready if called immediately after auth
        setTimeout(() => renderMainTable(), 100);

    } catch(e) { 
        console.error("Error loading analytics:", e); 
        // Ensure headers load even if data fails
        renderMainTable();
        const tbody = document.querySelector('#main-data-table tbody');
        if(tbody) {
            tbody.innerHTML = `<tr><td colspan="5" style="color:red; text-align:center; padding: 20px;">
                <i class="fa-solid fa-triangle-exclamation"></i> Error loading data: ${e.message}<br>
                <small>Check console for details.</small>
            </td></tr>`;
        }
    } finally {
        if(refreshBtn) refreshBtn.classList.remove('fa-spin');
    }
}

function updateStatsUI(orders, activity, leads) {
    console.log("Updating Stats UI");
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

    const totalVal = document.getElementById('stat-total-val');
    if(totalVal) totalVal.textContent = orders.length;
    
    const servVal = document.getElementById('stat-serviceable-val');
    if(servVal) servVal.textContent = available;
    
    const convVal = document.getElementById('stat-conversion-val');
    if(convVal) convVal.textContent = conversionRate + '%';
    
    const queriesVal = document.getElementById('stat-queries-val');
    if(queriesVal) queriesVal.textContent = activity.length;

    renderCharts(planCounts, { available, unavailable });
}

function renderCharts(planCounts, availabilityStats) {
    const ctx1 = document.getElementById('planChart');
    if (ctx1) {
        if (planChartInstance) planChartInstance.destroy();
        const planLabels = Object.keys(planCounts);
        const planData = Object.values(planCounts);
        planChartInstance = new Chart(ctx1.getContext('2d'), {
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
    }

    const ctx2 = document.getElementById('activityChart');
    if (ctx2) {
        if (activityChartInstance) activityChartInstance.destroy();
        activityChartInstance = new Chart(ctx2.getContext('2d'), {
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
}

// Export Functions
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
        const type = d.type === 'saved_quote' ? 'Saved Cart' : (d.isAvailable === false ? 'Unserviceable Lead' : 'Manual Inquiry');
        const row = [`"${date}"`, `"${d.name||''}"`, `"${d.phone||''}"`, `"${d.email||''}"`, `"${d.address||''}"`, `"${type}"`].join(",");
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

// Map Logic
function initializeMapLogic() {
    window.mapLogicReadyCallback = (isAdmin) => {
        isUserAdmin = isAdmin;
        loadMapFeatures();
    };
    // If the window var was set by Auth first, use it.
    if(typeof window.currentUserIsAdmin !== 'undefined') {
        window.mapLogicReadyCallback(window.currentUserIsAdmin);
    }
}
if(window.isGoogleMapsReady) initializeMapLogic();
else window.addEventListener('google-maps-ready', initializeMapLogic);

function loadMapFeatures() {
    if(map) return;
    initSearchControl();
    
    map=new google.maps.Map(document.getElementById('map'),{center:{lat:41.5006,lng:-85.8305},zoom:14,mapTypeId:'hybrid',disableDefaultUI:!isUserAdmin,zoomControl:true,});
    
    class ProjectionHelper extends google.maps.OverlayView {
        onAdd(){} onRemove(){} draw(){}
    }
    mapOverlay = new ProjectionHelper();
    mapOverlay.setMap(map);

    loadPolygonsFromDatabase();
    
    const heatmapBtn = document.getElementById('heatmap-btn');
    if(heatmapBtn) heatmapBtn.addEventListener('click', toggleHeatmap);
    
    const paletteBtn = document.getElementById('palette-btn');
    if(paletteBtn) paletteBtn.addEventListener('click', toggleCampaignPalette);
    
    document.getElementById('close-palette').addEventListener('click', () => {
        document.getElementById('campaign-palette').classList.add('hidden');
        if(paletteBtn) paletteBtn.classList.remove('active');
    });

    const mapDiv = document.getElementById('map');
    
    mapDiv.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    mapDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        const campaignId = e.dataTransfer.getData('text/plain');
        if (!campaignId) return;

        const rect = mapDiv.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        if (!mapOverlay.getProjection()) return;
        
        const latLng = mapOverlay.getProjection().fromContainerPixelToLatLng(new google.maps.Point(x, y));
        
        const targetPolygon = allShapes.find(shape => {
            if (shape.type === 'polygon' && shape.getMap()) {
                return google.maps.geometry.poly.containsLocation(latLng, shape);
            }
            return false;
        });

        if (targetPolygon && targetPolygon.firebaseId) {
            assignCampaignToPolygon(targetPolygon, campaignId);
        }
    });

    const campaignSelect=document.getElementById('campaign-select');
    if(campaignSelect){
        campaignSelect.addEventListener('change',async(e)=>{
            if(selectedShape&&selectedShape.firebaseId){
                const campaignId=e.target.value;
                selectedShape.campaignId=campaignId;
                updateShapeColor(selectedShape);
                try{
                    const docRef=doc(db,'artifacts',appId,'public','data','polygons',selectedShape.firebaseId);
                    await updateDoc(docRef,{campaignId:campaignId});
                }catch(err){console.error("Error assigning campaign:",err);}
            }
        });
    }

    if(isUserAdmin){
        const adminInst = document.getElementById('admin-instructions');
        if(adminInst) adminInst.style.display='block';
        
        drawingManager=new google.maps.drawing.DrawingManager({
            drawingMode:google.maps.drawing.OverlayType.POLYGON,
            drawingControl:true,
            drawingControlOptions:{position:google.maps.ControlPosition.TOP_LEFT,drawingModes:['polygon']},
            polygonOptions:{fillColor:'#ffff00',fillOpacity:0.5,strokeWeight:2,clickable:true,editable:true,zIndex:1}
        });
        drawingManager.setMap(map);
        
        google.maps.event.addListener(drawingManager,'overlaycomplete',function(e){
            if(e.type!==google.maps.drawing.OverlayType.MARKER){
                drawingManager.setDrawingMode(null);
                const newShape=e.overlay;
                newShape.type=e.type;
                newShape.campaignId="";
                savePolygonToDatabase(newShape).then(id=>{newShape.firebaseId=id;allShapes.push(newShape);attachPolygonListeners(newShape);});
                google.maps.event.addListener(newShape,'click',function(){setSelection(newShape);});
                setSelection(newShape);
            }
        });
        
        google.maps.event.addListener(map,'click',clearSelection);
        document.addEventListener('keydown',function(e){if(e.key==="Backspace"||e.key==="Delete")deleteSelectedShape();});
    }

    document.getElementById('export-btn').addEventListener('click',exporttoJSON);
    const importBtn=document.getElementById('import-btn');
    const importInput=document.getElementById('import-input');
    if(importBtn&&importInput){
        importBtn.addEventListener('click',()=>importInput.click());
        importInput.addEventListener('change',async(e)=>{
            const file=e.target.files[0];
            if(!file)return;
            const filename=file.name.toLowerCase();
            if(filename.endsWith('.json')||filename.endsWith('.geojson')){
                const reader=new FileReader();
                reader.onload=(event)=>{try{const geoJson=JSON.parse(event.target.result);loadPolygonsFromGeoJSON(geoJson);}catch(error){console.error(error);}};
                reader.readAsText(file);
            }
            importInput.value='';
        });
    }
}

function toggleCampaignPalette() {
    const palette = document.getElementById('campaign-palette');
    const btn = document.getElementById('palette-btn');
    
    if (palette.classList.contains('hidden')) {
        palette.classList.remove('hidden');
        btn.classList.add('active');
        renderCampaignPalette();
    } else {
        palette.classList.add('hidden');
        btn.classList.remove('active');
    }
}

function renderCampaignPalette() {
    const container = document.getElementById('palette-list');
    if(!container) return;
    container.innerHTML = '';

    campaigns.forEach(camp => {
        const div = document.createElement('div');
        div.className = 'draggable-campaign';
        div.draggable = true;
        div.innerHTML = `
            <span class="drag-swatch" style="background-color: ${camp.color || '#ccc'}"></span>
            <span class="drag-name">${camp.name}</span>
        `;
        
        div.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', camp.id);
            e.dataTransfer.effectAllowed = 'copy';
            div.style.opacity = '0.5';
        });
        
        div.addEventListener('dragend', () => {
            div.style.opacity = '1';
        });

        container.appendChild(div);
    });
    
    if (campaigns.length === 0) {
        container.innerHTML = '<div style="color:#888; text-align:center; padding:10px;">No campaigns found.</div>';
    }
}

async function assignCampaignToPolygon(polygon, campaignId) {
    if (!auth.currentUser) return;
    
    polygon.campaignId = campaignId;
    updateShapeColor(polygon);
    
    const originalStroke = polygon.get('strokeWeight');
    polygon.setOptions({ strokeWeight: 4, strokeColor: '#00ff00' });
    setTimeout(() => polygon.setOptions({ strokeWeight: originalStroke, strokeColor: '#000000' }), 600);
    
    try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'polygons', polygon.firebaseId);
        await updateDoc(docRef, { campaignId: campaignId });
        console.log(`Assigned campaign ${campaignId} to polygon ${polygon.firebaseId}`);
    } catch (err) {
        console.error("Error assigning campaign:", err);
        alert("Failed to save assignment.");
    }
}

async function toggleHeatmap() {
    const btn = document.getElementById('heatmap-btn');
    const legend = document.getElementById('heatmap-legend');
    
    isHeatmapVisible = !isHeatmapVisible;

    if (isHeatmapVisible) {
        btn.classList.add('active');
        legend.style.display = 'flex';
        
        if (heatmapMarkers.length === 0) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
            await loadHeatmapData();
            btn.innerHTML = '<i class="fa-solid fa-layer-group"></i> Hide Demand';
        } else {
            heatmapMarkers.forEach(marker => marker.setMap(map));
            btn.innerHTML = '<i class="fa-solid fa-layer-group"></i> Hide Demand';
        }
    } else {
        btn.classList.remove('active');
        legend.style.display = 'none';
        btn.innerHTML = '<i class="fa-solid fa-layer-group"></i> Show Demand';
        heatmapMarkers.forEach(marker => marker.setMap(null));
    }
}

async function loadHeatmapData() {
    if (!auth.currentUser) return;
    try {
        let data = cachedData.activity;
        
        if (!data || data.length === 0) {
            const snapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'service_requests'));
            let rawChecks = [];
            snapshot.forEach(doc => rawChecks.push(doc.data()));
            data = getUniqueByAddress(rawChecks, 'address', 'checkedAt');
        }

        data.forEach(item => {
            if (item.location && item.location.lat && item.location.lng) {
                const isServiceable = item.isAvailable === true;
                
                const marker = new google.maps.Marker({
                    position: item.location,
                    map: map,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 6,
                        fillColor: isServiceable ? '#2ecc71' : '#e74c3c',
                        fillOpacity: 0.9,
                        strokeWeight: 1,
                        strokeColor: '#ffffff'
                    },
                    title: `${item.address} (${isServiceable ? 'Serviceable' : 'Unserviceable'})`,
                    zIndex: 10
                });
                
                const infoWindow = new google.maps.InfoWindow({
                    content: `<div style="color:black; font-family:sans-serif; padding:5px;">
                                <strong>${item.address}</strong><br>
                                Status: ${isServiceable ? '<span style="color:green; font-weight:bold;">Serviceable</span>' : '<span style="color:red; font-weight:bold;">Unserviceable</span>'}<br>
                                <small>${item.checkedAt ? new Date(item.checkedAt.toDate()).toLocaleDateString() : ''}</small>
                              </div>`
                });

                marker.addListener('click', () => {
                    infoWindow.open(map, marker);
                });

                heatmapMarkers.push(marker);
            }
        });

    } catch (e) {
        console.error("Error loading heatmap:", e);
        alert("Failed to load demand data.");
    }
}

function initSearchControl() {
    const controlDiv=document.createElement("div");
    controlDiv.style.marginTop="10px";
    controlDiv.style.display="flex";
    controlDiv.style.gap="5px";
    controlDiv.style.zIndex="5";
    const searchInput=document.createElement("input");
    searchInput.type="text";
    searchInput.placeholder="Search Address";
    searchInput.style.padding="8px";
    searchInput.style.borderRadius="4px";
    searchInput.style.border="1px solid #ccc";
    const searchBtn=document.createElement("button");
    searchBtn.textContent="Go";
    searchBtn.style.padding="8px 12px";
    searchBtn.style.cursor="pointer";
    controlDiv.appendChild(searchInput);
    controlDiv.appendChild(searchBtn);
    if(map) map.controls[google.maps.ControlPosition.TOP_CENTER].push(controlDiv);
    const geocoder=new google.maps.Geocoder();
    const performSearch=()=>{
        const address=searchInput.value;
        if(!address)return;
        geocoder.geocode({'address':address},function(results,status){
            if(status==='OK'){
                map.setCenter(results[0].geometry.location);
                map.setZoom(17);
                if(searchMarker) searchMarker.setMap(null);
                searchMarker=new google.maps.Marker({map:map,position:results[0].geometry.location});
            }
        });
    };
    searchBtn.addEventListener("click",performSearch);
}

async function savePolygonToDatabase(shape) {
    if(!auth.currentUser) return;
    const coordinates=getCoordinatesFromShape(shape);
    try {
        const docRef=await addDoc(collection(db,'artifacts',appId,'public','data','polygons'),{
            coordinates,type:'polygon',campaignId:shape.campaignId||"",createdAt:new Date()
        });
        return docRef.id;
    } catch(e) { console.error(e); }
}

async function updatePolygonInDatabase(id, shape) {
    if(!auth.currentUser||!id) return;
    const coordinates=getCoordinatesFromShape(shape);
    try {
        const docRef=doc(db,'artifacts',appId,'public','data','polygons',id);
        await updateDoc(docRef,{coordinates,campaignId:shape.campaignId||""});
    } catch(e) { console.error(e); }
}

async function loadPolygonsFromDatabase() {
    if(!auth.currentUser) return;
    try {
        const querySnapshot=await getDocs(collection(db,'artifacts',appId,'public','data','polygons'));
        querySnapshot.forEach((doc)=>{
            const data=doc.data();
            if(data.type==='polygon'&&data.coordinates){
                const newPolygon=new google.maps.Polygon({
                    paths:data.coordinates,fillOpacity:0.5,strokeWeight:2,clickable:true,editable:isUserAdmin,zIndex:1
                });
                newPolygon.type='polygon';
                newPolygon.firebaseId=doc.id;
                newPolygon.campaignId=data.campaignId||"";
                updateShapeColor(newPolygon);
                newPolygon.setMap(map);
                allShapes.push(newPolygon);
                if(isUserAdmin){
                    attachPolygonListeners(newPolygon);
                    google.maps.event.addListener(newPolygon,'click',function(){setSelection(newPolygon);});
                }
            }
        });
    } catch(e) { console.error(e); }
}

function updateShapeColor(shape) {
    let color='#ffff00';
    if(shape.campaignId){
        const campaign=campaigns.find(c=>c.id===shape.campaignId);
        if(campaign&&campaign.color){color=campaign.color;}
    }
    shape.setOptions({fillColor:color});
}

function refreshMapColors() {
    allShapes.forEach(shape=>updateShapeColor(shape));
}

async function deletePolygonFromDatabase(id) {
    if(!auth.currentUser||!id) return;
    try {
        await deleteDoc(doc(db,'artifacts',appId,'public','data','polygons',id));
    } catch(e) { console.error(e); }
}

function getCoordinatesFromShape(shape) {
    const path=shape.getPath();
    const coordinates=[];
    for(let i=0;i<path.getLength();i++){
        const xy=path.getAt(i);
        coordinates.push({lat:xy.lat(),lng:xy.lng()});
    }
    return coordinates;
}

function attachPolygonListeners(polygon) {
    if(!isUserAdmin) return;
    const path=polygon.getPath();
    const triggerUpdate=()=>{
        if(polygon.firebaseId) updatePolygonInDatabase(polygon.firebaseId,polygon);
    };
    google.maps.event.addListener(path,'set_at',triggerUpdate);
    google.maps.event.addListener(path,'insert_at',triggerUpdate);
    google.maps.event.addListener(path,'remove_at',triggerUpdate);
    google.maps.event.addListener(polygon,'dragend',triggerUpdate);
}

function loadPolygonsFromGeoJSON(geoJson) {
    if(!geoJson.features) return;
    geoJson.features.forEach(feature=>{
        if(feature.geometry&&feature.geometry.type==="Polygon"){
            const coords=feature.geometry.coordinates[0].map(coord=>({lat:coord[1],lng:coord[0]}));
            const newPolygon=new google.maps.Polygon({
                paths:coords,fillColor:'#ffff00',fillOpacity:0.5,strokeWeight:2,clickable:true,editable:isUserAdmin,zIndex:1
            });
            newPolygon.setMap(map);
            newPolygon.type='polygon';
            savePolygonToDatabase(newPolygon).then(id=>{
                newPolygon.firebaseId=id;
                allShapes.push(newPolygon);
                attachPolygonListeners(newPolygon);
            });
            if(isUserAdmin){
                google.maps.event.addListener(newPolygon,'click',function(){setSelection(newPolygon);});
            }
        }
    });
}

function setSelection(shape) {
    if(!isUserAdmin) return;
    clearSelection();
    selectedShape=shape;
    shape.setEditable(true);
    shape.setOptions({strokeColor:'#FF0000'});
    const wrapper=document.getElementById('campaign-selector-wrapper');
    const select=document.getElementById('campaign-select');
    if(wrapper&&select){
        wrapper.style.display='flex';
        select.value=shape.campaignId||"";
    }
}

function clearSelection() {
    if(selectedShape){
        selectedShape.setEditable(false);
        selectedShape.setOptions({strokeColor:'#000000'});
        selectedShape=null;
    }
    const wrapper=document.getElementById('campaign-selector-wrapper');
    if(wrapper) wrapper.style.display='none';
}

function deleteSelectedShape() {
    if(selectedShape&&isUserAdmin){
        if(selectedShape.firebaseId) deletePolygonFromDatabase(selectedShape.firebaseId);
        selectedShape.setMap(null);
        const index=allShapes.indexOf(selectedShape);
        if(index>-1) allShapes.splice(index,1);
        selectedShape=null;
        const wrapper=document.getElementById('campaign-selector-wrapper');
        if(wrapper) wrapper.style.display='none';
    }
}

function exporttoJSON() {
    const features=[];
    allShapes.forEach(shape=>{
        if(shape.type==='polygon'){
            const path=shape.getPath();
            const coordinates=[];
            for(let i=0;i<path.getLength();i++){
                const xy=path.getAt(i);
                coordinates.push([xy.lng(),xy.lat()]);
            }
            if(coordinates.length>0) coordinates.push(coordinates[0]);
            features.push({
                "type":"Feature",
                "properties":{campaignId:shape.campaignId||""},
                "geometry":{"type":"Polygon","coordinates":[coordinates]}
            });
        }
    });
    const geoJsonData={"type":"FeatureCollection","features":features};
    const dataStr="data:text/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(geoJsonData));
    const dl=document.createElement('a');
    dl.setAttribute("href",dataStr);
    dl.setAttribute("download","polygons.json");
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
}

// Global functions for inline HTML calls (Assigned last to ensure definition exists)
window.openCampaignModal = openCampaignModal;
window.switchTableView = switchTableView;
window.moveRowUp = moveRowUp;
window.moveRowDown = moveRowDown;
window.togglePromo = togglePromo;
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
            addPlanRow(
                name, 
                details.price, 
                details.speed, 
                details.isPopular, 
                details.promoPrice, 
                details.promoLabel, 
                details.promoEnd, 
                details.stickers,
                details.description
            );
        });
    }
};