import React, { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAppStore } from "./lib/store";
import { Spinner, Toasts } from "./components/ui";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import Build from "./pages/Build";
import MyApps from "./pages/MyApps";
import Builder from "./pages/Builder";
import Integrations from "./pages/Integrations";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  const { authChecked, checkAuth } = useAppStore();
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (!authChecked) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={20} className="text-ink-faint" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <div className="flex h-full">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto bg-surface-0">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/build" element={<Build />} />
            <Route path="/apps" element={<MyApps />} />
            <Route path="/apps/:appId" element={<Builder />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <Toasts />
    </BrowserRouter>
  );
}
