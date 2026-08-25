import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

if (window.location.pathname.startsWith("/buddy-dashboard")) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} else {
  window.location.replace("/operator/");
}
