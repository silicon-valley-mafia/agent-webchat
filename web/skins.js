/* agent-webchat skins (TODO #26): Web Chat styleOptions overrides per skin, used by app.js.
 * Page colours for each skin are in app.css ([data-skin]). */
/**
 * TODO #26: skins. Each skin = CSS variables in app.css ([data-skin]) + Web Chat styleOptions overrides here
 * ("all" first, then the light/dark part). Inspired-by layouts only - no logos or product names.
 */
window.AgentSkins = {
  classic: { label: "Classic" },
  focus: {
    label: "Focus (centered, no reply bubbles)",
    all: {
      bubbleBackground: "transparent", bubbleBorderWidth: 0, bubbleBorderRadius: 0,
      bubbleFromUserBorderWidth: 0, bubbleFromUserBorderRadius: 18,
      botAvatarInitials: "", botAvatarImage: undefined, userAvatarInitials: "", userAvatarImage: undefined
    },
    light: { bubbleFromUserBackground: "#eef0f3", bubbleFromUserTextColor: "#111827", bubbleTextColor: "#111827" },
    dark: { bubbleFromUserBackground: "#1f2937", bubbleFromUserTextColor: "#e5e7eb", bubbleTextColor: "#e5e7eb" }
  },
  contrast: {
    label: "High contrast",
    all: { bubbleBorderWidth: 2, bubbleFromUserBorderWidth: 2, bubbleBorderRadius: 4, bubbleFromUserBorderRadius: 4 },
    light: {
      accent: "#0000cc", backgroundColor: "#ffffff", bubbleBackground: "#ffffff", bubbleTextColor: "#000000", bubbleBorderColor: "#000000",
      bubbleFromUserBackground: "#0000cc", bubbleFromUserTextColor: "#ffffff", bubbleFromUserBorderColor: "#000000",
      subtle: "#1f2937", timestampColor: "#1f2937", sendBoxTextColor: "#000000", sendBoxBackground: "#ffffff", sendBoxBorderTop: "solid 2px #000000"
    },
    dark: {
      accent: "#ffff00", backgroundColor: "#000000", bubbleBackground: "#000000", bubbleTextColor: "#ffffff", bubbleBorderColor: "#ffffff",
      bubbleFromUserBackground: "#ffff00", bubbleFromUserTextColor: "#000000", bubbleFromUserBorderColor: "#ffffff",
      subtle: "#e5e7eb", timestampColor: "#e5e7eb", sendBoxTextColor: "#ffffff", sendBoxBackground: "#000000", sendBoxBorderTop: "solid 2px #ffffff"
    }
  }
};
window.AgentSkinOrder = ["classic", "focus", "contrast"];
