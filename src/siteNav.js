// One navigation for the whole app. The home page (index.html) is the digital twin and its sections;
// Live Capture (lab.html) is the camera workspace, crew records and research tools.
export const EXPERIENCES = [["mission", "Mission Control"], ["selfcheck", "Self-Check"], ["twin", "Digital Twin"], ["functional", "Functional Scan"], ["impact", "Impact Lab"], ["physiology", "Physiology"], ["evidence", "Evidence"]];
export const CAPTURE = { href: "lab.html#movement-capture", label: "Live Capture" };
export const experienceFromHash = hash => EXPERIENCES.find(([key]) => `#${key}` === hash)?.[0] ?? null;
