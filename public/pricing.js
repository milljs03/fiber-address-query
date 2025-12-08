import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nptel-map-portal';

// Hard fallback only if DB fails
const FALLBACK_PLANS = {
    "Standard": { price: "$65", speed: "200 Mbps" },
    "Advanced": { price: "$80", speed: "500 Mbps" },
    "Premium": { price: "$89", speed: "1 Gbps", isPopular: true }
};

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const address = params.get('address');
    const campaignId = params.get('campaign');
    
    // Display Address
    const addressDisplay = document.getElementById('display-address');
    if (address && addressDisplay) addressDisplay.textContent = address;

    // 1. Fetch Global Defaults First
    let plansToShow = FALLBACK_PLANS;
    try {
        const defaultDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', 'global_default'));
        if (defaultDoc.exists() && defaultDoc.data().plans) {
            plansToShow = defaultDoc.data().plans;
            console.log("Loaded global defaults");
        }
    } catch (e) { console.error("Error loading defaults:", e); }

    // 2. Fetch Campaign Override (Priority)
    if (campaignId) {
        try {
            const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', campaignId));
            if (snap.exists() && snap.data().plans) {
                plansToShow = snap.data().plans;
                console.log("Loaded campaign:", snap.data().name);
            }
        } catch (e) { console.error("Error loading campaign:", e); }
    }

    // 3. Render
    renderPlans(plansToShow, address, campaignId);
});

function renderPlans(plans, address, campaignId) {
    const container = document.querySelector('.pricing-container');
    container.innerHTML = '';
    const planKeys = Object.keys(plans);
    
    planKeys.forEach((key, index) => {
        const plan = plans[key];
        // Use explicit isPopular flag if present, else heuristic
        const isPopular = (typeof plan.isPopular !== 'undefined') ? plan.isPopular : (index === planKeys.length - 1);
        
        const popularClass = isPopular ? 'popular' : '';
        const popularBadge = isPopular ? '<div class="popular-badge">Most Popular</div>' : '';

        const cardHtml = `
            <div class="pricing-box ${popularClass}" data-plan="${key}">
                ${popularBadge}
                <div class="panel-heading">${key}</div>
                <div class="panel-body">
                    <span class="price">${plan.price}<small>/mo</small></span>
                    <div class="speed-features">${plan.speed}</div>
                    <div class="speed-capability">Download & Upload</div>
                    <div class="core-benefits">
                        <span class="highlight-text">Local Service</span>
                        <span class="highlight-text">Lifetime Price Lock</span>
                    </div>
                    <button class="sign-up-btn">Select Plan</button>
                    <!-- Broadband Facts -->
                    <div class="broadband-label-container">
                        <div class="broadband-facts-wrapper collapsed">
                            <div class="sneak-peek-overlay">
                                <button class="expand-label-btn"><i class="fa-solid fa-chevron-down"></i> Details</button>
                            </div>
                            <div class="bbf-header">
                                <h3 class="bbf-title">Broadband Facts</h3>
                                <p class="bbf-plan">${key}</p>
                            </div>
                            <div class="bbf-row"><span>Price</span><span class="bbf-val">${plan.price}</span></div>
                            <div class="bbf-row"><span>Speed</span><span class="bbf-val">${plan.speed}</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', cardHtml);
    });

    bindEvents(address, campaignId);
}

function bindEvents(address, campaignId) {
    document.querySelectorAll('.sign-up-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const planBox = e.target.closest('.pricing-box');
            const plan = planBox.dataset.plan;
            let url = `signup.html?plan=${encodeURIComponent(plan)}`;
            if (address) url += `&address=${encodeURIComponent(address)}`;
            if (campaignId) url += `&campaign=${encodeURIComponent(campaignId)}`;
            window.location.href = url;
        });
    });
    document.querySelectorAll('.expand-label-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const wrapper = e.target.closest('.sneak-peek-overlay').parentElement;
            if (wrapper) { wrapper.classList.remove('collapsed'); wrapper.classList.add('expanded'); }
        });
    });
}