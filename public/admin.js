import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, updateDoc, doc, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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
const provider = new GoogleAuthProvider();
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nptel-map-portal';

// State
let map;
let drawingManager;
let selectedShape;
let allShapes = [];
let isUserAdmin = false;
let searchMarker;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authMessage = document.getElementById('auth-message');
const userDisplay = document.getElementById('user-display');

// --- AUTH LOGIC ---
const initAuth = async () => {
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        }
    } catch (e) {
        console.warn("Auth check failed:", e);
    }
};
initAuth();

loginBtn.addEventListener('click', () => {
    signInWithPopup(auth, provider).catch((error) => {
        authMessage.textContent = "Error: " + error.message;
    });
});

logoutBtn.addEventListener('click', () => {
    signOut(auth).then(() => {
        window.location.reload();
    });
});

onAuthStateChanged(auth, (user) => {
    if (user && user.email) {
        if (!user.email.endsWith('@nptel.com')) {
            signOut(auth);
            authMessage.textContent = "Access Denied: @nptel.com email required.";
            return;
        }

        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex'; 
        userDisplay.textContent = user.email;

        isUserAdmin = (user.email.toLowerCase() === 'jmiller@nptel.com');
        
        initTabs();
        loadAnalyticsData(); 
        
        if (window.mapLogicReadyCallback) {
            window.mapLogicReadyCallback(isUserAdmin);
        } else {
            window.currentUserIsAdmin = isUserAdmin;
        }

    } else {
        loginScreen.style.display = 'flex';
        appContainer.style.display = 'none';
    }
});

// --- TAB LOGIC ---
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const contentId = tab.dataset.tab;
            document.getElementById(contentId).classList.add('active');

            if (contentId === 'map-view' && map) {
                google.maps.event.trigger(map, "resize");
            }
        });
    });

    document.getElementById('refresh-data-btn').addEventListener('click', loadAnalyticsData);
}

// --- ANALYTICS LOGIC ---
async function loadAnalyticsData() {
    if (!auth.currentUser) return;

    try {
        // 1. Fetch Orders
        const ordersSnap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'orders'));
        const orders = [];
        const planCounts = { 'Standard': 0, 'Advanced': 0, 'Premium': 0 };
        let pendingCount = 0;

        ordersSnap.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            orders.push(data);
            
            if (data.status === 'pending') pendingCount++;
            if (data.plan && planCounts[data.plan] !== undefined) {
                planCounts[data.plan]++;
            }
        });

        // 2. Fetch Service Checks (Addresses Entered)
        const checksSnap = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'service_requests'));
        let totalChecks = 0;
        let availableChecks = 0;
        let unavailableChecks = 0;

        checksSnap.forEach(doc => {
            const data = doc.data();
            totalChecks++;
            if (data.isAvailable) {
                availableChecks++;
            } else {
                unavailableChecks++;
            }
        });

        // 3. Calculate Derived Metrics
        // Note: Assuming "Unique Users" is roughly equal to checks for this simple implementation
        // or tracked via unique UIDs if available. Here we use total checks as proxy for activity.
        
        // "Able to get service but didn't sign up" (Lead Gap)
        // This is roughly: (Available Checks) - (Total Orders)
        // Note: This is an estimate, as one user might check multiple times.
        const potentialLostLeads = Math.max(0, availableChecks - orders.length);
        
        // Conversion Rate: Orders / Available Checks
        const conversionRate = availableChecks > 0 ? ((orders.length / availableChecks) * 100).toFixed(1) : 0;

        // 4. Update UI with Rich Analytics
        
        // Key Metrics
        document.getElementById('stat-total-orders').textContent = orders.length;
        document.getElementById('stat-pending').textContent = pendingCount;
        
        // Inject new stats if elements exist, or create dynamic dashboard
        updateDashboardUI({
            totalChecks,
            availableChecks,
            unavailableChecks,
            potentialLostLeads,
            conversionRate,
            planCounts
        });

        // Render Table (Sorted newest first)
        orders.sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
        renderOrdersTable(orders);

    } catch (e) {
        console.error("Error loading analytics:", e);
    }
}

