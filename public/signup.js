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
const FUNCTION_URL = "https://us-central1-fiber-service-query.cloudfunctions.net/createOrderSecure";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nptel-map-portal';

let PLAN_DATA = {
    "Standard": { price: "$65", speed: "200 Mbps" },
    "Advanced": { price: "$80", speed: "500 Mbps" },
    "Premium": { price: "$89", speed: "1 Gbps", isPopular: true, freeInstall: true, freeRouter: true } 
};

// --- AUTH ---
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
        renderPlanInForm(planKey);  // Render section 2
        updateOrderSummary();       // Render sidebar (Initial)
    } else {
        const noPlanMsg = "<p>No plan selected.</p>";
        document.getElementById('plan-card-container').innerHTML = noPlanMsg;
        document.getElementById('selected-plan-display').innerHTML = noPlanMsg;
    }

    // 4. Setup Add-on Logic
    setupAddonInteractions();

    const orderForm = document.getElementById('orderForm');
    if (orderForm) orderForm.addEventListener('submit', handleOrderSubmit);
});

function renderPlanInForm(planKey) {
    const container = document.getElementById('selected-plan-display');
    const plan = PLAN_DATA[planKey];
    
    if (!plan) return;

    const priceDisplay = plan.promoPrice ? 
        `<span style="text-decoration: line-through; color: #999; font-size: 1.2rem; margin-right: 10px;">${plan.price}</span> 
         <span style="color: #dc2626;">${plan.promoPrice}<small>/mo</small></span>` : 
        `<span>${plan.price}<small>/mo</small></span>`;

    let stickersHtml = '';
    if (plan.stickers) {
        const stickersList = Array.isArray(plan.stickers) ? plan.stickers : [plan.stickers];
        if (stickersList.length > 0) {
             stickersHtml = `<div class="plan-stickers-row">`;
             stickersList.forEach(sticker => {
                 stickersHtml += `<div class="sticker-badge"><i class="fa-solid fa-check"></i> ${sticker}</div>`;
             });
             stickersHtml += `</div>`;
        }
    }

    container.innerHTML = `
        <div class="plan-display-info">
            <h4>${planKey} Internet</h4>
            <div class="plan-display-speed"><i class="fa-solid fa-gauge-high"></i> ${plan.speed} Download & Upload</div>
            ${stickersHtml}
        </div>
        <div class="plan-display-price">
            ${priceDisplay}
        </div>
    `;
}

function setupAddonInteractions() {
    const phoneCheckbox = document.getElementById('addon-phone');
    const longDistanceCard = document.getElementById('card-long-distance');
    const longDistanceCheckbox = document.getElementById('addon-long-distance');
    const routerCheckbox = document.getElementById('addon-router');

    const update = () => updateOrderSummary();

    if (phoneCheckbox && longDistanceCard) {
        phoneCheckbox.addEventListener('change', () => {
            if (phoneCheckbox.checked) {
                longDistanceCard.classList.add('visible');
            } else {
                longDistanceCard.classList.remove('visible');
                if (longDistanceCheckbox) longDistanceCheckbox.checked = false;
            }
            update();
        });
    }

    if (longDistanceCheckbox) longDistanceCheckbox.addEventListener('change', update);
    if (routerCheckbox) routerCheckbox.addEventListener('change', update);
}

