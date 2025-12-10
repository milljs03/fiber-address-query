import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
const appId = 'nptel-map-portal';

// State
let map;
let allPolygons = [];
let autocomplete;
let currentMarker;
let campaigns = {}; 
let referenceLayer = null;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authMessage = document.getElementById('auth-message');
const userEmailSpan = document.getElementById('user-email');
const toggleLayerBtn = document.getElementById('toggle-reference-layer');

// --- AUTHENTICATION ---
loginBtn.addEventListener('click', () => {
    signInWithPopup(auth, provider).catch((error) => {
        authMessage.textContent = error.message;
    });
});

logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => window.location.reload());
});

onAuthStateChanged(auth, (user) => {
    if (user && user.email) {
        if (!user.email.endsWith('@nptel.com')) {
            signOut(auth);
            authMessage.textContent = "Access Denied: @nptel.com email required.";
            return;
        }
        userEmailSpan.textContent = user.email;
        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        
        if (window.isGoogleMapsReady) {
            initApp();
        } else {
            window.addEventListener('google-maps-ready', initApp);
        }
    } else {
        loginScreen.style.display = 'flex';
        appContainer.style.display = 'none';
    }
});

// --- MAP & DATA LOGIC ---
function initApp() {
    initMap();
    preloadCampaigns().then(() => {
        loadPolygons();
    });
    setupAutocomplete();
    setupLayerControls();
}

function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 41.5006, lng: -85.8305 },
        zoom: 12,
        mapTypeId: 'hybrid',
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false
    });

    referenceLayer = new google.maps.KmlLayer({
        url: "https://www.google.com/maps/d/kml?mid=16mma39raMyatbdMcF42v598h3FuWFg4&forcekml=1",
        map: map,
        preserveViewport: true, 
        suppressInfoWindows: false, 
        zIndex: 0 
    });
}

function setupLayerControls() {
    if(toggleLayerBtn) {
        toggleLayerBtn.addEventListener('change', (e) => {
            if (e.target.checked) {
                referenceLayer.setMap(map);
            } else {
                referenceLayer.setMap(null);
            }
        });
    }
}

async function preloadCampaigns() {
    try {
        const defaultDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'campaigns', 'global_default'));
        if (defaultDoc.exists()) {
            campaigns['global_default'] = defaultDoc.data();
        }
        const snap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'campaigns'));
        snap.forEach(doc => {
            campaigns[doc.id] = doc.data();
        });
    } catch (e) {
        console.error("Error loading campaigns", e);
    }
}

async function loadPolygons() {
    try {
        const querySnapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'polygons'));
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.type === 'polygon' && data.coordinates) {
                let color = '#34d399';
                if (data.campaignId && campaigns[data.campaignId] && campaigns[data.campaignId].color) {
                    color = campaigns[data.campaignId].color;
                }

                const polygon = new google.maps.Polygon({
                    paths: data.coordinates,
                    fillColor: color,
                    fillOpacity: 0.35,
                    strokeColor: color,
                    strokeWeight: 2,
                    clickable: false, 
                    map: map,
                    zIndex: 10 
                });
                polygon.campaignId = data.campaignId || null; 
                allPolygons.push(polygon);
            }
        });
    } catch (e) {
        console.error("Error loading polygons.", e);
    }
}

function setupAutocomplete() {
    const input = document.getElementById('address-input');
    autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.bindTo('bounds', map);

    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (!place.geometry) return;
        
        if (place.geometry.viewport) {
            map.fitBounds(place.geometry.viewport);
        } else {
            map.setCenter(place.geometry.location);
            map.setZoom(17);
        }

        if (currentMarker) currentMarker.setMap(null);
        currentMarker = new google.maps.Marker({
            position: place.geometry.location,
            map: map,
            animation: google.maps.Animation.DROP
        });

        evaluateLocation(place.geometry.location, place.formatted_address);
    });
}

