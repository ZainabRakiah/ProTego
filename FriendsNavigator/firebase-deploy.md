# Deploy to Firebase Hosting

Since you're already using Firebase, this is seamless!

## Steps:

1. **Install Firebase CLI** (one-time setup):
   ```bash
   npm install -g firebase-tools
   ```

2. **Login to Firebase**:
   ```bash
   firebase login
   ```

3. **Initialize Firebase Hosting** (in your project folder):
   ```bash
   firebase init hosting
   ```
   - Select your existing project: `loc-live-track`
   - Public directory: `.` (current directory)
   - Single-page app: `No`
   - Overwrite index.html: `No`

4. **Deploy**:
   ```bash
   firebase deploy --only hosting
   ```

5. **Done!** Your site will be at:
   `https://loc-live-track.web.app` or `https://loc-live-track.firebaseapp.com`

## Auto-deploy with GitHub
- Connect GitHub repo in Firebase Console
- Auto-deploys on push to main branch

