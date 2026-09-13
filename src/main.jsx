import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Only in a real build: during `npm run dev` a service worker would serve stale
// modules and fight the HMR client.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Resolve against the document, not import.meta.url — the bundled entry
    // lives in /assets/, while sw.js is copied to the app root.
    const sw = new URL("sw.js", document.baseURI).href;
    const scope = new URL("./", document.baseURI).href;
    navigator.serviceWorker.register(sw, { scope }).catch(() => {
      /* offline support is a bonus; never break the app over it */
    });
  });
}
