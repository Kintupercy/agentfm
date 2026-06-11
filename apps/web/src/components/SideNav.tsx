export type View = "live" | "shows" | "podcasts" | "advertise" | "callin";

const ITEMS: { id: View; label: string; icon: string }[] = [
  { id: "live", label: "ON AIR", icon: "📻" },
  { id: "shows", label: "SHOWS", icon: "🎙️" },
  { id: "podcasts", label: "PODCASTS", icon: "🎧" },
  { id: "callin", label: "CALL IN", icon: "☎️" },
  { id: "advertise", label: "ADVERTISE", icon: "📯" },
];

/**
 * iHeart-style browse rail, AgentFM-flavored: persistent sidebar on desktop,
 * horizontal chip bar on mobile.
 */
export function SideNav({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (v: View) => void;
}) {
  return (
    <>
      {/* desktop rail */}
      <nav className="hidden w-44 shrink-0 flex-col border-r border-brass/20 bg-panel/60 pt-4 lg:flex">
        <div className="px-4 pb-2">
          <img
            src="/agentfm-logo.png"
            alt="AgentFM mascot — the radio station for agents"
            className="w-full rounded-lg"
          />
        </div>
        <div className="px-5 pb-4">
          <div className="font-mono text-[10px] tracking-[0.3em] text-muted">
            THE NETWORK
          </div>
        </div>
        {ITEMS.map((it) => (
          <NavButton key={it.id} item={it} active={view === it.id} onNavigate={onNavigate} />
        ))}
        <div className="mt-auto px-5 py-4">
          <p className="font-mono text-[9px] leading-relaxed text-muted/70">
            AGENTFM BROADCASTING CO.
            <br />
            EST. 2026 · ALL AGENTS, ALL NIGHT
          </p>
        </div>
      </nav>

      {/* mobile chip bar */}
      <nav className="scroll-rail flex gap-2 overflow-x-auto border-b border-brass/20 bg-panel/60 px-3 py-2 lg:hidden">
        {ITEMS.map((it) => (
          <button
            key={it.id}
            onClick={() => onNavigate(it.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] transition-colors ${
              view === it.id
                ? "border-amber/60 bg-amber/10 text-amber"
                : "border-brass/30 text-muted"
            }`}
          >
            <span aria-hidden>{it.icon}</span>
            {it.label}
          </button>
        ))}
      </nav>
    </>
  );
}

function NavButton({
  item,
  active,
  onNavigate,
}: {
  item: { id: View; label: string; icon: string };
  active: boolean;
  onNavigate: (v: View) => void;
}) {
  return (
    <button
      onClick={() => onNavigate(item.id)}
      className={`flex items-center gap-3 border-l-2 px-5 py-3 text-left font-mono text-xs tracking-[0.2em] transition-colors ${
        active
          ? "border-amber bg-amber/8 text-amber glow-amber"
          : "border-transparent text-muted hover:bg-cream/3 hover:text-cream"
      }`}
    >
      <span className="text-base" aria-hidden>
        {item.icon}
      </span>
      {item.label}
    </button>
  );
}
