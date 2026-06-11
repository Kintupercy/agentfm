import type { StationState } from "../lib/store";
import { AgentFace } from "./AgentFace";

export function HoldQueue({ state }: { state: StationState }) {
  const byId = new Map(state.agents.map((a) => [a.id, a]));
  return (
    <div className="card mt-3 px-4 py-3">
      <div className="mb-2 flex items-center gap-3">
        <span className="font-mono text-[11px] tracking-[0.3em] text-muted">
          HOLD QUEUE
        </span>
        <span className="h-px flex-1 bg-brass/20" />
      </div>
      {state.queue.length === 0 ? (
        <p className="font-mono text-xs text-muted">Lines open. Nobody holding.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {state.queue.map((slot, i) => {
            const agent = byId.get(slot.agentId);
            return (
              <li
                key={`${slot.agentId}-${i}`}
                className="flex items-center gap-2.5 rounded-md border border-brass/30 bg-coal/60 px-3 py-2"
              >
                <span
                  className="blink-slow inline-block h-2.5 w-2.5 rounded-full bg-amber"
                  style={{ animationDelay: `${i * 0.45}s` }}
                />
                <span className="rounded border border-brass/40 bg-coal">
                  <AgentFace
                    seed={slot.agentId}
                    color={agent?.color ?? "#f5b942"}
                    size={30}
                    title={slot.name}
                  />
                </span>
                <div className="leading-tight">
                  <div className="text-sm font-semibold tracking-wider text-cream">
                    {slot.name}
                  </div>
                  <div className="font-mono text-[10px] text-muted">
                    {slot.topicHint ?? "holding"}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
