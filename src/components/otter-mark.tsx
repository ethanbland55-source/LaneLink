/**
 * The club mark, drawn as SVG so it stays crisp at 40px in the header and
 * scales up for the footer without a second asset. Echoes the printed logo:
 * gold otter, purple ground, the swoosh underneath.
 */
export default function OtterMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Carnforth Otters"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="otter-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6e40a2" />
          <stop offset="55%" stopColor="#592d71" />
          <stop offset="100%" stopColor="#3d1d52" />
        </linearGradient>
        <linearGradient id="otter-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd670" />
          <stop offset="100%" stopColor="#f7b519" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="17" fill="url(#otter-bg)" />

      {/* Otter head, seen face-on: ears, crown, cheeks, muzzle. */}
      <g fill="url(#otter-gold)">
        <circle cx="20.5" cy="19.5" r="5.4" />
        <circle cx="43.5" cy="19.5" r="5.4" />
        <path d="M32 12c9.7 0 17.2 6.6 17.2 15.6 0 8.2-6.6 13.6-17.2 13.6S14.8 35.8 14.8 27.6C14.8 18.6 22.3 12 32 12Z" />
      </g>

      {/* Eyes and nose punched out in the ground colour. */}
      <g fill="#3d1d52">
        <circle cx="25.6" cy="25.4" r="2.5" />
        <circle cx="38.4" cy="25.4" r="2.5" />
        <path d="M32 30.6c2.4 0 4 1.1 4 2.4 0 1.6-1.9 2.9-4 2.9s-4-1.3-4-2.9c0-1.3 1.6-2.4 4-2.4Z" />
      </g>

      {/* The swoosh from the printed logo, doubling as water. */}
      <path
        d="M6 48.5c6.6-4.4 13.1-4.4 19.7 0s13.1 4.4 19.7 0 13.1-4.4 19.7 0"
        stroke="#ffffff"
        strokeOpacity="0.9"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M6 55c6.6-4.4 13.1-4.4 19.7 0s13.1 4.4 19.7 0 13.1-4.4 19.7 0"
        stroke="url(#otter-gold)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
