import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
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

// --- SETTINGS ---
// This is the URL of your deployed Cloud Function
const FUNCTION_URL = "https://us-central1-fiber-service-query.cloudfunctions.net/createOrderSecure";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nptel-map-portal';

let PLAN_DATA = {
    "Standard": { price: "$65", speed: "200 Mbps" },
    "Advanced": { price: "$80", speed: "500 Mbps" },
    "Premium": { price: "$89", speed: "1 Gbps", isPopular: true }
};

// --- AUTH ---
// IMPORTANT: You MUST enable "Anonymous" sign-in in Firebase Console -> Authentication
async function initAuth() { 
    try { 
        await signInAnonymously(auth); 
    } catch (e) { 
        console.warn("Auth Warning (Enable Anonymous Auth in Console):", e.message); 
    } 
}
initAuth();

// --- LOGIC ---
document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const address = params.get('address');
    const planKey = params.get('plan');
    const campaignId = params.get('campaign');

    // 1. Load Global Defaults
    try {
        const defaultDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', 'global_default'));
        if (defaultDoc.exists() && defaultDoc.data().plans) PLAN_DATA = defaultDoc.data().plans;
    } catch (e) { console.error("Error loading defaults:", e); }

    // 2. Load Campaign Overrides
    if (campaignId) {
        try {
            const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', campaignId));
            if (snap.exists() && snap.data().plans) PLAN_DATA = snap.data().plans;
        } catch (e) { console.error("Error loading campaign:", e); }
    }

    // 3. Populate Fields
    if (address) document.getElementById('address').value = decodeURIComponent(address);
    
    if (planKey) {
        document.getElementById('selected-plan').value = decodeURIComponent(planKey);
        renderPlanSummary(planKey);
    } else {
        document.getElementById('plan-card-container').innerHTML = "<p>No plan selected.</p>";
    }

    const orderForm = document.getElementById('orderForm');
    if (orderForm) orderForm.addEventListener('submit', handleOrderSubmit);
});

function renderPlanSummary(planKey) {
    const container = document.getElementById('plan-card-container');
    const plan = PLAN_DATA[planKey];

    if (!plan) {
        container.innerHTML = `<p>Details for plan "${planKey}" not found.</p>`;
        return;
    }

    const isPopular = (typeof plan.isPopular !== 'undefined') ? plan.isPopular : false;
    const popularClass = isPopular ? 'popular' : '';
    const popularBadge = isPopular ? '<div class="popular-badge">Most Popular</div>' : '';

    const hasPromo = !!plan.promoPrice;
    let priceHtml = hasPromo ? 
        `<div style="text-decoration: line-through; color: #999; font-size: 1.2rem;">${plan.price}</div>
         <span class="price" style="color: #dc2626;">${plan.promoPrice}<small>/mo</small></span>
         <div style="font-weight: bold; color: #dc2626; margin-bottom: 10px;">${plan.promoLabel || 'Special Offer'}</div>` : 
        `<span class="price">${plan.price}<small>/mo</small></span>`;

    const html = `
        <div class="pricing-box ${popularClass}" style="max-width: 100%;">
            ${popularBadge}
            <div class="panel-heading">${planKey}</div>
            <div class="panel-body">
                ${priceHtml}
                <div class="speed-features">${plan.speed}</div>
                <div class="speed-capability">Download & Upload</div>
                <div class="core-benefits">
                    <span class="highlight-text">Local Service</span>
                    <span class="highlight-text">Lifetime Price Lock</span>
                </div>
            </div>
        </div>
    `;
    container.innerHTML = html;
}

async function handleOrderSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    
    // --- PREPARE PLAN DETAILS FOR EMAIL ---
    const planKey = document.getElementById('selected-plan').value;
    const planData = PLAN_DATA[planKey] || {};
    
    let planDetails = planKey;
    const extraDetails = [];

    // Add stickers/perks
    if (planData.stickers) {
        extraDetails.push(planData.stickers);
    }

    // Add price (Use promo price if available)
    const effectivePrice = planData.promoPrice || planData.price;
    if (effectivePrice) {
        extraDetails.push(`${effectivePrice}/mo`);
    }

    // Combine into "Plan - Sticker, Sticker, Price"
    if (extraDetails.length > 0) {
        planDetails += ` - ${extraDetails.join(', ')}`;
    }
    // -------------------------------------

    const orderDetails = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        address: document.getElementById('address').value,
        plan: planKey,           // Original concise plan name for analytics
        planDetails: planDetails, // Detailed string for email notification
        uid: auth.currentUser ? auth.currentUser.uid : 'anon'
    };

    if (typeof grecaptcha === 'undefined') {
        alert("Security check failed to load. Please refresh the page.");
        return;
    }
    
    const captchaToken = grecaptcha.getResponse();
    if (captchaToken.length === 0) {
        alert("Please verify that you are not a robot.");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Securing Order...";

    try {
        // --- USE STANDARD FETCH ---
        const response = await fetch(FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderDetails, captchaToken })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            alert("Order submitted successfully! We will contact you shortly.");
            window.location.href = 'query.html'; 
        } else {
            throw new Error(result.error || "Submission rejected by server.");
        }
    } catch (error) {
        console.error("Order Failed:", error);
        alert("Submission failed: " + error.message);
        btn.disabled = false;
        btn.textContent = "Complete Order";
        grecaptcha.reset(); 
    }
}