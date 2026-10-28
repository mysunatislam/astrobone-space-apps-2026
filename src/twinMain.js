import "./twin.css";
import "./selfCheck.css";
import { createTwinApp } from "./twinApp.js";
import { registerOffline } from "./offline.js";

const app = createTwinApp(document.getElementById("twin-root"));
// The offline pack downloads after the 3D twin, so the two do not share a slow link.
registerOffline(app.loaded);
// Exposed for automated UI checks only.
window.__astroboneTwin = app;
