import asyncio
import os
import re
import subprocess
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
    
    # Asyncio-compatible long-running code, executed in a task when the plugin is loaded
    async def _main(self):
        decky.logger.info("Multi-User Manager loaded")

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
    
    async def get_users(self):
        """Get list of all Steam users from loginusers.vdf"""
        try:
            if not self.LOGINUSERS_VDF.exists():
                decky.logger.error(f"loginusers.vdf not found at {self.LOGINUSERS_VDF}")
                return []
            
            with open(self.LOGINUSERS_VDF, 'r', encoding='utf-8') as f:
                content = f.read()
            
            users = []
            # Parse VDF format to extract user information
            user_blocks = re.finditer(r'"(\d+)"\s*\{([^}]+)\}', content, re.DOTALL)
            
            for match in user_blocks:
                steamid = match.group(1)
                user_data = match.group(2)
                
                # Extract account name
                account_match = re.search(r'"AccountName"\s+"([^"]+)"', user_data)
                persona_match = re.search(r'"PersonaName"\s+"([^"]+)"', user_data)
                recent_match = re.search(r'"mostrecent"\s+"([^"]+)"', user_data)
                timestamp_match = re.search(r'"Timestamp"\s+"([^"]+)"', user_data)
                
                if account_match:
                    users.append({
                        'steamid': steamid,
                        'accountName': account_match.group(1),
                        'personaName': persona_match.group(1) if persona_match else account_match.group(1),
                        'mostRecent': recent_match.group(1) == "1" if recent_match else False,
                        'timestamp': int(timestamp_match.group(1)) if timestamp_match else 0
                    })
            
            # Sort by timestamp (most recent first)
            users.sort(key=lambda x: x['timestamp'], reverse=True)
            decky.logger.info(f"Found {len(users)} users")
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

    async def switch_user(self, steamid: str):
        """Switch to a different Steam user by updating loginusers.vdf"""
        try:
            if not self.LOGINUSERS_VDF.exists():
                decky.logger.error("loginusers.vdf not found during switch")
                return {"success": False, "error": "loginusers.vdf not found"}
            
            # Read current file
            with open(self.LOGINUSERS_VDF, 'r', encoding='utf-8') as f:
                content = f.read()

            decky.logger.info(f"Read {len(content)} chars from loginusers.vdf")
 
            # Update mostrecent flags
            # First, set all to "0"
            content = re.sub(
                r'"mostrecent"\s+"1"',
                '"mostrecent"\t\t"0"',
                content,
                flags=re.IGNORECASE
            )
            
            # Then set the target user to "1"
            # Find the specific user block and update it
            # We use a more robust pattern
            pattern = rf'("{steamid}"\s*\{{[^}}]*"mostrecent"\s+)"0"'
            
            # Check if we can find the user first
            if steamid not in content:
                decky.logger.error(f"User {steamid} not found in file content")
                return {"success": False, "error": "User ID not found in VDF"}
                
            content = re.sub(
                pattern,
                r'\1"1"',
                content,
                flags=re.DOTALL | re.IGNORECASE
            )
            
            # Write back to file
            # with open(self.LOGINUSERS_VDF, 'w', encoding='utf-8') as f:
            #     f.write(content)
            
            decky.logger.info(f"[DRY-RUN] Would have switched to user {steamid}")
            decky.logger.info(f"[DRY-RUN] Updated content length would be: {len(content)}")
            
            return {"success": True, "steamid": steamid}
            
        except Exception as e:
            decky.logger.error(f"Error switching user: {e}")
            decky.logger.exception("Full stack trace:")
            return {"success": False, "error": str(e)}
    
    async def restart_steam(self):
        """Restart Steam to apply user changes"""
        try:
            # Kill Steam processes
            subprocess.run(['killall', '-9', 'steam'], check=False)
            subprocess.run(['killall', '-9', 'steamwebhelper'], check=False)
            
            # Wait a moment
            await asyncio.sleep(1)
            
            # Restart Steam
            subprocess.Popen(['steam', '-silent'], 
                           stdout=subprocess.DEVNULL, 
                           stderr=subprocess.DEVNULL,
                           start_new_session=True)
            
            decky.logger.info("Steam restart initiated")
            return {"success": True}
            
        except Exception as e:
            decky.logger.error(f"Error restarting Steam: {e}")
            return {"success": False, "error": str(e)}
