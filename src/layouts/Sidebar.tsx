import { NavLink, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  MessageSquarePlus,
  Search,
  Plug2,
  Layers,
  BookOpen,
  BarChart3,
  Settings,
  Trash2,
  Sparkles,
  Star,
  Pin,
  X,
} from "lucide-react";
import { useChatStore } from "@/store/chat-store";
import { useUIStore } from "@/store/ui-store";
import { cn, truncate } from "@/utils";
import { useState } from "react";
import { SearchDialog } from "@/features/search/SearchDialog";

const nav = [
  { to: "/providers", label: "Providers", icon: Plug2 },
  { to: "/models", label: "My Models", icon: Layers },
  { to: "/prompts", label: "Prompt Library", icon: BookOpen },
  { to: "/usage", label: "Usage", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/trash", label: "Trash", icon: Trash2 },
];

export function Sidebar() {
  const navigate = useNavigate();
  const chats = useChatStore((s) => s.chats);
  const create = useChatStore((s) => s.create);
  const [searchOpen, setSearchOpen] = useState(false);
  const mobileOpen = useUIStore((s) => s.sidebarOpen);
  const setMobileOpen = useUIStore((s) => s.setSidebarOpen);

  const activeChats = chats
    .filter((c) => !c.deleted)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, 30);

  const newChat = () => {
    const c = create();
    setMobileOpen(false);
    navigate(`/chat/${c.id}`);
  };

  const closeOnNav = () => setMobileOpen(false);

  const inner = (
    <>
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <NavLink
            to="/"
            onClick={closeOnNav}
            className="flex items-center gap-2"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <div className="text-sm font-semibold">AI Provider Hub</div>
              <div className="text-[10px] text-muted-foreground">
                Zero-backend AI
              </div>
            </div>
          </NavLink>
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden p-1.5 rounded-lg hover:bg-secondary"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <motion.button
          onClick={newChat}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-3 py-2.5 font-medium text-sm shadow-lg shadow-primary/20 hover:brightness-110 transition"
        >
          <MessageSquarePlus className="w-4 h-4" />
          New chat
        </motion.button>

        <button
          onClick={() => setSearchOpen(true)}
          className="mt-2 w-full flex items-center gap-2 rounded-xl bg-secondary/70 hover:bg-secondary px-3 py-2 text-sm text-muted-foreground transition"
        >
          <Search className="w-4 h-4" />
          Search
          <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-background border border-border">
            ⌘K
          </kbd>
        </button>
      </div>

      <nav className="px-2 space-y-0.5">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            onClick={closeOnNav}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition",
                isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              )
            }
          >
            <n.icon className="w-4 h-4" />
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-3 px-2 flex-1 min-h-0 flex flex-col">
        <div className="px-3 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
          Recent
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin space-y-0.5 pr-1">
          {activeChats.length === 0 && (
            <div className="text-xs text-muted-foreground px-3 py-2">
              No chats yet.
            </div>
          )}
          {activeChats.map((c) => (
            <NavLink
              key={c.id}
              to={`/chat/${c.id}`}
              onClick={closeOnNav}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition group",
                  isActive
                    ? "bg-accent/70 text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                )
              }
            >
              {c.pinned && <Pin className="w-3 h-3 shrink-0" />}
              {c.favorite && (
                <Star className="w-3 h-3 shrink-0 text-amber-400 fill-amber-400" />
              )}
              <span className="truncate flex-1">{truncate(c.title, 28)}</span>
            </NavLink>
          ))}
        </div>
      </div>

      <div className="p-3 border-t border-border/60 text-[10px] text-muted-foreground">
        Everything runs locally in your browser.
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-[280px] shrink-0 h-full bg-card/40 backdrop-blur-xl border-r border-border/60 flex-col">
        {inner}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            />
            <motion.aside
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed z-50 top-0 left-0 h-full w-[85%] max-w-[320px] bg-card/95 backdrop-blur-2xl border-r border-border/60 flex flex-col md:hidden"
            >
              {inner}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
