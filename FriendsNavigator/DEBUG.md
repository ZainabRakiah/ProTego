# Debugging Guide - Buttons Not Working on Vercel

## Quick Fixes:

### 1. Check Browser Console
- Open your Vercel site
- Press **F12** (or right-click → Inspect)
- Go to **Console** tab
- Look for errors (red text)

### 2. Common Issues:

#### Issue: "Firebase is not defined"
**Fix:** Firebase scripts might not be loading. Check network tab.

#### Issue: "Cannot read property 'onclick' of null"
**Fix:** Buttons not found. Check if HTML elements exist.

#### Issue: Script.js not loading
**Fix:** Check if path is correct. Should be `/script.js` not `./script.js`

### 3. Test Steps:

1. Open browser console (F12)
2. Type: `typeof firebase`
   - Should return: `"object"`
   - If `"undefined"`: Firebase not loaded

3. Type: `document.getElementById("btnCreate")`
   - Should return: `<button id="btnCreate">...`
   - If `null`: Button not found

4. Check Network tab:
   - Look for `script.js` - should be status 200
   - Look for Firebase scripts - should be status 200

### 4. Vercel-Specific Issues:

- **Case sensitivity**: Make sure filenames match exactly
- **Path issues**: Use relative paths like `script.js` not `./script.js`
- **Build settings**: Vercel should auto-detect static site

### 5. Quick Test:

Add this to your HTML temporarily to test:
```html
<button onclick="alert('Test')">Test Button</button>
```

If this works but your buttons don't, it's a JavaScript issue.

### 6. Redeploy:

After fixing, redeploy on Vercel:
- Push changes to Git (if connected)
- Or drag & drop again

---

## Still Not Working?

Check the console logs - I've added debug messages:
- `✅ HTML loaded` - HTML is ready
- `✅ initApp() called` - JavaScript started
- `✅ All event handlers attached` - Buttons should work
- `✅ App initialized successfully` - Everything loaded

If you see errors before these messages, that's your problem!

