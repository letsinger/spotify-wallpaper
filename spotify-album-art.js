#!/usr/bin/env node

const SpotifyWebApi = require('spotify-web-api-node');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const Vibrant = require('node-vibrant');
const selfsigned = require('selfsigned');

// Configuration
const CONFIG_FILE = path.join(__dirname, '.spotify-config.json');
const TOKEN_FILE = path.join(__dirname, '.spotify-tokens.json');
const TEMP_IMAGE_DIR = path.join(__dirname, 'temp');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_IMAGE_DIR)) {
  fs.mkdirSync(TEMP_IMAGE_DIR, { recursive: true });
}

// Load configuration
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('Error: .spotify-config.json not found!');
    console.error('Please create .spotify-config.json with your Spotify API credentials.');
    console.error('See README.md for setup instructions.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

// Load tokens
function loadTokens() {
  if (fs.existsSync(TOKEN_FILE)) {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  }
  return null;
}

// Save tokens
function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

// Download image from URL
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(filepath);
    
    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        return downloadImage(response.headers.location, filepath)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(filepath);
        reject(new Error(`Failed to download image: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      reject(err);
    });
  });
}

// Extract colors from image
async function extractColors(imagePath) {
  try {
    const palette = await Vibrant.from(imagePath).getPalette();
    const colors = [];
    
    // Extract vibrant colors from the palette
    const colorKeys = ['Vibrant', 'Muted', 'DarkVibrant', 'DarkMuted', 'LightVibrant', 'LightMuted'];
    for (const key of colorKeys) {
      if (palette[key]) {
        const rgb = palette[key].getRgb();
        colors.push(rgb);
      }
    }
    
    // If we don't have enough colors, duplicate some
    while (colors.length < 4) {
      colors.push(...colors);
    }
    
    return colors.slice(0, 6); // Return up to 6 colors
  } catch (error) {
    console.error('Error extracting colors:', error.message);
    // Return default colors if extraction fails
    return [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0]
    ];
  }
}

// Clean up old album art images, keeping only the most recent ones
function cleanupOldImages(currentImagePath, keepCount = 2) {
  try {
    if (!fs.existsSync(TEMP_IMAGE_DIR)) {
      return;
    }

    const files = fs.readdirSync(TEMP_IMAGE_DIR);
    const imageFiles = files
      .filter(file => file.startsWith('album-art-') && file.endsWith('.jpg'))
      .map(file => {
        const filePath = path.join(TEMP_IMAGE_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          path: filePath,
          mtime: stats.mtime.getTime()
        };
      })
      .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

    // Get the current image filename to make sure we don't delete it
    const currentFileName = path.basename(currentImagePath);

    // Remove old images, but keep the current one and a few recent ones
    let kept = 0;
    for (const file of imageFiles) {
      if (file.name === currentFileName) {
        // Always keep the current image
        kept++;
        continue;
      }
      
      if (kept < keepCount) {
        // Keep the most recent images
        kept++;
        continue;
      }
      
      // Delete old images
      try {
        fs.unlinkSync(file.path);
      } catch (err) {
        // Ignore errors deleting individual files
      }
    }
  } catch (error) {
    // Silently fail cleanup - not critical
    console.error('Error cleaning up old images:', error.message);
  }
}

// Global Electron process reference
let electronProcess = null;
let electronIPC = null;

// Launch or update Electron app
function launchElectronApp(imagePath, colors, trackInfo, audioFeatures = null) {
  return new Promise((resolve, reject) => {
    const updateData = {
      imagePath: path.resolve(imagePath),
      colors: colors,
      trackInfo: trackInfo,
      audioFeatures: audioFeatures
    };
    
    // Write update to a file that Electron can watch
    const updateFile = path.join(TEMP_IMAGE_DIR, 'update.json');
    try {
      fs.writeFileSync(updateFile, JSON.stringify(updateData, null, 2));
      console.log(`[${new Date().toLocaleTimeString()}] Wrote update file: ${updateFile}`);
      console.log(`[${new Date().toLocaleTimeString()}] Update data: track=${trackInfo.track}`);
    } catch (error) {
      console.error(`[${new Date().toLocaleTimeString()}] Error writing update file:`, error.message);
    }
    
    // If Electron is already running, it will pick up the update via file watch
    if (electronProcess && !electronProcess.killed) {
      console.log(`[${new Date().toLocaleTimeString()}] Electron process already running, update will be picked up via file watch`);
      resolve();
      return;
    }
    
    // Launch new Electron process
    const electronPath = require('electron');
    const mainPath = path.join(__dirname, 'electron-main.js');
    
    // Use absolute path
    const absoluteImagePath = path.resolve(imagePath);
    const escapedColors = JSON.stringify(colors);
    const escapedTrackInfo = JSON.stringify(trackInfo);
    const escapedAudioFeatures = JSON.stringify(audioFeatures);
    
    const args = [
      mainPath,
      absoluteImagePath,
      escapedColors,
      escapedTrackInfo,
      escapedAudioFeatures
    ];
    
    // Log environment variables being passed
    const electronEnv = {
      ...process.env,  // Inherit all environment variables
      DISPLAY: process.env.DISPLAY || ':0',  // Ensure DISPLAY is set
      XAUTHORITY: process.env.XAUTHORITY  // Pass XAUTHORITY if set
    };
    console.log(`[${new Date().toLocaleTimeString()}] Launching Electron with DISPLAY=${electronEnv.DISPLAY}, XAUTHORITY=${electronEnv.XAUTHORITY || 'not set'}`);
    
    electronProcess = spawn(electronPath, args, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout and stderr for logging
      env: electronEnv
    });
    
    // Log Electron output
    electronProcess.stdout.on('data', (data) => {
      console.log(`[Electron] ${data.toString().trim()}`);
    });
    
    electronProcess.stderr.on('data', (data) => {
      console.error(`[Electron Error] ${data.toString().trim()}`);
    });
    
    electronProcess.on('exit', (code) => {
      console.log(`[${new Date().toLocaleTimeString()}] Electron process exited with code ${code}`);
      electronProcess = null;
    });
    
    electronProcess.on('error', (error) => {
      console.error(`[${new Date().toLocaleTimeString()}] Electron process error:`, error.message);
    });
    
    electronProcess.unref();
    
    console.log(`[${new Date().toLocaleTimeString()}] Launched Electron process (PID: ${electronProcess.pid})`);
    
    // Give it a moment to start
    setTimeout(() => {
      resolve();
    }, 500);
  });
}

// Initialize Spotify API
async function initializeSpotify() {
  const config = loadConfig();
  const spotifyApi = new SpotifyWebApi({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri || 'https://127.0.0.1:8888/callback'
  });

  let tokens = loadTokens();
  
  if (!tokens) {
    console.log('No saved tokens found. Starting OAuth flow...');
    await authenticate(spotifyApi);
    tokens = loadTokens();
  }

  spotifyApi.setAccessToken(tokens.access_token);
  spotifyApi.setRefreshToken(tokens.refresh_token);

  // Check if token needs refresh
  try {
    await spotifyApi.getMe();
  } catch (error) {
    if (error.statusCode === 401) {
      console.log('Token expired. Refreshing...');
      try {
        const data = await spotifyApi.refreshAccessToken();
        spotifyApi.setAccessToken(data.body['access_token']);
        if (data.body['refresh_token']) {
          spotifyApi.setRefreshToken(data.body['refresh_token']);
        }
        saveTokens({
          access_token: spotifyApi.getAccessToken(),
          refresh_token: spotifyApi.getRefreshToken()
        });
      } catch (refreshError) {
        console.error('Failed to refresh token. Re-authenticating...');
        await authenticate(spotifyApi);
        tokens = loadTokens();
        spotifyApi.setAccessToken(tokens.access_token);
        spotifyApi.setRefreshToken(tokens.refresh_token);
      }
    } else {
      throw error;
    }
  }

  return spotifyApi;
}

// OAuth authentication
function authenticate(spotifyApi) {
  return new Promise((resolve, reject) => {
    const scopes = ['user-read-recently-played', 'user-read-currently-playing'];
    const authorizeURL = spotifyApi.createAuthorizeURL(scopes, 'state');

    console.log('\n=== Spotify Authentication Required ===');
    const redirectUri = spotifyApi.getRedirectURI();
    console.log('Redirect URI being used:', redirectUri);
    
    // Parse and display the authorization URL to verify redirect_uri parameter
    try {
      const urlObj = new URL(authorizeURL);
      const redirectParam = urlObj.searchParams.get('redirect_uri');
      console.log('Redirect URI in authorization URL:', redirectParam);
      console.log('Match:', redirectParam === redirectUri ? 'YES ✓' : 'NO ✗');
      if (redirectParam !== redirectUri) {
        console.log('WARNING: Mismatch detected!');
      }
    } catch (e) {
      console.log('Could not parse authorization URL');
    }
    
    console.log('\nPlease visit this URL to authorize the application:');
    console.log(authorizeURL);
    console.log('\nWaiting for authorization...');
    console.log('Note: Your browser may show a security warning for the self-signed certificate.');
    console.log('This is normal for localhost. Click "Advanced" and proceed anyway.');
    console.log('\nIMPORTANT: Make sure your Spotify app has this EXACT redirect URI:');
    console.log('  https://127.0.0.1:8888/callback');
    console.log('  (Must be HTTPS, not HTTP!)\n');

    // Generate self-signed certificate for HTTPS with larger key size
    const attrs = [{ name: 'commonName', value: '127.0.0.1' }];
    const pems = selfsigned.generate(attrs, { 
      days: 365,
      keySize: 2048,  // Use 2048-bit key (required by modern OpenSSL)
      algorithm: 'sha256'
    });

    // Start HTTPS server to receive callback
    const server = https.createServer({
      key: pems.private,
      cert: pems.cert
    }, async (req, res) => {
      if (req.url.startsWith('/callback')) {
        const url = new URL(req.url, 'https://127.0.0.1:8888');
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authorization failed: ${error}</h1>`);
          server.close();
          reject(new Error(`Authorization failed: ${error}`));
          return;
        }

        if (code) {
          try {
            const data = await spotifyApi.authorizationCodeGrant(code);
            saveTokens({
              access_token: data.body['access_token'],
              refresh_token: data.body['refresh_token']
            });
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Authorization successful! You can close this window.</h1>');
            server.close();
            console.log('Authorization successful!\n');
            resolve();
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<h1>Error: ${err.message}</h1>`);
            server.close();
            reject(err);
          }
        }
      }
    });

    server.listen(8888, '127.0.0.1', () => {
      console.log('Local HTTPS server started on https://127.0.0.1:8888');
    });
  });
}

// Helper function to refresh token if expired
async function refreshTokenIfNeeded(spotifyApi, error) {
  if (error && error.statusCode === 401) {
    console.log(`[${new Date().toLocaleTimeString()}] Token expired. Refreshing...`);
    try {
      const data = await spotifyApi.refreshAccessToken();
      spotifyApi.setAccessToken(data.body['access_token']);
      if (data.body['refresh_token']) {
        spotifyApi.setRefreshToken(data.body['refresh_token']);
      }
      saveTokens({
        access_token: spotifyApi.getAccessToken(),
        refresh_token: spotifyApi.getRefreshToken()
      });
      console.log(`[${new Date().toLocaleTimeString()}] Token refreshed successfully`);
      return true;
    } catch (refreshError) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to refresh token:`, refreshError.message);
      console.error('Re-authentication required. Please restart the service.');
      return false;
    }
  }
  return false;
}

