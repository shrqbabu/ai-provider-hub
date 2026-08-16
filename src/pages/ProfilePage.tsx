import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  User,
  Shield,
  KeyRound,
  Layers,
  Boxes,
  Plug2,
  Lock,
  Copy,
  Check,
  Download,
  Calendar,
  Mail,
  Fingerprint,
  RefreshCw,
  Sparkles,
  ExternalLink,
  ChevronRight,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/auth-store";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import { useComboStore } from "@/store/combo-store";
import { useKeyStoreStore } from "@/store/keystore-store";
import { listGatewayKeys, type GatewayKey } from "@/services/gateway-keys-service";
import { ProviderLogo } from "@/components/ProviderLogo";
import { timeAgo } from "@/utils";
import { NavLink } from "react-router-dom";

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const providers = useProviderStore((s) => s.providers);
  const models = useModelStore((s) => s.models);
  const combos = useComboStore((s) => s.combos);
  const keystoreItems = useKeyStoreStore((s) => s.items);

  const [gatewayKeys, setGatewayKeys] = useState<GatewayKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "providers" | "combos" | "keys" | "export">("overview");

  const uid = user?.uid || "local_user";
  const email = user?.email || "user@ai-hub.local";
  const displayName = user?.displayName || email.split("@")[0];
  const photoURL = user?.photoURL;
  const authProvider = user?.providerData?.[0]?.providerId === "google.com" ? "Google Account" : "Email / Password";
  const createdAt = (user?.metadata as any)?.creationTime
    ? new Date((user.metadata as any).creationTime).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Active Account";

  const fetchKeys = async () => {
    setLoadingKeys(true);
    try {
      const keys = await listGatewayKeys();
      setGatewayKeys(keys.filter((k) => !k.revoked));
    } catch {
      // ignore
    } finally {
      setLoadingKeys(false);
    }
  };

  useEffect(() => {
    fetchKeys();
  }, [user]);

  const copyUid = () => {
    navigator.clipboard.writeText(uid);
    setCopiedUid(true);
    toast.success("User UID copied to clipboard!");
    setTimeout(() => setCopiedUid(false), 1500);
  };

  const handleExportData = () => {
    const exportPayload = {
      exportVersion: "1.0",
      exportedAt: new Date().toISOString(),
      user: {
        uid,
        email,
        displayName,
        authProvider,
      },
      inventory: {
        providersCount: providers.length,
        modelsCount: models.length,
        combosCount: combos.length,
        gatewayKeysCount: gatewayKeys.length,
        keystoreItemsCount: keystoreItems.length,
      },
      data: {
        providers,
        models,
        combos,
        keystore: keystoreItems,
      },
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `ai-hub-profile-${uid.slice(0, 8)}-backup.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    toast.success("Account data backup downloaded successfully!");
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
        {/* Profile Card Header */}
        <div className="rounded-3xl border border-border/60 bg-card/40 backdrop-blur-xl p-6 md:p-8 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl -z-10 pointer-events-none" />

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div className="flex items-center gap-4 md:gap-6">
              <div className="relative">
                {photoURL ? (
                  <img
                    src={photoURL}
                    alt={displayName}
                    className="w-16 h-16 md:w-20 md:h-20 rounded-2xl object-cover ring-2 ring-primary/40 shadow-lg"
                  />
                ) : (
                  <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground font-bold text-2xl md:text-3xl ring-2 ring-primary/40 shadow-lg">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 p-1 rounded-lg bg-background border border-border/80 text-emerald-400">
                  <Shield className="w-3.5 h-3.5" />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl md:text-2xl font-bold tracking-tight">{displayName}</h1>
                  <Badge variant="secondary" className="rounded-lg text-[10px] font-medium py-0.5 px-2">
                    {authProvider}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> {email}
                </div>
                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-0.5">
                  <Calendar className="w-3.5 h-3.5" /> Member since {createdAt}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportData}
                className="gap-2 rounded-xl h-9 text-xs"
              >
                <Download className="w-3.5 h-3.5 text-primary" />
                Export Data (JSON)
              </Button>
            </div>
          </div>

          {/* UID Card Badge */}
          <div className="mt-6 pt-5 border-t border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Fingerprint className="w-4 h-4 text-primary" /> Account UID:
              </span>
              <code className="px-2.5 py-1 rounded-lg bg-secondary/80 text-xs font-mono select-all text-foreground">
                {uid}
              </code>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={copyUid}
              className="gap-1.5 rounded-lg h-7 px-2.5 text-xs self-start sm:self-auto"
            >
              {copiedUid ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedUid ? "Copied" : "Copy UID"}
            </Button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            icon={Plug2}
            title="Providers"
            count={providers.length}
            sub="Connected AI APIs"
            to="/providers"
            color="from-blue-500/20 to-blue-500/5 text-blue-400"
          />
          <StatCard
            icon={Layers}
            title="My Models"
            count={models.length}
            sub="Registered Models"
            to="/models"
            color="from-purple-500/20 to-purple-500/5 text-purple-400"
          />
          <StatCard
            icon={Boxes}
            title="Combos"
            count={combos.length}
            sub="Fallback Groups"
            to="/combos"
            color="from-amber-500/20 to-amber-500/5 text-amber-400"
          />
          <StatCard
            icon={KeyRound}
            title="Gateway Keys"
            count={gatewayKeys.length}
            sub="Active ah-… keys"
            to="/api-keys"
            color="from-emerald-500/20 to-emerald-500/5 text-emerald-400"
          />
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-border/60 gap-1 pb-px overflow-x-auto scrollbar-none">
          <TabButton
            active={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
            label="Overview & Isolation"
          />
          <TabButton
            active={activeTab === "providers"}
            onClick={() => setActiveTab("providers")}
            label={`Providers & Models (${providers.length})`}
          />
          <TabButton
            active={activeTab === "combos"}
            onClick={() => setActiveTab("combos")}
            label={`Combos (${combos.length})`}
          />
          <TabButton
            active={activeTab === "keys"}
            onClick={() => setActiveTab("keys")}
            label={`Gateway & Vault (${gatewayKeys.length + keystoreItems.length})`}
          />
          <TabButton
            active={activeTab === "export"}
            onClick={() => setActiveTab("export")}
            label="Raw Data Explorer"
          />
        </div>

        {/* Tab 1: Overview */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="p-5 rounded-2xl border border-border/60 bg-card/30 backdrop-blur-xl space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Strict Multi-User Isolation Guarantee</h2>
                  <p className="text-xs text-muted-foreground">
                    All your providers, API keys, models, and custom combos are cryptographically mapped strictly to your UID:
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-2">
                <div className="p-3.5 rounded-xl border border-border/40 bg-background/50 space-y-1">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-primary" /> Firestore Collection
                  </div>
                  <code className="text-muted-foreground text-[11px] block truncate">
                    users/{uid}/kv/*
                  </code>
                </div>

                <div className="p-3.5 rounded-xl border border-border/40 bg-background/50 space-y-1">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-emerald-400" /> Gateway Key Scope
                  </div>
                  <div className="text-muted-foreground text-[11px]">
                    Requests using your <code className="text-foreground">ah-…</code> keys resolve strictly to your models.
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Overview Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Connected Providers List */}
              <div className="p-5 rounded-2xl border border-border/60 bg-card/30 backdrop-blur-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Connected Providers ({providers.length})
                  </h3>
                  <NavLink to="/providers" className="text-xs text-primary hover:underline flex items-center gap-1">
                    Manage <ChevronRight className="w-3.5 h-3.5" />
                  </NavLink>
                </div>

                {providers.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3">No providers added yet. Connect OpenAI, Claude, or Host CLI.</p>
                ) : (
                  <div className="space-y-2">
                    {providers.slice(0, 5).map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-2.5 rounded-xl bg-background/50 border border-border/30">
                        <div className="flex items-center gap-2.5">
                          <ProviderLogo provider={p.key} className="w-6 h-6" />
                          <div>
                            <div className="text-xs font-medium">{p.displayName || p.key}</div>
                            <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[180px]">
                              {p.baseURL || "Default Endpoint"}
                            </div>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {p.authMode || "API Key"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Active Combos List */}
              <div className="p-5 rounded-2xl border border-border/60 bg-card/30 backdrop-blur-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Active Combos ({combos.length})
                  </h3>
                  <NavLink to="/combos" className="text-xs text-primary hover:underline flex items-center gap-1">
                    Manage <ChevronRight className="w-3.5 h-3.5" />
                  </NavLink>
                </div>

                {combos.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-3">No combos configured yet. Create a multi-model fallback group.</p>
                ) : (
                  <div className="space-y-2">
                    {combos.slice(0, 5).map((c) => (
                      <div key={c.id} className="flex items-center justify-between p-2.5 rounded-xl bg-background/50 border border-border/30">
                        <div className="flex items-center gap-2">
                          <Boxes className="w-4 h-4 text-amber-400" />
                          <div className="text-xs font-medium">{c.name}</div>
                        </div>
                        <Badge variant="secondary" className="text-[10px]">
                          {c.members?.length || 0} fallback models
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Providers & Models */}
        {activeTab === "providers" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">All Connected Providers & Registered Models</h2>
              <NavLink to="/providers">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs rounded-xl h-8">
                  <Plug2 className="w-3.5 h-3.5 text-primary" /> Add Provider
                </Button>
              </NavLink>
            </div>

            {providers.length === 0 ? (
              <div className="p-8 text-center rounded-2xl border border-dashed border-border/80 bg-card/20 space-y-2">
                <p className="text-sm font-medium">No providers added yet</p>
                <p className="text-xs text-muted-foreground">Add your API keys or connect Host CLI to start using models.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {providers.map((p) => {
                  const pModels = models.filter((m) => m.providerId === p.id);
                  return (
                    <div key={p.id} className="p-4 rounded-2xl border border-border/60 bg-card/30 backdrop-blur-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <ProviderLogo provider={p.key} className="w-7 h-7" />
                          <div>
                            <div className="text-xs font-bold">{p.displayName || p.key}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">{p.key}</div>
                          </div>
                        </div>
                        <Badge variant="secondary" className="text-[10px]">
                          {pModels.length} models
                        </Badge>
                      </div>

                      <div className="text-[11px] text-muted-foreground font-mono bg-background/50 p-2 rounded-lg truncate">
                        {p.baseURL}
                      </div>

                      <div className="space-y-1 pt-1">
                        <div className="text-[10px] font-semibold text-muted-foreground uppercase">Models available:</div>
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto scrollbar-thin">
                          {pModels.map((m) => (
                            <Badge key={m.id} variant="outline" className="text-[10px] font-mono py-0">
                              {m.modelId}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Combos */}
        {activeTab === "combos" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Your Custom Model Combos</h2>
              <NavLink to="/combos">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs rounded-xl h-8">
                  <Boxes className="w-3.5 h-3.5 text-amber-400" /> Create Combo
                </Button>
              </NavLink>
            </div>

            {combos.length === 0 ? (
              <div className="p-8 text-center rounded-2xl border border-dashed border-border/80 bg-card/20 space-y-2">
                <p className="text-sm font-medium">No combos created yet</p>
                <p className="text-xs text-muted-foreground">Combos allow automatic fallback between multiple models.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {combos.map((c) => (
                  <div key={c.id} className="p-4 rounded-2xl border border-border/60 bg-card/30 backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Boxes className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-bold font-mono">{c.name}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Order of fallback: {c.members?.map((m) => m.modelId).join(" → ") || "No models"}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-[10px] self-start md:self-auto">
                      {c.members?.length || 0} Fallback Models
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Keys & Vault */}
        {activeTab === "keys" && (
          <div className="space-y-6">
            {/* Gateway API Keys */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Gateway API Keys ({gatewayKeys.length})
                </h3>
                <NavLink to="/api-keys" className="text-xs text-primary hover:underline">
                  Generate Key →
                </NavLink>
              </div>

              {gatewayKeys.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No gateway keys generated yet.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {gatewayKeys.map((k) => (
                    <div key={k.id} className="p-3.5 rounded-xl border border-border/50 bg-card/30 backdrop-blur-xl space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{k.label || "Gateway Key"}</span>
                        <code className="text-xs font-mono text-emerald-400 font-bold">…{k.last4}</code>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Created {timeAgo(k.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Key Store Vault */}
            <div className="space-y-3 pt-4 border-t border-border/50">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Key Store Vault Items ({keystoreItems.length})
                </h3>
                <NavLink to="/keystore" className="text-xs text-primary hover:underline">
                  Open Vault →
                </NavLink>
              </div>

              {keystoreItems.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No credentials stored in Key Store vault.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {keystoreItems.map((item) => (
                    <div key={item.id} className="p-3.5 rounded-xl border border-border/50 bg-card/30 backdrop-blur-xl space-y-1">
                      <div className="text-xs font-semibold flex items-center gap-1.5">
                        <Lock className="w-3 h-3 text-primary" /> {item.label}
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground truncate">
                        {item.keyValue ? item.keyValue.slice(0, 8) + "••••••••" : "••••••••"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 5: Raw JSON Explorer */}
        {activeTab === "export" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Complete User Data JSON Snapshot</h3>
                <p className="text-xs text-muted-foreground">Live payload synced with your unique UID in Firestore.</p>
              </div>
              <Button size="sm" onClick={handleExportData} className="gap-1.5 text-xs rounded-xl h-8">
                <Download className="w-3.5 h-3.5" /> Download JSON
              </Button>
            </div>

            <pre className="p-4 rounded-2xl bg-background/80 border border-border/60 text-[11px] font-mono overflow-x-auto max-h-[450px] scrollbar-thin text-muted-foreground">
              {JSON.stringify(
                {
                  user: { uid, email, displayName, authProvider },
                  stats: {
                    providersCount: providers.length,
                    modelsCount: models.length,
                    combosCount: combos.length,
                    gatewayKeysCount: gatewayKeys.length,
                    keystoreCount: keystoreItems.length,
                  },
                  providers,
                  models,
                  combos,
                  keystore: keystoreItems,
                },
                null,
                2
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  title,
  count,
  sub,
  to,
  color,
}: {
  icon: any;
  title: string;
  count: number;
  sub: string;
  to: string;
  color: string;
}) {
  return (
    <NavLink
      to={to}
      className="p-4 rounded-2xl border border-border/60 bg-card/30 backdrop-blur-xl hover:bg-card/60 transition group space-y-2 block"
    >
      <div className="flex items-center justify-between">
        <div className={`p-2 rounded-xl bg-gradient-to-br ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition" />
      </div>
      <div>
        <div className="text-xl md:text-2xl font-bold">{count}</div>
        <div className="text-xs font-semibold text-foreground">{title}</div>
        <div className="text-[10px] text-muted-foreground">{sub}</div>
      </div>
    </NavLink>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-2 text-xs font-medium rounded-xl transition shrink-0 ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
      }`}
    >
      {label}
    </button>
  );
}
