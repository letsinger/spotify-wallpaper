const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
const UPDATE_FILE = path.join(__dirname, 'temp', 'update.json');

function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function updateWindow(imagePath, colors, trackInfo, audioFeatures = null) {
  log(`updateWindow called: imagePath=${imagePath}, track=${trackInfo?.track || 'unknown'}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Update existing window
    log('Sending update to existing window');
    mainWindow.webContents.send('album-data', {
      imagePath: imagePath,
      colors: colors,
      trackInfo: trackInfo,
      audioFeatures: audioFeatures
    });
  } else {
    // Create new window
    log('Creating new window');
    createWindow(imagePath, colors, trackInfo, audioFeatures);
  }
}

function createWindow(imagePath, colors, trackInfo, audioFeatures = null) {
  // Get screen dimensions for fullscreen
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  
  mainWindow = new BrowserWindow({
    width: width,
    height: height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    resizable: false,
    fullscreen: true,
    fullscreenable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  // Ensure fullscreen on Linux
  if (process.platform === 'linux') {
    mainWindow.setFullScreen(true);
  }

  // Load the HTML file
  const htmlPath = path.join(__dirname, 'electron-renderer.html');
  log(`Loading HTML from: ${htmlPath}`);
  mainWindow.loadFile(htmlPath);

  // Pass data to renderer (pass the absolute path as-is, renderer will handle conversion)
  mainWindow.webContents.on('did-finish-load', () => {
    log('Window finished loading, sending initial data');
    updateWindow(imagePath, colors, trackInfo, audioFeatures);
  });
  
  mainWindow.webContents.on('dom-ready', () => {
    log('DOM ready');
  });
  
  // Show window (in case it's hidden)
  mainWindow.show();
  log('Window shown');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  log('Electron app ready');
  log(`DISPLAY=${process.env.DISPLAY || 'not set'}`);
  log(`Platform: ${process.platform}`);
  
  // Get data from command line arguments
  const args = process.argv.slice(2);
  log(`Received ${args.length} command line arguments`);
  if (args.length >= 3) {
    const imagePath = args[0];
    const colors = JSON.parse(args[1]);
    const trackInfo = JSON.parse(args[2]);
    const audioFeatures = args.length >= 4 ? JSON.parse(args[3]) : null;
    log(`Creating window with track: ${trackInfo.track}`);
    createWindow(imagePath, colors, trackInfo, audioFeatures);
    
    // Watch for updates
    log(`Watching for updates at: ${UPDATE_FILE}`);
    if (fs.existsSync(UPDATE_FILE)) {
      log('Update file exists, starting file watch');
    } else {
      log('Update file does not exist yet, will watch for it');
    }
    
    // Watch the temp directory and the update file
    const watchUpdateFile = () => {
      if (fs.existsSync(UPDATE_FILE)) {
        try {
          const updateData = JSON.parse(fs.readFileSync(UPDATE_FILE, 'utf8'));
          log(`Update file changed, updating window with track: ${updateData.trackInfo?.track || 'unknown'}`);
          updateWindow(updateData.imagePath, updateData.colors, updateData.trackInfo, updateData.audioFeatures);
        } catch (e) {
          log(`Error reading update file: ${e.message}`);
        }
      }
    };
    
    // Initial read
    watchUpdateFile();
    
    // Watch for file changes
    fs.watchFile(UPDATE_FILE, { interval: 1000 }, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        watchUpdateFile();
      }
    });
    
    // Also watch the directory in case the file doesn't exist yet
    const tempDir = path.dirname(UPDATE_FILE);
    fs.watch(tempDir, (eventType, filename) => {
      if (filename === 'update.json') {
        log(`Update file ${eventType} detected`);
        setTimeout(watchUpdateFile, 100); // Small delay to ensure file is written
      }
    });
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