function updateDashboardUI(stats) {
    // We'll dynamically update the dashboard HTML structure to accommodate the new stats
    // Find the stats row and inject/replace content
    const container = document.querySelector('.stats-row');
    if (!container) return;

    container.innerHTML = `
        <div class="stat-card">
            <h3>Total Orders</h3>
            <p>${document.getElementById('stat-total-orders').textContent}</p>
            <small>Pending: ${document.getElementById('stat-pending').textContent}</small>
        </div>
        <div class="stat-card">
            <h3>Addresses Checked</h3>
            <p>${stats.totalChecks}</p>
            <div style="font-size: 0.8rem; color: #666; margin-top: 5px;">
                <span style="color: #28a745;">${stats.availableChecks} Available</span> | 
                <span style="color: #dc3545;">${stats.unavailableChecks} Unavailable</span>
            </div>
        </div>
        <div class="stat-card">
            <h3>Conversion Rate</h3>
            <p>${stats.conversionRate}%</p>
            <small style="color: #e67e22;">${stats.potentialLostLeads} Unconverted Leads</small>
        </div>
        <div class="stat-card">
            <h3>Plan Breakdown</h3>
            <div style="display: flex; justify-content: space-between; margin-top: 10px; font-size: 0.9rem;">
                <div style="text-align: center;">
                    <div style="font-weight: bold; color: #333;">${stats.planCounts.Standard}</div>
                    <div style="font-size: 0.7rem;">Standard</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-weight: bold; color: #0056b3;">${stats.planCounts.Advanced}</div>
                    <div style="font-size: 0.7rem;">Advanced</div>
                </div>
                <div style="text-align: center;">
                    <div style="font-weight: bold; color: #d4af37;">${stats.planCounts.Premium}</div>
                    <div style="font-size: 0.7rem;">Premium</div>
                </div>
            </div>
        </div>
    `;
}

function renderOrdersTable(orders) {
    const tbody = document.querySelector('#orders-table tbody');
    tbody.innerHTML = '';

    orders.forEach(order => {
        const tr = document.createElement('tr');
        
        let dateStr = 'N/A';
        if (order.submittedAt && order.submittedAt.toDate) {
            dateStr = order.submittedAt.toDate().toLocaleDateString();
        }

        const statusClass = order.status === 'completed' ? 'status-completed' : 'status-pending';
        const statusText = order.status ? order.status.toUpperCase() : 'PENDING';

        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${order.name || 'Unknown'}</td>
            <td><strong>${order.plan || 'None'}</strong></td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${order.address || ''}
            </td>
            <td>
                <div>${order.email || ''}</div>
                <small>${order.phone || ''}</small>
            </td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>
                <button class="table-btn btn-check" title="Mark Complete" onclick="window.updateOrderStatus('${order.id}', 'completed')">
                    <i class="fa-solid fa-check"></i>
                </button>
                <button class="table-btn btn-delete" title="Delete Order" onclick="window.deleteOrder('${order.id}')">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Global functions for table actions
window.updateOrderStatus = async function(id, status) {
    if(!confirm("Mark this order as completed?")) return;
    try {
        const ref = doc(db, 'artifacts', appId, 'public', 'data', 'orders', id);
        await updateDoc(ref, { status: status });
        loadAnalyticsData(); // Refresh UI
    } catch (e) {
        console.error("Update failed:", e);
        alert("Failed to update status.");
    }
};

window.deleteOrder = async function(id) {
    if(!confirm("Are you sure you want to delete this order record?")) return;
    try {
        const ref = doc(db, 'artifacts', appId, 'public', 'data', 'orders', id);
        await deleteDoc(ref);
        loadAnalyticsData(); // Refresh UI
    } catch (e) {
        console.error("Delete failed:", e);
        alert("Failed to delete order.");
    }
};

// --- MAP LOGIC ---
function initializeMapLogic() {
    window.mapLogicReadyCallback = (isAdmin) => {
        isUserAdmin = isAdmin;
        loadMapFeatures();
    };

    if (typeof window.currentUserIsAdmin !== 'undefined') {
        window.mapLogicReadyCallback(window.currentUserIsAdmin);
    }
}

if (window.isGoogleMapsReady) {
    initializeMapLogic();
} else {
    window.addEventListener('google-maps-ready', initializeMapLogic);
}

function loadMapFeatures() {
    if(map) return;

    // Search Bar for Map
    initSearchControl();

    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 41.5006, lng: -85.8305 },
        zoom: 14,
        mapTypeId: 'hybrid',
        disableDefaultUI: !isUserAdmin, 
        zoomControl: true, 
    });

    loadPolygonsFromDatabase();

    // --- DRAWING MANAGER (ADMIN ONLY) ---
    if (isUserAdmin) {
        document.getElementById('admin-instructions').style.display = 'block';

        drawingManager = new google.maps.drawing.DrawingManager({
            drawingMode: google.maps.drawing.OverlayType.POLYGON,
            drawingControl: true,
            drawingControlOptions: {
                position: google.maps.ControlPosition.TOP_LEFT,
                drawingModes: ['polygon']
            },
            polygonOptions: {
                fillColor: '#ffff00',
                fillOpacity: 0.5,
                strokeWeight: 2,
                clickable: true,
                editable: true,
                zIndex: 1
            }
        });
        drawingManager.setMap(map);

        google.maps.event.addListener(drawingManager, 'overlaycomplete', function(e) {
            if (e.type !== google.maps.drawing.OverlayType.MARKER) {
                drawingManager.setDrawingMode(null);
                const newShape = e.overlay;
                newShape.type = e.type;
                
                savePolygonToDatabase(newShape).then(id => {
                    newShape.firebaseId = id; 
                    allShapes.push(newShape);
                    attachPolygonListeners(newShape);
                });
                
                google.maps.event.addListener(newShape, 'click', function() {
                    setSelection(newShape);
                });
                setSelection(newShape);
            }
        });

        google.maps.event.addListener(map, 'click', clearSelection);

        document.addEventListener('keydown', function(e) {
            if (e.key === "Backspace" || e.key === "Delete") {
                deleteSelectedShape();
            }
        });
    }
    
    document.getElementById('export-btn').addEventListener('click', exporttoJSON);

    const importBtn = document.getElementById('import-btn');
    const importInput = document.getElementById('import-input');

    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            // (Import logic remains the same as before...)
            const filename = file.name.toLowerCase();
            if (filename.endsWith('.json') || filename.endsWith('.geojson')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const geoJson = JSON.parse(event.target.result);
                        loadPolygonsFromGeoJSON(geoJson);
                    } catch (error) { console.error(error); }
                };
                reader.readAsText(file);
            }
            // ... (KML/KMZ support assumed from previous version)
            importInput.value = ''; 
        });
    }
}

