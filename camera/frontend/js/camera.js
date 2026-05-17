import { db, app } from "./firebase-config.js";

// use matching Firebase SDK version (12.10.0) to avoid type mismatches
import { getAuth } 
from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

import { collection, addDoc }
from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

const auth = getAuth(app);
const emergencyBtn = document.getElementById("emergencyBtn");
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");

emergencyBtn.addEventListener("click", startCamera);

async function startCamera() {

    console.log("Button clicked");

    const stream = await navigator.mediaDevices.getUserMedia({
        video: true
    });

    video.srcObject = stream;

    console.log("Camera activated");

    setInterval(() => {

        console.log("Interval running");
        capturePhoto();

    }, 10000);

}

async function capturePhoto(){

    const context = canvas.getContext("2d");
    context.drawImage(video,0,0,canvas.width,canvas.height);
    const imageData = canvas.toDataURL("image/png");

    const user = auth.currentUser;
    if(!user){
        alert("Please login first");
        return;
    }

    // helper that wraps geolocation in a promise
    function getLocation(){
        return new Promise((resolve, reject) => {
            if(!navigator.geolocation){
                reject(new Error('Geolocation not supported'));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                pos => resolve(pos.coords),
                err => reject(err)
            );
        });
    }

    try{
        const coords = await getLocation();
        // coords may be undefined if user denies permission
        const latitude = coords?.latitude ?? null;
        const longitude = coords?.longitude ?? null;

        await addDoc(collection(db,"captures"),{
            userId:user.uid,
            image:imageData,
            latitude,
            longitude,
            time:new Date().toISOString()
        });

        console.log("Image saved for user:",user.uid);
    }catch(error){
        console.log("Error capturing photo or location:",error);
    }

}