import "./twin.css";
import "./selfCheck.css";
import "./dashboard.css";
import { createTwinApp } from "./twinApp.js";
import { registerOffline } from "./offline.js";
import { mountMissionUpgrade } from "./missionUpgrade.js";

const app = createTwinApp(document.getElementById("twin-root"));
mountMissionUpgrade(document.getElementById("twin-root"), app);
// The offline pack downloads after the 3D twin, so the two do not share a slow link.
registerOffline(app.loaded);
// Exposed for automated UI checks only.
window.__astroboneTwin = app;
