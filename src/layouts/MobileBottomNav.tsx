import { NavLink, useLocation } from "react-router-dom";
import { BookOpen, Grid2x2, Layers, MessageSquare, Minimize2 } from "lucide-react";
import { cn } from "@/utils";
import { useChatStore } from "@/store/chat-store";

const tabs = [
  { to: "/chat", label: "Chat", icon: MessageSquare, match: (p: string) => p === "/" || p.startsWith("/chat") },
  { to: "/models", label: "Models", icon: Layers, match: (p: string) => p.startsWith("/models") },
  { to: "/compress", label: "Compress", icon: Minimize2, match: (p: string) => p.startsWith("/compress") },
  { to: "/prompts", label: "Prompts", icon: BookOpen, match: (p: string) => p.startsWith("/prompts") },
  { to: "/more", label: "More", icon: Grid2x2, match: (p: string) => p.startsWith("/more") },
];

export function MobileBottomNav() {
  const location = useLocation();
  const chats = useChatStore((s) => s.chats);
  const latest = chats
    .filter((c) => !c.deleted)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const chatTo = latest ? `/chat/${latest.id}` : "/chat";

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border/70 bg-card/90 backdrop-blur-2xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5 h-16">
        {tabs.map((t) => {
          const href = t.to === "/chat" ? chatTo : t.to;
          const active = t.match(location.pathname);
          return (
            <NavLink
              key={t.to}
              to={href}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "flex items-center justify-center w-10 h-7 rounded-full transition",
                  active && "bg-primary/15"
                )}
              >
                <t.icon className="w-5 h-5" />
              </span>
              {t.label}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
