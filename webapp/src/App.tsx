import React, { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAppStore } from "./lib/store";
import { Toasts, Spinner } from "./components/ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Builder from "./pages/Builder";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  const { user, authChecked, checkAuth } = useAppStore();
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
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/" element={user ? <Dashboard /> : <Navigate to="/login" replace />} />
        <Route path="/apps/:appId" element={user ? <Builder /> : <Navigate to="/login" replace />} />
        <Route path="/settings" element={user ? <SettingsPage /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
    </BrowserRouter>
  );
}
