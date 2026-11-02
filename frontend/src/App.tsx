import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { TradeProvider } from "./context/TradeContext";
import AppShell from "./layout/AppShell";
import ActivityPage from "./pages/ActivityPage";
import NetworkPage from "./pages/NetworkPage";
import PoliciesPage from "./pages/PoliciesPage";
import PortfolioPage from "./pages/PortfolioPage";
import TradePage from "./pages/TradePage";


export default function App() {
  return (
    <TradeProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<TradePage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="portfolio" element={<PortfolioPage />} />
            <Route path="policies" element={<PoliciesPage />} />
            <Route path="network" element={<NetworkPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TradeProvider>
  );
}