function evaluateLocation(point, addressText) {
    let isInside = false;
    let matchedCampaignId = null;

    if (google.maps.geometry && google.maps.geometry.poly) {
        for (const poly of allPolygons) {
            if (google.maps.geometry.poly.containsLocation(point, poly)) {
                isInside = true;
                matchedCampaignId = poly.campaignId; 
                break;
            }
        }
    }

    const statusDiv = document.getElementById('status-indicator');
    const resultsDiv = document.getElementById('plans-list');
    document.querySelector('.empty-state').style.display = 'none';

    statusDiv.classList.remove('hidden', 'success', 'fail');
    resultsDiv.innerHTML = '';

    if (isInside) {
        statusDiv.textContent = "✅ Service Available In This Zone";
        statusDiv.classList.add('success');

        let planData = null;
        if (matchedCampaignId && campaigns[matchedCampaignId]) {
            planData = campaigns[matchedCampaignId].plans;
            resultsDiv.innerHTML += `<div style="text-align:center; margin-bottom:10px; color:#666;">Applying Offer: <strong>${campaigns[matchedCampaignId].name}</strong></div>`;
        } else if (campaigns['global_default']) {
            planData = campaigns['global_default'].plans;
            resultsDiv.innerHTML += `<div style="text-align:center; margin-bottom:10px; color:#666;">Standard Pricing Applied</div>`;
        }

        if (planData) {
            renderPlans(planData, resultsDiv);
        } else {
            resultsDiv.innerHTML = "<p>Error: Zone found but no pricing data attached.</p>";
        }

    } else {
        statusDiv.textContent = "❌ Outside Designated Service Area";
        statusDiv.classList.add('fail');
        resultsDiv.innerHTML = `
            <div style="text-align:center; padding: 20px; color: #666;">
                <p>This address is not currently inside any defined service polygon.</p>
                <p><em>Check the map to see if it lands in the colored reference zones.</em></p>
            </div>
        `;
    }
}

function renderPlans(plans, container) {
    const planArray = Object.entries(plans).map(([key, val]) => ({ name: key, ...val }));
    planArray.sort((a, b) => {
        const pA = parseFloat((a.promoPrice || a.price).replace(/[^0-9.]/g, '')) || 0;
        const pB = parseFloat((b.promoPrice || b.price).replace(/[^0-9.]/g, '')) || 0;
        return pA - pB;
    });

    planArray.forEach(plan => {
        const hasPromo = !!plan.promoPrice;
        let priceHtml = hasPromo 
            ? `<span style="text-decoration:line-through; color:#999; font-size:1rem;">${plan.price}</span> <span class="price">${plan.promoPrice}<small>/mo</small></span>`
            : `<span class="price">${plan.price}<small>/mo</small></span>`;
        
        const btnId = `btn-${plan.name.replace(/\s+/g, '-')}`;
        
        const html = `
            <div class="pricing-box ${plan.isPopular ? 'popular' : ''}">
                <div class="panel-heading">${plan.name}</div>
                <div>${priceHtml}</div>
                <div class="speed-features">${plan.speed} <span style="font-weight:normal; color:#666;">(Up & Down)</span></div>
                ${plan.stickers ? `<div style="margin-top:5px; font-size:0.85rem; color:#d63384;"><strong>Bonus:</strong> ${plan.stickers}</div>` : ''}
                
                <button id="${btnId}" class="signup-btn" style="width:100%; margin-top:15px; padding:8px; background:#0d6efd; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:600;">
                    <i class="fa-solid fa-user-plus"></i> Create Service Order
                </button>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);

        // Updated Listener to save detailed data
        setTimeout(() => {
            const btn = document.getElementById(btnId);
            if(btn) {
                btn.addEventListener('click', () => {
                    const address = document.getElementById('address-input').value;
                    sessionStorage.setItem('so_address', address);
                    sessionStorage.setItem('so_planName', plan.name);
                    sessionStorage.setItem('so_planPrice', plan.promoPrice || plan.price);
                    sessionStorage.setItem('so_planSpeed', plan.speed);
                    // New fields
                    sessionStorage.setItem('so_stickers', plan.stickers || '');
                    sessionStorage.setItem('so_promoLabel', plan.promoLabel || '');
                    sessionStorage.setItem('so_promoEnd', plan.promoEnd || '');
                    
                    window.open('officesignup.html', '_blank');
                });
            }
        }, 0);
    });
}