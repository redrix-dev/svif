// Window controls for Windows/Linux, where the window is frameless.
// macOS keeps its native traffic lights (title bar overlay).

import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconClose, IconMaximize, IconMinimize } from "./icons";

export function WindowButtons() {
  const win = getCurrentWindow();
  return (
    <div class="window-buttons">
      <button class="icon-btn" title="Minimize" onClick={() => void win.minimize()}>
        <IconMinimize />
      </button>
      <button class="icon-btn" title="Maximize" onClick={() => void win.toggleMaximize()}>
        <IconMaximize />
      </button>
      <button class="icon-btn win-close" title="Close" onClick={() => void win.close()}>
        <IconClose />
      </button>
    </div>
  );
}
