import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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

// Google Apps Script URL for Email Notifications
const EMAIL_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbylC4OXreb74IxO0cmfpTHdFKjCJy1_TOiJfi3GRm6UoEdLhVquw8rbMGKb3fJc4xDW/exec"; 

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nptel-map-portal';

// --- PLAN DATA (Matches Pricing Page) ---
const PLAN_DATA = {
    "Standard": {
        price: "$65",
        speed: "200 Mbps",
        isPopular: false
    },
    "Advanced": {
        price: "$80",
        speed: "500 Mbps",
        isPopular: false
    },
    "Premium": {
        price: "$89",
        speed: "1 Gbps",
        isPopular: true
    }
};

// --- AUTH ---
async function initAuth() {
    try {
        await signInAnonymously(auth);
    } catch (e) {
        console.warn("Auth warning:", e);
    }
}
initAuth();

// --- LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Get Params
    const params = new URLSearchParams(window.location.search);
    const address = params.get('address');
    const planKey = params.get('plan');

    // 2. Pre-fill Form
    if (address) {
        document.getElementById('address').value = decodeURIComponent(address);
    }
    
    // 3. Render Plan Summary
    if (planKey) {
        document.getElementById('selected-plan').value = decodeURIComponent(planKey);
        renderPlanSummary(planKey);
    } else {
        document.getElementById('plan-card-container').innerHTML = "<p>No plan selected.</p>";
    }

    // 4. Handle Submit
    const orderForm = document.getElementById('orderForm');
    if (orderForm) {
        orderForm.addEventListener('submit', handleOrderSubmit);
    }
});

function renderPlanSummary(planKey) {
    const container = document.getElementById('plan-card-container');
    const plan = PLAN_DATA[planKey];

    if (!plan) {
        container.innerHTML = `<p>Details for plan "${planKey}" not found.</p>`;
        return;
    }

    const popularClass = plan.isPopular ? 'popular' : '';
    const popularBadge = plan.isPopular ? '<div class="popular-badge">Most Popular</div>' : '';

    const html = `
        <div class="pricing-box ${popularClass}">
            ${popularBadge}
            <div class="panel-heading">${planKey}</div>
            <div class="panel-body">
                <span class="price">${plan.price}<small>/mo</small></span>
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

    // Verify Recaptcha
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
        const timestamp = new Date();
        
        // 1. Save to Firestore
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'orders'), {
            type: 'new_service_order',
            name: name,
            email: email,
            phone: phone,
            address: address,
            plan: plan,
            submittedAt: timestamp,
            uid: userId,
            status: 'pending'
        });

        // 2. Send Notification Email via Apps Script
        await sendNotificationEmail({
            name, email, phone, address, plan, timestamp
        });

        alert("Order submitted successfully! We will contact you shortly.");
        window.location.href = 'query.html'; 

    } catch (error) {
        console.error("Error submitting order:", error);
        alert("There was an error processing your order. Please try again.");
        btn.disabled = false;
        btn.textContent = "Complete Order";
    }
}

async function sendNotificationEmail(data) {
    const subject = `New Fiber Sign-Up: ${data.name}`;
    const htmlBody = `
        <h2>New Service Order Received</h2>
        <p><strong>Name:</strong> ${data.name}</p>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>Phone:</strong> ${data.phone}</p>
        <p><strong>Address:</strong> ${data.address}</p>
        <p><strong>Selected Plan:</strong> ${data.plan}</p>
        <p><strong>Time:</strong> ${data.timestamp.toLocaleString()}</p>
        <hr>
        <p>Please log in to the admin portal to manage this order.</p>
    `;

    try {
        // We use 'no-cors' mode because Apps Script doesn't return CORS headers by default for simple triggers.
        // This means we won't get a readable response, but the request WILL be sent.
        await fetch(EMAIL_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', 
            headers: {
                'Content-Type': 'text/plain;charset=utf-8', 
            },
            body: JSON.stringify({
                to: "jmiller@nptel.com", // Hardcoded recipient
                subject: subject,
                htmlBody: htmlBody
            })
        });
        console.log("Email notification trigger sent.");
    } catch (e) {
        console.error("Failed to send email notification:", e);
        // We don't block the UI flow for email errors, as the DB save is the critical part.
    }
}