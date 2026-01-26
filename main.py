import asyncio
import json
import os
import pwd
import re
import shutil
import subprocess
import time
from pathlib import Path

# The decky plugin module is located at decky-loader/plugin
# For easy intellisense checkout the decky-loader code repo
# and add the `decky-loader/plugin/imports` path to `python.analysis.extraPaths` in `.vscode/settings.json`
import decky

# Initialize decky-loader settings manager
from settings import SettingsManager
settingsDir = os.environ.get("DECKY_PLUGIN_SETTINGS_DIR", "/tmp")
settings = SettingsManager(name="settings", settings_directory=settingsDir)
settings.read()


def get_steam_user():
    """Get the username of the user running Steam (typically 'deck' on Steam Deck)."""
    # Try DECKY_USER environment variable first (set by decky-loader)
    decky_user = os.environ.get("DECKY_USER")
    if decky_user:
        return decky_user
    # Fallback: check who owns the Steam directory
    steam_paths = [
        Path("/home/deck/.steam"),
        Path.home() / ".steam"
    ]
    for steam_path in steam_paths:
        if steam_path.exists():
            try:
                return steam_path.owner()
            except (KeyError, OSError):
                pass
    # Default fallback for Steam Deck
    return "deck"


# Get the Steam user dynamically
STEAM_USER = get_steam_user()
STEAM_HOME = Path(f"/home/{STEAM_USER}")


