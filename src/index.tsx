import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import { definePlugin } from "@decky/api";
import { FaUsers } from "react-icons/fa";

// import logo from "../assets/logo.png";

function Content() {
  return (
    <PanelSection title="Account Management">
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={() => {
            console.log("TODO: Switch Account");
          }}
        >
          Switch Account (Placeholder)
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

export default definePlugin(() => {
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
    onDismount() {},
  };
});
