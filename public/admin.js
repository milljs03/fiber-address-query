import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, deleteDoc, updateDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- CONFIGURATION ---
// Check if environment config exists, otherwise use hardcoded fallback
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
const db = getFirestore(app); // Initialize Firestore
const provider = new GoogleAuthProvider();

// App ID for Firestore path (using default if not in environment)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'nptel-map-portal';

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
        // Only use custom token if provided by the environment (for previewing)
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        }
        // Removed signInAnonymously to prevent "auth/admin-restricted-operation" errors
        // The app will now just wait for the user to click "Sign in with Google"
    } catch (e) {
        console.warn("Auth initialization warning:", e);
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
        // 1. Check Domain
        if (!user.email.endsWith('@nptel.com')) {
            signOut(auth);
            authMessage.textContent = "Access Denied: @nptel.com email required.";
            return;
        }

        // 2. Access Granted
        loginScreen.style.display = 'none';
        appContainer.style.display = 'block';
        userDisplay.textContent = user.email;

        // 3. Determine Role
        const isAdmin = (user.email.toLowerCase() === 'jmiller@nptel.com');
        
        if (window.mapLogicReadyCallback) {
            window.mapLogicReadyCallback(isAdmin);
        } else {
            window.currentUserIsAdmin = isAdmin;
        }

    } else {
        loginScreen.style.display = 'flex';
        appContainer.style.display = 'none';
    }
});

// --- GOOGLE MAPS LOGIC ---
let map;
let drawingManager;
let selectedShape;
let allShapes = [];
let isUserAdmin = false;
let searchMarker; // Store the current search marker

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

    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 41.5006, lng: -85.8305 }, // New Paris, IN
        zoom: 14,
        mapTypeId: 'hybrid',
        disableDefaultUI: !isUserAdmin, 
        zoomControl: true, 
    });

    // Initialize Search Control
    initSearchControl();

    // LOAD EXISTING POLYGONS FROM DB
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

        // Listen for completion
        google.maps.event.addListener(drawingManager, 'overlaycomplete', function(e) {
            if (e.type !== google.maps.drawing.OverlayType.MARKER) {
                drawingManager.setDrawingMode(null);
                const newShape = e.overlay;
                newShape.type = e.type;
                
                // SAVE TO DATABASE
                savePolygonToDatabase(newShape).then(id => {
                    newShape.firebaseId = id; 
                    allShapes.push(newShape);
                    // Attach edit listeners now that it has an ID
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

            const filename = file.name.toLowerCase();

            if (filename.endsWith('.json') || filename.endsWith('.geojson')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const geoJson = JSON.parse(event.target.result);
                        loadPolygonsFromGeoJSON(geoJson);
                    } catch (error) {
                        console.error("Error parsing JSON:", error);
                        alert("Invalid JSON file");
                    }
                };
                reader.readAsText(file);

            } else if (filename.endsWith('.kmz')) {
                try {
                    const zip = new JSZip();
                    const unzipped = await zip.loadAsync(file);
                    const kmlFilename = Object.keys(unzipped.files).find(name => name.toLowerCase().endsWith('.kml'));
                    
                    if (kmlFilename) {
                        const kmlString = await unzipped.files[kmlFilename].async("string");
                        parseKMLString(kmlString);
                    } else {
                        alert("Invalid KMZ: No .kml file found inside.");
                    }
                } catch (err) {
                    console.error("Error unzipping KMZ:", err);
                    alert("Error processing KMZ file.");
                }

            } else if (filename.endsWith('.kml')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    parseKMLString(event.target.result);
                };
                reader.readAsText(file);
            } else {
                alert("Unsupported file type. Please upload .json, .kml, or .kmz");
            }
            
            importInput.value = ''; 
        });
    }
}

// --- SEARCH CONTROL ---
function initSearchControl() {
    // Inject into the main 'controls' div instead of the map
    const controlsContainer = document.getElementById('controls');
    if (!controlsContainer) return;

    // Create a container for the search elements
    const searchContainer = document.createElement("div");
    searchContainer.style.display = "flex";
    searchContainer.style.gap = "5px";
    searchContainer.style.borderRight = "1px solid #ddd"; // Separator
    searchContainer.style.paddingRight = "10px";
    searchContainer.style.marginRight = "10px";

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search Address...";
    searchInput.style.padding = "8px";
    searchInput.style.borderRadius = "4px";
    searchInput.style.border = "1px solid #ccc";
    searchInput.style.width = "200px";
    searchInput.style.fontSize = "14px";

    const searchBtn = document.createElement("button");
    searchBtn.textContent = "Go";
    searchBtn.style.padding = "8px 12px";
    searchBtn.style.backgroundColor = "#4285F4"; // Google Blue
    searchBtn.style.color = "white";
    searchBtn.style.border = "none";
    searchBtn.style.borderRadius = "4px";
    searchBtn.style.cursor = "pointer";
    searchBtn.style.fontWeight = "bold";
    searchBtn.style.fontSize = "14px";

    searchContainer.appendChild(searchInput);
    searchContainer.appendChild(searchBtn);

    // Insert at the beginning of the controls bar
    controlsContainer.insertBefore(searchContainer, controlsContainer.firstChild);

    const geocoder = new google.maps.Geocoder();

    const performSearch = () => {
        const address = searchInput.value;
        if (!address) return;

        geocoder.geocode({ 'address': address }, function(results, status) {
            if (status === 'OK') {
                map.setCenter(results[0].geometry.location);
                map.setZoom(17); // Zoom in on result

                // Clear previous marker
                if (searchMarker) {
                    searchMarker.setMap(null);
                }

                // Drop teardrop (Marker)
                searchMarker = new google.maps.Marker({
                    map: map,
                    position: results[0].geometry.location,
                    title: address,
                    animation: google.maps.Animation.DROP 
                });
            } else {
                alert('Geocode was not successful for the following reason: ' + status);
            }
        });
    };

    searchBtn.addEventListener("click", performSearch);
    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") performSearch();
    });
}

