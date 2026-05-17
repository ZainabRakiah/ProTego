const BACKEND_URL = "http://127.0.0.1:5001";

const userJson = sessionStorage.getItem("user");
if (!userJson) {
  alert("Please login first");
  window.location.href = "index.html";
}

const user = JSON.parse(userJson);
const container = document.getElementById("evidenceList");

// Load evidence
fetch(`${BACKEND_URL}/api/evidence/${user.id}`)
  .then(res => res.json())
  .then(data => {
    if (data.length === 0) {
      container.innerHTML = "<p>No evidence found.</p>";
      return;
    }

    data.forEach(ev => {
      const div = document.createElement("div");
      div.className = "card";

      const time = new Date(ev.timestamp).toLocaleString();

      div.innerHTML = `
        <p><strong>${ev.type}</strong> — ${time}</p>
        <img src="${ev.image}" style="width:100%; border-radius:12px;" />
        <button style="margin-top:8px;" onclick="deleteEvidence(${ev.id})">
          🗑 Delete
        </button>
      `;

      container.appendChild(div);
    });
  });

function deleteEvidence(id) {
  if (!confirm("Delete this evidence permanently?")) return;

  fetch(`${BACKEND_URL}/api/evidence/${id}`, {
    method: "DELETE"
  })
    .then(res => res.json())
    .then(() => {
      alert("Evidence deleted");
      location.reload();
    });
}
