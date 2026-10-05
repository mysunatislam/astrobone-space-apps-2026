import { resolve } from "node:path";
import { defineConfig } from "vite";

// Pages: the digital twin (home) and Live Capture (camera, crew records, research tools).
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        lab: resolve(import.meta.dirname, "lab.html"),
      },
    },
  },
});
