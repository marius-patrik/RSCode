import App from "@/App.tsx";
import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";

const storedTheme = window.localStorage.getItem("canvas-theme");
if (storedTheme !== "light") {
  document.documentElement.classList.add("dark");
  document.documentElement.dataset.theme = "dark";
} else {
  document.documentElement.dataset.theme = "light";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
