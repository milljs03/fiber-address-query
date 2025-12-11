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
    "Premium": { price: "$89", speed: "1 Gbps", isPopular: true, stickers: "Free Install, WiFi 6 Included" }
};

// --- STICKER CSS INJECTION ---
const stickerStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Permanent+Marker&family=Inter:wght@400;600;800&display=swap');

    .stickers-container {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        margin: 25px 0;
        justify-content: center;
        perspective: 1000px;
    }

    .sticker-perk {
        position: relative;
        overflow: hidden;
        font-family: 'Permanent Marker', cursive;
        font-size: 20px;
        padding: 12px 24px;
        border: 4px solid white;
        box-shadow: 3px 6px 10px rgba(0,0,0,0.3);
        transform-origin: center;
        opacity: 0; 
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: normal; 
        text-align: center;
        max-width: 100%;
        box-sizing: border-box; 
    }

    .sticker-perk:hover {
        transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); 
        transform: scale(1.1) rotate(0deg) !important;
        z-index: 20;
    }

    .sticker-variant-0 { background: #facc15; color: #422006; border-radius: 4px; }
    .sticker-variant-1 { background: #ec4899; color: white; border-radius: 9999px; }
    .sticker-variant-2 { background: #22d3ee; color: #164e63; border-radius: 16px; }
    .sticker-variant-3 { background: #34d399; color: #064e3b; border-radius: 8px; }
    .sticker-variant-4 { background: #fb923c; color: #431407; border-radius: 255px 15px 225px 15px / 15px 225px 15px 255px; }

    /* Holographic Shimmer Effect */
    .sticker-shimmer {
        position: absolute;
        top: -100%; 
        left: -100%; 
        width: 300%; 
        height: 300%;
        background: linear-gradient(
            135deg, 
            transparent 45%, 
            rgba(255, 255, 255, 0.8) 50%,
            rgba(130, 240, 255, 0.7) 52%,
            rgba(240, 130, 255, 0.7) 54%,
            rgba(255, 230, 130, 0.7) 56%,
            transparent 60%
        );
        mix-blend-mode: plus-lighter;
        opacity: 1;
        pointer-events: none;
        
        /* UPDATED: Runs for 6 seconds (slower loop), but the movement is condensed in keyframes */
        animation: holo-move 6s infinite linear;
    }

    .sticker-grain {
        position: absolute;
        inset: 0;
        opacity: 0.12;
        background-image: radial-gradient(circle, #000 1px, transparent 1px);
        background-size: 3px 3px;
        pointer-events: none;
        mix-blend-mode: multiply;
    }

    /* UPDATED ANIMATION KEYFRAMES */
    @keyframes holo-move {
        0% { transform: translate(-50%, -50%); }
        35% { transform: translate(50%, 50%); } /* Finish the move quickly */
        100% { transform: translate(50%, 50%); } /* Wait here for the rest of the 6s */
    }

    @keyframes sticker-slap {
        0% {
            opacity: 0;
            transform: scale(3) translateY(-100px) rotate(var(--start-rot));
        }
        60% {
            opacity: 1;
            transform: scale(0.9) translateY(10px) rotate(var(--end-rot));
        }
        100% {
            opacity: 1;
            transform: scale(1) translateY(0) rotate(var(--end-rot));
        }
    }
    
    .sticker-animate {
        animation: sticker-slap 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
    }
`;

function injectStyles() {
    if (!document.getElementById('sticker-dynamic-styles')) {
        const styleSheet = document.createElement("style");
        styleSheet.id = 'sticker-dynamic-styles';
        styleSheet.innerText = stickerStyles;
        document.head.appendChild(styleSheet);
    }
}

// --- MAIN LOGIC ---
document.addEventListener('DOMContentLoaded', async () => {
    injectStyles(); 

    const params = new URLSearchParams(window.location.search);
    const address = params.get('address');
    const campaignId = params.get('campaign');
    
    const addressDisplay = document.getElementById('display-address');
    if (address && addressDisplay) addressDisplay.textContent = address;

    let plansToShow = FALLBACK_PLANS;
    let campaignName = "Standard"; 
    
    try {
        // 1. Always load global defaults first
        const defaultDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', 'global_default'));
        if (defaultDoc.exists() && defaultDoc.data().plans) {
            plansToShow = defaultDoc.data().plans;
        }

        // 2. If a campaign is requested, check if it is valid AND active
        if (campaignId) {
            const snap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', campaignId));
            
            if (snap.exists()) {
                const data = snap.data();
                let isExpired = false;

                // --- EXPIRATION CHECK ---
                if (data.expiresAt) {
                    // Convert Firestore Timestamp or String to JS Date
                    const expiryDate = data.expiresAt.toDate ? data.expiresAt.toDate() : new Date(data.expiresAt);
                    const now = new Date();

                    if (now > expiryDate) {
                        isExpired = true;
                        console.log(`Campaign ${campaignId} expired on ${expiryDate.toLocaleDateString()}. Reverting to defaults.`);
                    }
                }

                // Only overwrite defaults if plans exist AND it's not expired
                if (!isExpired && data.plans) {
                    plansToShow = data.plans;
                    campaignName = data.name || "Special Offer";
                }
            }
        }
    } catch (e) {
        console.error("Error loading data from Firebase, using fallback:", e);
    }

    renderPlans(plansToShow, address, campaignId, campaignName);
});

function renderPlans(plans, address, campaignId, campaignName) {
    const container = document.querySelector('.pricing-container');
    if (!container) return; 
    container.innerHTML = '';
    
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

        const hasPromo = !!plan.promoPrice;
        let priceHtml = '';
        let badgeHtml = '';
        let expiryHtml = '';
        
        const labelMonthlyPrice = hasPromo ? plan.promoPrice : plan.price;
        
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

        let stickersHtml = '';
        if (plan.stickers) {
            const stickerList = plan.stickers.split(',').map(s => s.trim()).filter(s => s);
            if (stickerList.length > 0) {
                stickersHtml = `<div class="stickers-container">`;
                
                stickerList.forEach((sticker, sIndex) => {
                    const rot = (Math.random() * 12) - 6; 
                    const startRot = rot * 8; 
                    const delay = sIndex * 0.15 + 0.2; 
                    const variantIdx = Math.floor(Math.random() * 5);
                    const variantClass = `sticker-variant-${variantIdx}`;

                    // Added a 'randomOffset' so they don't all shimmer exactly at the same time
                    const shimmerDelay = (Math.random() * 2) + "s";

                    stickersHtml += `
                        <div class="sticker-perk ${variantClass} sticker-animate" 
                             style="--start-rot: ${startRot}deg; --end-rot: ${rot}deg; animation-delay: ${delay}s; transform: rotate(${rot}deg);">
                            <div class="sticker-shimmer" style="animation-delay: ${shimmerDelay};"></div>
                            <div class="sticker-grain"></div>
                            <span>${sticker}</span>
                        </div>
                    `;
                });
                
                stickersHtml += `</div>`;
            }
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
                    
                    ${stickersHtml}

                    <div class="speed-features">${plan.speed}</div>
                    <div class="speed-capability">Download & Upload</div>
                    <div class="core-benefits">
                        <span class="highlight-text">Local Service</span>
                        <span class="highlight-text">Lifetime Price Lock</span>               
                        <span class="highlight-text">No Contracts</span>

                    </div>
                    <button class="sign-up-btn">Select Plan</button>
                    
                    <div class="broadband-label-container" style="width: 100%; max-width: 100%; box-sizing: border-box; border: 3px solid black; font-family: Helvetica, Arial, sans-serif; color: black; background: white; margin-top: 20px;">
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
                                <span style="font-weight: bold;">$50 - $150*</span>
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

                            <div class="bbf-footer">
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