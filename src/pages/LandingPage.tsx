import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  MessageSquarePlus,
  Plug2,
  Sparkles,
  Zap,
  Shield,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PROVIDER_LIST } from "@/constants/providers";
import { ProviderLogo } from "@/components/ProviderLogo";
import { useProviderStore } from "@/store/provider-store";
import { useModelStore } from "@/store/model-store";
import { useChatStore } from "@/store/chat-store";
import { useUsageStore } from "@/store/usage-store";
import { formatNumber, timeAgo, truncate } from "@/utils";

export function LandingPage() {
  const providers = useProviderStore((s) => s.providers);
  const models = useModelStore((s) => s.models);
  const chats = useChatStore((s) => s.chats).filter((c) => !c.deleted);
  const usage = useUsageStore((s) => s.usage);
  const navigate = useNavigate();
  const create = useChatStore((s) => s.create);

  const totalTokens = usage.reduce((a, u) => a + u.tokensIn + u.tokensOut, 0);
  const recent = chats.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);

  const newChat = () => {
    const c = create();
    navigate(`/chat/${c.id}`);
  };

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8 md:space-y-10">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl border border-border/60 p-6 md:p-10 bg-gradient-to-br from-card/80 via-card/40 to-card/20 backdrop-blur-2xl"
        >
          <div className="absolute -top-20 -right-20 w-80 h-80 bg-primary/20 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-primary/10 rounded-full blur-3xl" />

          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
              <Sparkles className="w-3 h-3" />
              Bring your own AI keys — everything stays local
            </div>
            <h1 className="mt-4 text-3xl md:text-5xl font-bold tracking-tight leading-tight max-w-3xl">
              One <span className="text-primary">premium hub</span> for every AI provider you use.
            </h1>
            <p className="mt-4 text-muted-foreground max-w-2xl">
              Connect OpenAI, Claude, NVIDIA NIM, OpenRouter, or any OpenAI-compatible endpoint.
              Discover models. Chat. Upload files. Track usage. No backend, no auth — just you and the models.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" onClick={newChat}>
                <MessageSquarePlus className="w-4 h-4" />
                Start a chat
                <ArrowRight className="w-4 h-4" />
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/providers">
                  <Plug2 className="w-4 h-4" />
                  Connect a provider
                </Link>
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Connected providers" value={providers.length} icon={Plug2} />
          <StatCard label="Discovered models" value={models.length} icon={Layers} />
          <StatCard label="Total chats" value={chats.length} icon={MessageSquarePlus} />
          <StatCard label="Tokens used" value={formatNumber(totalTokens)} icon={Zap} />
        </div>

        {/* Providers overview */}
        <section>
          <div className="flex items-end justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">Supported providers</h2>
              <p className="text-sm text-muted-foreground">
                Connect any of these — or add a custom endpoint.
              </p>
            </div>
            <Button variant="ghost" asChild>
              <Link to="/providers">
                Manage <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {PROVIDER_LIST.map((p) => {
              const connected = providers.some((cp) => cp.key === p.key);
              return (
                <motion.div
                  key={p.key}
                  whileHover={{ y: -3 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className="relative overflow-hidden">
                    <div
                      className={`absolute inset-0 opacity-[0.06] bg-gradient-to-br ${p.gradient}`}
                    />
                    <CardContent className="p-5 relative flex gap-4 items-start">
                      <ProviderLogo provider={p.key} className="w-12 h-12" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{p.name}</h3>
                          {connected && (
                            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                              Connected
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {p.description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Recent chats */}
        <section>
          <div className="flex items-end justify-between mb-4">
            <h2 className="text-xl font-semibold">Recent chats</h2>
            <Button variant="ghost" onClick={newChat}>
              <MessageSquarePlus className="w-3.5 h-3.5" /> New
            </Button>
          </div>
          {recent.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                No chats yet. Start one to see it here.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {recent.map((c) => (
                <Link key={c.id} to={`/chat/${c.id}`}>
                  <Card className="hover:border-primary/40 transition">
                    <CardContent className="p-4">
                      <div className="font-medium truncate">{truncate(c.title, 60)}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {c.messages.length} messages · {timeAgo(c.updatedAt)}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Features */}
        <section className="grid md:grid-cols-3 gap-4">
          <Feature icon={Shield} title="100% local">
            Your API keys, chats, and files never leave the browser.
          </Feature>
          <Feature icon={Zap} title="Streaming everywhere">
            Token-by-token streaming, stop mid-generation, retry, regenerate.
          </Feature>
          <Feature icon={Layers} title="Every provider">
            OpenAI SDK powers OpenAI, Anthropic, NVIDIA NIM, OpenRouter, and any custom endpoint.
          </Feature>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </div>
        <div className="text-2xl font-bold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function Feature({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </div>
        <div className="mt-3 font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground mt-1">{children}</div>
      </CardContent>
    </Card>
  );
}
