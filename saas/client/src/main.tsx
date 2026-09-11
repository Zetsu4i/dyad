import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import { DataProvider, ToastProvider } from "./state/store";
import { Layout } from "./components/Layout";
import { AppsPage } from "./pages/AppsPage";
import { BuilderPage } from "./pages/BuilderPage";
import { SettingsPage } from "./pages/SettingsPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { SkillsPage } from "./pages/SkillsPage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <DataProvider>
        <BrowserRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<AppsPage />} />
              <Route path="/apps/:appId" element={<BuilderPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/integrations" element={<IntegrationsPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      </DataProvider>
    </ToastProvider>
  </React.StrictMode>,
);
