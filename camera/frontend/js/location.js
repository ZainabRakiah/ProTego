const BACKEND = "http://127.0.0.1:5001";
const user = JSON.parse(sessionStorage.getItem("user"));

function loadLocations() {
  fetch(`${BACKEND}/api/locations/${user.id}`)
    .then(res => res.json())
    .then(data => {
      const div = document.getElementById("locations");
      div.innerHTML = "";
      data.forEach(l => {
        div.innerHTML += `
          <div>
            <h4>${l.label}</h4>
            <button onclick="manageContacts(${l.id})">Contacts</button>
          </div>
        `;
      });
    });
}

function addLocation() {
  const label = document.getElementById("locLabel").value;

  fetch(`${BACKEND}/api/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: user.id, label })
  }).then(loadLocations);
}

function manageContacts(id) {
  window.location.href = `contacts.html?location=${id}`;
}

loadLocations();
