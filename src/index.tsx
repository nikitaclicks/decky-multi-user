import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  staticClasses,
  Focusable,
  ConfirmModal,
  showModal,
  afterPatch,
  wrapReactType,
  ToggleField
} from "@decky/ui";
import { definePlugin, callable, routerHook, fetchNoCors } from "@decky/api";
import { FaUsers, FaUserCircle, FaSyncAlt } from "react-icons/fa";
import { useState, useEffect, ReactElement } from "react";

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
const getGameOwner = callable<[string], { last_owner?: string; installed_by?: string } | null>("get_game_owner");
const getLocalOwners = callable<[string], string[]>("get_local_owners");
const switchUser = callable<[string, string, string?], { success: boolean; error?: string }>("switch_user");

// Check for pending game launch - called when frontend loads
const triggerPendingLaunch = callable<[], void>("trigger_pending_launch");

// Settings management
const getSetting = callable<[string, any], any>("get_setting");
const setSetting = callable<[string, any], boolean>("set_setting");

// Settings keys
const SETTING_SHOW_CONFIRMATION = "show_switch_confirmation";

function Content() {
  const [users, setUsers] = useState<SteamUser[]>([]);
  const [currentUser, setCurrentUser] = useState<SteamUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorHeader, setErrorHeader] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(true);

  const loadUsers = async () => {
    setLoading(true);
    setErrorHeader(null);
    try {
      const [usersData, currentUserData, confirmationSetting] = await Promise.all([
        getUsers(),
        getCurrentUser(),
        getSetting(SETTING_SHOW_CONFIRMATION, true)
      ]);
      setUsers(usersData || []);
      setCurrentUser(currentUserData);
      setShowConfirmation(confirmationSetting !== false);
    } catch (error: any) {
      console.error("[MultiUser] Error loading users:", error);
      setErrorHeader(error?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const doSwitch = async (user: SteamUser, disableConfirmation?: boolean) => {
    setSwitching(true);
    try {
      // If user chose "Don't ask again", save the setting
      if (disableConfirmation) {
        await setSetting(SETTING_SHOW_CONFIRMATION, false);
        setShowConfirmation(false);
      }
      const result = await switchUser(user.steamid, user.accountName);
      if (result.success) {
        loadUsers();
      } else {
        console.error("[MultiUser] Error switching user:", result.error);
      }
    } catch (error) {
      console.error("[MultiUser] Error switching user:", error);
    } finally {
      setSwitching(false);
    }
  };

  const handleSwitchUser = async (user: SteamUser) => {
    if (user.steamid === currentUser?.steamid) {
      return;
    }

    // Skip confirmation if disabled
    if (!showConfirmation) {
      doSwitch(user);
      return;
    }

    showModal(
      <ConfirmModal
        strTitle="Switch User"
        strDescription={`Switch to ${user.personaName}? Steam will restart.`}
        strOKButtonText="Switch"
        strCancelButtonText="Cancel"
        onOK={() => doSwitch(user)}
        onCancel={() => {}}
      >
        <Focusable style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
          <input 
            type="checkbox" 
            id="dontAskAgain"
            style={{ width: "20px", height: "20px" }}
            onChange={(e) => {
              if (e.target.checked) {
                setSetting(SETTING_SHOW_CONFIRMATION, false);
                setShowConfirmation(false);
              }
            }}
          />
          <label htmlFor="dontAskAgain" style={{ opacity: 0.8, fontSize: "13px" }}>
            Don't ask again
          </label>
        </Focusable>
      </ConfirmModal>
    );
  };

  const handleToggleConfirmation = async (checked: boolean) => {
    await setSetting(SETTING_SHOW_CONFIRMATION, checked);
    setShowConfirmation(checked);
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

  // Filter out current user from the switch list
  const otherUsers = users.filter(u => u.steamid !== currentUser?.steamid);

  return (
    <PanelSection title="Accounts">
      {currentUser && (
        <PanelSectionRow>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px", backgroundColor: "rgba(76, 175, 80, 0.1)", borderRadius: "4px", border: "1px solid rgba(76, 175, 80, 0.3)" }}>
            <FaUserCircle size={20} style={{ color: "#4CAF50" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "bold" }}>{currentUser.personaName}</div>
              <div style={{ fontSize: "0.8em", opacity: 0.6 }}>@{currentUser.accountName}</div>
            </div>
            <div style={{ fontSize: "0.75em", color: "#4CAF50", fontWeight: "bold" }}>ACTIVE</div>
          </div>
        </PanelSectionRow>
      )}

      {otherUsers.length > 0 && (
        <>
          <PanelSectionRow>
            <div style={{ fontSize: "0.85em", opacity: 0.7, marginTop: "8px", marginBottom: "4px" }}>
              Switch to:
            </div>
          </PanelSectionRow>
          <Focusable style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {otherUsers.map((user) => (
              <ButtonItem
                key={user.steamid}
                layout="below"
                disabled={switching}
                onClick={() => handleSwitchUser(user)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <FaUsers size={14} />
                  <div style={{ flex: 1 }}>
                    <div>{user.personaName}</div>
                    <div style={{ fontSize: "0.8em", opacity: 0.6 }}>@{user.accountName}</div>
                  </div>
                </div>
              </ButtonItem>
            ))}
          </Focusable>
        </>
      )}

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
        <ToggleField
          label="Confirm before switching"
          description="Show confirmation dialog when switching accounts"
          checked={showConfirmation}
          onChange={handleToggleConfirmation}
        />
      </PanelSectionRow>
    </PanelSection>
  );
}

const OwnerLabel = ({ appId }: { appId: string; [key: string]: unknown }) => {
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [targetAccountName, setTargetAccountName] = useState<string | null>(null);
  const [localPlayers, setLocalPlayers] = useState<string[]>([]);
  const [shouldShow, setShouldShow] = useState<boolean>(false);
  const [showConfirmation, setShowConfirmation] = useState<boolean>(true);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);

  useEffect(() => {
    const fetchOwner = async () => {
      try {
        setShouldShow(false);
        // Fetch all data in parallel, including confirmation setting
        const [ownerData, currentUser, allUsers, localOwnersIds, confirmSetting] = await Promise.all([
            getGameOwner(appId),
            getCurrentUser(),
            getUsers(),
            getLocalOwners(appId),
            getSetting(SETTING_SHOW_CONFIRMATION, true)
        ]);
        
        setShowConfirmation(confirmSetting !== false);

        // Identify License Owner
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
                    licenseOwnerDisplayName = id;
                    
                    // Attempt to fetch display name from Steam community (non-blocking, best-effort)
                    fetchNoCors(`https://steamcommunity.com/profiles/${id}/?xml=1`)
                        .then(async res => {
                            if (res.ok) {
                                const text = await res.text();
                                const nameMatch = text.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/) || text.match(/<steamID>(.*?)<\/steamID>/);
                                if (nameMatch && nameMatch[1]) {
                                     const newName = nameMatch[1];
                                     setOwnerName(prev => prev?.startsWith('7656') ? newName : prev);
                                }
                            }
                        })
                        .catch(() => {
                            // Silently ignore - this is a best-effort enhancement
                        });
                }
            }
        }
        
        if (isCurrentUser) {
            return;
        }

        if (licenseOwnerDisplayName === "Unknown") {
            return;
        }

        setOwnerName(licenseOwnerDisplayName);

        const playerNames: string[] = [];
        let firstLocalPlayer: SteamUser | null = null;
        let currentUserCanPlay = false;

        if (localOwnersIds && localOwnersIds.length > 0) {
            for (const id of localOwnersIds) {
                const user = allUsers.find(u => u.steamid === id);
                if (user) {
                     if (currentUser && user.steamid === currentUser.steamid) {
                         currentUserCanPlay = true;
                     } else {
                         playerNames.push(user.personaName);
                         if (!firstLocalPlayer) {
                             firstLocalPlayer = user;
                         }
                     }
                }
            }
        }

        if (currentUserCanPlay) {
            return;
        }
        setLocalPlayers(playerNames);
        
        if (firstLocalPlayer) {
            setTargetId(firstLocalPlayer.steamid);
            setTargetName(firstLocalPlayer.personaName);
            setTargetAccountName(firstLocalPlayer.accountName);
        } else if (foundOwnerId && foundOwnerIsLocal) {
            const ownerUser = allUsers.find(u => u.steamid === foundOwnerId);
            if (ownerUser) {
                setTargetId(ownerUser.steamid);
                setTargetName(ownerUser.personaName);
                setTargetAccountName(ownerUser.accountName);
            }
        } else {
            setTargetId(null);
            setTargetName(null);
            setTargetAccountName(null);
        }

        setShouldShow(true);

      } catch (e) {
        console.error("[MultiUser] Error fetching owner for label:", e);
        setShouldShow(false);
      }
    };
    fetchOwner();
  }, [appId]);

  const handleOwnerClick = () => {
      if (!targetId || !targetName || !targetAccountName) return;

      const doSwitchAndPlay = async (disableConfirmation?: boolean) => {
        try {
          if (disableConfirmation) {
            await setSetting(SETTING_SHOW_CONFIRMATION, false);
            setShowConfirmation(false);
          }
          setIsSwitching(true);
          switchUser(targetId, targetAccountName, appId);
        } catch (e) {
          console.error("[MultiUser] Switch exception:", e);
          setIsSwitching(false);
        }
      };

      if (!showConfirmation) {
        doSwitchAndPlay();
        return;
      }
      
      showModal(
        <ConfirmModal
            strTitle="Switch Account"
            strDescription={`Switch to ${targetName} to play this game? Steam will restart and launch the game.`}
            strOKButtonText="Switch User & Play"
            strCancelButtonText="Cancel"
            onOK={() => doSwitchAndPlay()}
            onCancel={() => {}}
        >
          <Focusable style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <input 
              type="checkbox" 
              id="dontAskAgainGame"
              style={{ width: "20px", height: "20px" }}
              onChange={(e) => {
                if (e.target.checked) {
                  setSetting(SETTING_SHOW_CONFIRMATION, false);
                  setShowConfirmation(false);
                }
              }}
            />
            <label htmlFor="dontAskAgainGame" style={{ opacity: 0.8, fontSize: "13px" }}>
              Don't ask again
            </label>
          </Focusable>
        </ConfirmModal>
      );
  };

  if (!shouldShow) {
      return null;
  }

  // Full-width row with button and info text
  if (isSwitching) {
    return (
      <div style={{ 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center",
        gap: "12px",
        padding: "14px 12px",
        backgroundColor: "#23262e",
        borderRadius: "4px",
        marginBottom: "8px"
      }}>
        <FaSyncAlt size={16} style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ fontSize: "14px", fontWeight: "500" }}>
          Switching to {targetName}... Please wait
        </span>
      </div>
    );
  }

  return (
    <div style={{ 
      display: "flex", 
      alignItems: "center", 
      gap: "16px",
      padding: "10px 12px",
      backgroundColor: "#23262e",
      borderRadius: "4px",
      marginBottom: "8px"
    }}>
      {/* Switch & Play Button */}
      {targetId && (
        <Focusable onActivate={handleOwnerClick}>
          <div
            onClick={handleOwnerClick}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#2b5a83"}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "#1a9fff"}
            style={{
              padding: "8px 16px",
              backgroundColor: "#1a9fff",
              borderRadius: "2px",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              cursor: "pointer",
              fontWeight: "500",
              color: "white",
              fontSize: "14px",
              lineHeight: "20px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              whiteSpace: "nowrap"
            }}
          >
            <FaUsers size={14} />
            Switch User & Play
          </div>
        </Focusable>
      )}
      
      {/* Info text - always visible */}
      <div style={{ 
        display: "flex", 
        gap: "8px", 
        alignItems: "center",
        fontSize: "13px",
        flex: 1,
        opacity: 0.85
      }}>
        <FaUserCircle size={14} style={{ opacity: 0.6 }} />
        <span>
          <span style={{ color: "#1a9fff", fontWeight: "500" }}>{targetName}</span>
          <span style={{ opacity: 0.6 }}>'s account</span>
          {ownerName !== targetName && (
            <span>
              <span style={{ opacity: 0.6 }}> • licensed to </span>
              <span style={{ fontWeight: "500" }}>{ownerName}</span>
            </span>
          )}
          {localPlayers.length > 0 && localPlayers[0] !== targetName && (
            <span>
              <span style={{ opacity: 0.6 }}> • played by </span>
              <span style={{ color: "#4CAF50" }}>{localPlayers.join(", ")}</span>
            </span>
          )}
        </span>
      </div>
    </div>
  );
};

