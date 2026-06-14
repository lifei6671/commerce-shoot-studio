import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import { App } from "./app/App";
import "./shared/styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
