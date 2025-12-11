import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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

// Auth Check
const initAuth = async () => {
    // Check for custom token (if passed from server/context)
    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
    } 
    // FIXED: Removed the 'else { signInAnonymously }' block.
    // This allows the browser to restore the existing session from frontoffice.html
};

initAuth();

onAuthStateChanged(auth, (user) => {
    // Basic guard - in real prod, enforce email domain check again
    if (user) {
        currentUser = user;
        document.getElementById('auth-cover').style.display = 'none';
        console.log("Session restored for:", user.email);
    } else {
        console.warn("No user session found. Please log in via Front Office first.");
        // Optional: Redirect back to frontoffice or show a specific message
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // 1. Load Session Data (Pre-fill)
    const storedAddress = sessionStorage.getItem('so_address');
    const storedPlan = sessionStorage.getItem('so_planName');
    const storedPrice = sessionStorage.getItem('so_planPrice');
    const storedSpeed = sessionStorage.getItem('so_planSpeed');
    const storedStickers = sessionStorage.getItem('so_stickers');
    
    if (storedAddress) {
        document.getElementById('homeAddress').value = storedAddress;
        document.getElementById('prefilled-info').textContent = `For: ${storedAddress}`;
    }

    if (storedPlan) {
        document.getElementById('disp-plan-name').textContent = storedPlan;
        document.getElementById('disp-plan-price').textContent = storedPrice || 'N/A';
        document.getElementById('disp-plan-speed').textContent = storedSpeed || 'N/A';
        
        if (storedStickers) {
            document.getElementById('disp-extras').textContent = `Included Perks: ${storedStickers}`;
        }

        // Set Select Box
        const select = document.getElementById('fiberPlan');
        for (let i = 0; i < select.options.length; i++) {
            if (storedPlan.toLowerCase().includes(select.options[i].text.split(' - ')[0].toLowerCase())) {
                select.selectedIndex = i;
                break;
            }
        }
    }

    // 2. Handle Form Submission
    document.getElementById('so-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        if(!currentUser) { alert("You must be logged in."); return; }
        
        const btn = document.querySelector('.btn-submit');
        btn.textContent = "Saving...";
        btn.disabled = true;

        await saveOrder(new FormData(e.target));
    });
});

async function saveOrder(formData) {
    const formProps = Object.fromEntries(formData);
    
    // Combine Form Data with Session Data
    const orderPayload = {
        // Customer Profile
        customer: {
            name: formProps.custName,
            address: formProps.homeAddress,
            mailingAddress: formProps.mailAddress || formProps.homeAddress,
            mobile: formProps.mobile,
            email: formProps.email,
            dob: formProps.dob || null,
            ssn4: formProps.ssn4 || null,
            joint: {
                name: formProps.jointName || null,
                mobile: formProps.jointMobile || null,
                email: formProps.jointEmail || null,
                dob: formProps.jointDob || null,
                ssn4: formProps.jointSsn4 || null
            }
        },
        // Plan Details (From Session)
        plan: {
            selectedTier: formProps.fiberPlan, // From dropdown (confirmed by user)
            originalPlanName: sessionStorage.getItem('so_planName'),
            price: sessionStorage.getItem('so_planPrice'),
            speed: sessionStorage.getItem('so_planSpeed'),
            stickers: sessionStorage.getItem('so_stickers'),
            promoLabel: sessionStorage.getItem('so_promoLabel'),
            promoEnd: sessionStorage.getItem('so_promoEnd')
        },
        // Meta
        surveyContact: formProps.surveyContact,
        internalNotes: formProps.internalNotes || '', // New Field
        createdBy: currentUser.email || 'unknown_agent',
        createdById: currentUser.uid,
        createdAt: new Date(),
        status: 'Pending',
        source: 'front_office'
    };

    try {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'office_signups'), orderPayload);
        
        // Clear session
        sessionStorage.clear();
        
        // Redirect to List
        window.location.href = 'serviceorderlist.html';
    } catch (e) {
        console.error("Error saving order:", e);
        alert("Error saving order: " + e.message);
        const btn = document.querySelector('.btn-submit'); // Re-select to be safe
        if(btn) {
            btn.textContent = "Try Again";
            btn.disabled = false;
        }
    }
}