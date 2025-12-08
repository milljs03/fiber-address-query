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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nptel-map-portal';

// --- AUTH ---
async function initAuth() {
    try {
        await signInAnonymously(auth);
    } catch (e) {
        console.warn("Anonymous auth failed.", e);
    }
}
initAuth();

// --- LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Populate Address from URL Params
    const urlParams = new URLSearchParams(window.location.search);
    const addressParam = urlParams.get('address');
    const addressInput = document.getElementById('lead-address');

    if (addressParam) {
        addressInput.value = decodeURIComponent(addressParam);
    }

    // 2. Handle Form Submission
    const form = document.getElementById('lead-form');
    form.addEventListener('submit', handleFormSubmit);
});

async function handleFormSubmit(e) {
    e.preventDefault();

    const name = document.getElementById('lead-name').value;
    const phone = document.getElementById('lead-phone').value.trim();
    const email = document.getElementById('lead-email').value.trim();
    const address = document.getElementById('lead-address').value;
    const btn = document.getElementById('submit-lead-btn');

    // Validation: Require either Phone OR Email
    if (!phone && !email) {
        alert("Please provide either a phone number or an email address so we can contact you.");
        // Highlight inputs
        document.getElementById('lead-phone').style.borderColor = "#dc2626";
        document.getElementById('lead-email').style.borderColor = "#dc2626";
        return;
    } else {
        // Reset styles
        document.getElementById('lead-phone').style.borderColor = "#d1d5db";
        document.getElementById('lead-email').style.borderColor = "#d1d5db";
    }

    // Verify Recaptcha (Simple client-side check)
    if (grecaptcha.getResponse().length === 0) {
        alert("Please verify that you are not a robot.");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Submitting...";

    try {
        const userId = auth.currentUser ? auth.currentUser.uid : 'anonymous';
        
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'service_requests'), {
            type: 'manual_check', 
            name: name,
            phone: phone,
            email: email, // Added email
            address: address,
            submittedAt: new Date(),
            uid: userId
        });

        // Show Success Message
        const form = document.getElementById('lead-form');
        const title = document.getElementById('card-title');
        const desc = document.getElementById('card-desc');
        const thanks = document.getElementById('thank-you-msg');

        form.classList.add('hidden');
        title.classList.add('hidden');
        desc.classList.add('hidden');
        thanks.classList.remove('hidden');

    } catch (error) {
        console.error("Error submitting lead:", error);
        alert("There was an error submitting your information. Please try again.");
        btn.disabled = false;
        btn.textContent = "Submit";
    }
}