const patchAppPage = () => {
    if (!routerHook) {
        console.error("[MultiUser] Router hook is not available!");
        return undefined;
    }
    
    // Patch Library Page
    return routerHook.addPatch(
        '/library/app/:appid',
        (props: { path: string; children: ReactElement }) => {
            afterPatch(
                props.children.props,
                'renderFunc',
                (_: Record<string, unknown>[], ret1: ReactElement) => {
                     // Extract AppID - cast to any to access dynamic Steam UI props
                     const ret1Props = ret1.props as { children?: { props?: { overview?: { appid?: string | number } } } };
                     const overview = ret1Props.children?.props?.overview;
                     const appId = overview?.appid;
                     if (!appId) return ret1;

                     wrapReactType((ret1.props as { children: ReactElement }).children);
                     afterPatch(
                        ((ret1.props as { children: { type: unknown } }).children).type,
                        'type',
                        (_1: Record<string, unknown>[], ret2: ReactElement) => {
                            // Cast to any for dynamic Steam UI component structure
                            const ret2Props = ret2.props as { children?: Array<{ props?: { children?: { props?: { children?: ReactElement[] } } } }> };
                            const componentToSplice = ret2Props.children?.[1]?.props?.children?.props?.children;
                            
                            if (!componentToSplice || !Array.isArray(componentToSplice)) {
                                return ret2;
                            }
                            
                            const spliceIndex = componentToSplice?.findIndex(
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                (child: any) => {
                                    return (
                                        child?.props?.childFocusDisabled !== undefined &&
                                        child?.props?.children?.props?.overview !== undefined
                                    );
                                }
                            );
                            

                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const existingIndex = componentToSplice?.findIndex((child: any) => {
                                return child?.type === OwnerLabel || child?.props?._source === "decky-multi-user"; 
                            });

                            const component = <OwnerLabel key={appId} appId={appId.toString()} _source="decky-multi-user" />;

                            if (existingIndex !== -1) {
                                componentToSplice[existingIndex] = component;
                            } else if (spliceIndex > -1) {
                                componentToSplice.splice(
                                    Math.max(0, spliceIndex),
                                    0,
                                    component
                                );
                            } else {
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
  // Check for pending game launch immediately when plugin loads (after Steam restart)
  triggerPendingLaunch().catch(e => console.error("[MultiUser] Pending launch check failed:", e));

  // Inject CSS animation for spinning icon
  const styleId = "decky-multi-user-styles";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  let libraryAppPagePatch: any;
  let patchInterval: number | null = null;
  
  const tryPatch = () => {
      if (routerHook) {
          try {
              libraryAppPagePatch = patchAppPage();
              if (libraryAppPagePatch) {
                return true;
              }
          } catch (e) {
              console.error("[MultiUser] Failed to patch app page", e);
          }
      }
      return false;
  };

  setTimeout(() => {
     if (!tryPatch()) {
        // @ts-ignore
        patchInterval = setInterval(() => {
            if (tryPatch()) {
                if (patchInterval) clearInterval(patchInterval);
                patchInterval = null;
            }
        }, 1000);
     }
  }, 1000);

  return {
    // The name shown in various decky menus
    name: "Quick User Switcher",
    // The element displayed at the top of your plugin's menu
    titleView: <div className={staticClasses.Title}>Quick User Switcher</div>,
    // The content of your plugin's menu
    content: <Content />,
    // The icon displayed in the plugin list
    icon: <FaUsers />,
    // The function triggered when your plugin unloads
    onDismount() {
        if (patchInterval) clearInterval(patchInterval);
        
        // Remove injected styles
        const styleEl = document.getElementById("decky-multi-user-styles");
        if (styleEl) styleEl.remove();
        
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
