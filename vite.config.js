import { resolve } from "node:path";
import { defineConfig } from "vite";

// Two pages: the existing research/mission app and the full-screen digital twin.
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        twin: resolve(import.meta.dirname, "twin.html"),
        pitch: resolve(import.meta.dirname, "pitch.html"),
      },
    },
  },
});
