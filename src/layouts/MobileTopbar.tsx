import { Menu, Settings } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useUIStore } from "@/store/ui-store";

export function MobileTopbar() {
  const toggle = useUIStore((s) => s.toggleSidebar);
  const isOpen = useUIStore((s) => s.sidebarOpen);
  const navigate = useNavigate();
  const location = useLocation();
  const onChat = location.pathname.startsWith("/chat") || location.pathname === "/";

  if (onChat) return null;

  return (
    <header className="md:hidden sticky top-0 z-30 flex items-center gap-2 px-3 h-14 bg-background">
      <button
        onClick={toggle}
        aria-expanded={isOpen}
        className="p-2.5 rounded-full hover:bg-secondary active:scale-95 transition"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>
      <div className="flex-1" />
      <button
        onClick={() => navigate("/settings")}
        className="p-2.5 rounded-full hover:bg-secondary"
        aria-label="Settings"
      >
        <Settings className="w-5 h-5" />
      </button>
    </header>
  );
}
