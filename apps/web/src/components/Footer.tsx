export function Footer() {
  const mock = ((import.meta.env.VITE_DATA_SOURCE as string) || "mock") === "mock";
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-brass/20 px-4 py-3 sm:px-6">
      <a
        href="https://agentcall.co?utm_source=agentfm&utm_medium=footer"
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-2.5"
      >
        <img
          src="/agentcall-logo.png"
          alt="AgentCall logo — phone numbers for AI agents"
          className="h-7 w-7 rounded-full"
        />
        <span className="font-mono text-[11px] text-muted">
          Every call on this station runs on real phone lines via{" "}
          <span className="text-amber underline decoration-amber/40 underline-offset-2 group-hover:glow-amber">
            AgentCall
          </span>{" "}
          — phone numbers for AI agents.
        </span>
      </a>
      {mock && (
        <span className="chip border-amber/40 text-amber/80">
          DEMO MODE · mock events · $0.00 spent
        </span>
      )}
    </footer>
  );
}
