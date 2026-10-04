import { resolve } from "node:path";
import { defineConfig } from "vite";

// Pages: the digital twin (home), Live Capture (camera, crew records, research tools), the 240-second
// presentation and the Day 1 vs Day 147 clip.
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        lab: resolve(import.meta.dirname, "lab.html"),
        pitch: resolve(import.meta.dirname, "pitch.html"),
      },
    },
  },
});
