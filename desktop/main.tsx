import React from "react";
import ReactDOM from "react-dom/client";
import "@/app/globals.css";
import "./desktop.css";
import { DesktopApp } from "./app";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DesktopApp />
  </React.StrictMode>
);
