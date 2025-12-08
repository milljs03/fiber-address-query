import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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

const EMAIL_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbylC4OXreb74IxO0cmfpTHdFKjCJy1_TOiJfi3GRm6UoEdLhVquw8rbMGKb3fJc4xDW/exec"; 

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
async function initAuth() { try { await signInAnonymously(auth); } catch (e) { console.warn(e); } }
initAuth();

// --- LOGIC ---
document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const address = params.get('address');
    const planKey = params.get('plan');
    const campaignId = params.get('campaign');

    try {
        const defaultDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', 'global_default'));
        if (defaultDoc.exists() && defaultDoc.data().plans) PLAN_DATA = defaultDoc.data().plans;
    } catch (e) { console.error(e); }

    if (campaignId) {
        try {
            const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', campaignId));
            if (snap.exists() && snap.data().plans) PLAN_DATA = snap.data().plans;
        } catch (e) { console.error(e); }
    }

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

    // -- PROMO LOGIC FOR SUMMARY --
    const hasPromo = !!plan.promoPrice;
    let priceHtml = '';
    if (hasPromo) {
        priceHtml = `
            <div style="text-decoration: line-through; color: #999; font-size: 1.2rem;">${plan.price}</div>
            <span class="price" style="color: #dc2626;">${plan.promoPrice}<small>/mo</small></span>
            <div style="font-weight: bold; color: #dc2626; margin-bottom: 10px;">${plan.promoLabel || 'Special Offer'}</div>
        `;
    } else {
        priceHtml = `<span class="price">${plan.price}<small>/mo</small></span>`;
    }

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
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const phone = document.getElementById('phone').value;
    const address = document.getElementById('address').value;
    const plan = document.getElementById('selected-plan').value;
    const btn = document.getElementById('submit-btn');

    if (typeof grecaptcha !== 'undefined' && grecaptcha.getResponse) {
        if (grecaptcha.getResponse().length === 0) {
            alert("Please verify that you are not a robot.");
            return;
        }
    }

    btn.disabled = true;
    btn.textContent = "Processing...";

    try {
        const userId = auth.currentUser ? auth.currentUser.uid : 'anonymous_order';
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'orders'), {
            type: 'new_service_order',
            name, email, phone, address, plan,
            submittedAt: new Date(),
            uid: userId,
            status: 'pending'
        });
        
        // Notify
        await sendNotificationEmail({ name, email, phone, address, plan, timestamp: new Date() });

        alert("Order submitted successfully! We will contact you shortly.");
        window.location.href = 'query.html'; 
    } catch (error) {
        console.error("Error submitting order:", error);
        alert("Error processing order. Please try again.");
        btn.disabled = false;
        btn.textContent = "Complete Order";
    }
}

async function sendNotificationEmail(data) {
    try {
        await fetch(EMAIL_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                to: "jmiller@nptel.com", 
                subject: `New Fiber Sign-Up: ${data.name}`,
                htmlBody: `<h2>New Service Order</h2><p>Name: ${data.name}</p><p>Plan: ${data.plan}</p><p>Address: ${data.address}</p>`
            })
        });
    } catch (e) { console.error("Failed to send email:", e); }
}