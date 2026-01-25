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
import { definePlugin, callable, routerHook } from "@decky/api";
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
const getGameOwner = callable<[string], string | null>("get_game_owner");
const switchUser = callable<[string], { success: boolean; error?: string }>("switch_user");
const restartSteam = callable<[], { success: boolean; error?: string }>("restart_steam");

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
            const result = await switchUser(user.steamid);
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
    </PanelSection>
  );
}

const OwnerLabel = ({ appId, overview }: { appId: string, overview?: any }) => {
  const [ownerName, setOwnerName] = useState<string | null>(null);

  useEffect(() => {
    // console.log("OwnerLabel mounted for AppID:", appId);
    const fetchOwner = async () => {
      try {
        const [ownerId, currentUser, allUsers] = await Promise.all([
            getGameOwner(appId),
            getCurrentUser(),
            getUsers()
        ]);
        
        // console.log("Owner Fetch Result:", { appId, ownerId, currentUser: currentUser?.steamid });

        if (ownerId && currentUser && ownerId !== currentUser.steamid) {
             const owner = allUsers.find(u => u.steamid === ownerId);
             if (owner) {
                 setOwnerName(owner.personaName);
             }
        }
      } catch (e) {
        console.error("Error fetching owner for label", e);
      }
    };
    fetchOwner();
  }, [appId]);

  // Debugging: Get button state from overview if available
  const buttonState = overview?.display_status || overview?.status_string || "Unknown State";

  // CHANGED: Always render for debugging verification
  // if (!ownerName) return null;

  return (
    <PanelSectionRow>
     <div style={{
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
        <FaUsers style={{ color: "#1a9fff" }} />
        <div style={{ display: "flex", flexDirection: "column" }}>
            <span>Owned by <strong>{ownerName || "Checking..."}</strong></span>
            <span style={{ fontSize: "0.8em", opacity: 0.7 }}>State: {buttonState} (ID: {appId})</span>
        </div>
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

                     console.log("[MultiUser] Patching renderFunc. AppID:", appId);

                     wrapReactType(ret1.props.children);
                     afterPatch(
                        ret1.props.children.type,
                        'type',
                        (_1: Record<string, unknown>[], ret2: ReactElement) => {
                            const componentToSplice =
                                ret2.props.children?.[1]?.props.children.props
                                    .children;
                            
                            console.log("[MultiUser] componentToSplice exists:", !!componentToSplice, "Length:", componentToSplice?.length);

                             // Look for where to insert - typically before the game details/overview
                            const spliceIndex = componentToSplice?.findIndex(
                                (child: ReactElement) => {
                                    return (
                                        child?.props?.childFocusDisabled !== undefined &&
                                        child?.props?.children?.props?.overview !== undefined
                                    );
                                }
                            );
                            
                            console.log("[MultiUser] Found spliceIndex:", spliceIndex);

                            const component = <OwnerLabel appId={appId.toString()} overview={overview} />;

                            if (spliceIndex > -1) {
                                // Simple check to avoid duplicating if we re-render
                                // This is tricky with raw React elements, but splice in place
                                // is usually "okay" if the hook runs once per render cycle.
                                
                                // To act like existing plugins, just insert.
                                componentToSplice?.splice(
                                    Math.max(0, spliceIndex),
                                    0,
                                    component
                                );
                            } else {
                                // If we couldn't find the insertion point, log it
                                console.warn("[MultiUser] Could not find splice index. Attempting fallback unshift.");
                                
                                // Fallback: Try to find ANY index to insert at, e.g. at the top
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
