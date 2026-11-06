import { Outlet } from "react-router-dom";

import DemoBanner from "./DemoBanner";
import SideNav from "./SideNav";
import TopBar from "./TopBar";

export default function AppShell() {
  return (
    <div className="app-shell">
      <SideNav />
      <div className="app-shell-main">
        <DemoBanner />
        <TopBar />
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
