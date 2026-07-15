import type { ProviderKey } from "@/types";
import { cn } from "@/utils";

interface Props {
  provider: ProviderKey;
  className?: string;
  customUrl?: string;
}

export function ProviderLogo({ provider, className, customUrl }: Props) {
  if (customUrl) {
    return (
      <img
        src={customUrl}
        alt="logo"
        className={cn("rounded-lg object-cover", className)}
      />
    );
  }
  const base = cn(
    "flex items-center justify-center rounded-xl font-bold text-white shrink-0",
    className
  );
  switch (provider) {
    case "openai":
      return (
        <div className={cn(base, "bg-gradient-to-br from-emerald-500 to-teal-700")}>
          <svg viewBox="0 0 24 24" className="w-1/2 h-1/2" fill="currentColor">
            <path d="M22.3 9.9a5.9 5.9 0 0 0-.5-4.9 6 6 0 0 0-6.5-2.9A6 6 0 0 0 4.9 4.5a5.9 5.9 0 0 0-4 2.9 6 6 0 0 0 .7 7 5.9 5.9 0 0 0 .5 4.9 6 6 0 0 0 6.5 2.9 6 6 0 0 0 4.5 2 6 6 0 0 0 5.7-4.2 5.9 5.9 0 0 0 4-2.9 6 6 0 0 0-.7-7Zm-9 12.6a4.4 4.4 0 0 1-2.8-1l.1-.1 4.7-2.7a.8.8 0 0 0 .4-.7v-6.6l2 1.1v5.5a4.4 4.4 0 0 1-4.4 4.5Zm-9.6-4.1a4.4 4.4 0 0 1-.5-3l.1.1 4.7 2.7a.8.8 0 0 0 .8 0l5.7-3.3v2.3l-4.7 2.7a4.4 4.4 0 0 1-6-1.5Z"/>
          </svg>
        </div>
      );
    case "nvidia":
      return (
        <div className={cn(base, "bg-gradient-to-br from-lime-500 to-green-700")}>
          <span className="text-[10px] tracking-widest">NIM</span>
        </div>
      );
    case "anthropic":
      return (
        <div className={cn(base, "bg-gradient-to-br from-orange-400 to-rose-600")}>
          <svg viewBox="0 0 24 24" className="w-1/2 h-1/2" fill="currentColor">
            <path d="M8.7 4h-3l5.6 16h3zM15.3 4h-3l5.6 16h3z" />
          </svg>
        </div>
      );
    case "openrouter":
      return (
        <div className={cn(base, "bg-gradient-to-br from-indigo-500 to-fuchsia-700")}>
          <svg viewBox="0 0 24 24" className="w-1/2 h-1/2" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h10M4 12h16M4 17h10" />
            <circle cx="18" cy="7" r="2" fill="currentColor" />
            <circle cx="18" cy="17" r="2" fill="currentColor" />
          </svg>
        </div>
      );
    default:
      return (
        <div className={cn(base, "bg-gradient-to-br from-slate-500 to-zinc-700")}>
          <svg viewBox="0 0 24 24" className="w-1/2 h-1/2" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
          </svg>
        </div>
      );
  }
}
