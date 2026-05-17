const API = "http://127.0.0.1:5001";

const user = JSON.parse(sessionStorage.getItem("user"));
if (!user) {
  alert("Login required");
  location.href = "index.html";
}

let selectedLocationId = null;

/* =============================
   LOAD LOCATIONS
============================= */
async function loadLocations() {
  const res = await fetch(`${API}/api/locations/${user.id}`);
  const locations = await res.json();

  const list = document.getElementById("locationsList");
  list.innerHTML = "";

  locations.forEach(loc => {
    const li = document.createElement("li");
    li.textContent = loc.label;
    li.onclick = () => {
      selectedLocationId = loc.id;
      loadContacts(loc.id);
    };
    list.appendChild(li);
  });
}

/* =============================
   ADD LOCATION
============================= */
document.getElementById("addLocationBtn").onclick = async () => {
  const label = document.getElementById("locLabel").value.trim();
  if (!label) return alert("Enter label");

  await fetch(`${API}/api/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: user.id,
      label
    })
  });

  document.getElementById("locLabel").value = "";
  loadLocations();
};

/* =============================
   LOAD CONTACTS
============================= */
async function loadContacts(locationId) {
  const res = await fetch(`${API}/api/contacts/${locationId}`);
  const contacts = await res.json();

  const list = document.getElementById("contactsList");
  list.innerHTML = "";

  contacts.forEach(c => {
    const li = document.createElement("li");
    li.textContent = `${c.name} (${c.phone})`;
    list.appendChild(li);
  });
}

/* =============================
   ADD CONTACT
============================= */
document.getElementById("addContactBtn").onclick = async () => {
  if (!selectedLocationId) return alert("Select a location first");

  const name = contactName.value.trim();
  const phone = contactPhone.value.trim();
  const email = contactEmail.value.trim();

  if (!name || !phone) return alert("Name & phone required");

  await fetch(`${API}/api/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location_id: selectedLocationId,
      name, phone, email
    })
  });

  contactName.value = contactPhone.value = contactEmail.value = "";
  loadContacts(selectedLocationId);
};

loadLocations();
