import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
const auth = getAuth(app); // Still needed to check if a real user IS logged in
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nptel-map-portal';

// State
let map;
let allPolygons = [];

// --- SESSION HELPER ---
// Since we removed signInAnonymously (to fix the 400 error), 
// we generate a random ID to track this specific visitor's session.
function getSessionId() {
    let sid = localStorage.getItem('fiber_session_id');
    if (!sid) {
        sid = 'anon_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('fiber_session_id', sid);
    }
    return sid;
}

// --- LOGIC ---

// Wait for Google Maps API to load
if (window.isGoogleMapsReady) {
    initApp();
} else {
    window.addEventListener('google-maps-ready', initApp);
}

function initApp() {
    // 1. Initialize Invisible Map
    const mapEl = document.getElementById('map');
    if (mapEl) {
        map = new google.maps.Map(mapEl, {
            center: { lat: 41.5006, lng: -85.8305 },
            zoom: 13,
            disableDefaultUI: true
        });
    }

    // 2. Load Polygons
    loadPolygons();

    // 3. Setup UI
    setupAutocomplete();
    setupButtons();
}

async function loadPolygons() {
    try {
        const querySnapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'polygons'));
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.type === 'polygon' && data.coordinates) {
                const polygon = new google.maps.Polygon({
                    paths: data.coordinates,
                    visible: false // Invisible
                });
                polygon.setMap(map); 
                allPolygons.push(polygon);
            }
        });
        console.log(`Loaded ${allPolygons.length} service zones.`);
    } catch (e) {
        console.error("Error loading polygons. Ensure Firestore permissions allow public read.", e);
    }
}

function setupAutocomplete() {
    const input = document.getElementById('address-input');
    if (!input) return;

    const autocomplete = new google.maps.places.Autocomplete(input);
    if (map) autocomplete.bindTo('bounds', map);

    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) return;
        evaluateLocation(place);
    });
}

function setupButtons() {
    const checkBtn = document.getElementById('check-btn');
    const resetBtn = document.getElementById('reset-btn');
    const input = document.getElementById('address-input');
    
    if(checkBtn && input) {
        checkBtn.addEventListener('click', () => {
            // Focus input to encourage using the dropdown
            input.focus(); 
            // Optional: You could trigger geocoding here manually if they didn't select from dropdown
        });
    }

    if(resetBtn) {
        resetBtn.addEventListener('click', resetUI);
    }
}

function evaluateLocation(place) {
    const point = place.geometry.location;
    const address = place.formatted_address;
    
    // 1. Check Geometry
    let isInside = false;
    if (google.maps.geometry && google.maps.geometry.poly) {
        for (const poly of allPolygons) {
            if (google.maps.geometry.poly.containsLocation(point, poly)) {
                isInside = true;
                break;
            }
        }
    } else {
        console.error("Google Maps Geometry library not loaded.");
    }

    // 2. Handle Result
    if (isInside) {
        // GREEN STATE -> Redirect to Pricing Page
        // Log positive result THEN redirect
        logRequest(address, point.lat(), point.lng(), true).finally(() => {
            window.location.href = `pricing.html?address=${encodeURIComponent(address)}`;
        });
    } else {
        // RED STATE -> Redirect to Sorry Page
        // Log negative result THEN redirect
        logRequest(address, point.lat(), point.lng(), false).finally(() => {
            // Redirect to sorry.html with the address in the query string
            window.location.href = `sorry.html?address=${encodeURIComponent(address)}`;
        });
    }
}

function updateUI(isAvailable, address) {
    // Only handling Available state here now, as Unavailable redirects
    if (!isAvailable) return;

    const card = document.getElementById('service-card');
    const title = document.getElementById('card-title');
    const desc = document.getElementById('card-desc');
    const inputContainer = document.querySelector('.search-bar-wrapper');
    const resultContainer = document.getElementById('result-container');
    const resultStatus = document.getElementById('result-status');
    const resultDetail = document.getElementById('result-detail');
    const resultIcon = document.getElementById('result-icon');

    // Check if elements exist before modifying to prevent "classList of null" error
    if (inputContainer) inputContainer.classList.add('hidden');
    if (title) title.classList.add('hidden');
    if (desc) desc.classList.add('hidden');

    if (resultContainer) {
        resultContainer.classList.remove('hidden');
        
        if (card) card.className = 'card available'; // Green
        if (resultIcon) resultIcon.className = 'fa-solid fa-circle-check';
        if (resultStatus) resultStatus.textContent = 'Service Available!';
        if (resultDetail) resultDetail.textContent = `Great news! We can provide service to ${address}.`;
    }
}

function resetUI() {
    window.location.reload();
}

async function logRequest(address, lat, lng, isAvailable) {
    try {
        // Use existing auth user if available, otherwise use session ID
        const userId = auth.currentUser ? auth.currentUser.uid : getSessionId();
        
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'service_requests'), {
            address: address,
            location: { lat: lat, lng: lng },
            isAvailable: isAvailable,
            checkedAt: new Date(),
            uid: userId
        });
    } catch (e) {
        console.error("Error logging request:", e);
    }
}