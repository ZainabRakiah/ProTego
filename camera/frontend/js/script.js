/* -----------------------------------------
   SAFEWALK FRONTEND JS (BACKEND-AWARE)
------------------------------------------*/

const BACKEND_URL = "http://127.0.0.1:5001";

/* ================================
   AUTH SESSION HELPER
================================ */
function getLoggedInUser() {
  return JSON.parse(sessionStorage.getItem("user"));
}

function requireLogin() {
  if (!getLoggedInUser()) {
    window.location.href = "index.html";
  }
}


/* ================================
   LOGIN PAGE (BACKEND)
================================ */
if (document.getElementById("loginBtn")) {
  document.getElementById("loginBtn").addEventListener("click", async () => {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!email || !password) {
      alert("Please enter email and password");
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Login failed");
        return;
      }

      // ✅ Store session (temporary, replaced by JWT later)
      sessionStorage.setItem("user", JSON.stringify(data.user));

      alert("Login successful");
      window.location.href = "dashboard.html";

    } catch (err) {
      console.error(err);
      alert("Backend server not reachable");
    }
  });
}


/* ================================
   SIGNUP PAGE (BACKEND)
================================ */
if (document.getElementById("registerBtn")) {
  document.getElementById("registerBtn").addEventListener("click", async () => {
    const name = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const phone = document.getElementById("reg-phone").value.trim();
    const password = document.getElementById("reg-pass").value.trim();
    const confirmPassword = document.getElementById("reg-cpass").value.trim();

    if (!name || !email || !password || !confirmPassword) {
      alert("Please fill all required fields");
      return;
    }

    if (password !== confirmPassword) {
      alert("Passwords do not match");
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Signup failed");
        return;
      }

      alert("Registration successful. Please login.");
      window.location.href = "index.html";

    } catch (err) {
      console.error(err);
      alert("Backend server not reachable");
    }
  });
}


/* ================================
   DASHBOARD / MAP / PROFILE PROTECTION
================================ */
if (
  window.location.pathname.includes("dashboard") ||
  window.location.pathname.includes("map") ||
  window.location.pathname.includes("profile") ||
  window.location.pathname.includes("report")
) {
  requireLogin();
}


/* ================================
   REPORT PAGE (TEMP – UI ONLY)
================================ */
if (document.getElementById("submitReport")) {
  document.getElementById("submitReport").addEventListener("click", () => {
    const loc = document.getElementById("rep-location").value.trim();
    const desc = document.getElementById("rep-desc").value.trim();

    if (!loc || !desc) {
      alert("Please fill location and description");
      return;
    }

    alert("Report submitted (backend integration later)");
    document.getElementById("rep-location").value = "";
    document.getElementById("rep-desc").value = "";
  });
}


/* ================================
   PROFILE PAGE
================================ */
if (document.getElementById("editProfile")) {
  requireLogin();
  
  document.getElementById("editProfile").addEventListener("click", () => {
    const user = getLoggedInUser();
    const newName = prompt("Enter display name", user.name);

    if (newName) {
      document.getElementById("pfName").innerText = newName;
      document.getElementById("pfNameVal").innerText = newName;
    }
  });
}

/* ================================
   CAMERA + FLASHLIGHT (NO UPLOAD)
================================ */

let cameraStream = null;
let videoTrack = null;
let flashOn = false;

const video = document.getElementById("camera");
const previewImg = document.getElementById("preview");
const canvas = document.getElementById("snapshot");

document.getElementById("openCameraBtn")?.addEventListener("click", async () => {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false
    });

    video.srcObject = cameraStream;
    videoTrack = cameraStream.getVideoTracks()[0];

    alert("Camera opened");

  } catch (err) {
    console.error(err);
    alert("Camera access denied or not available");
  }
});


document.getElementById("captureBtn")?.addEventListener("click", () => {
  if (!video.srcObject) {
    alert("Camera not opened");
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);

  const imageData = canvas.toDataURL("image/png");
  previewImg.src = imageData;
  previewImg.style.display = "block";
});


document.getElementById("flashBtn")?.addEventListener("click", async () => {
  if (!videoTrack) {
    alert("Camera not opened");
    return;
  }

  const capabilities = videoTrack.getCapabilities();

  if (!capabilities.torch) {
    alert("Flashlight not supported on this device");
    return;
  }

  flashOn = !flashOn;

  await videoTrack.applyConstraints({
    advanced: [{ torch: flashOn }]
  });

  document.getElementById("flashBtn").innerText = flashOn ? "Flash OFF" : "Flash ON";
});

