import { doc, deleteDoc }
from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

// Import Firebase authentication
import { getAuth, onAuthStateChanged }
from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

// Import Firestore database and config
import { db, app } from "./firebase-config.js";

// Import Firestore functions
import { collection, getDocs, query, where }
from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const gallery = document.getElementById("gallery");

const auth = getAuth(app);

console.log("Upload.js loaded, gallery element:", gallery);

// Wait until Firebase confirms the logged-in user
onAuthStateChanged(auth, async (user)=>{

    console.log("Auth state changed, user:", user?.uid);

    if(!user){
        console.log("No user logged in");
        gallery.innerHTML = "<p>Please login first</p>";
        return;
    }

    try {
        // Get all capture records for this user
        const q = query(collection(db,"captures"), where("userId", "==", user.uid));
        const querySnapshot = await getDocs(q);

        console.log("Firestore query returned", querySnapshot.size, "documents");

        let images = [];

        querySnapshot.forEach((doc)=>{

            const data = doc.data();
            data.id = doc.id;

            images.push(data);

        });

        // Sort images by newest time first
        images.sort((a,b)=> new Date(b.time) - new Date(a.time));

        console.log("Total images to display:", images.length);

        if(images.length === 0){
            gallery.innerHTML = "<p>No images found. Activate emergency mode to capture images.</p>";
            return;
        }

        // Display images
        images.forEach((data)=>{

            const container = document.createElement("div");
            container.style.marginBottom = "20px";

            const img = document.createElement("img");
            img.src = data.image;
            img.style.width = "300px";
            img.style.borderRadius = "10px";
            img.style.boxShadow = "0px 0px 10px rgba(0,0,0,0.2)";
            img.style.margin = "10px";

            const time = document.createElement("p");
            time.innerText = "Captured: " + new Date(data.time).toLocaleString();

             const deleteBtn = document.createElement("button");
             deleteBtn.innerText = "Delete";

             deleteBtn.onclick = async () => {

        await deleteDoc(doc(db,"captures",data.id));

        container.remove();

    };


            container.appendChild(img);
            container.appendChild(time);
            container.appendChild(deleteBtn);

            gallery.appendChild(container);

            console.log("Image added to gallery");

        });

    } catch(error){
        console.error("Error loading images:", error);
        gallery.innerHTML = "<p>Error loading images: " + error.message + "</p>";
    }

});