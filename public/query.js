import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
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
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nptel-map-portal';

// State
let map;
let allPolygons = [];

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

if (window.isGoogleMapsReady) {
    initApp();
} else {
    window.addEventListener('google-maps-ready', initApp);
}

function initApp() {
    // 1. Initialize Invisible Map
    // We bind it to a hidden div in HTML to perform geometry calculations
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 41.5006, lng: -85.8305 },
        zoom: 13,
        disableDefaultUI: true
    });

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
        console.error("Error loading polygons.", e);
    }
}

function setupAutocomplete() {
    const input = document.getElementById('address-input');
    const autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.bindTo('bounds', map);

    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.geometry || !place.geometry.location) return;
        evaluateLocation(place);
    });
}

function setupButtons() {
    const checkBtn = document.getElementById('check-btn');
    const resetBtn = document.getElementById('reset-btn');
    
    // Check button manually triggers the logic if the user typed but didn't select
    // (Note: Geocoding might be required if not using Autocomplete place object directly)
    // For now, we rely on Autocomplete selection for accuracy.
    checkBtn.addEventListener('click', () => {
        // Trigger focus to encourage selection from dropdown
        document.getElementById('address-input').focus();
    });

    resetBtn.addEventListener('click', resetUI);
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
    }

    // 2. Update UI
    updateUI(isInside, address);

    // 3. Log
    logRequest(address, point.lat(), point.lng(), isInside);
}

function updateUI(isAvailable, address) {
    const card = document.getElementById('service-card');
    const title = document.getElementById('card-title');
    const desc = document.getElementById('card-desc');
    const inputContainer = document.querySelector('.input-container');
    const checkBtn = document.getElementById('check-btn');
    
    const resultContainer = document.getElementById('result-container');
    const resultStatus = document.getElementById('result-status');
    const resultDetail = document.getElementById('result-detail');
    const resultIcon = document.getElementById('result-icon');

    // Hide input elements
    inputContainer.classList.add('hidden');
    checkBtn.classList.add('hidden');
    title.classList.add('hidden');
    desc.classList.add('hidden');

    // Show result elements
    resultContainer.classList.remove('hidden');

    if (isAvailable) {
        card.className = 'card available'; // Green
        resultIcon.className = 'fa-solid fa-circle-check';
        resultStatus.textContent = 'Service Available!';
        resultDetail.textContent = `Great news! We can provide service to ${address}.`;
    } else {
        card.className = 'card unavailable'; // Red
        resultIcon.className = 'fa-solid fa-circle-xmark';
        resultStatus.textContent = 'Service Unavailable';
        resultDetail.textContent = `Sorry, ${address} is not currently within our service area.`;
    }
}

function resetUI() {
    const card = document.getElementById('service-card');
    const title = document.getElementById('card-title');
    const desc = document.getElementById('card-desc');
    const inputContainer = document.querySelector('.input-container');
    const checkBtn = document.getElementById('check-btn');
    const resultContainer = document.getElementById('result-container');
    const input = document.getElementById('address-input');

    // Reset classes and visibility
    card.className = 'card';
    inputContainer.classList.remove('hidden');
    checkBtn.classList.remove('hidden');
    title.classList.remove('hidden');
    desc.classList.remove('hidden');
    resultContainer.classList.add('hidden');
    
    input.value = '';
    input.focus();
}

async function logRequest(address, lat, lng, isAvailable) {
    try {
        const userId = auth.currentUser ? auth.currentUser.uid : 'anonymous';
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