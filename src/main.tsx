import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/fonts";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";
import { App } from "./App";
import { Tray } from "./screens/Tray";

// The popover window is transparent (macOS vibrancy behind it): nothing but `.tray` paints.
if (window.location.hash === "#tray") document.documentElement.classList.add("is-tray");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.location.hash === "#tray" ? <Tray /> : <App />}
  </StrictMode>,
);
