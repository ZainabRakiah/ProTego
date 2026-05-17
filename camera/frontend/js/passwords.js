let masterPassword = localStorage.getItem("masterPass") || "abc123";
let vaultData = JSON.parse(localStorage.getItem("vaultPasswords")) || [];

function unlockVault() {
  const entered = document.getElementById("masterPassInput").value;
  if (entered === masterPassword) {
    document.getElementById("lockScreen").style.display = "none";
    document.getElementById("vault").style.display = "block";
    renderVault();
  } else {
    alert("Incorrect password");
  }
}

function addPassword() {
  const site = document.getElementById("site").value.trim();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  if (!site || !username || !password) {
    alert("Please fill all fields");
    return;
  }

  vaultData.push({ site, username, password });
  localStorage.setItem("vaultPasswords", JSON.stringify(vaultData));
  renderVault();
  clearForm();
}

function renderVault() {
  const container = document.getElementById("vaultList");
  const searchValue = document.getElementById("searchInput").value.toLowerCase();
  container.innerHTML = "";

  vaultData
    .filter(entry => entry.site.toLowerCase().includes(searchValue))
    .forEach((entry, index) => {
      const div = document.createElement("div");
      div.className = "password-entry";
      div.innerHTML = `
        <div>
          <strong>${entry.site}</strong><br>
          Username: ${entry.username}<br>
          Password: <span id="pass-${index}" data-visible="false">••••••••</span>
          <button class="icon-btn" id="eye-${index}" onclick="toggleStoredPassword(${index})">👁️</button>
        </div>
        <div class="action-icons">
          <button class="icon-btn edit" onclick="editEntry(${index})">✏️</button>
          <button class="icon-btn delete" onclick="deleteEntry(${index})">🗑️</button>
        </div>
      `;
      container.appendChild(div);
    });
}

function editEntry(index) {
  const entry = vaultData[index];
  const newSite = prompt("Edit site:", entry.site);
  const newUser = prompt("Edit username:", entry.username);
  const newPass = prompt("Edit password:", entry.password);

  if (newSite && newUser && newPass) {
    vaultData[index] = { site: newSite, username: newUser, password: newPass };
    localStorage.setItem("vaultPasswords", JSON.stringify(vaultData));
    renderVault();
  }
}

function deleteEntry(index) {
  if (confirm("Are you sure you want to delete this entry?")) {
    vaultData.splice(index, 1);
    localStorage.setItem("vaultPasswords", JSON.stringify(vaultData));
    renderVault();
  }
}

function clearForm() {
  document.getElementById("site").value = "";
  document.getElementById("username").value = "";
  document.getElementById("password").value = "";
}

function changeMasterPassword() {
  const current = prompt("Enter current master password:");
  if (current !== masterPassword) {
    alert("Wrong password!");
    return;
  }

  const newPass = prompt("Enter new master password:");
  if (!newPass) {
    alert("Password not changed.");
    return;
  }

  masterPassword = newPass;
  localStorage.setItem("masterPass", newPass);
  alert("Master password updated.");
}

function toggleMasterVisibility() {
  const input = document.getElementById("masterPassInput");
  input.type = input.type === "password" ? "text" : "password";
}

function toggleFormPassword() {
  const input = document.getElementById("password");
  input.type = input.type === "password" ? "text" : "password";
}

function toggleStoredPassword(index) {
  const passSpan = document.getElementById(`pass-${index}`);
  const icon = document.getElementById(`eye-${index}`);

  if (passSpan.dataset.visible === "true") {
    passSpan.innerText = "••••••••";
    passSpan.dataset.visible = "false";
    icon.innerText = "👁️";
  } else {
    passSpan.innerText = vaultData[index].password;
    passSpan.dataset.visible = "true";
    icon.innerText = "🙈";
  }
}
