import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { Layout } from "./components/Layout";
import { ToastProvider } from "./components/ui";
import { AuthProvider, RequireAuth } from "./lib/auth";
import { AuthPage } from "./pages/Auth";
import { WorkspaceProvider } from "./lib/workspace";
import { SettingsPage } from "./pages/Settings";
import { LandingPage } from "./pages/Landing";
import { ConnectionsPage } from "./pages/Connections";
import { ConnectionEditorPage } from "./pages/ConnectionEditor";
import { ConnectionTestPage } from "./pages/ConnectionTest";
import { FirstConnectionPage } from "./pages/FirstConnection";
import { SourcesPage } from "./pages/Sources";
import { SourceDetailPage } from "./pages/SourceDetail";
import { DestinationsPage } from "./pages/Destinations";
import { DestinationDetailPage } from "./pages/DestinationDetail";
import { TransformationsPage, TransformationEditor } from "./pages/Transformations";
import { RequestsPage } from "./pages/Requests";
import { EventsPage } from "./pages/Events";
import { MetricsPage } from "./pages/Metrics";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <AuthProvider>
        <Routes>
          <Route index element={<LandingPage />} />
          <Route path="login" element={<AuthPage mode="login" />} />
          <Route path="signup" element={<AuthPage mode="signup" />} />
          <Route element={<RequireAuth><WorkspaceProvider><Layout /></WorkspaceProvider></RequireAuth>}>
            <Route path="connections" element={<ConnectionsPage />} />
            <Route path="connections/new" element={<ConnectionEditorPage />} />
            <Route path="connections/first" element={<FirstConnectionPage />} />
            <Route path="connections/:id/edit" element={<ConnectionEditorPage />} />
            <Route path="connections/:id/test" element={<ConnectionTestPage />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="sources/:id" element={<SourceDetailPage />} />
            <Route path="destinations" element={<DestinationsPage />} />
            <Route path="destinations/:id" element={<DestinationDetailPage />} />
            <Route path="transformations" element={<TransformationsPage />} />
            <Route path="transformations/:id" element={<TransformationEditor />} />
            <Route path="requests" element={<RequestsPage preset="all" />} />
            <Route path="requests/accepted" element={<RequestsPage preset="accepted" />} />
            <Route path="requests/rejected" element={<RequestsPage preset="rejected" />} />
            <Route path="events" element={<EventsPage preset="all" />} />
            <Route path="events/failed" element={<EventsPage preset="failed" />} />
            <Route path="events/paused" element={<EventsPage preset="paused" />} />
            <Route path="metrics" element={<MetricsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/connections" replace />} />
          </Route>
        </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
);
