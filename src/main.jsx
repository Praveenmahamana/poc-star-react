import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import App from "./AppSimple.jsx";
import "./styles.css";
import "./vision.css";

// Hide the HTML fallback spinner once JS runs
const fallback = document.getElementById("root-fallback");
if (fallback) fallback.style.display = "none";

// Catch unhandled errors before React mounts
window.addEventListener("unhandledrejection", (e) => {
  console.error("[UnhandledRejection]", e.reason);
});

window.addEventListener("error", (e) => {
  console.error("[GlobalError]", e.message, e.filename, e.lineno, e.error);
  // If React hasn't replaced root content yet, show error visibly
  const root = document.getElementById("root");
  if (root && !root.hasChildNodes()) {
    if (fallback) fallback.style.display = "";
    root.innerHTML = `<div style="position:fixed;inset:0;background:#0f172a;color:#fbbf24;padding:32px;font-family:monospace;overflow:auto;z-index:99999">
      <div style="color:#ef4444;font-size:1.2rem;font-weight:700;margin-bottom:16px">⚠ JS Error (before React)</div>
      <pre style="background:#1e293b;padding:16px;border-radius:8px;white-space:pre-wrap;word-break:break-all;font-size:0.8rem">${e.message}\n${e.filename}:${e.lineno}\n\n${e.error?.stack || ""}</pre>
    </div>`;
  }
});

console.log("[main.jsx] Starting React mount...");
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <MantineProvider
      defaultColorScheme="light"
      theme={{
        primaryColor: "cyan",
        fontFamily: "Inter, Segoe UI, Roboto, sans-serif",
        white: "#ffffff",
        colors: {
          slate: [
            "#f8fafc",
            "#f1f5f9",
            "#e2e8f0",
            "#cbd5e1",
            "#94a3b8",
            "#64748b",
            "#475569",
            "#334155",
            "#1e293b",
            "#0f172a",
          ],
        },
      }}
    >
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
console.log("[main.jsx] ReactDOM.createRoot().render() called");
