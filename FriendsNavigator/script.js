// 🔥 Firebase config
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDQBpM6DFHWVcPyNPLjdSfrP3NAxc4FXu4",
  authDomain: "loc-live-track.firebaseapp.com",
  databaseURL: "https://loc-live-track-default-rtdb.firebaseio.com",
  projectId: "loc-live-track",
  storageBucket: "loc-live-track.firebasestorage.app",
  messagingSenderId: "1097169095550",
  appId: "1:1097169095550:web:34e63d85ee686cecc5012f",
  measurementId: "G-M2S6EZTPFL"
};

// OSRM Routing API (public instance)
const OSRM_API = "https://router.project-osrm.org/route/v1/driving";

// State
let db = null;
let userId = null;
let currentTeam = null;
let map = null;
let watchId = null;
let markers = {};
let waypointMarkers = {};
let meetupMarker = null;
let meetupPoint = null;
let waypoints = [];
let waypointDropMode = false;
let myPosition = null;
let displayName = null;
let routePolylines = {};
let membersData = {};

// Wait for DOM and Firebase to be ready
function initializeApp() {
  try {
    // Check if Firebase is available
    if (typeof firebase === 'undefined') {
      console.error('Firebase is not loaded!');
      alert('Firebase failed to load. Please refresh the page.');
      return;
    }

    // Init Firebase
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    
    // User ID
    userId = localStorage.getItem("fn_uid");
    if (!userId) {
      userId = "u_" + Math.random().toString(36).slice(2, 8);
      localStorage.setItem("fn_uid", userId);
    }

    // Display name
    let storedName = localStorage.getItem("fn_name");
    if (!storedName) {
      // If user has never set a name, assign a friendly fallback like "User 1", "User 2", ...
      const currentNumber = parseInt(localStorage.getItem("fn_user_number") || "0", 10) || 0;
      const nextNumber = currentNumber + 1;
      localStorage.setItem("fn_user_number", String(nextNumber));
      storedName = `User ${nextNumber}`;
      localStorage.setItem("fn_name", storedName);
    }
    displayName = storedName;
    
    initApp();
  } catch (error) {
    console.error('Initialization error:', error);
    alert('Failed to initialize app: ' + error.message);
  }
}

// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
  // Wait for Firebase to be ready
  if (window.firebaseReady || typeof firebase !== 'undefined') {
    initializeApp();
  } else {
    window.initAppWhenReady = initializeApp;
    // Fallback: try after a short delay
    setTimeout(() => {
      if (typeof firebase !== 'undefined') {
        initializeApp();
      } else {
        console.error('Firebase still not loaded after timeout');
        alert('Firebase failed to load. Please check your internet connection and refresh.');
      }
    }, 2000);
  }
});