// --- DATABASE FUNCTIONS ---

async function savePolygonToDatabase(shape) {
    if (!auth.currentUser) return;
    const coordinates = getCoordinatesFromShape(shape);

    try {
        const docRef = await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'polygons'), {
            coordinates: coordinates,
            type: 'polygon',
            createdAt: new Date()
        });
        console.log("Document written with ID: ", docRef.id);
        return docRef.id;
    } catch (e) {
        console.error("Error adding document: ", e);
        alert("Failed to save polygon to database.");
    }
}

// NEW: Function to update existing polygon
async function updatePolygonInDatabase(id, shape) {
    if (!auth.currentUser || !id) return;
    const coordinates = getCoordinatesFromShape(shape);

    try {
        const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'polygons', id);
        await updateDoc(docRef, {
            coordinates: coordinates
        });
        console.log("Updated polygon coordinates for ID:", id);
    } catch (e) {
        console.error("Error updating document: ", e);
    }
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
                    attachPolygonListeners(newPolygon); // Attach listeners on load
                    google.maps.event.addListener(newPolygon, 'click', function() {
                        setSelection(newPolygon);
                    });
                }
            }
        });
    } catch (e) {
        console.error("Error loading documents: ", e);
    }
}

async function deletePolygonFromDatabase(id) {
    if (!auth.currentUser || !id) return;
    try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'polygons', id));
        console.log("Document deleted with ID: ", id);
    } catch (e) {
        console.error("Error deleting document: ", e);
        alert("Failed to delete polygon from database.");
    }
}

// --- HELPER FUNCTIONS ---

// Extract simple coordinate array from Google Maps Shape
function getCoordinatesFromShape(shape) {
    const path = shape.getPath();
    const coordinates = [];
    for (let i = 0; i < path.getLength(); i++) {
        const xy = path.getAt(i);
        coordinates.push({ lat: xy.lat(), lng: xy.lng() });
    }
    return coordinates;
}

// Listen for edit events (Vertex move, Vertex add, Vertex remove, Whole shape drag)
function attachPolygonListeners(polygon) {
    if (!isUserAdmin) return;

    const path = polygon.getPath();

    // Helper to debounce updates slightly or just trigger update
    const triggerUpdate = () => {
        if (polygon.firebaseId) {
            updatePolygonInDatabase(polygon.firebaseId, polygon);
        }
    };

    // Listen to changes on the path (points moved/added/deleted)
    google.maps.event.addListener(path, 'set_at', triggerUpdate);
    google.maps.event.addListener(path, 'insert_at', triggerUpdate);
    google.maps.event.addListener(path, 'remove_at', triggerUpdate);
    
    // Listen to the whole shape being dragged
    google.maps.event.addListener(polygon, 'dragend', triggerUpdate);
}

function parseKMLString(kmlString) {
    const parser = new DOMParser();
    const kmlDom = parser.parseFromString(kmlString, 'text/xml');
    
    if (window.toGeoJSON && window.toGeoJSON.kml) {
        const geoJson = window.toGeoJSON.kml(kmlDom);
        loadPolygonsFromGeoJSON(geoJson);
    } else {
        alert("Error: KML Parser library not loaded.");
    }
}

function loadPolygonsFromGeoJSON(geoJson) {
    if (!geoJson.features) {
        alert("Invalid GeoJSON format or empty file.");
        return;
    }

    let count = 0;
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
                attachPolygonListeners(newPolygon); // Attach listeners on import
            });

            if (isUserAdmin) {
                google.maps.event.addListener(newPolygon, 'click', function() {
                    setSelection(newPolygon);
                });
            }
            count++;
        }
    });
    alert(`Importing ${count} polygons to database...`);
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
        if (selectedShape.firebaseId) {
            deletePolygonFromDatabase(selectedShape.firebaseId);
        }

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