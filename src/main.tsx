import React from "react";
import ReactDOM from "react-dom/client";
import App from "./routes/__root";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
