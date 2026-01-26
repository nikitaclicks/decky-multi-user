import asyncio
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

# The decky plugin module is located at decky-loader/plugin
# For easy intellisense checkout the decky-loader code repo
# and add the `decky-loader/plugin/imports` path to `python.analysis.extraPaths` in `.vscode/settings.json`
import decky


class Plugin:
    # Hardcode path for Steam Deck as Decky plugins might run as root
    STEAM_CONFIG_PATH = Path("/home/deck/.local/share/Steam/config")
    LOGINUSERS_VDF = STEAM_CONFIG_PATH / "loginusers.vdf"
    USERDATA_PATH = Path("/home/deck/.local/share/Steam/userdata")
    # Registry file contains AutoLoginUser - key for account switching!
    REGISTRY_VDF = Path("/home/deck/.steam/registry.vdf")
    # File to store pending game launch after account switch
    PENDING_LAUNCH_FILE = Path("/tmp/decky_multiuser_pending_launch.json")
    
    # Asyncio-compatible long-running code, executed in a task when the plugin is loaded
    async def _main(self):
        decky.logger.info("Multi-User Manager loaded")
        decky.logger.info(f"Checking for pending launch file at: {self.PENDING_LAUNCH_FILE}")
        decky.logger.info(f"File exists: {self.PENDING_LAUNCH_FILE.exists()}")
        # Check for pending game launch after account switch
        asyncio.create_task(self._check_pending_launch())

    async def _check_pending_launch(self):
        """Check if there's a pending game launch after account switch"""
        try:
            decky.logger.info(f"_check_pending_launch called, file exists: {self.PENDING_LAUNCH_FILE.exists()}")
            
            if not self.PENDING_LAUNCH_FILE.exists():
                decky.logger.info("No pending launch file found")
                return
            
            decky.logger.info("Found pending launch file, reading...")
            with open(self.PENDING_LAUNCH_FILE, 'r') as f:
                data = json.load(f)
            
            decky.logger.info(f"Pending launch data: {data}")
            
            # Delete the file immediately to prevent re-launch loops
            self.PENDING_LAUNCH_FILE.unlink()
            decky.logger.info("Pending launch file deleted")
            
            appid = data.get('appid')
            if not appid:
                decky.logger.warn("Pending launch file had no appid")
                return
            
            decky.logger.info(f"Pending game launch detected: {appid}")
            
            # Wait a bit for Steam to fully initialize after login
            # This delay is crucial - Steam needs time to complete login
            delay = data.get('delay', 30)
            decky.logger.info(f"Waiting {delay}s for Steam to be ready...")
            await asyncio.sleep(delay)
            
            # Launch the game using steam:// URL protocol
            # Must run as deck user since Decky runs as root but Steam runs as deck
            decky.logger.info(f"Launching game {appid}...")
            result = subprocess.run(
                ['sudo', '-u', 'deck', 'steam', f'steam://rungameid/{appid}'],
                capture_output=True,
                text=True,
                timeout=10
            )
            decky.logger.info(f"Game {appid} launch triggered, returncode: {result.returncode}")
            if result.stderr:
                decky.logger.warn(f"Launch stderr: {result.stderr}")
            
        except Exception as e:
            decky.logger.error(f"Error checking pending launch: {e}")
            import traceback
            decky.logger.error(traceback.format_exc())
            # Clean up file if it exists
            if self.PENDING_LAUNCH_FILE.exists():
                self.PENDING_LAUNCH_FILE.unlink()

    def _save_pending_launch(self, appid: str, delay: int = 3):
        """Save appid for launch after Steam restart. Delay is short since frontend triggers after Steam is up."""
        try:
            data = {'appid': appid, 'delay': delay, 'timestamp': time.time()}
            with open(self.PENDING_LAUNCH_FILE, 'w') as f:
                json.dump(data, f)
            decky.logger.info(f"Saved pending launch: {appid}")
        except Exception as e:
            decky.logger.error(f"Error saving pending launch: {e}")

    # Function called first during the unload process, utilize this to handle your plugin being stopped, but not
    # completely removed
    async def _unload(self):
        decky.logger.info("Multi-User Manager unloaded")

    # Function called after `_unload` during uninstall, utilize this to clean up processes and other remnants of your
    # plugin that may remain on the system
    async def _uninstall(self):
        decky.logger.info("Multi-User Manager uninstalled")

    # Migrations that should be performed before entering `_main()`.
    async def _migration(self):
        decky.logger.info("Migrating Multi-User Manager")
    
    async def trigger_pending_launch(self):
        """Called by frontend when it loads - checks for pending game launch"""
        decky.logger.info("trigger_pending_launch called by frontend")
        asyncio.create_task(self._check_pending_launch())
    
    async def test_pending_launch(self, appid: str):
        """Test method to manually trigger pending launch check"""
        decky.logger.info(f"test_pending_launch called with appid: {appid}")
        # Save the file
        self._save_pending_launch(appid, delay=5)
        # Now check it
        await self._check_pending_launch()
        return {"success": True, "message": f"Triggered launch for {appid}"}

    async def check_pending_file(self):
        """Debug method to check if pending file exists"""
        exists = self.PENDING_LAUNCH_FILE.exists()
        content = None
        if exists:
            try:
                with open(self.PENDING_LAUNCH_FILE, 'r') as f:
                    content = f.read()
            except Exception as e:
                content = str(e)
        return {"exists": exists, "path": str(self.PENDING_LAUNCH_FILE), "content": content}

    async def debug_registry(self):
        """Debug method to inspect registry.vdf contents"""
        try:
            result = {"exists": False, "auto_login_user": None, "remember_password": None, "snippet": ""}
            
            if self.REGISTRY_VDF.exists():
                result["exists"] = True
                with open(self.REGISTRY_VDF, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Extract AutoLoginUser
                auto_match = re.search(r'"AutoLoginUser"\s+"([^"]*)"', content, re.IGNORECASE)
                if auto_match:
                    result["auto_login_user"] = auto_match.group(1)
                
                # Extract RememberPassword
                remember_match = re.search(r'"RememberPassword"\s+"([^"]*)"', content, re.IGNORECASE)
                if remember_match:
                    result["remember_password"] = remember_match.group(1)
                
                # Find the Steam section for context
                steam_section = re.search(r'"HKCU".*?"Software".*?"Valve".*?"Steam"[^{]*\{([^}]{0,1000})', content, re.DOTALL | re.IGNORECASE)
                if steam_section:
                    result["snippet"] = steam_section.group(1)[:500]
                else:
                    result["snippet"] = content[:500]
            
            decky.logger.info(f"Debug registry: {result}")
            return result
        except Exception as e:
            decky.logger.error(f"Debug registry error: {e}")
            return {"error": str(e)}

    async def get_users(self):
        """Get list of all Steam users from loginusers.vdf"""
        decky.logger.info("get_users called")
        try:
            if not self.LOGINUSERS_VDF.exists():
                decky.logger.error(f"loginusers.vdf not found at {self.LOGINUSERS_VDF}")
                return []
            
            # Read line by line first debug
            # decky.logger.info(f"Reading {self.LOGINUSERS_VDF}")
            
            with open(self.LOGINUSERS_VDF, 'r', encoding='utf-8') as f:
                content = f.read()
            
            decky.logger.info(f"File read, size: {len(content)}")

            users = []
            # Parse VDF format to extract user information
            # Using finditer with DOTALL to match multiline blocks
            user_blocks = list(re.finditer(r'"(\d+)"\s*\{([^}]+)\}', content, re.DOTALL))
            
            decky.logger.info(f"Found {len(user_blocks)} user blocks")

            for match in user_blocks:
                steamid = match.group(1)
                user_data = match.group(2)
                # decky.logger.info(f"Parsing user {steamid}")
                
                # Extract fields with forgiving regex (ignoring case for keys)
                account_match = re.search(r'"AccountName"\s+"([^"]+)"', user_data, re.IGNORECASE)
                persona_match = re.search(r'"PersonaName"\s+"([^"]+)"', user_data, re.IGNORECASE)
                recent_match = re.search(r'"mostrecent"\s+"([^"]+)"', user_data, re.IGNORECASE)
                timestamp_match = re.search(r'"Timestamp"\s+"([^"]+)"', user_data, re.IGNORECASE)
                
                if account_match:
                    users.append({
                         # Ensure types are correct for frontend
                        'steamid': str(steamid),
                        'accountName': account_match.group(1),
                        'personaName': persona_match.group(1) if persona_match else account_match.group(1),
                        'mostRecent': (recent_match.group(1) == "1") if recent_match else False,
                        'timestamp': int(timestamp_match.group(1)) if timestamp_match else 0
                    })
            
            # Sort by timestamp (most recent first)
            users.sort(key=lambda x: x['timestamp'], reverse=True)
            decky.logger.info(f"Found {len(users)} users")
            return users
            
        except Exception as e:
            decky.logger.error(f"Error reading users: {e}")
            # decky.logger.exception("Stack trace:") # Commenting out to ensure stability
            return []
    
    async def get_current_user(self):
        """Get the currently logged-in Steam user"""
        try:
            users = await self.get_users()
            for user in users:
                if user['mostRecent']:
                    return user
            # If no mostRecent flag, return first user (most recent by timestamp)
            return users[0] if users else None
        except Exception as e:
            decky.logger.error(f"Error getting current user: {e}")
            return None
    
    async def get_game_owner(self, appid: str):
        """Find which user owns the installed game by checking appmanifest"""
        try:
            library_folders = [self.STEAM_CONFIG_PATH.parent / "steamapps"]
            
            # 1. Read libraryfolders.vdf to find other libraries
            library_vdf = self.STEAM_CONFIG_PATH / "libraryfolders.vdf"
            if library_vdf.exists():
                with open(library_vdf, 'r', encoding='utf-8') as f:
                    content = f.read()
                # Simple regex to find paths (not perfect but usually works for VDF)
                # Looking for "path" "/path/to/lib"
                paths = re.findall(r'"path"\s+"([^"]+)"', content)
                for p in paths:
                    path_obj = Path(p) / "steamapps"
                    if path_obj not in library_folders:
                        library_folders.append(path_obj)
            
            # 2. Search for appmanifest in all libraries
            manifest_file = None
            for lib in library_folders:
                candidate = lib / f"appmanifest_{appid}.acf"
                if candidate.exists():
                    manifest_file = candidate
                    break
            
            if not manifest_file:
                decky.logger.info(f"Manifest for {appid} not found in {len(library_folders)} libs")
                # Log libs for debugging
                # decky.logger.info(f"Checked libs: {[str(l) for l in library_folders]}")
                return None
                
            # 3. Read manifest to get LastOwner and InstalledBy
            with open(manifest_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            result = {}
            # Use ignorecase and handle potenital surrounding quotes variance
            owner_match = re.search(r'"LastOwner"\s+"(\d+)"', content, re.IGNORECASE)
            if owner_match:
                result["last_owner"] = owner_match.group(1)
            
            installer_match = re.search(r'"InstalledBy"\s+"(\d+)"', content, re.IGNORECASE)
            if installer_match:
                result["installed_by"] = installer_match.group(1)
            
            # Send first 500 chars to frontend for debugging
            result["_debug_snippet"] = content[:500]

            if not result.get("last_owner") and not result.get("installed_by"):
                decky.logger.warn(f"Found manifest for {appid} but no owner info found")
                
            return result
            
        except Exception as e:
            decky.logger.error(f"Error getting game owner: {e}")
            return None

    async def get_local_owners(self, appid: str):
        """Scan userdata folders to find users who have config for this app (played/owned)"""
        owners = []
        if not self.USERDATA_PATH.exists():
            return []
            
        for user_dir in self.USERDATA_PATH.iterdir():
            if not user_dir.is_dir() or not user_dir.name.isdigit():
                continue
                
            local_config = user_dir / "config" / "localconfig.vdf"
            if not local_config.exists():
                continue
                
            try:
                with open(local_config, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    
                    # Find the AppID block
                    match = re.search(rf'"{appid}"\s*({{)', content)
                    if match:
                        start_brace_idx = match.start(1)
                        
                        # Find matching closing brace
                        depth = 0
                        in_quote = False
                        end_brace_idx = -1
                        
                        for i in range(start_brace_idx, len(content)):
                            char = content[i]
                            if char == '"' and (i == 0 or content[i-1] != '\\'):
                                in_quote = not in_quote
                            elif not in_quote:
                                if char == '{':
                                    depth += 1
                                elif char == '}':
                                    depth -= 1
                                    if depth == 0:
                                        end_brace_idx = i
                                        break
                        
                        if end_brace_idx != -1:
                            block_content = content[start_brace_idx:end_brace_idx+1]
                            
                            # Check for PlayTime > 0
                            # PlayTime is in minutes. "at least 1 second" -> > 0 minutes is the best proxy locally.
                            pt_match = re.search(r'"PlayTime"\s+"(\d+)"', block_content, re.IGNORECASE)
                            if pt_match:
                                playtime = int(pt_match.group(1))
                                if playtime > 0:
                                    steam3 = int(user_dir.name)
                                    steam64 = steam3 + 76561197960265728
                                    owners.append(str(steam64))

            except Exception as e:
                decky.logger.error(f"Error scanning user {user_dir.name}: {e}")
                
        return owners

    async def switch_user(self, steamid: str, username: str, appid: str = None):
        """Switch to a different Steam user by modifying registry.vdf and loginusers.vdf"""
        try:
            decky.logger.info(f"Switching to user: {username} (steamid: {steamid})")
            
            # 1. Modify registry.vdf - Contains AutoLoginUser which Steam checks on startup
            if self.REGISTRY_VDF.exists():
                decky.logger.info(f"Modifying registry.vdf at {self.REGISTRY_VDF}")
                with open(self.REGISTRY_VDF, 'r', encoding='utf-8') as f:
                    registry_content = f.read()
                
                # Set AutoLoginUser to target username
                original_registry = registry_content
                registry_content = re.sub(
                    r'("AutoLoginUser"\s+")[^"]*"',
                    rf'\1{username}"',
                    registry_content,
                    flags=re.IGNORECASE
                )
                
                # Ensure RememberPassword is enabled
                registry_content = re.sub(
                    r'("RememberPassword"\s+")[^"]*"',
                    r'\g<1>1"',
                    registry_content,
                    flags=re.IGNORECASE
                )
                
                if registry_content != original_registry:
                    decky.logger.info("registry.vdf modified, writing...")
                    with open(self.REGISTRY_VDF, 'w', encoding='utf-8') as f:
                        f.write(registry_content)
                    try:
                        shutil.chown(self.REGISTRY_VDF, user="deck", group="deck")
                    except Exception as e:
                        decky.logger.warn(f"Failed to chown registry.vdf: {e}")
                else:
                    decky.logger.warn("No changes made to registry.vdf - pattern not found")
            else:
                decky.logger.warn(f"registry.vdf not found at {self.REGISTRY_VDF}")
            
            # 2. Modify loginusers.vdf - Set mostrecent flag
            if self.LOGINUSERS_VDF.exists():
                decky.logger.info(f"Modifying loginusers.vdf at {self.LOGINUSERS_VDF}")
                with open(self.LOGINUSERS_VDF, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Reset all mostrecent and AllowAutoLogin to "0"
                content = re.sub(
                    r'("mostrecent"\s+)"1"',
                    r'\1"0"',
                    content,
                    flags=re.IGNORECASE
                )
                content = re.sub(
                    r'("AllowAutoLogin"\s+)"1"',
                    r'\1"0"',
                    content,
                    flags=re.IGNORECASE
                )
                
                # Set target user's mostrecent and AllowAutoLogin to "1"
                # Find the user block and modify within it
                def set_user_flags(match):
                    block = match.group(0)
                    block = re.sub(r'("mostrecent"\s+)"0"', r'\1"1"', block, flags=re.IGNORECASE)
                    block = re.sub(r'("AllowAutoLogin"\s+)"0"', r'\1"1"', block, flags=re.IGNORECASE)
                    return block
                
                content = re.sub(
                    rf'"{steamid}"\s*\{{[^}}]+\}}',
                    set_user_flags,
                    content,
                    flags=re.DOTALL
                )
                
                # Update timestamp
                ts_now = int(time.time())
                content = re.sub(
                    rf'("{steamid}"\s*\{{[^}}]*"Timestamp"\s+)"\d+"',
                    rf'\g<1>"{ts_now}"',
                    content,
                    flags=re.DOTALL | re.IGNORECASE
                )
                
                decky.logger.info("loginusers.vdf modified, writing...")
                with open(self.LOGINUSERS_VDF, 'w', encoding='utf-8') as f:
                    f.write(content)
                try:
                    shutil.chown(self.LOGINUSERS_VDF, user="deck", group="deck")
                except Exception as e:
                    decky.logger.warn(f"Failed to chown loginusers.vdf: {e}")
            
            decky.logger.info("Config files updated, restarting Steam...")
            return await self.restart_steam(appid)
            
        except Exception as e:
            decky.logger.error(f"Error switching user: {e}")
            decky.logger.exception("Full stack trace:")
            return {"success": False, "error": str(e)}

    async def restart_steam(self, appid: str = None, username: str = None):
        """Restart Steam to apply user changes. Optionally launch a game."""
        try:
            decky.logger.info(f"Restarting Steam. AppID to launch: {appid}")
            
            # Kill Steam processes
            subprocess.run(['killall', '-9', 'steam'], check=False)
            subprocess.run(['killall', '-9', 'steamwebhelper'], check=False)
            
            # Wait for processes to fully terminate
            await asyncio.sleep(2)
            
            # If we have an appid to launch, save it for after Steam restarts
            # We can't use -applaunch because Steam needs to complete login first
            if appid:
                self._save_pending_launch(appid)
            
            # Restart Steam - rely on registry.vdf AutoLoginUser for login
            cmd = ['steam']
            # Note: Don't use -applaunch here - it runs before login completes
            # The pending launch system will handle game launch after login

            decky.logger.info(f"Starting Steam with: {' '.join(cmd)}")
            subprocess.Popen(cmd, 
                           stdout=subprocess.DEVNULL, 
                           stderr=subprocess.DEVNULL,
                           start_new_session=True)
            
            decky.logger.info("Steam restart initiated")
            return {"success": True}
            
        except Exception as e:
            decky.logger.error(f"Error restarting Steam: {e}")
            return {"success": False, "error": str(e)}
