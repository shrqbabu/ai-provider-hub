import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileTopbar } from "./MobileTopbar";
import { MobileBottomNav } from "./MobileBottomNav";

export function AppShell() {
  return (
    <div className="h-full w-full flex aurora relative android-app">
      <div
        className="absolute inset-0 -z-10 aurora animate-gradient-move pointer-events-none"
        style={{ backgroundSize: "200% 200%" }}
      />
      <Sidebar />
      <main className="flex-1 h-full overflow-hidden flex flex-col min-w-0">
        <MobileTopbar />
        <div className="flex-1 min-h-0 pb-16 md:pb-0">
          <Outlet />
        </div>
        <MobileBottomNav />
      </main>
    </div>
  );
}