function initApp() {
  console.log("✅ initApp() called - App initializing...");
  
  // Views
  function show(view) {
    console.log("Switching to view:", view);
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    const targetView = document.getElementById(view);
    if (targetView) {
      targetView.classList.add("active");
    } else {
      console.error("View not found:", view);
    }
  }

  // Elements
  const recentList = document.getElementById("recentList");
  const createName = document.getElementById("createName");
  const joinName = document.getElementById("joinName");
  const teamNameDisplay = document.getElementById("teamNameDisplay");
  const membersList = document.getElementById("membersList");
  const waypointsList = document.getElementById("waypointsList");
  const createDisplayNameInput = document.getElementById("createDisplayName");
  const joinDisplayNameInput = document.getElementById("joinDisplayName");
  const directionsCard = document.getElementById("directionsCard");
  const directionDestination = document.getElementById("directionDestination");
  const directionDetails = document.getElementById("directionDetails");
  const clearDirectionsBtn = document.getElementById("clearDirections");
  const locateUsBtn = document.getElementById("btnLocateUs");

  // ============================================
  // 🟦 1. MAP SETUP FUNCTIONS
  // ============================================

  function initMap() {
    if (map) return;

    map = L.map('map').setView([12.97, 77.6], 13);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    // Prepare layers
    map.on('click', onMapClick);
  }

  function initFirebaseListeners() {
    if (!currentTeam) return;
    
    // Listen for member updates
    db.ref(`teams/${currentTeam}/members`).on('value', onMembersUpdate);
    
    // Listen for waypoint updates
    db.ref(`teams/${currentTeam}/waypoints`).on('value', onWaypointsUpdate);
    
    // Listen for meetup updates
    db.ref(`teams/${currentTeam}/meetup`).on('value', onMeetupUpdate);
  }

  // ============================================
  // 🟩 2. GEOLOCATION FUNCTIONS
  // ============================================

  function startGeolocation() {
    if (watchId) stopGeolocation();

    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    watchId = navigator.geolocation.watchPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        myPosition = { lat: latitude, lng: longitude };
        sendLocation(latitude, longitude);
      },
      error => {
        console.error("Geolocation error:", error);
        alert("Location access denied. Please enable location permissions.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function stopGeolocation() {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  function sendLocation(lat, lng) {
    if (!currentTeam) return;
    
    db.ref(`teams/${currentTeam}/members/${userId}`).update({
      id: userId,
      name: displayName,
      lat: lat,
      lng: lng,
      ts: Date.now()
    });
  }

  // ============================================
  // 🟧 3. MARKER HANDLING FUNCTIONS
  // ============================================

  function createUserMarker(userId, name, lat, lng) {
    if (markers[userId]) return markers[userId];

    const isMe = userId === window.userId;
    const icon = L.divIcon({
      className: 'user-marker' + (isMe ? ' me' : ''),
      html: `<div class="marker-pin ${isMe ? 'me' : ''}">${isMe ? 'YOU' : name?.charAt(0) || 'U'}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30]
    });

    const marker = L.marker([lat, lng], { icon }).addTo(map);
    
    if (name) {
      marker.bindPopup(name);
    }

    markers[userId] = marker;
    return marker;
  }

  function updateUserMarker(userId, lat, lng) {
    if (!markers[userId]) {
      const member = getMemberData(userId);
      createUserMarker(userId, member?.name, lat, lng);
      return;
    }

    const newPos = [lat, lng];
    animateMarkerMove(markers[userId], newPos);
  }

  function animateMarkerMove(marker, newPos, duration = 1000) {
    const startPos = marker.getLatLng();
    const startTime = performance.now();

    function animate(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing function (ease-out)
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      
      const lat = startPos.lat + (newPos[0] - startPos.lat) * easeProgress;
      const lng = startPos.lng + (newPos[1] - startPos.lng) * easeProgress;
      
      marker.setLatLng([lat, lng]);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }
    
    requestAnimationFrame(animate);
  }

  function removeUserMarker(userId) {
    if (markers[userId]) {
      map.removeLayer(markers[userId]);
      delete markers[userId];
    }
  }

  function getMemberData(userId) {
    // This will be populated from Firebase
    return null;
  }

  // ============================================
  // 🟫 4. WAYPOINT FUNCTIONS
  // ============================================

  function enableWaypointDrop() {
    waypointDropMode = !waypointDropMode;
    const btn = document.getElementById("btnWaypointMode");
    
    if (waypointDropMode) {
      btn.classList.add("active");
      map.getContainer().style.cursor = "crosshair";
      btn.title = "Click map to add waypoint (Click again to cancel)";
    } else {
      btn.classList.remove("active");
      map.getContainer().style.cursor = "";
      btn.title = "Drop Waypoints";
    }
  }

  function addWaypoint(lat, lng, name = null) {
    if (!currentTeam) return;

    // Limit to 2 saved locations per team
    if (waypoints.length >= 2) {
      alert("Only 2 locations can be saved. Please remove one before adding another.");
      // Turn off drop mode if we were in it
      waypointDropMode = false;
      const btn = document.getElementById("btnWaypointMode");
      if (btn) {
        btn.classList.remove("active");
        btn.title = "Drop Waypoints";
      }
      if (map) {
        map.getContainer().style.cursor = "";
      }
      return;
    }

    // Ask for a friendly trip title / destination if none was given
    if (!name) {
      const entered = prompt("Enter trip title or destination name:", "");
      if (entered && entered.trim()) {
        name = entered.trim();
      }
    }

    const wpId = "wp_" + Date.now();
    const waypoint = {
      id: wpId,
      lat: lat,
      lng: lng,
      name: name || `Location ${waypoints.length + 1}`,
      order: waypoints.length,
      createdAt: Date.now()
    };

    db.ref(`teams/${currentTeam}/waypoints/${wpId}`).set(waypoint);
  }

  function renderWaypoint(waypoint) {
    if (waypointMarkers[waypoint.id]) {
      updateWaypoint(waypoint);
      return;
    }

    const isMeetup = meetupPoint && meetupPoint.waypointId === waypoint.id;
    const icon = L.divIcon({
      className: 'waypoint-marker' + (isMeetup ? ' meetup' : ''),
      html: `<div class="waypoint-pin ${isMeetup ? 'meetup' : ''}">📍</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30]
    });

    const marker = L.marker([waypoint.lat, waypoint.lng], { icon })
      .addTo(map)
      .bindPopup(waypoint.name)
      .on('click', () => onWaypointClick(waypoint.id));

    waypointMarkers[waypoint.id] = marker;
  }

  function updateWaypoint(waypoint) {
    const marker = waypointMarkers[waypoint.id];
    if (!marker) {
      renderWaypoint(waypoint);
      return;
    }

    marker.setLatLng([waypoint.lat, waypoint.lng]);
    marker.setPopupContent(waypoint.name);
    
    const isMeetup = meetupPoint && meetupPoint.waypointId === waypoint.id;
    const icon = L.divIcon({
      className: 'waypoint-marker' + (isMeetup ? ' meetup' : ''),
      html: `<div class="waypoint-pin ${isMeetup ? 'meetup' : ''}">📍</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30]
    });
    marker.setIcon(icon);
  }

  function removeWaypoint(wpId) {
    if (waypointMarkers[wpId]) {
      map.removeLayer(waypointMarkers[wpId]);
      delete waypointMarkers[wpId];
    }
    
    waypoints = waypoints.filter(wp => wp.id !== wpId);
    updateWaypointsUI();
  }

  function focusWaypointLocation(wpId) {
    const waypoint = waypoints.find(wp => wp.id === wpId);
    if (!waypoint || !map) return;

    // Collapse panel so map is clearly visible
    const panel = document.querySelector(".panel");
    if (panel) {
      panel.classList.add("collapsed");
    }

    // Center and zoom to the chosen waypoint (like dropping a pin there)
    map.setView([waypoint.lat, waypoint.lng], 17, { animate: true });

    // Brief highlight circle to mimic a freshly dropped pin
    const highlight = L.circleMarker([waypoint.lat, waypoint.lng], {
      radius: 14,
      color: '#facc15',
      weight: 3,
      fillColor: '#facc15',
      fillOpacity: 0.4
    }).addTo(map);

    setTimeout(() => {
      map.removeLayer(highlight);
      const marker = waypointMarkers[wpId];
      if (marker) {
        marker.openPopup();
      }
    }, 1200);
  }

  function onWaypointClick(wpId) {
    const waypoint = waypoints.find(wp => wp.id === wpId);
    if (!waypoint) return;

    const popup = L.popup()
      .setLatLng([waypoint.lat, waypoint.lng])
      .setContent(`
        <div class="waypoint-popup">
          <strong>${waypoint.name}</strong>
          <button onclick="setMeetupWaypoint('${wpId}')">Set as Meetup</button>
          <button onclick="removeWaypointById('${wpId}')">Remove</button>
          <button onclick="showDirectionsForWaypoint('${wpId}')">Directions + ETA</button>
        </div>
      `)
      .openOn(map);
  }

  // Global functions for popup buttons
  window.setMeetupWaypoint = (wpId) => setMeetupWaypoint(wpId);
  window.removeWaypointById = (wpId) => {
    if (!currentTeam) return;
    db.ref(`teams/${currentTeam}/waypoints/${wpId}`).remove();
  };
  window.computeETAsForWaypoint = (wpId) => computeETAsForWaypoint(wpId);
   window.focusWaypointLocation = (wpId) => focusWaypointLocation(wpId);

  // ============================================
  // 🟥 5. MEETUP HANDLING FUNCTIONS
  // ============================================

  function setMeetupWaypoint(wpId) {
    if (!currentTeam) return;
    
    const waypoint = waypoints.find(wp => wp.id === wpId);
    if (!waypoint) return;

    db.ref(`teams/${currentTeam}/meetup`).set({
      waypointId: wpId,
      lat: waypoint.lat,
      lng: waypoint.lng,
      name: waypoint.name,
      updatedAt: Date.now()
    });
  }

  function renderMeetupMarker(lat, lng) {
    if (meetupMarker) {
      meetupMarker.setLatLng([lat, lng]);
      return;
    }

    const icon = L.divIcon({
      className: 'meetup-marker',
      html: '<div class="meetup-pin">🎯 MEET HERE</div>',
      iconSize: [100, 40],
      iconAnchor: [50, 40]
    });

    meetupMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup("Meetup Point");
  }

  function highlightSelectedWaypoint(waypoint) {
    // Update all waypoint markers to show which is selected
    Object.keys(waypointMarkers).forEach(wpId => {
      const marker = waypointMarkers[wpId];
      const isSelected = waypoint && wpId === waypoint.id;
      
      const icon = L.divIcon({
        className: 'waypoint-marker' + (isSelected ? ' meetup' : ''),
        html: `<div class="waypoint-pin ${isSelected ? 'meetup' : ''}">📍</div>`,
        iconSize: isSelected ? [40, 40] : [30, 30],
        iconAnchor: isSelected ? [20, 40] : [15, 30]
      });
      marker.setIcon(icon);
    });
  }

  // ============================================
  // 🟨 6. ETA & ROUTING FUNCTIONS
  // ============================================

  async function computeETAsForWaypoint(wpId) {
    const waypoint = waypoints.find(wp => wp.id === wpId);
    if (!waypoint || !myPosition) {
      alert("Your location is not available");
      return;
    }

    const from = `${myPosition.lng},${myPosition.lat}`;
    const to = `${waypoint.lng},${waypoint.lat}`;
    const url = `${OSRM_API}/${from};${to}?overview=false`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const duration = Math.round(route.duration / 60); // minutes
        const distance = (route.distance / 1000).toFixed(1); // km
        
        showETAs([{
          waypoint: waypoint.name,
          duration: duration,
          distance: distance
        }]);
      } else {
        alert("Could not calculate route");
      }
    } catch (error) {
      console.error("ETA calculation error:", error);
      alert("Failed to calculate ETA");
    }
  }

  function showETAs(results) {
    const popup = document.getElementById("etaPopup");
    let html = "<strong>Estimated Time & Distance</strong><ul>";
    
    results.forEach(result => {
      html += `<li>${result.waypoint}: ${result.duration} min (${result.distance} km)</li>`;
    });
    html += "</ul>";
    
    popup.innerHTML = html;
    popup.style.display = "block";
    
    setTimeout(() => {
      popup.style.display = "none";
    }, 5000);
  }

  function showDirectionsInfo(destination, distance, duration) {
    if (!directionsCard || !directionDestination || !directionDetails) return;
    directionDestination.textContent = destination;
    directionDetails.textContent = `${distance} km • ${duration} min`;
    directionsCard.classList.remove("hidden");
  }

  function clearDirections() {
    if (map && routePolylines) {
      Object.values(routePolylines).forEach(pl => {
        if (pl) {
          map.removeLayer(pl);
        }
      });
    }
    routePolylines = {};
    if (directionsCard) {
      directionsCard.classList.add("hidden");
    }
    if (directionDestination) {
      directionDestination.textContent = "Directions";
    }
    if (directionDetails) {
      directionDetails.textContent = "Pick a waypoint to see route, distance, and ETA.";
    }
  }

  async function showDirectionsForWaypoint(wpId) {
    const waypoint = waypoints.find(wp => wp.id === wpId);
    if (!waypoint) return;
    if (!membersData || Object.keys(membersData).length === 0) {
      alert("No members with locations available yet");
      return;
    }

    // Clear any existing routes
    clearDirections();

    const palette = ['#22c55e', '#f97316', '#e11d48', '#a855f7', '#facc15'];
    let paletteIndex = 0;
    const results = [];

    const memberIds = Object.keys(membersData);

    for (const id of memberIds) {
      const m = membersData[id];
      if (!m || m.lat == null || m.lng == null) continue;

      const from = `${m.lng},${m.lat}`;
      const to = `${waypoint.lng},${waypoint.lat}`;
      const url = `${OSRM_API}/${from};${to}?overview=full&geometries=geojson`;

      try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.code !== 'Ok' || !data.routes?.length) continue;

        const route = data.routes[0];
        const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

        const isMe = id === userId;
        const color = isMe ? '#06b6d4' : palette[paletteIndex++ % palette.length];
        const weight = isMe ? 5 : 3;

        const polyline = L.polyline(coords, { color, weight, opacity: 0.9 }).addTo(map);
        routePolylines[id] = polyline;

        const duration = Math.round(route.duration / 60);
        const distance = (route.distance / 1000).toFixed(1);

        results.push({
          waypoint: `${waypoint.name} — ${isMe ? 'You' : (m.name || id)}`,
          duration,
          distance
        });
      } catch (error) {
        console.error("Directions error for member", id, error);
      }
    }

    const polylinesArray = Object.values(routePolylines);
    if (polylinesArray.length > 0) {
      const group = L.featureGroup(polylinesArray);
      map.fitBounds(group.getBounds(), { padding: [40, 40] });
    }

    if (results.length > 0) {
      // Prefer to show "you" in the card if available
      const meResult = results.find(r => r.waypoint.includes('You'));
      const main = meResult || results[0];
      showDirectionsInfo(waypoint.name, main.distance, main.duration);
      showETAs(results);
    } else {
      alert("Could not calculate routes for any members");
    }
  }

  window.showDirectionsForWaypoint = (wpId) => showDirectionsForWaypoint(wpId);

  // ============================================
  // 🟪 7. FIREBASE EVENT HANDLERS
  // ============================================

  function renderMembersList() {
    membersList.innerHTML = "";
    const now = Date.now();

    Object.keys(membersData || {}).forEach(id => {
      const m = membersData[id];
      if (!m) return;

      const isOnline = typeof m.ts === "number" && now - m.ts <= 20000;
      if (!isOnline) {
        // Hide markers for offline members
        removeUserMarker(id);
        return;
      }

      // UI row
      const row = document.createElement("div");
      row.className = "memberRow";
      row.textContent = m.name || m.id;
      if (id === userId) row.classList.add("me");
      membersList.appendChild(row);

      // Markers
      if (m.lat != null && m.lng != null) {
        if (markers[id]) {
          updateUserMarker(id, m.lat, m.lng);
        } else {
          createUserMarker(id, m.name || m.id, m.lat, m.lng);
        }
      } else {
        removeUserMarker(id);
      }
    });

    // Remove markers for users no longer in membersData
    Object.keys(markers).forEach(id => {
      if (!membersData || !membersData[id]) {
        removeUserMarker(id);
      }
    });
  }

  function onMembersUpdate(snap) {
    membersData = snap.val() || {};
    renderMembersList();
  }

  function onWaypointsUpdate(snap) {
    const waypointsData = snap.val() || {};
    waypoints = Object.values(waypointsData).sort((a, b) => a.order - b.order);

    // Remove old markers
    Object.keys(waypointMarkers).forEach(wpId => {
      if (!waypointsData[wpId]) {
        removeWaypoint(wpId);
      }
    });

    // Render waypoints
    waypoints.forEach(wp => renderWaypoint(wp));
    
    updateWaypointsUI();
  }

  function onMeetupUpdate(snap) {
    const meetup = snap.val();
    meetupPoint = meetup;

    if (meetup && meetup.lat && meetup.lng) {
      renderMeetupMarker(meetup.lat, meetup.lng);
      
      if (meetup.waypointId) {
        const waypoint = waypoints.find(wp => wp.id === meetup.waypointId);
        if (waypoint) {
          highlightSelectedWaypoint(waypoint);
        }
      }
    } else if (meetupMarker) {
      map.removeLayer(meetupMarker);
      meetupMarker = null;
    }
  }

  // ============================================
  // 🟫 8. UI FUNCTIONS
  // ============================================

  function handleLeaveTeam() {
    if (confirm("Leave this team?")) {
      const lastTeam = currentTeam;
      clearDirections();
      cleanupBeforeExit();
      show("homeView");
      if (lastTeam) {
        alert(`You left team: ${lastTeam}`);
      } else {
        alert("You left the team.");
      }
    }
  }

  function persistDisplayNameFromInput(inputEl) {
    if (!inputEl) return;
    const value = inputEl.value.trim();
    if (value) {
      displayName = value;
      localStorage.setItem("fn_name", displayName);
      if (currentTeam) {
        db.ref(`teams/${currentTeam}/members/${userId}`).update({ name: displayName });
      }
    }
  }

  // Persist display name when it comes from a prompt or other source (non-input)
  function persistDisplayNameValue(value) {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    displayName = trimmed;
    localStorage.setItem("fn_name", displayName);
    if (currentTeam) {
      db.ref(`teams/${currentTeam}/members/${userId}`).update({ name: displayName });
    }
  }

  function prefillDisplayNameInput(inputEl) {
    if (!inputEl) return;
    inputEl.value = displayName || "";
  }

  function updateDisplayName() {
    const name = prompt("Enter your display name:", displayName);
    if (name && name.trim()) {
      displayName = name.trim();
      localStorage.setItem("fn_name", displayName);
      if (currentTeam) {
        db.ref(`teams/${currentTeam}/members/${userId}`).update({ name: displayName });
      }
    }
  }

  function recenterToUser() {
    if (myPosition && map) {
      map.setView([myPosition.lat, myPosition.lng], 15, { animate: true });
    } else {
      alert("Your location is not available");
    }
  }

  function toggleWaypointPanel() {
    const panel = document.querySelector(".panel");
    panel.classList.toggle("collapsed");
  }

  function updateWaypointsUI() {
    waypointsList.innerHTML = "";
    
    if (waypoints.length === 0) {
      waypointsList.innerHTML = "<p style='opacity:0.6;'>No waypoints yet</p>";
      return;
    }

    waypoints.forEach((wp, index) => {
      const item = document.createElement("div");
      item.className = "waypoint-item";
      item.innerHTML = `
        <span>${index + 1}. ${wp.name}</span>
        <div class="waypoint-actions">
          <button onclick="setMeetupWaypoint('${wp.id}')" class="small">Set Meetup</button>
          <button onclick="showDirectionsForWaypoint('${wp.id}')" class="small">Directions + ETA</button>
          <button onclick="removeWaypointById('${wp.id}')" class="small outline">Remove</button>
        </div>
      `;
      waypointsList.appendChild(item);
    });
  }

  // ============================================
  // 🟦 9. DATA MANAGEMENT FUNCTIONS
  // ============================================

  function loadInitialTeamData(teamId) {
    db.ref(`teams/${teamId}`).once('value', snap => {
      const team = snap.val();
      if (team) {
        teamNameDisplay.textContent = team.name || teamId;
        refreshRecentTeamName(teamId, team.name || teamId);
      }
    });
  }

  function syncMembers() {
    // Handled by Firebase listeners
  }

  function syncWaypoints() {
    // Handled by Firebase listeners
  }

  function bumpRecentTeamUsage(teamId, teamName, createdAt) {
    if (!teamId) return;
    db.ref(`recentTeams/${teamId}`).transaction(current => {
      const now = Date.now();
      const created = current?.createdAt || createdAt || now;
      if (current) {
        return {
          ...current,
          name: teamName || current.name || teamId,
          lastUsed: now,
          uses: (current.uses || 0) + 1,
          createdAt: created
        };
      }
      return {
        name: teamName || teamId,
        lastUsed: now,
        uses: 1,
        createdAt: created
      };
    });
  }

  function refreshRecentTeamName(teamId, teamName) {
    if (!teamId || !teamName) return;
    db.ref(`recentTeams/${teamId}`).update({ name: teamName });
  }

  // ============================================
  // 🟩 10. CLEANUP
  // ============================================

  function cleanupBeforeExit() {
    stopGeolocation();
    clearDirections();
    
    // Remove all markers
    Object.keys(markers).forEach(id => removeUserMarker(id));
    Object.keys(waypointMarkers).forEach(id => removeWaypoint(id));
    
    if (meetupMarker) {
      map.removeLayer(meetupMarker);
      meetupMarker = null;
    }

    // Remove from team
    if (currentTeam) {
      db.ref(`teams/${currentTeam}/members/${userId}`).remove();
    }

    // Clear Firebase listeners
    if (currentTeam) {
      db.ref(`teams/${currentTeam}/members`).off();
      db.ref(`teams/${currentTeam}/waypoints`).off();
      db.ref(`teams/${currentTeam}/meetup`).off();
    }

    currentTeam = null;
    waypointDropMode = false;
    map.getContainer().style.cursor = "";
  }

  // ============================================
  // EVENT HANDLERS
  // ============================================

  function onMapClick(e) {
    if (waypointDropMode) {
      addWaypoint(e.latlng.lat, e.latlng.lng);
      enableWaypointDrop(); // Turn off after adding
    }
  }

  // Load recent teams
  function loadRecent() {
    db.ref("recentTeams").on("value", snap => {
      recentList.innerHTML = "";
      const teams = snap.val() || {};
      const sorted = Object.keys(teams).map(id => ({
        id,
        ...teams[id]
      })).sort((a, b) => {
        // Sort by most recently created; fallback to lastUsed
        const createdDiff = (b.createdAt || 0) - (a.createdAt || 0);
        if (createdDiff !== 0) return createdDiff;
        return (b.lastUsed || 0) - (a.lastUsed || 0);
      }).slice(0, 5);

      if (sorted.length === 0) {
        const empty = document.createElement("li");
        empty.className = "recent-empty";
        empty.textContent = "Join or create a team to see it here.";
        recentList.appendChild(empty);
        return;
      }

      sorted.forEach(team => {
        const li = document.createElement("li");
        li.className = "recent-item";
        const usageText = team.createdAt ? `Created ${new Date(team.createdAt).toLocaleString()}` : "Recently created";
        li.innerHTML = `
          <div>
            <strong>${team.name}</strong>
            <span class="recent-meta">${usageText}</span>
          </div>
          <span class="recent-action">Join →</span>
        `;
        li.onclick = () => {
          // Ask for a display name before joining from the recent list
          const namePrompt = prompt("Enter your display name (shown to the team):", displayName || "");
          if (namePrompt && namePrompt.trim()) {
            persistDisplayNameValue(namePrompt);
          }
          joinTeam(team.id, { teamName: team.name, createdAt: team.createdAt });
        };
        recentList.appendChild(li);
      });
    });
  }

  // Create team
  const btnCreate = document.getElementById("btnCreate");
  const btnJoin = document.getElementById("btnJoin");
  const createCancel = document.getElementById("createCancel");
  const createSubmit = document.getElementById("createSubmit");
  const joinCancel = document.getElementById("joinCancel");
  const joinSubmit = document.getElementById("joinSubmit");

  if (!btnCreate || !btnJoin) {
    console.error("Buttons not found! Check HTML structure.");
    return;
  }

  btnCreate.onclick = () => {
    console.log("Create button clicked");
    show("createView");
    prefillDisplayNameInput(createDisplayNameInput);
  };
  
  if (createCancel) {
    createCancel.onclick = () => show("homeView");
  }

  if (createSubmit) {
    createSubmit.onclick = async () => {
      persistDisplayNameFromInput(createDisplayNameInput);
      const rawName = createName.value.trim() || "Team";
      // Use a stable, shareable team id derived from the name so others can join it
      let id = rawName
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      if (!id) {
        id = "team-" + Math.random().toString(36).slice(2, 6);
      }
      // If the id already exists, append a short suffix to avoid collision
      const finalId = id;
      const createdAt = Date.now();

      try {
        await db.ref("teams/" + finalId).set({ name: rawName, createdAt });
        alert(`Team created!\nShare this ID with friends so they join the SAME team:\n\n${finalId}`);
        joinTeam(finalId, { teamName: rawName, createdAt });
      } catch (error) {
        console.error("Error creating team:", error);
        alert("Failed to create team. Check console for details.");
      }
    };
  }

  // Join team
  btnJoin.onclick = () => {
    console.log("Join button clicked");
    show("joinView");
    prefillDisplayNameInput(joinDisplayNameInput);
  };
  
  if (joinCancel) {
    joinCancel.onclick = () => show("homeView");
  }

  if (joinSubmit) {
    joinSubmit.onclick = () => {
      persistDisplayNameFromInput(joinDisplayNameInput);
      joinTeam(joinName.value.trim());
    };
  }

  // Join team handler
  function joinTeam(teamId, options = {}) {
    if (!teamId) return alert("Enter a valid team ID");
    const providedName = options.teamName;
    const createdAt = options.createdAt;

    currentTeam = teamId;
    window.userId = userId; // For global functions
    
    show("mapView");
    teamNameDisplay.textContent = providedName || teamId;

    // Initialize map
    initMap();

    // Add user to team
    db.ref(`teams/${teamId}/members/${userId}`).set({
      id: userId,
      name: displayName,
      lat: null,
      lng: null,
      ts: Date.now()
    });

    // Start location tracking
    startGeolocation();

    bumpRecentTeamUsage(teamId, providedName, createdAt);

    // Load initial data
    loadInitialTeamData(teamId);
    
    // Set up Firebase listeners
    initFirebaseListeners();
  }

  // Map controls (only if map view elements exist)
  const btnWaypointMode = document.getElementById("btnWaypointMode");
  const btnRecenter = document.getElementById("btnRecenter");
  const btnWaypointPanel = document.getElementById("btnWaypointPanel");
  const leaveTeamBtn = document.getElementById("leaveTeam");
  const btnAddWaypoint = document.getElementById("btnAddWaypoint");

  if (btnWaypointMode) btnWaypointMode.onclick = enableWaypointDrop;
  if (btnRecenter) btnRecenter.onclick = recenterToUser;
  if (locateUsBtn) locateUsBtn.onclick = recenterToUser;
  if (btnWaypointPanel) btnWaypointPanel.onclick = toggleWaypointPanel;
  if (leaveTeamBtn) leaveTeamBtn.onclick = handleLeaveTeam;
  if (btnAddWaypoint) {
    // Hide the "+ Add Waypoint" button in the UI
    btnAddWaypoint.style.display = "none";
    // If you ever want to re-enable adding by button, remove the line above
    // and keep this click handler:
    btnAddWaypoint.onclick = () => {
      if (myPosition) {
        addWaypoint(myPosition.lat, myPosition.lng);
      } else {
        enableWaypointDrop();
        alert("Click on the map to add a waypoint");
      }
    };
  }
  if (clearDirectionsBtn) clearDirectionsBtn.onclick = clearDirections;

  // Tab switching
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add("active");
    };
  });

  // Panel close
  document.getElementById("btnClosePanel").onclick = () => {
    document.querySelector(".panel").classList.add("collapsed");
  };

  // Periodically prune offline members (no update for > 20s)
  setInterval(() => {
    renderMembersList();
  }, 5000);

  // Initialize
  console.log("✅ All event handlers attached");
  loadRecent();
  console.log("✅ App initialized successfully!");
}
