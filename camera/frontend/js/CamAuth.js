import { app } from "./firebase-config.js";

import { getAuth, GoogleAuthProvider, signInWithPopup }
from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const loginBtn = document.getElementById("loginBtn");

loginBtn.addEventListener("click", async () => {

    try {

        const result = await signInWithPopup(auth, provider);

        const user = result.user;

        console.log("User:", user);

        alert("Login successful: " + user.displayName);

    } catch (error) {

        console.error(error);

    }

});