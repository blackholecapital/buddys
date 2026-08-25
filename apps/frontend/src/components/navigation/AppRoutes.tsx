import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "../../pages/Landing";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/operator/*" element={<Navigate to="/operator/" replace />} />
      <Route path="*" element={<Navigate to="/operator/" replace />} />
    </Routes>
  );
}
