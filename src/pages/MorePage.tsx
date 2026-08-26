import { NavLink } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Boxes,
  Cookie,
  Gauge,
  KeyRound,
  Minimize2,
  Plug2,
  Settings,
  Trash2,
  User,
  Sparkles,
} from "lucide-react";
import { InstallAppBanner } from "@/components/InstallAppBanner";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";
import { formatNumber } from "@/utils";

const tiles = [
  { to: "/providers", label: "Providers", hint: "Connect APIs & OAuth", icon: Plug2 },
  { to: "/quota", label: "Quota", hint: "Provider usage caps", icon: Gauge },
  { to: "/cookies", label: "Cookies", hint: "Web-session auth", icon: Cookie },
  { to: "/api-keys", label: "Gateway keys", hint: "ah-… keys for IDEs", icon: KeyRound },
  { to: "/keystore", label: "Key store", hint: "Vault of raw keys", icon: KeyRound },
  { to: "/combos", label: "Combos", hint: "Fallback model chains", icon: Boxes },
  { to: "/combo-logs", label: "Combo logs", hint: "Who answered", icon: Activity },
  { to: "/compress", label: "Compress", hint: "Token & prompt saver", icon: Minimize2 },
  { to: "/usage", label: "Usage", hint: "Tokens & cost", icon: BarChart3 },
  { to: "/profile", label: "Profile", hint: "Account & UID", icon: User },
  { to: "/settings", label: "Settings", hint: "Theme, limits, backup", icon: Settings },
  { to: "/trash", label: "Trash", hint: "Deleted chats", icon: Trash2 },
];

export function MorePage() {
  const providers = useProviderStore((s) => s.providers);
  const models = useModelStore((s) => s.models);
  const chats = useChatStore((s) => s.chats).filter((c) => !c.deleted);
  const saved = useSettingsStore((s) => s.settings.compressStats?.tokensSaved ?? 0);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin pb-24 md:pb-8">
      <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-5">
        <div>
          <div className="flex items-center gap-2 text-primary text-[11px] font-semibold uppercase tracking-[0.18em]">
            <Sparkles className="w-3.5 h-3.5" /> AI Provider Hub
          </div>
          <h1 className="text-2xl font-bold mt-1">Control center</h1>
          <p className="text-sm text-muted-foreground">
            Every hub feature, tuned for a phone-first Android app.
          </p>
        </div>

        <InstallAppBanner />

        <div className="grid grid-cols-3 gap-2">
          <Mini stat={String(providers.length)} label="Providers" />
          <Mini stat={String(models.length)} label="Models" />
          <Mini stat={formatNumber(saved)} label="Tok saved" />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {tiles.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className="group rounded-2xl border border-border/70 bg-card/70 backdrop-blur-xl p-3.5 active:scale-[0.98] transition hover:border-primary/40 hover:bg-card"
            >
              <div className="w-9 h-9 rounded-xl bg-primary/12 text-primary flex items-center justify-center mb-2.5 group-hover:bg-primary group-hover:text-primary-foreground transition">
                <t.icon className="w-4.5 h-4.5" />
              </div>
              <div className="font-semibold text-sm">{t.label}</div>
              <div className="text-[11px] text-muted-foreground">{t.hint}</div>
            </NavLink>
          ))}
        </div>

        <p className="text-[11px] text-center text-muted-foreground">
          {chats.length} chats on this device · Install from the banner or Chrome menu → Add to Home screen
        </p>
      </div>
    </div>
  );
}

function Mini({ stat, label }: { stat: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 px-3 py-2.5 text-center">
      <div className="text-lg font-bold">{stat}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
