import React from "react";
import ReactDOM from "react-dom/client";
import { BootstrappedApp } from "./app/BootstrappedApp";
import { ToastProvider } from "./shared/ui/toast";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <BootstrappedApp />
    </ToastProvider>
  </React.StrictMode>,
);