class Plugin:
    # Paths are determined dynamically based on the Steam user
    STEAM_CONFIG_PATH = STEAM_HOME / ".local/share/Steam/config"
    LOGINUSERS_VDF = STEAM_CONFIG_PATH / "loginusers.vdf"
    USERDATA_PATH = STEAM_HOME / ".local/share/Steam/userdata"
    # Registry file contains AutoLoginUser - key for account switching!
    REGISTRY_VDF = STEAM_HOME / ".steam/registry.vdf"
    # File to store pending game launch after account switch
    PENDING_LAUNCH_FILE = Path("/tmp/decky_multiuser_pending_launch.json")
    
    # Asyncio-compatible long-running code, executed in a task when the plugin is loaded
    async def _main(self):
        decky.logger.info("Quick User Switcher loaded")
        asyncio.create_task(self._check_pending_launch())

    # Settings management
    async def get_setting(self, key: str, default):
        """Get a setting value"""
        return settings.getSetting(key, default)
    
    async def set_setting(self, key: str, value):
        """Set a setting value"""
        settings.setSetting(key, value)
        settings.commit()
        return True

    async def _check_pending_launch(self):
        """Check if there's a pending game launch after account switch"""
        try:
            if not self.PENDING_LAUNCH_FILE.exists():
                return
            
            with open(self.PENDING_LAUNCH_FILE, 'r') as f:
                data = json.load(f)
            
            self.PENDING_LAUNCH_FILE.unlink()
            
            appid = data.get('appid')
            if not appid:
                return
            
            delay = data.get('delay', 3)
            await asyncio.sleep(delay)
            
            result = subprocess.run(
                ['sudo', '-u', STEAM_USER, 'steam', f'steam://rungameid/{appid}'],
                capture_output=True,
                text=True,
                timeout=10
            )
            decky.logger.info(f"Game {appid} launch triggered")
            
        except Exception as e:
            decky.logger.error(f"Error checking pending launch: {e}")
            if self.PENDING_LAUNCH_FILE.exists():
                self.PENDING_LAUNCH_FILE.unlink()

    def _save_pending_launch(self, appid: str, delay: int = 0):
        """Save appid for launch after Steam restart."""
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
        decky.logger.info("Quick User Switcher unloaded")

    # Function called after `_unload` during uninstall, utilize this to clean up processes and other remnants of your
    # plugin that may remain on the system
    async def _uninstall(self):
        decky.logger.info("Quick User Switcher uninstalled")

    # Migrations that should be performed before entering `_main()`.
    async def _migration(self):
        decky.logger.info("Migrating Quick User Switcher")
    
    async def trigger_pending_launch(self):
        """Called by frontend when it loads - checks for pending game launch"""
        asyncio.create_task(self._check_pending_launch())

    async def get_users(self):
        """Get list of all Steam users from loginusers.vdf"""
        try:
            if not self.LOGINUSERS_VDF.exists():
                decky.logger.error(f"loginusers.vdf not found at {self.LOGINUSERS_VDF}")
                return []
            
            with open(self.LOGINUSERS_VDF, 'r', encoding='utf-8') as f:
                content = f.read()
            
            users = []
            user_blocks = list(re.finditer(r'"(\d+)"\s*\{([^}]+)\}', content, re.DOTALL))

            for match in user_blocks:
                steamid = match.group(1)
                user_data = match.group(2)
                
                account_match = re.search(r'"AccountName"\s+"([^"]+)"', user_data, re.IGNORECASE)
                persona_match = re.search(r'"PersonaName"\s+"([^"]+)"', user_data, re.IGNORECASE)
                recent_match = re.search(r'"mostrecent"\s+"([^"]+)"', user_data, re.IGNORECASE)
                timestamp_match = re.search(r'"Timestamp"\s+"([^"]+)"', user_data, re.IGNORECASE)
                
                if account_match:
                    users.append({
                        'steamid': str(steamid),
                        'accountName': account_match.group(1),
                        'personaName': persona_match.group(1) if persona_match else account_match.group(1),
                        'mostRecent': (recent_match.group(1) == "1") if recent_match else False,
                        'timestamp': int(timestamp_match.group(1)) if timestamp_match else 0
                    })
            
            users.sort(key=lambda x: x['timestamp'], reverse=True)
            return users
            
        except Exception as e:
            decky.logger.error(f"Error reading users: {e}")
            return []
    
    async def get_current_user(self):
        """Get the currently logged-in Steam user"""
        try:
            users = await self.get_users()
            for user in users:
                if user['mostRecent']:
                    return user
            return users[0] if users else None
        except Exception as e:
            decky.logger.error(f"Error getting current user: {e}")
            return None
    
    async def get_game_owner(self, appid: str):
        """Find which user owns the installed game by checking appmanifest"""
        try:
            library_folders = [self.STEAM_CONFIG_PATH.parent / "steamapps"]
            
            library_vdf = self.STEAM_CONFIG_PATH / "libraryfolders.vdf"
            if library_vdf.exists():
                with open(library_vdf, 'r', encoding='utf-8') as f:
                    content = f.read()
                paths = re.findall(r'"path"\s+"([^"]+)"', content)
                for p in paths:
                    path_obj = Path(p) / "steamapps"
                    if path_obj not in library_folders:
                        library_folders.append(path_obj)
            
            manifest_file = None
            for lib in library_folders:
                candidate = lib / f"appmanifest_{appid}.acf"
                if candidate.exists():
                    manifest_file = candidate
                    break
            
            if not manifest_file:
                return None
                
            with open(manifest_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            result = {}
            owner_match = re.search(r'"LastOwner"\s+"(\d+)"', content, re.IGNORECASE)
            if owner_match:
                result["last_owner"] = owner_match.group(1)
            
            installer_match = re.search(r'"InstalledBy"\s+"(\d+)"', content, re.IGNORECASE)
            if installer_match:
                result["installed_by"] = installer_match.group(1)

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
                
                registry_content = re.sub(
                    r'("RememberPassword"\s+")[^"]*"',
                    r'\g<1>1"',
                    registry_content,
                    flags=re.IGNORECASE
                )
                
                if registry_content != original_registry:
                    with open(self.REGISTRY_VDF, 'w', encoding='utf-8') as f:
                        f.write(registry_content)
                    try:
                        shutil.chown(self.REGISTRY_VDF, user=STEAM_USER, group=STEAM_USER)
                    except Exception as e:
                        decky.logger.warn(f"Failed to chown registry.vdf: {e}")
                else:
                    decky.logger.warn("No changes made to registry.vdf - pattern not found")
            else:
                decky.logger.warn(f"registry.vdf not found at {self.REGISTRY_VDF}")
            

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
                
                ts_now = int(time.time())
                content = re.sub(
                    rf'("{steamid}"\s*\{{[^}}]*"Timestamp"\s+)"\d+"',
                    rf'\g<1>"{ts_now}"',
                    content,
                    flags=re.DOTALL | re.IGNORECASE
                )
                
                with open(self.LOGINUSERS_VDF, 'w', encoding='utf-8') as f:
                    f.write(content)
                try:
                    shutil.chown(self.LOGINUSERS_VDF, user=STEAM_USER, group=STEAM_USER)
                except Exception as e:
                    decky.logger.warn(f"Failed to chown loginusers.vdf: {e}")
            
            return await self.restart_steam(appid)
            
        except Exception as e:
            decky.logger.error(f"Error switching user: {e}")
            decky.logger.exception("Full stack trace:")
            return {"success": False, "error": str(e)}

    async def restart_steam(self, appid: str = None, username: str = None):
        """Restart Steam to apply user changes. Optionally launch a game."""
        try:
            decky.logger.info(f"Restarting Steam. AppID to launch: {appid}")
            
            subprocess.run(['killall', '-9', 'steam'], check=False)
            subprocess.run(['killall', '-9', 'steamwebhelper'], check=False)
            
            await asyncio.sleep(2)
            
            if appid:
                self._save_pending_launch(appid)
            
            cmd = ['steam']

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