// Fetch and display current track
async function fetchAndDisplay(spotifyApi, lastTrackId = null) {
  try {
    // Try to get currently playing track first (more accurate)
    let track = null;
    let currentTrackId = null;
    
    try {
      const currentlyPlaying = await spotifyApi.getMyCurrentPlayingTrack();
      if (currentlyPlaying.body && currentlyPlaying.body.item) {
        track = currentlyPlaying.body.item;
        currentTrackId = track.id;
        console.log(`[${new Date().toLocaleTimeString()}] Currently playing track detected`);
      }
    } catch (e) {
      // If token expired, try to refresh
      if (e.statusCode === 401) {
        const refreshed = await refreshTokenIfNeeded(spotifyApi, e);
        if (refreshed) {
          // Retry the call after refresh
          try {
            const currentlyPlaying = await spotifyApi.getMyCurrentPlayingTrack();
            if (currentlyPlaying.body && currentlyPlaying.body.item) {
              track = currentlyPlaying.body.item;
              currentTrackId = track.id;
              console.log(`[${new Date().toLocaleTimeString()}] Currently playing track detected (after token refresh)`);
            }
          } catch (retryError) {
            // If still fails, fall through to recently played
          }
        } else {
          // Token refresh failed, return early
          return lastTrackId;
        }
      }
      // If no currently playing track or other error, fall back to recently played
    }
    
    // Fall back to recently played tracks if no currently playing track
    if (!track) {
      try {
        const response = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 1 });
        
        if (!response.body.items || response.body.items.length === 0) {
          console.log(`[${new Date().toLocaleTimeString()}] No recently played tracks found.`);
          return lastTrackId;
        }

        track = response.body.items[0].track;
        currentTrackId = track.id;
        console.log(`[${new Date().toLocaleTimeString()}] Using recently played track`);
      } catch (e) {
        // If token expired, try to refresh and retry
        if (e.statusCode === 401) {
          const refreshed = await refreshTokenIfNeeded(spotifyApi, e);
          if (refreshed) {
            try {
              const response = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 1 });
              if (response.body.items && response.body.items.length > 0) {
                track = response.body.items[0].track;
                currentTrackId = track.id;
                console.log(`[${new Date().toLocaleTimeString()}] Using recently played track (after token refresh)`);
              } else {
                console.log(`[${new Date().toLocaleTimeString()}] No recently played tracks found.`);
                return lastTrackId;
              }
            } catch (retryError) {
              console.error(`[${new Date().toLocaleTimeString()}] Error fetching recently played tracks:`, retryError.message);
              return lastTrackId;
            }
          } else {
            return lastTrackId;
          }
        } else {
          console.error(`[${new Date().toLocaleTimeString()}] Error fetching recently played tracks:`, e.message);
          return lastTrackId;
        }
      }
    }
    
    if (!track || !currentTrackId) {
      console.log(`[${new Date().toLocaleTimeString()}] No valid track found (track: ${!!track}, id: ${currentTrackId})`);
      return lastTrackId;
    }
    
    // Only update if track changed
    if (currentTrackId === lastTrackId) {
      console.log(`[${new Date().toLocaleTimeString()}] Same track (${currentTrackId}), skipping update`);
      return lastTrackId;
    }
    
    // Log when track changes
    if (lastTrackId !== null) {
      console.log(`[${new Date().toLocaleTimeString()}] Track changed from ${lastTrackId} to ${currentTrackId}`);
    }

    const album = track.album;
    const albumArtUrl = album.images[0]?.url || album.images[album.images.length - 1]?.url;

    if (!albumArtUrl) {
      console.log('No album art available for this track.');
      return currentTrackId;
    }

    console.log(`\n[${new Date().toLocaleTimeString()}] New track detected:`);
    console.log(`Track: ${track.name}`);
    console.log(`Artist: ${track.artists.map(a => a.name).join(', ')}`);
    console.log(`Album: ${album.name}`);
    console.log(`Downloading album art...`);

    // Use track ID in filename to avoid caching issues
    const imagePath = path.join(TEMP_IMAGE_DIR, `album-art-${currentTrackId}.jpg`);
    await downloadImage(albumArtUrl, imagePath);
    
    console.log(`Extracting colors from album art...`);
    const colors = await extractColors(imagePath);
    
    // Fetch audio features for the track
    let audioFeatures = null;
    if (currentTrackId) {
      try {
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const features = await spotifyApi.getAudioFeaturesForTrack(currentTrackId);
        if (features.body && features.body.tempo !== null && features.body.tempo !== undefined) {
          audioFeatures = features.body;
          console.log(`Audio features: tempo=${audioFeatures.tempo?.toFixed(1)}bpm, energy=${audioFeatures.energy?.toFixed(2)}`);
        } else {
          console.log('Audio features returned null or empty, using defaults');
        }
      } catch (error) {
        // If token expired, try to refresh and retry once
        if (error.statusCode === 401) {
          const refreshed = await refreshTokenIfNeeded(spotifyApi, error);
          if (refreshed) {
            try {
              const features = await spotifyApi.getAudioFeaturesForTrack(currentTrackId);
              if (features.body && features.body.tempo !== null && features.body.tempo !== undefined) {
                audioFeatures = features.body;
                console.log(`Audio features: tempo=${audioFeatures.tempo?.toFixed(1)}bpm, energy=${audioFeatures.energy?.toFixed(2)} (after token refresh)`);
              }
            } catch (retryError) {
              // If still fails, continue without features
              console.log('Audio features not available after token refresh - using defaults');
            }
          } else {
            console.log('Audio features not available (token refresh failed) - using defaults');
          }
        } else if (error.statusCode === 403) {
          // 403 errors are common for audio features - some tracks don't have them available
          // or there might be rate limiting. Continue without features.
          console.log('Audio features not available for this track (403 Forbidden) - using default animation speed');
        } else if (error.statusCode === 404) {
          console.log('Audio features not found for this track (404) - using default animation speed');
        } else {
          console.log(`Could not fetch audio features: ${error.message || 'Unknown error'}`);
          if (error.statusCode) {
            console.log(`  Status code: ${error.statusCode}`);
          }
        }
        // Continue without audio features - app will use defaults
      }
    } else {
      console.log('No track ID available, skipping audio features');
    }
    
    // Clean up old images (keep current + 1 previous)
    cleanupOldImages(imagePath, 2);
    
    const trackInfo = {
      track: track.name,
      artist: track.artists.map(a => a.name).join(', '),
      album: album.name
    };
    
    console.log(`Updating display...`);
    await launchElectronApp(imagePath, colors, trackInfo, audioFeatures);
    
    return currentTrackId;
  } catch (error) {
    console.error('Error fetching track:', error.message);
    return lastTrackId;
  }
}

// Main function with polling
async function main() {
  try {
    const spotifyApi = await initializeSpotify();
    
    console.log('Starting Spotify album art display...');
    console.log('Polling every 30 seconds for new tracks...');
    console.log('Press Ctrl+C to stop.\n');
    
    let lastTrackId = null;
    
    // Initial fetch
    lastTrackId = await fetchAndDisplay(spotifyApi, lastTrackId);
    
    // Poll every 30 seconds
    const pollInterval = setInterval(async () => {
      try {
        lastTrackId = await fetchAndDisplay(spotifyApi, lastTrackId);
      } catch (error) {
        console.error('Error in polling:', error.message);
      }
    }, 30000); // 30 seconds
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\nShutting down...');
      clearInterval(pollInterval);
      if (electronProcess && !electronProcess.killed) {
        electronProcess.kill();
      }
      process.exit(0);
    });
    
    // Keep process alive
    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception:', error);
      clearInterval(pollInterval);
      process.exit(1);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run main function
main();