function updateOrderSummary() {
    const planKey = document.getElementById('selected-plan').value;
    const container = document.getElementById('plan-card-container');
    const plan = PLAN_DATA[planKey];

    if (!plan) {
        container.innerHTML = `<p>Details for plan "${planKey}" not found.</p>`;
        return;
    }

    // --- CHECK STICKERS FOR WAIVED FEES ---
    let isFreeInstall = !!plan.freeInstall;
    let isFreeRouter = !!plan.freeRouter;

    if (plan.stickers) {
        const stickersList = Array.isArray(plan.stickers) ? plan.stickers : [plan.stickers];
        const lowerStickers = stickersList.map(s => s.toLowerCase());
        
        if (lowerStickers.some(s => s.includes('free install') || s.includes('no install fee'))) {
            isFreeInstall = true;
        }
        
        if (lowerStickers.some(s => s.includes('free router') || s.includes('free equipment') || s.includes('no equipment fee') || s.includes('no router fee'))) {
            isFreeRouter = true;
        }
    }
    // -------------------------------------

    // 1. Build Plan Card
    const isPopular = (typeof plan.isPopular !== 'undefined') ? plan.isPopular : false;
    const popularClass = isPopular ? 'popular' : '';
    const popularBadge = isPopular ? '<div class="popular-badge">Most Popular</div>' : '';

    const hasPromo = !!plan.promoPrice;
    let priceHtml = hasPromo ? 
        `<div style="text-decoration: line-through; color: #999; font-size: 1.2rem;">${plan.price}</div>
         <span class="price" style="color: #dc2626;">${plan.promoPrice}<small>/mo</small></span>
         <div style="font-weight: bold; color: #dc2626; margin-bottom: 10px;">${plan.promoLabel || 'Special Offer'}</div>` : 
        `<span class="price">${plan.price}<small>/mo</small></span>`;

    let stickersHtml = '';
    if (plan.stickers) {
        const stickersList = Array.isArray(plan.stickers) ? plan.stickers : [plan.stickers];
        if (stickersList.length > 0) {
             stickersHtml = `<div class="plan-stickers-row" style="justify-content: center; margin-bottom: 15px;">`;
             stickersList.forEach(sticker => {
                 stickersHtml += `<div class="sticker-badge"><i class="fa-solid fa-check"></i> ${sticker}</div>`;
             });
             stickersHtml += `</div>`;
        }
    }

    let html = `
        <div class="pricing-box ${popularClass}" style="max-width: 100%;">
            ${popularBadge}
            <div class="panel-heading">${planKey}</div>
            <div class="panel-body">
                ${priceHtml}
                ${stickersHtml}
                <div class="speed-features">${plan.speed}</div>
                <div class="speed-capability">Download & Upload</div>
                <div class="core-benefits">
                    <span class="highlight-text">Local Service</span>
                    <span class="highlight-text">No Contracts</span>
                    <span class="highlight-text">No Data Caps</span>
                </div>
            </div>
        </div>
    `;

    // 2. Build Fees Section (Secondary Box)
    html += `
        <div class="pricing-box secondary-box">
            <div class="panel-heading small-heading">One-time Fees</div>
            <div class="fee-rows-container">
    `;

    // Install Fee Logic
    const installFeeDisplay = isFreeInstall ? 
        `<div class="fee-price"><span class="crossed-text">$50 - $150</span> <span class="free-text">0.00 on us!</span></div>` : 
        `<div class="fee-price">$50 - $150*</div>`;
    
    html += `
        <div class="fee-row-item">
            <div class="fee-line">
                <div class="fee-item-header">
                    <div class="fee-icon"><i class="fa-solid fa-screwdriver-wrench"></i></div>
                    <span>Installation</span>
                </div>
                ${installFeeDisplay}
            </div>
            <div class="fee-note">*Distance house is from the road will determine install price.</div>
        </div>
    `;

    // Router Fee Logic
    const routerFeeDisplay = isFreeRouter ? 
        `<div class="fee-price"><span class="crossed-text">$99.00</span> <span class="free-text">0.00 on us!</span></div>` : 
        `<div class="fee-price">$99.00</div>`;

    html += `
        <div class="fee-row-item">
            <div class="fee-line">
                <div class="fee-item-header">
                    <div class="fee-icon"><img src="logos/Eero_(1).png" alt="Eero"></div>
                    <span>Eero 6+ Mesh Unit</span>
                </div>
                ${routerFeeDisplay}
            </div>
            <div class="fee-note">High-performance Wi-Fi 6 router.</div>
        </div>
    `;
    
    html += `</div></div>`; // Close fee container and box

    // 3. Build Add-ons Section (Secondary Box)
    const phoneChecked = document.getElementById('addon-phone')?.checked;
    const longDistanceChecked = document.getElementById('addon-long-distance')?.checked;
    const routerChecked = document.getElementById('addon-router')?.checked;

    if (phoneChecked || routerChecked) {
        html += `
            <div class="pricing-box secondary-box">
                <div class="panel-heading small-heading">Selected Add-ons</div>
                <div class="fee-rows-container">
        `;
        
        if (phoneChecked) {
            html += `
            <div class="fee-row-item">
                <div class="fee-line">
                    <div class="fee-item-header">
                        <div class="fee-icon"><i class="fa-solid fa-phone"></i></div>
                        <span>Home Phone</span>
                    </div>
                    <div class="fee-price">+$20.65<small>/mo</small></div>
                </div>
            </div>`;
            
            if (longDistanceChecked) {
                html += `
                <div class="fee-row-item">
                    <div class="fee-line">
                        <div class="fee-item-header">
                            <div class="fee-icon"><i class="fa-solid fa-earth-americas"></i></div>
                            <span>Unltd. Long Distance</span>
                        </div>
                        <div class="fee-price">+$4.95<small>/mo</small></div>
                    </div>
                </div>`;
            }
        }

        if (routerChecked) {
            html += `
            <div class="fee-row-item">
                <div class="fee-line">
                    <div class="fee-item-header">
                        <div class="fee-icon"><i class="fa-solid fa-wifi"></i></div>
                        <span>Extra Mesh Router</span>
                    </div>
                    <div class="fee-price">+$99.00</div>
                </div>
            </div>`;
        }

        html += `</div></div>`; // Close addon container and box
    }

    container.innerHTML = html;
}

// ... rest of handleOrderSubmit ...
async function handleOrderSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    
    const planKey = document.getElementById('selected-plan').value;
    const planData = PLAN_DATA[planKey] || {};
    
    let planDetails = planKey;
    const extraDetails = [];

    if (planData.stickers) { extraDetails.push(planData.stickers); }

    const effectivePrice = planData.promoPrice || planData.price;
    if (effectivePrice) { extraDetails.push(`${effectivePrice}/mo`); }

    if (extraDetails.length > 0) { planDetails += ` - ${extraDetails.join(', ')}`; }
    
    const addOns = [];
    
    const phoneChecked = document.getElementById('addon-phone')?.checked;
    const longDistanceChecked = document.getElementById('addon-long-distance')?.checked;
    const routerChecked = document.getElementById('addon-router')?.checked;

    if (phoneChecked) {
        let phoneText = "Home Phone Service ($20.65/mo)";
        if (longDistanceChecked) {
            phoneText += " + Unlimited Long Distance ($4.95/mo)";
        }
        addOns.push(phoneText);
    }

    if (routerChecked) {
        addOns.push("Extra Mesh Router ($99.00 one-time fee)");
    }

    const specialRequests = document.getElementById('special-requests')?.value || "";

    const orderDetails = {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        address: document.getElementById('address').value,
        plan: planKey,
        planDetails: planDetails, 
        addOns: addOns,              
        specialRequests: specialRequests, 
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