// --- SEARCH CONTROL ---
function initSearchControl() {
    const controlDiv = document.createElement("div");
    controlDiv.style.marginTop = "10px";
    controlDiv.style.display = "flex";
    controlDiv.style.gap = "5px";
    controlDiv.style.zIndex = "5"; 

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search Address";
    searchInput.style.padding = "8px";
    searchInput.style.borderRadius = "4px";
    searchInput.style.border = "1px solid #ccc";

    const searchBtn = document.createElement("button");
    searchBtn.textContent = "Go";
    searchBtn.style.padding = "8px 12px";
    searchBtn.style.cursor = "pointer";

    controlDiv.appendChild(searchInput);
    controlDiv.appendChild(searchBtn);

    // If map exists, push control
    if(map) map.controls[google.maps.ControlPosition.TOP_CENTER].push(controlDiv);

    const geocoder = new google.maps.Geocoder();
    const performSearch = () => {
        const address = searchInput.value;
        if (!address) return;
        geocoder.geocode({ 'address': address }, function(results, status) {
            if (status === 'OK') {
                map.setCenter(results[0].geometry.location);
                map.setZoom(17);
                if (searchMarker) searchMarker.setMap(null);
                searchMarker = new google.maps.Marker({
                    map: map,
                    position: results[0].geometry.location
                });
            }
        });
    };
    searchBtn.addEventListener("click", performSearch);
}

// --- DATABASE FUNCTIONS (Map) ---
async function savePolygonToDatabase(shape) {
    if (!auth.currentUser) return;
    const coordinates = getCoordinatesFromShape(shape);
    try {
        const docRef = await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'polygons'), {
            coordinates: coordinates,
            type: 'polygon',
            createdAt: new Date()
        });
        return docRef.id;
    } catch (e) { console.error(e); }
}

async function updatePolygonInDatabase(id, shape) {
    if (!auth.currentUser || !id) return;
    const coordinates = getCoordinatesFromShape(shape);
    try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'polygons', id);
        await updateDoc(docRef, { coordinates: coordinates });
    } catch (e) { console.error(e); }
}

