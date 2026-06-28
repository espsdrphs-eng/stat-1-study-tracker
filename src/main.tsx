import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

if ("storage" in navigator && "persist" in navigator.storage) {
  navigator.storage.persist().catch(()=>false);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>
);
