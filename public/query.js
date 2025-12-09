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
const auth = getAuth(app); 
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nptel-map-portal';

// State
let map;
let allPolygons = [];
let autocomplete; // Made global so button can access if needed

// --- SESSION HELPER ---
function getSessionId() {
    let sid = localStorage.getItem('fiber_session_id');
    if (!sid) {
        sid = 'anon_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('fiber_session_id', sid);
    }
    return sid;
}

// --- LOGIC ---

if (window.isGoogleMapsReady) {
    initApp();
} else {
    window.addEventListener('google-maps-ready', initApp);
}

function initApp() {
    const mapEl = document.getElementById('map');
    if (mapEl) {
        map = new google.maps.Map(mapEl, {
            center: { lat: 41.5006, lng: -85.8305 },
            zoom: 13,
            disableDefaultUI: true
        });
    }
    loadPolygons();
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
                    visible: false
                });
                // STORE CAMPAIGN ID ON THE POLYGON OBJECT
                polygon.campaignId = data.campaignId || null; 
                
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
    if (!input) return;

    autocomplete = new google.maps.places.Autocomplete(input);
    if (map) autocomplete.bindTo('bounds', map);

    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        
        if (!place.geometry) {
            // User entered the name of a Place that was not suggested and
            // pressed the Enter key, or the Place Details request failed.
            // We do NOT return here anymore; we fall through to let them try the button
            // or show a specific alert if they rely purely on dropdown.
            // For now, let's keep the alert but allow the button to handle the raw text.
            return;
        }
        
        // FIX: This call was missing in your previous code!
        evaluateLocation(place);
    });
}

function setupButtons() {
    const checkBtn = document.getElementById('check-btn');
    const resetBtn = document.getElementById('reset-btn');
    const input = document.getElementById('address-input');
    
    if(checkBtn && input) {
        checkBtn.addEventListener('click', () => {
            const address = input.value;
            if (!address) {
                input.focus();
                return;
            }

            // FIX: If user clicks button, we manually geocode what they typed
            // This handles cases where they paste an address and don't select from dropdown
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ 'address': address }, function(results, status) {
                if (status === 'OK' && results[0]) {
                    // Create a "place-like" object to pass to evaluateLocation
                    const place = {
                        geometry: results[0].geometry,
                        formatted_address: results[0].formatted_address
                    };
                    evaluateLocation(place);
                } else {
                    alert('Geocode was not successful for the following reason: ' + status);
                }
            });
        });
    }

    if(resetBtn) {
        resetBtn.addEventListener('click', () => window.location.reload());
    }
}

function evaluateLocation(place) {
    if (!place || !place.geometry) return;

    const point = place.geometry.location;
    const address = place.formatted_address || document.getElementById('address-input').value;
    
    // 1. Check Geometry & Campaign
    let isInside = false;
    let matchedCampaignId = null;

    if (google.maps.geometry && google.maps.geometry.poly) {
        for (const poly of allPolygons) {
            if (google.maps.geometry.poly.containsLocation(point, poly)) {
                isInside = true;
                matchedCampaignId = poly.campaignId; // Capture the campaign ID!
                break;
            }
        }
    } else {
        console.error("Google Maps Geometry library not loaded.");
    }

    // 2. Handle Result
    if (isInside) {
        logRequest(address, point.lat(), point.lng(), true).finally(() => {
            // PASS CAMPAIGN ID IN URL
            let url = `pricing.html?address=${encodeURIComponent(address)}`;
            if (matchedCampaignId) {
                url += `&campaign=${encodeURIComponent(matchedCampaignId)}`;
            }
            window.location.href = url;
        });
    } else {
        logRequest(address, point.lat(), point.lng(), false).finally(() => {
            window.location.href = `sorry.html?address=${encodeURIComponent(address)}`;
        });
    }
}

async function logRequest(address, lat, lng, isAvailable) {
    try {
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