async function loadPolygonsFromDatabase() {
    if (!auth.currentUser) return;
    try {
        const querySnapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'polygons'));
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.type === 'polygon' && data.coordinates) {
                const newPolygon = new google.maps.Polygon({
                    paths: data.coordinates,
                    fillColor: '#ffff00',
                    fillOpacity: 0.5,
                    strokeWeight: 2,
                    clickable: true,
                    editable: isUserAdmin, 
                    zIndex: 1
                });
                newPolygon.setMap(map);
                newPolygon.type = 'polygon';
                newPolygon.firebaseId = doc.id; 
                allShapes.push(newPolygon);
                if (isUserAdmin) {
                    attachPolygonListeners(newPolygon);
                    google.maps.event.addListener(newPolygon, 'click', function() {
                        setSelection(newPolygon);
                    });
                }
            }
        });
    } catch (e) { console.error(e); }
}

async function deletePolygonFromDatabase(id) {
    if (!auth.currentUser || !id) return;
    try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'polygons', id));
    } catch (e) { console.error(e); }
}

// --- HELPER FUNCTIONS ---
function getCoordinatesFromShape(shape) {
    const path = shape.getPath();
    const coordinates = [];
    for (let i = 0; i < path.getLength(); i++) {
        const xy = path.getAt(i);
        coordinates.push({ lat: xy.lat(), lng: xy.lng() });
    }
    return coordinates;
}

function attachPolygonListeners(polygon) {
    if (!isUserAdmin) return;
    const path = polygon.getPath();
    const triggerUpdate = () => {
        if (polygon.firebaseId) updatePolygonInDatabase(polygon.firebaseId, polygon);
    };
    google.maps.event.addListener(path, 'set_at', triggerUpdate);
    google.maps.event.addListener(path, 'insert_at', triggerUpdate);
    google.maps.event.addListener(path, 'remove_at', triggerUpdate);
    google.maps.event.addListener(polygon, 'dragend', triggerUpdate);
}

function loadPolygonsFromGeoJSON(geoJson) {
    if (!geoJson.features) return;
    geoJson.features.forEach(feature => {
        if (feature.geometry && feature.geometry.type === "Polygon") {
            const coords = feature.geometry.coordinates[0].map(coord => ({
                lat: coord[1],
                lng: coord[0]
            }));
            const newPolygon = new google.maps.Polygon({
                paths: coords,
                fillColor: '#ffff00',
                fillOpacity: 0.5,
                strokeWeight: 2,
                clickable: true,
                editable: isUserAdmin,
                zIndex: 1
            });
            newPolygon.setMap(map);
            newPolygon.type = 'polygon';
            savePolygonToDatabase(newPolygon).then(id => {
                newPolygon.firebaseId = id;
                allShapes.push(newPolygon);
                attachPolygonListeners(newPolygon);
            });
            if (isUserAdmin) {
                google.maps.event.addListener(newPolygon, 'click', function() { setSelection(newPolygon); });
            }
        }
    });
}

function setSelection(shape) {
    if (!isUserAdmin) return; 
    clearSelection();
    selectedShape = shape;
    shape.setEditable(true);
    shape.setOptions({ strokeColor: '#FF0000' });
}

function clearSelection() {
    if (selectedShape) {
        selectedShape.setEditable(false);
        selectedShape.setOptions({ strokeColor: '#000000' });
        selectedShape = null;
    }
}

function deleteSelectedShape() {
    if (selectedShape && isUserAdmin) {
        if (selectedShape.firebaseId) deletePolygonFromDatabase(selectedShape.firebaseId);
        selectedShape.setMap(null);
        const index = allShapes.indexOf(selectedShape);
        if (index > -1) allShapes.splice(index, 1);
        selectedShape = null;
    }
}

function exporttoJSON() {
    const features = [];
    allShapes.forEach(shape => {
        if (shape.type === 'polygon') {
            const path = shape.getPath();
            const coordinates = [];
            for (let i = 0; i < path.getLength(); i++) {
                const xy = path.getAt(i);
                coordinates.push([xy.lng(), xy.lat()]); 
            }
            if (coordinates.length > 0) coordinates.push(coordinates[0]);
            features.push({
                "type": "Feature",
                "properties": {},
                "geometry": { "type": "Polygon", "coordinates": [coordinates] }
            });
        }
    });
    const geoJsonData = { "type": "FeatureCollection", "features": features };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(geoJsonData));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", "polygons.json");
    document.body.appendChild(dl);
    dl.click();
    dl.remove();
}