import "./twin.css";
import "./selfCheck.css";
import { createTwinApp } from "./twinApp.js";
import { registerOffline } from "./offline.js";

registerOffline();

const app = createTwinApp(document.getElementById("twin-root"));
// Exposed for automated UI checks only.
window.__astroboneTwin = app;
