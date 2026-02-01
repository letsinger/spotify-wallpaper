const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
const UPDATE_FILE = path.join(__dirname, 'temp', 'update.json');

function updateWindow(imagePath, colors, trackInfo, audioFeatures = null) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Update existing window
    mainWindow.webContents.send('album-data', {
      imagePath: imagePath,
      colors: colors,
      trackInfo: trackInfo,
      audioFeatures: audioFeatures
    });
  } else {
    // Create new window
    createWindow(imagePath, colors, trackInfo, audioFeatures);
  }
}

function createWindow(imagePath, colors, trackInfo, audioFeatures = null) {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 600,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    resizable: false,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Load the HTML file
  const htmlPath = path.join(__dirname, 'electron-renderer.html');
  mainWindow.loadFile(htmlPath);

  // Pass data to renderer (pass the absolute path as-is, renderer will handle conversion)
  mainWindow.webContents.on('did-finish-load', () => {
    updateWindow(imagePath, colors, trackInfo, audioFeatures);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Get data from command line arguments
  const args = process.argv.slice(2);
  if (args.length >= 3) {
    const imagePath = args[0];
    const colors = JSON.parse(args[1]);
    const trackInfo = JSON.parse(args[2]);
    const audioFeatures = args.length >= 4 ? JSON.parse(args[3]) : null;
    createWindow(imagePath, colors, trackInfo, audioFeatures);
    
    // Watch for updates
    if (fs.existsSync(UPDATE_FILE)) {
      fs.watchFile(UPDATE_FILE, { interval: 1000 }, (curr, prev) => {
        if (curr.mtime > prev.mtime) {
          try {
            const updateData = JSON.parse(fs.readFileSync(UPDATE_FILE, 'utf8'));
            updateWindow(updateData.imagePath, updateData.colors, updateData.trackInfo, updateData.audioFeatures);
          } catch (e) {
            // Ignore parse errors
          }
        }
      });
    }
  } else {
    console.error('Missing arguments');
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Don't quit when window is closed, keep watching for updates
  // app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // Recreate window if needed
  }
});
