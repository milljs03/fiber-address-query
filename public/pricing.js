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

// Hard fallback
const FALLBACK_PLANS = {
    "Standard": { price: "$65", speed: "200 Mbps" },
    "Advanced": { price: "$80", speed: "500 Mbps" },
    "Premium": { price: "$89", speed: "1 Gbps", isPopular: true }
};

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const address = params.get('address');
    const campaignId = params.get('campaign');
    
    const addressDisplay = document.getElementById('display-address');
    if (address && addressDisplay) addressDisplay.textContent = address;

    let plansToShow = FALLBACK_PLANS;
    let campaignName = "Standard"; // Default name
    
    // 1. Load Defaults
    try {
        const defaultDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', 'global_default'));
        if (defaultDoc.exists() && defaultDoc.data().plans) {
            plansToShow = defaultDoc.data().plans;
        }
    } catch (e) { console.error("Error loading defaults:", e); }

    // 2. Load Campaign Override
    if (campaignId) {
        try {
            const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', campaignId));
            if (snap.exists() && snap.data().plans) {
                plansToShow = snap.data().plans;
                campaignName = snap.data().name || "Special Offer"; // Capture campaign name for label title
            }
        } catch (e) { console.error("Error loading campaign:", e); }
    }

    renderPlans(plansToShow, address, campaignId, campaignName);
});

