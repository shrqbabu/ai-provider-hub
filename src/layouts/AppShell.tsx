import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { MobileTopbar } from "./MobileTopbar";

export function AppShell() {
  return (
    <div className="h-full w-full flex relative android-app bg-background">
      <Sidebar />
      <main className="flex-1 h-full overflow-hidden flex flex-col min-w-0 bg-background">
        <MobileTopbar />
        <div className="flex-1 min-h-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
