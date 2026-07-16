import { Menu, MessageSquarePlus, Sparkles } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useUIStore } from "@/store/ui-store";
import { useChatStore } from "@/store/chat-store";

export function MobileTopbar() {
  const setOpen = useUIStore((s) => s.setSidebarOpen);
  const create = useChatStore((s) => s.create);
  const navigate = useNavigate();

  return (
    <header className="md:hidden sticky top-0 z-30 flex items-center gap-2 px-3 h-14 bg-card/60 backdrop-blur-xl border-b border-border/60">
      <button
        onClick={() => setOpen(true)}
        className="p-2 rounded-xl hover:bg-secondary transition"
        aria-label="Open sidebar"
      >
        <Menu className="w-5 h-5" />
      </button>
      <NavLink to="/" className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
        </div>
        <span className="text-sm font-semibold truncate">AI Provider Hub</span>
      </NavLink>
      <button
        onClick={() => {
          const c = create();
          navigate(`/chat/${c.id}`);
        }}
        className="p-2 rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20"
        aria-label="New chat"
      >
        <MessageSquarePlus className="w-4 h-4" />
      </button>
    </header>
  );
}