function renderPlans(plans, address, campaignId, campaignName) {
    const container = document.querySelector('.pricing-container');
    container.innerHTML = '';
    
    // Sort logic
    const planArray = Object.entries(plans).map(([key, val]) => ({ name: key, ...val }));
    planArray.sort((a, b) => {
        const pA = parseFloat((a.promoPrice || a.price).replace(/[^0-9.]/g, '')) || 0;
        const pB = parseFloat((b.promoPrice || b.price).replace(/[^0-9.]/g, '')) || 0;
        return pA - pB;
    });
    
    planArray.forEach((plan, index) => {
        const key = plan.name;
        const isPopular = (typeof plan.isPopular !== 'undefined') ? plan.isPopular : (index === planArray.length - 1);
        
        const popularClass = isPopular ? 'popular' : '';
        const popularBadge = isPopular ? '<div class="popular-badge">Most Popular</div>' : '';

        // -- PROMO LOGIC --
        const hasPromo = !!plan.promoPrice;
        let priceHtml = '';
        let badgeHtml = '';
        let expiryHtml = '';
        
        // Define price variables for Label
        // If promo is active, the "Monthly Price" is the promo price.
        // The "Price After" is the regular price.
        const labelMonthlyPrice = hasPromo ? plan.promoPrice : plan.price;
        const labelRegularPrice = plan.price; 
        
        if (hasPromo) {
            priceHtml = `
                <span class="old-price">${plan.price}</span>
                <span class="price promo-price">${plan.promoPrice}<small>/mo</small></span>
            `;
            if (plan.promoLabel) {
                badgeHtml = `<div class="promo-tag">${plan.promoLabel}</div>`;
            }
            if (plan.promoEnd) {
                const d = new Date(plan.promoEnd);
                if (!isNaN(d.getTime())) {
                    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    expiryHtml = `<div class="promo-end-date">Ends ${dateStr}</div>`;
                }
            }
        } else {
            priceHtml = `<span class="price">${plan.price}<small>/mo</small></span>`;
        }

        const cardHtml = `
            <div class="pricing-box ${popularClass}" data-plan="${key}">
                ${popularBadge}
                <div class="panel-heading">${key}</div>
                <div class="panel-body">
                    <div class="price-wrapper">
                        ${badgeHtml}
                        ${priceHtml}
                        ${expiryHtml}
                    </div>
                    <div class="speed-features">${plan.speed}</div>
                    <div class="speed-capability">Download & Upload</div>
                    <div class="core-benefits">
                        <span class="highlight-text">Local Service</span>
                        <span class="highlight-text">Lifetime Price Lock</span>
                    </div>
                    <button class="sign-up-btn">Select Plan</button>
                    
                    <!-- Broadband Facts (Exact Layout Replication) -->
                    <div class="broadband-label-container" style="border: 3px solid black; font-family: Helvetica, Arial, sans-serif; color: black; background: white; margin-top: 20px;">
                        <div class="broadband-facts-wrapper collapsed">
                            <div class="sneak-peek-overlay">
                                <button class="expand-label-btn"><i class="fa-solid fa-chevron-down"></i> Show Full Details</button>
                            </div>

                            <div style="border-bottom: 5px solid black; padding: 10px 15px;">
                                <h3 style="font-weight: 900; font-size: 28px; margin: 0; text-transform: uppercase;">Broadband Facts</h3>
                            </div>
                            
                            <div style="padding: 10px 15px; border-bottom: 1px solid #ccc;">
                                <p style="font-weight: bold; margin: 0; font-size: 16px;">Community Fiber Network</p>
                                <p style="margin: 3px 0 0 0; font-size: 16px;">${key} Plan</p>
                                <p style="margin: 3px 0 0 0; font-size: 14px;">Fixed Broadband Consumer Disclosure</p>
                            </div>

                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding: 10px 15px;">
                                <span style="font-weight: bold;">Monthly Price</span>
                                <span style="font-weight: bold; font-size: 18px;">${labelMonthlyPrice}</span>
                            </div>
                            
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding: 10px 15px;">
                                <span style="padding-left: 10px;">This monthly price is an introductory rate</span>
                                <span style="font-weight: bold;">No</span>
                            </div>
                            
                            ${hasPromo ? `
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding: 10px 15px;">
                                <span style="padding-left: 20px; font-style: italic;">Time the introductory rate applies</span>
                                <span style="font-weight: bold;">n/a</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding: 10px 15px;">
                                <span style="padding-left: 20px; font-style: italic;">Monthly price after the introductory rate</span>
                                <span style="font-weight: bold;">n/a</span>
                            </div>
                            ` : ''}

                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid black; padding: 10px 15px;">
                                <span style="font-weight: bold;">Length of Contract</span>
                                <span style="font-weight: bold;">None</span>
                            </div>

                            <div style="background-color: #f0f0f0; font-weight: bold; padding: 8px 15px; border-bottom: 1px solid #ccc; text-transform: uppercase; font-size: 14px;">Additional Charges & Terms</div>
                            
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding: 10px 15px;">
                                <span style="font-weight: bold;">One-Time Purchase Fees</span>
                                <span style="font-weight: bold;"></span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding: 8px 15px;">
                                <span style="padding-left: 10px;">Residential Install Fee</span>
                                <span style="font-weight: bold;">$50-$150*</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding: 8px 15px;">
                                <span style="padding-left: 10px;">Equipment Fee (Includes Mesh Router)</span>
                                <span style="font-weight: bold;">$99.00</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding: 8px 15px;">
                                <span style="font-weight: bold;">Early Termination Fee</span>
                                <span style="font-weight: bold;">n/a</span>
                            </div>
                            
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding: 10px 15px;">
                                <span style="font-weight: bold;">Government Taxes</span>
                                <span style="font-weight: bold;">Varies by Location</span>
                            </div>
                            <div style="border-bottom: 3px solid black; padding: 8px 15px;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span style="padding-left: 10px;">IN Sales Taxes</span>
                                    <span style="font-weight: bold;">7% on equipment</span>
                                </div>
                                <div style="font-size: 11px; margin-top: 5px; font-style: italic;">*Distance house is from the road will determine install price.</div>
                            </div>

                            <div style="background-color: #f0f0f0; font-weight: bold; padding: 8px 15px; border-bottom: 1px solid #ccc; text-transform: uppercase; font-size: 14px;">Speeds Provided with Plan</div>
                            
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding: 10px 15px;">
                                <span>Typical Download Speed</span>
                                <span style="font-weight: bold;">${plan.speed}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #ccc; padding: 10px 15px;">
                                <span>Typical Upload Speed</span>
                                <span style="font-weight: bold;">${plan.speed}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid black; padding: 10px 15px;">
                                <span>Typical Latency</span>
                                <span style="font-weight: bold;">17 ms</span>
                            </div>

                            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid black; padding: 10px 15px;">
                                <span style="font-weight: bold;">Data Included with Monthly Price</span>
                                <span style="font-weight: bold;">Unlimited</span>
                            </div>

                            <div style="padding: 15px; font-size: 12px; text-align: center; background: #fff;">
                                <p style="margin: 5px 0;"><strong>Customer Support</strong></p>
                                <p style="margin: 3px 0;">Phone: (574) 533-4237</p>
                                <p style="margin: 3px 0;">Website: Community Fiber Network</p>
                                <p style="margin: 10px 0 3px 0;">Learn about the terms used on this label. Visit the Federal Communications Commission's Consumer Resource Center.</p>
                                <p style="margin: 3px 0; color: #000; font-weight: bold;"><a href="https://fcc.gov/consumer" style="color:inherit; text-decoration:none;">fcc.gov/consumer</a></p>
                                <p style="margin-top: 10px; font-size: 10px; color: #666;">F000582522710924</p>
                            </div>
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