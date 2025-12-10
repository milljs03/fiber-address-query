import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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

// Auth Init
const initAuth = async () => {
    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
    } else {
        await signInAnonymously(auth);
    }
};

initAuth();

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loadOrders();
    }
});

document.getElementById('refresh-btn').addEventListener('click', loadOrders);
document.querySelectorAll('input[name="filter"]').forEach(r => {
    r.addEventListener('change', renderList);
});

// Load Data
async function loadOrders() {
    const listDiv = document.getElementById('orders-list');
    const loadingDiv = document.getElementById('loading-msg');
    
    loadingDiv.style.display = 'block';
    listDiv.innerHTML = '';
    
    try {
        // Retrieve all orders (filtering done client side for flexibility)
        const q = collection(db, 'artifacts', appId, 'public', 'data', 'office_signups');
        const snap = await getDocs(q);
        
        allOrders = [];
        snap.forEach(doc => {
            allOrders.push({ id: doc.id, ...doc.data() });
        });

        // Sort by date manually since we didn't use orderBy in query (Rule 2)
        allOrders.sort((a, b) => {
            const da = a.createdAt ? a.createdAt.seconds : 0;
            const db = b.createdAt ? b.createdAt.seconds : 0;
            return db - da; // Descending
        });

        renderList();
    } catch (e) {
        console.error(e);
        listDiv.innerHTML = '<div style="color:red">Error loading orders.</div>';
    } finally {
        loadingDiv.style.display = 'none';
    }
}

function renderList() {
    const filter = document.querySelector('input[name="filter"]:checked').value;
    const listDiv = document.getElementById('orders-list');
    listDiv.innerHTML = '';

    const filtered = allOrders.filter(o => {
        if (filter === 'mine' && currentUser) {
            return o.createdById === currentUser.uid;
        }
        return true;
    });

    if (filtered.length === 0) {
        listDiv.innerHTML = '<div style="padding:20px; color:#666;">No orders found.</div>';
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
                    <i class="fa-solid fa-user-pen"></i> ${order.createdBy}
                </div>
            </div>
            <div style="text-align:right;">
                <div class="order-price">${order.plan.price}</div>
                <div style="font-size:0.8rem;">${order.plan.originalPlanName}</div>
            </div>
        `;
        card.addEventListener('click', () => openDetail(order));
        listDiv.appendChild(card);
    });
}

// Global functions for modal
window.closeModal = () => {
    document.getElementById('detail-modal').style.display = 'none';
};

function openDetail(order) {
    const reportDiv = document.getElementById('report-view');
    const now = new Date();
    const created = order.createdAt ? new Date(order.createdAt.seconds * 1000) : now;
    
    // Stickers
    let stickerHtml = '';
    if (order.plan.stickers) {
        stickerHtml = `<br><strong>Perks/Stickers:</strong> ${order.plan.stickers}`;
    }

    // Generate HTML (Report format)
    const html = `
        <div class="report-header">
            <div>
                <strong>NPTECH SERVICE ORDER REPORT</strong><br>
                <span>${created.toLocaleString()}</span>
            </div>
            <div style="text-align:right;">
                PAGE 1
            </div>
        </div>

        <div style="display:flex; gap: 40px; margin-bottom: 20px;">
            <div>
                <strong>Service Order:</strong> ${order.id.substr(0,8).toUpperCase()}<br>
                <strong>Customer:</strong> ${order.customer.mobile.replace(/\D/g,'').substr(-5)}
            </div>
            <div>
                <strong>SO Status:</strong> ${order.status}<br>
                <strong>Entry Date:</strong> ${created.toLocaleDateString()}<br>
                <strong>Taken By:</strong> ${order.createdBy.split('@')[0]}
            </div>
        </div>

        <div class="report-section">
            <div style="display:flex; justify-content: space-between;">
                <div style="width: 45%;">
                    <strong>*** Name-Address Info ***</strong><br>
                    ${order.customer.name.toUpperCase()}<br>
                    ${order.customer.address.toUpperCase()}<br>
                    <br>
                    <strong>Res/Bus:</strong> Residence<br>
                    <strong>Email:</strong> ${order.customer.email}
                </div>
                <div style="width: 45%;">
                     <strong>Requested By:</strong> ${order.customer.name.toUpperCase()}<br>
                     <strong>Contact:</strong> ${order.customer.mobile}
                </div>
            </div>
        </div>

        <div class="report-section" style="border: 1px dashed #000; padding: 10px;">
            <strong>Service Remark:</strong><br>
            CONNECT ${order.plan.speed} MEG FTTH SVC<br>
            PLAN: ${order.plan.selectedTier}<br><br>
            <strong>Request:</strong><br>
            ${order.plan.price}/MONTH<br>
            $25.00/ACTIVATION CHARGE<br>
            SURVEY CONTACT: ${order.surveyContact.toUpperCase()}
            ${stickerHtml}
        </div>

        <div class="report-section">
            <strong>Contact Method</strong>
            <table class="report-table">
                <thead>
                    <tr>
                        <th>Contact Type</th>
                        <th>Contact Info</th>
                        <th>Name</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>CELL</td><td>${order.customer.mobile}</td><td>${order.customer.name}</td></tr>
                    <tr><td>EMAIL</td><td>${order.customer.email}</td><td>${order.customer.name}</td></tr>
                    ${order.customer.joint.name ? `<tr><td>JOINT</td><td>${order.customer.joint.mobile || ''}</td><td>${order.customer.joint.name}</td></tr>` : ''}
                </tbody>
            </table>
        </div>
        
        <div class="report-section">
             <strong>Internal Data (Plan Snapshot)</strong>
             <p style="font-size:0.8rem; color:#666;">
                Promo Label: ${order.plan.promoLabel || 'None'}<br>
                Promo End: ${order.plan.promoEnd || 'N/A'}
             </p>
        </div>
    `;

    reportDiv.innerHTML = html;
    document.getElementById('detail-modal').style.display = 'flex';
}