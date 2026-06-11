/**
 * Procedural agent portraits — deterministic retro-robot faces.
 * Seeded by agent id (or caller phone number for unknown walk-ins), so the
 * same agent always shows the same face everywhere: switchboard, hold queue,
 * ON AIR card, recap cards. No avatar service, no network, crisp at any size.
 *
 * Renders as an <svg>, which is valid both standalone in HTML and nested
 * inside the switchboard's SVG (pass x/y).
 */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, arr: T[]): T =>
  arr[Math.floor(r() * arr.length)];

export function AgentFace({
  seed,
  color = "#f5b942",
  size = 40,
  x,
  y,
  title,
}: {
  seed: string;
  color?: string;
  size?: number;
  x?: number;
  y?: number;
  title?: string;
}) {
  const r = mulberry32(hashString(seed));
  const head = pick(r, ["square", "round", "trapezoid", "tv"] as const);
  const eyes = pick(r, ["lamp", "visor", "round", "wide"] as const);
  const mouth = pick(r, ["grille", "wave", "dots", "slit"] as const);
  const antenna = pick(r, ["ball", "twin", "loop", "none"] as const);
  const eyeY = 27 + Math.floor(r() * 4);
  const eyeDX = 9 + Math.floor(r() * 3);
  const rivets = r() > 0.45;

  const plate = "#16120d";
  const line = "#8a6a3a";

  return (
    <svg
      width={size}
      height={size}
      x={x}
      y={y}
      viewBox="0 0 64 64"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}

      {/* antenna */}
      {antenna === "ball" && (
        <>
          <line x1="32" y1="12" x2="32" y2="4" stroke={line} strokeWidth="2" />
          <circle cx="32" cy="4" r="2.6" fill={color} />
        </>
      )}
      {antenna === "twin" && (
        <>
          <line x1="22" y1="13" x2="17" y2="5" stroke={line} strokeWidth="2" />
          <line x1="42" y1="13" x2="47" y2="5" stroke={line} strokeWidth="2" />
          <circle cx="17" cy="5" r="2" fill={color} />
          <circle cx="47" cy="5" r="2" fill={color} />
        </>
      )}
      {antenna === "loop" && (
        <>
          <line x1="32" y1="12" x2="32" y2="7" stroke={line} strokeWidth="2" />
          <circle cx="32" cy="5" r="3" fill="none" stroke={color} strokeWidth="1.8" />
        </>
      )}

      {/* head */}
      {head === "square" && (
        <rect x="11" y="11" width="42" height="46" rx="6" fill={plate} stroke={line} strokeWidth="2" />
      )}
      {head === "round" && (
        <ellipse cx="32" cy="34" rx="22" ry="23" fill={plate} stroke={line} strokeWidth="2" />
      )}
      {head === "trapezoid" && (
        <path d="M17 12 H47 L53 54 Q53 57 50 57 H14 Q11 57 11 54 Z" fill={plate} stroke={line} strokeWidth="2" />
      )}
      {head === "tv" && (
        <path d="M9 18 Q9 11 16 11 H48 Q55 11 55 18 V48 Q55 57 46 57 H18 Q9 57 9 48 Z" fill={plate} stroke={line} strokeWidth="2" />
      )}

      {/* faint accent tint */}
      <rect x="13" y="13" width="38" height="42" rx="8" fill={color} opacity="0.06" />

      {/* eyes */}
      {eyes === "lamp" && (
        <>
          <circle cx={32 - eyeDX} cy={eyeY} r="5.5" fill="none" stroke={line} strokeWidth="1.6" />
          <circle cx={32 + eyeDX} cy={eyeY} r="5.5" fill="none" stroke={line} strokeWidth="1.6" />
          <circle cx={32 - eyeDX} cy={eyeY} r="2.6" fill={color} />
          <circle cx={32 + eyeDX} cy={eyeY} r="2.6" fill={color} />
        </>
      )}
      {eyes === "visor" && (
        <>
          <rect x={32 - eyeDX - 7} y={eyeY - 4} width={eyeDX * 2 + 14} height="8" rx="4" fill="#0a0805" stroke={line} strokeWidth="1.4" />
          <circle cx={32 - eyeDX} cy={eyeY} r="2.2" fill={color} />
          <circle cx={32 + eyeDX} cy={eyeY} r="2.2" fill={color} />
        </>
      )}
      {eyes === "round" && (
        <>
          <circle cx={32 - eyeDX} cy={eyeY} r="3.4" fill={color} />
          <circle cx={32 + eyeDX} cy={eyeY} r="3.4" fill={color} />
        </>
      )}
      {eyes === "wide" && (
        <>
          <rect x={32 - eyeDX - 4} y={eyeY - 3} width="8" height="6" rx="1.5" fill={color} />
          <rect x={32 + eyeDX - 4} y={eyeY - 3} width="8" height="6" rx="1.5" fill={color} />
        </>
      )}

      {/* mouth */}
      {mouth === "grille" && (
        <g stroke={line} strokeWidth="2" strokeLinecap="round">
          <line x1="24" y1="43" x2="24" y2="49" />
          <line x1="29" y1="43" x2="29" y2="49" />
          <line x1="34" y1="43" x2="34" y2="49" />
          <line x1="39" y1="43" x2="39" y2="49" />
        </g>
      )}
      {mouth === "wave" && (
        <path d="M22 46 Q26 42 30 46 T38 46 T44 46" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" opacity="0.9" />
      )}
      {mouth === "dots" && (
        <g fill={line}>
          <circle cx="25" cy="46" r="1.7" />
          <circle cx="32" cy="46" r="1.7" />
          <circle cx="39" cy="46" r="1.7" />
        </g>
      )}
      {mouth === "slit" && (
        <rect x="24" y="44.5" width="16" height="3" rx="1.5" fill="#0a0805" stroke={line} strokeWidth="1.2" />
      )}

      {/* rivets */}
      {rivets && (
        <g fill={line} opacity="0.7">
          <circle cx="15.5" cy="34" r="1.4" />
          <circle cx="48.5" cy="34" r="1.4" />
        </g>
      )}
    </svg>
  );
}
