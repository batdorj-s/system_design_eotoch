import { BrowserRouter, Route, Routes } from "react-router";
import { AuthProvider } from "./lib/auth";
import { AppShell } from "./components/AppShell";
import { Home } from "./pages/Home";
import { Assessment } from "./pages/Assessment";
import { Result } from "./pages/Result";
import { Hospitals } from "./pages/Hospitals";
import { Login } from "./pages/Login";
import { MyHealth } from "./pages/MyHealth";
import { Insights } from "./pages/Insights";
import { Privacy } from "./pages/Privacy";
import { StaffDashboard } from "./pages/staff/StaffDashboard";
import { AdminDashboard } from "./pages/admin/AdminDashboard";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/assessment" element={<Assessment />} />
            <Route path="/result/:id" element={<Result />} />
            <Route path="/hospitals" element={<Hospitals />} />
            <Route path="/login" element={<Login />} />
            <Route path="/me" element={<MyHealth />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/staff" element={<StaffDashboard />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="*" element={<div className="py-24 text-center text-muted-foreground">Хуудас олдсонгүй.</div>} />
          </Routes>
        </AppShell>
      </AuthProvider>
    </BrowserRouter>
  );
}
