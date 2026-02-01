# Spotify Album Art Display

A command-line tool that displays the album art of your most recently played Spotify track.

## Setup

### 1. Create a Spotify App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Click "Create an app"
3. Fill in the app details:
   - App name: `Spotify Album Art` (or any name you prefer)
   - App description: `Display album art for recently played tracks`
   - Website: `http://127.0.0.1` (can be any URL, this is required)
4. Check the box to agree to the terms
5. Click "Save"
6. **IMPORTANT:** After creating the app, click on "Edit Settings"
7. In the "Redirect URIs" section, click "Add" and enter exactly: `https://127.0.0.1:8888/callback`
   - Make sure there are no trailing slashes
   - Make sure it's `https://` (Spotify now requires HTTPS)
   - Make sure the port is `8888`
   - **Note:** Use `127.0.0.1` instead of `localhost` (Spotify sometimes rejects localhost)
8. Click "Add" and then "Save"
9. Copy your **Client ID** and **Client Secret** from the app overview page

### 2. Configure the Application

1. Create your config file by copying the example:
   
   **On Windows (PowerShell):**
   ```powershell
   Copy-Item .spotify-config.json.example .spotify-config.json
   ```
   
   **On Linux/Mac:**
   ```bash
   cp .spotify-config.json.example .spotify-config.json
   ```

2. Edit `.spotify-config.json` and replace the placeholder values with your actual Spotify API credentials:
   ```json
   {
     "clientId": "your-actual-client-id-here",
     "clientSecret": "your-actual-client-secret-here",
     "redirectUri": "https://127.0.0.1:8888/callback"
   }
   ```
   
   **Note:** The `.spotify-config.json` file is created from the example file. Make sure to edit the actual `.spotify-config.json` file (not the `.example` file) with your credentials.

### 3. Install Dependencies

```bash
npm install
```

### 4. First Run (Authentication)

Run the script for the first time:
```bash
node spotify-album-art.js
```

This will:
1. Open a browser window asking you to authorize the app
2. **Important:** Your browser will show a security warning about the self-signed certificate. This is normal for 127.0.0.1. Click "Advanced" or "Show Details" and then "Proceed to 127.0.0.1" or "Accept the Risk" to continue.
3. After authorization, save your tokens for future use
4. Display the album art of your most recently played track

### 5. Add to bashrc (Linux/Mac) or PowerShell Profile (Windows)

#### For Linux/Mac (bashrc):

Add this line to your `~/.bashrc`:
```bash
alias spotify-art='cd /path/to/spotify-wallpaper && node spotify-album-art.js'
```

Or if you want to run it from anywhere:
```bash
alias spotify-art='node /path/to/spotify-wallpaper/spotify-album-art.js'
```

Then reload your bashrc:
```bash
source ~/.bashrc
```

#### For Windows (PowerShell):

Add this to your PowerShell profile (`$PROFILE`):
```powershell
function spotify-art {
    cd C:\Users\alets\Documents\Git\spotify-wallpaper
    node spotify-album-art.js
}
```

Or to run from anywhere:
```powershell
function spotify-art {
    node C:\Users\alets\Documents\Git\spotify-wallpaper\spotify-album-art.js
}
```

To edit your PowerShell profile:
```powershell
notepad $PROFILE
```

If the profile doesn't exist, create it first:
```powershell
New-Item -Path $PROFILE -Type File -Force
notepad $PROFILE
```

## Usage

After setup, simply run:
```bash
spotify-art
```

The script will:
1. Fetch your most recently played track
2. Download the album art
3. Extract colors from the album art
4. Open a borderless Electron app displaying the album art with an animated gradient background based on the extracted colors
5. **Automatically poll every 30 seconds** for new tracks and update the display when a new track is detected

The app will continue running and updating until you press `Ctrl+C` to stop it.

## How It Works

- The script uses OAuth 2.0 to authenticate with Spotify
- Tokens are saved locally in `.spotify-tokens.json` (don't commit this file!)
- The script automatically refreshes expired tokens
- **Polls the Spotify API every 30 seconds** to check for new tracks
- Only updates the display when a new track is detected (tracks by ID)
- Album art is temporarily saved in the `temp/` directory
- **Automatically cleans up old album art images** (keeps only the current + 1 previous to prevent disk space issues)
- Colors are extracted from the album art using `node-vibrant`
- A borderless Electron window displays the album art with an animated gradient background
- The gradient animates smoothly using colors extracted from the album art
- The Electron window stays open and updates automatically when tracks change

## Troubleshooting

- **"INVALID_CLIENT: Insecure redirect URI"**: 
  - **This error means Spotify doesn't recognize your redirect URI as secure (HTTPS)**
  - **First, check the console output** - it will show exactly what redirect URI is being sent
  - Go to your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
  - Click on your app, then click "Edit Settings"
  - In the "Redirect URIs" section:
    1. **Remove ALL existing redirect URIs** (clear the list completely)
    2. **Add the HTTPS redirect URI**: Click "Add" and enter exactly: `https://127.0.0.1:8888/callback`
    3. **Double-check**: 
       - Must start with `https://` (not `http://`)
       - No trailing slash
       - Port is `8888`
       - Path is `/callback` (lowercase)
       - Use `127.0.0.1` (not `localhost` - Spotify sometimes rejects localhost)
  - Click "Save" after making changes
  - **Wait 5-10 minutes** for Spotify's servers to update (sometimes takes longer)
  - **Try these additional steps if it still doesn't work:**
    - Clear your browser cache and cookies
    - Try in an incognito/private browser window
    - Make sure you're using `https://127.0.0.1:8888/callback` (not localhost)
    - Regenerate your Client Secret in the dashboard
- **Browser security warning about certificate**: This is expected! The app uses a self-signed certificate for 127.0.0.1 HTTPS. Click "Advanced" and proceed anyway.

- **"No saved tokens found"**: Run the script once to authenticate
- **"Token expired"**: The script will automatically refresh tokens
- **"No recently played tracks"**: Make sure you've played some music on Spotify recently
- **Electron window doesn't appear**: Make sure Electron is properly installed (`npm install`)
- **Colors look wrong**: The color extraction may vary - this is normal and depends on the album art

## Security Notes

- Never commit `.spotify-config.json` or `.spotify-tokens.json` to version control
- Add these files to your `.gitignore`
