# FriendsNavigator - Local Development

## Quick Start (Option 1: Node.js - Recommended)

1. **Install Node.js** (if not already installed):
   - Download from: https://nodejs.org/
   - Install the LTS version
   - Restart VS Code after installation

2. **Start the server**:
   ```bash
   npm start
   ```

3. **Open your browser**:
   - Go to: http://localhost:8080

---

## Quick Start (Option 2: VS Code Live Server Extension)

1. **Install Live Server extension**:
   - Open VS Code
   - Press `Ctrl+Shift+X` to open Extensions
   - Search for "Live Server" by Ritwick Dey
   - Click Install

2. **Run the server**:
   - Right-click on `index.html`
   - Select "Open with Live Server"
   - Your browser will open automatically

---

## Quick Start (Option 3: Python - If you have Python installed)

1. **Open terminal in this folder**

2. **Run**:
   ```bash
   python -m http.server 8080
   ```

3. **Open**: http://localhost:8080

---

## Troubleshooting

- **ERR_CONNECTION_REFUSED**: Make sure the server is running before opening the browser
- **Port 8080 already in use**: Change the port in `server.js` (line 5) or use a different port
- **Firebase/Mapbox errors**: Make sure your API keys are correctly set in `script.js`


