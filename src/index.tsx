import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  staticClasses,
  Focusable,
  ConfirmModal,
  showModal,
  afterPatch,
  wrapReactType
} from "@decky/ui";
import { definePlugin, callable, routerHook, fetchNoCors } from "@decky/api";
import { FaUsers, FaUserCircle, FaSyncAlt } from "react-icons/fa";
import { useState, useEffect, ReactElement } from "react";

// import logo from "../assets/logo.png";

interface SteamUser {
  steamid: string;
  accountName: string;
  personaName: string;
  mostRecent: boolean;
  timestamp: number;
}

// Backend methods
const getUsers = callable<[], SteamUser[]>("get_users");
const getCurrentUser = callable<[], SteamUser | null>("get_current_user");
const getGameOwner = callable<[string], { last_owner?: string; installed_by?: string; _debug_snippet?: string } | null>("get_game_owner");
const getLocalOwners = callable<[string], string[]>("get_local_owners");
const switchUser = callable<[string, string, string?], { success: boolean; error?: string }>("switch_user");
const debugRegistry = callable<[], { exists: boolean; auto_login_user?: string; remember_password?: string; snippet?: string; error?: string }>("debug_registry");

// Removed old UI injection logic. We use Router Patch now.

function Content() {
  const [users, setUsers] = useState<SteamUser[]>([]);
  const [currentUser, setCurrentUser] = useState<SteamUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorHeader, setErrorHeader] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    setErrorHeader(null);
    try {
      console.log("Fetching users...");
      const [usersData, currentUserData] = await Promise.all([
        getUsers(),
        getCurrentUser(),
      ]);
      console.log("Users fetched:", usersData);
      setUsers(usersData || []);
      setCurrentUser(currentUserData);
    } catch (error: any) {
      console.error("Error loading users:", error);
      setErrorHeader(error?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleSwitchUser = async (user: SteamUser) => {
    if (user.steamid === currentUser?.steamid) {
      return;
    }

    showModal(
      <ConfirmModal
        strTitle="Switch User"
        strDescription={`Switch to ${user.personaName}? Steam will restart.`}
        strOKButtonText="Switch"
        strCancelButtonText="Cancel"
        onOK={async () => {
          setSwitching(true);
          try {
            const result = await switchUser(user.steamid, user.accountName);
            if (result.success) {
              console.log("Switch user success (Dry Run)");
              // Wait a moment before restarting
              // await new Promise(resolve => setTimeout(resolve, 500));
              // await restartSteam();
              
              // For testing: just reload users
              loadUsers();
            } else {
              console.error("Error switching user:", result.error);
            }
          } catch (error) {
            console.error("Error switching user:", error);
          } finally {
            setSwitching(false);
          }
        }}
      />
    );
  };

  if (loading) {
    return (
      <PanelSection title="Account Management">
        <PanelSectionRow>
          <div style={{ display: "flex", justifyContent: "center", padding: "20px" }}>
            Loading users...
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  if (errorHeader) {
    return (
      <PanelSection title="Account Management">
        <PanelSectionRow>
          <div style={{ color: "red", marginBottom: "10px" }}>Error: {errorHeader}</div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={loadUsers}>
            Retry
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <PanelSection title="Account Management">
      {currentUser && (
        <PanelSectionRow>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <FaUserCircle size={16} />
            <div>
              <div style={{ fontWeight: "bold" }}>Current User</div>
              <div style={{ fontSize: "0.9em", opacity: 0.7 }}>{currentUser.personaName}</div>
            </div>
          </div>
        </PanelSectionRow>
      )}

      <PanelSectionRow>
        <div style={{ fontSize: "0.9em", fontWeight: "bold", marginBottom: "4px" }}>
          Available Accounts ({users.length})
        </div>
      </PanelSectionRow>

      <Focusable style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {users.map((user) => (
          <ButtonItem
            key={user.steamid}
            layout="below"
            disabled={switching || user.steamid === currentUser?.steamid}
            onClick={() => handleSwitchUser(user)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <FaUsers size={14} />
              <div style={{ flex: 1 }}>
                <div>{user.personaName}</div>
                <div style={{ fontSize: "0.8em", opacity: 0.6 }}>@{user.accountName}</div>
              </div>
              {user.steamid === currentUser?.steamid && (
                <div style={{ fontSize: "0.8em", color: "#4CAF50" }}>Active</div>
              )}
            </div>
          </ButtonItem>
        ))}
      </Focusable>

      {users.length === 0 && (
        <PanelSectionRow>
          <div style={{ opacity: 0.6, fontSize: "0.9em" }}>No users found</div>
        </PanelSectionRow>
      )}

      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={loading}
          onClick={loadUsers}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", justifyContent: "center" }}>
            <FaSyncAlt size={14} />
            Refresh
          </div>
        </ButtonItem>
      </PanelSectionRow>

      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={async () => {
            const result = await debugRegistry();
            console.log("Registry debug:", result);
            alert(`AutoLoginUser: ${result.auto_login_user || 'not set'}\nRememberPassword: ${result.remember_password || 'not set'}\nExists: ${result.exists}`);
          }}
        >
          Debug Registry
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

const OwnerLabel = ({ appId, overview }: { appId: string, overview?: any, [key: string]: any }) => {
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [localPlayers, setLocalPlayers] = useState<string[]>([]);
  const [shouldShow, setShouldShow] = useState<boolean>(false);

  useEffect(() => {
    // console.log("OwnerLabel mounted for AppID:", appId);
    const fetchOwner = async () => {
      try {
        setShouldShow(false);
        // Fetch all data in parallel
        const [ownerData, currentUser, allUsers, localOwnersIds] = await Promise.all([
            getGameOwner(appId),
            getCurrentUser(),
            getUsers(),
            getLocalOwners(appId)
        ]);
        
        console.log("[MultiUser] Data Fetch:", { appId, ownerData, localOwnersIds });

        // --- 1. Identify License Owner ---
        let licenseOwnerDisplayName = "Unknown";
        let isCurrentUser = false;
        let foundOwnerId: string | null = null;
        let foundOwnerIsLocal = false;
        
        if (ownerData && ownerData.last_owner) {
            const id = ownerData.last_owner;
            foundOwnerId = id;
            
            // Is it the current user?
            if (currentUser && id === currentUser.steamid) {
                licenseOwnerDisplayName = "You";
                isCurrentUser = true;
            } else {
                // Is it a known local user?
                const localUser = allUsers.find(u => u.steamid === id);
                if (localUser) {
                    licenseOwnerDisplayName = localUser.personaName;
                    foundOwnerIsLocal = true;
                } else {
                    // Remote user - try to fetch web info or just show ID for now
                    // We can do the async fetch separately if needed, but for now denote as Remote
                    licenseOwnerDisplayName = `Remote (${id})`;
                    
                    // Optional: Fire and forget remote fetch? 
                    // Keeping it simple for now to avoid React state race conditions in this snippet
                    try {
                        // Quick sync check if we can (async inside async)
                        fetchNoCors(`https://steamcommunity.com/profiles/${id}/?xml=1`).then(async res => {
                            if (res.ok) {
                                const text = await res.text();
                                const nameMatch = text.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/) || text.match(/<steamID>(.*?)<\/steamID>/);
                                if (nameMatch && nameMatch[1]) {
                                     const newName = nameMatch[1] + " (Remote)";
                                     setOwnerName(prev => (prev && prev.includes("Remote")) ? newName : prev);
                                }
                            }
                        });
                    } catch (e) {}
                }
            }
        }
        
        if (isCurrentUser) {
            // Do not show for games owned by current user
            return;
        }

        // Only show if we found an owner (meaning it's installed and we can identify it)
        // or if there are local players potentially?
        // For now, if owner is "Unknown" (e.g. uninstalled), we hide it too to avoid clutter
        if (licenseOwnerDisplayName === "Unknown") {
            return;
        }

        setOwnerName(licenseOwnerDisplayName);

        // --- 2. Identify Local Players (Config Owners) ---
        const playerNames: string[] = [];
        let firstLocalPlayer: SteamUser | null = null;

        if (localOwnersIds && localOwnersIds.length > 0) {
            for (const id of localOwnersIds) {
                const user = allUsers.find(u => u.steamid === id);
                if (user) {
                     if (currentUser && user.steamid === currentUser.steamid) {
                         playerNames.push("You");
                     } else {
                         playerNames.push(user.personaName);
                         if (!firstLocalPlayer) {
                             firstLocalPlayer = user;
                         }
                     }
                }
            }
        }
        setLocalPlayers(playerNames);
        
        // Determine Switch Target (Prioritize Local Player -> Then Owner if Local)
        if (firstLocalPlayer) {
            setTargetId(firstLocalPlayer.steamid);
            setTargetName(firstLocalPlayer.personaName);
        } else if (foundOwnerId && foundOwnerIsLocal) {
            // If no one played it yet, but the owner is local, switch to owner
            const ownerUser = allUsers.find(u => u.steamid === foundOwnerId);
            if (ownerUser) {
                setTargetId(ownerUser.steamid);
                setTargetName(ownerUser.personaName);
            }
        } else {
            // Owner is remote? Can't switch.
            setTargetId(null);
            setTargetName(null);
        }

        setShouldShow(true);

      } catch (e) {
        console.error("Error fetching owner for label", e);
        setShouldShow(false);
      }
    };
    fetchOwner();
  }, [appId]);

  const handleOwnerClick = () => {
      if (!targetId || !targetName) return;
      
      showModal(
        <ConfirmModal
            strTitle="Switch Account"
            strDescription={`Switch to ${targetName} to play this game? Steam will restart and launch the game.`}
            strOKButtonText="Switch & Play"
            strCancelButtonText="Cancel"
            onOK={async () => {
                try {
                    // Switch user and restart steam in one go (Backend handles sequence)
                    // We don't await result because backend kills steam, terminating connection.
                    switchUser(targetId, appId);
                } catch (e) {
                    console.error("Switch exception", e);
                }
            }}
        />
      );
  };

  if (!shouldShow) {
      return null;
  }

  return (
    <PanelSectionRow>
     <div 
        style={{
          padding: "10px",
          backgroundColor: "#3d4450", 
          borderRadius: "4px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "10px",
          border: '1px solid #1a9fff',
          boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
      }}>
        <FaUsers style={{ color: "#1a9fff", fontSize: "1.5em" }} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            
            {/* License Owner Line */}
            <div style={{ marginBottom: "4px" }}>
                <span style={{ opacity: 0.8, fontSize: "0.9em" }}>Licensed to: </span>
                <span style={{ fontWeight: "bold", color: "white" }}>{ownerName}</span>
            </div>

            {/* Local Players Line */}
            {localPlayers.length > 0 && (
                <div>
                    <span style={{ opacity: 0.8, fontSize: "0.9em" }}>Played by: </span>
                    <span style={{ fontWeight: "bold", color: "#4CAF50" }}>
                        {localPlayers.join(", ")}
                    </span>
                </div>
            )}
             {localPlayers.length === 0 && (
                <div style={{ fontSize: "0.8em", opacity: 0.5, fontStyle: "italic" }}>
                    No local config found
                </div>
            )}
        </div>
        
        {targetId && (
            <ButtonItem
                layout="below"
                onClick={handleOwnerClick}
                style={{
                    width: "auto",
                    minWidth: "80px",
                    padding: "4px 12px",
                    fontSize: "0.9em",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "auto"
                }}
            >
                Switch
            </ButtonItem>
        )}
      </div>
    </PanelSectionRow>
  );
};

const patchAppPage = () => {
    if (!routerHook) {
        console.error("Router hook is not available!");
        return undefined;
    }
    
    // Patch Library Page
    return routerHook.addPatch(
        '/library/app/:appid',
        (props: { path: string; children: ReactElement }) => {
            // console.log("Router Patch triggered for:", props.path);
            afterPatch(
                props.children.props,
                'renderFunc',
                (_: Record<string, unknown>[], ret1: ReactElement) => {
                     // Extract AppID
                     const overview = ret1.props.children.props.overview;
                     const appId = overview?.appid;
                     if (!appId) return ret1;

                     // console.log("[MultiUser] Patching renderFunc. AppID:", appId);

                     wrapReactType(ret1.props.children);
                     afterPatch(
                        ret1.props.children.type,
                        'type',
                        (_1: Record<string, unknown>[], ret2: ReactElement) => {
                            const componentToSplice =
                                ret2.props.children?.[1]?.props.children.props
                                    .children;
                            
                            if (!componentToSplice || !Array.isArray(componentToSplice)) {
                                // console.log("[MultiUser] componentToSplice is not an array or missing");
                                return ret2;
                            }
                            
                            // console.log("[MultiUser] componentToSplice exists:", !!componentToSplice, "Length:", componentToSplice?.length);

                             // Look for where to insert - typically before the game details/overview
                            const spliceIndex = componentToSplice?.findIndex(
                                (child: ReactElement) => {
                                    return (
                                        child?.props?.childFocusDisabled !== undefined &&
                                        child?.props?.children?.props?.overview !== undefined
                                    );
                                }
                            );
                            
                            // console.log("[MultiUser] Found spliceIndex:", spliceIndex);


                            // CHECK FOR DUPLICATES / EXISTING
                            // We look for our component to either update or insert it.
                            const existingIndex = componentToSplice?.findIndex((child: any) => {
                                return child?.type === OwnerLabel || child?.props?._source === "decky-multi-user"; 
                            });

                            // Use a key to force React to remount/reset state when appId changes
                            const component = <OwnerLabel key={appId} appId={appId.toString()} overview={overview} _source="decky-multi-user" />;

                            if (existingIndex !== -1) {
                                // Replace existing instance to ensure props (appId) are updated
                                // console.log("[MultiUser] Updating existing label for AppID:", appId);
                                componentToSplice[existingIndex] = component;
                            } else if (spliceIndex > -1) {
                                // Insert new
                                componentToSplice.splice(
                                    Math.max(0, spliceIndex),
                                    0,
                                    component
                                );
                            } else {
                                // Fallback
                                console.warn("[MultiUser] Could not find splice index. Attempting fallback unshift.");
                                if (componentToSplice && Array.isArray(componentToSplice)) {
                                     componentToSplice.unshift(component);
                                }
                            }
                            return ret2;
                        }
                     );
                     return ret1;
                }
            );
            return props;
        }
    );
};

export default definePlugin(() => {
  let libraryAppPagePatch: any;
  let patchInterval: number | null = null;
  
  const tryPatch = () => {
      if (routerHook) {
          try {
              libraryAppPagePatch = patchAppPage();
              if (libraryAppPagePatch) {
                console.log("[MultiUser] Router patch applied successfully.");
                return true;
              }
          } catch (e) {
              console.error("[MultiUser] Failed to patch app page", e);
          }
      } else {
          // console.log("[MultiUser] routerHook missing.");
      }
      return false;
  };

  // Attempt immediately
  setTimeout(() => {
     if (!tryPatch()) {
        console.log("[MultiUser] Queuing patch retry...");
        // @ts-ignore
        patchInterval = setInterval(() => {
            if (tryPatch()) {
                if (patchInterval) clearInterval(patchInterval);
                patchInterval = null;
            }
        }, 1000);
     }
  }, 1000); // Wait 1s initially to be safe

  return {
    // The name shown in various decky menus
    name: "Multi-User Manager",
    // The element displayed at the top of your plugin's menu
    titleView: <div className={staticClasses.Title}>Multi-User Manager</div>,
    // The content of your plugin's menu
    content: <Content />,
    // The icon displayed in the plugin list
    icon: <FaUsers />,
    // The function triggered when your plugin unloads
    onDismount() {
        if (patchInterval) clearInterval(patchInterval);
        
        if (libraryAppPagePatch) {
            // @ts-ignore
            routerHook.removePatch(
                '/library/app/:appid',
                libraryAppPagePatch
            );
        }
    },
  };
});
