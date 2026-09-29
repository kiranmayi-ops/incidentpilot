// Icon set — a single stroke-based 24×24 set used by both the marketing
// surface and the console. Pure presentational: no data logic lives here.

import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "compass"
  | "pulse"
  | "brain"
  | "layers"
  | "database"
  | "terminal"
  | "search"
  | "check"
  | "check-circle"
  | "x-circle"
  | "alert"
  | "shield"
  | "arrow-right"
  | "arrow-up-right"
  | "chevron-right"
  | "chevron-left"
  | "chevron-down"
  | "sparkles"
  | "play"
  | "rotate"
  | "seed"
  | "flask"
  | "clock"
  | "git-branch"
  | "sun"
  | "moon"
  | "panel-left"
  | "external"
  | "cpu"
  | "plug"
  | "scale"
  | "target"
  | "inbox"
  | "loader"
  | "plus"
  | "minus"
  | "filter"
  | "zap"
  | "book"
  | "trend";

const PATHS: Record<IconName, ReactNode> = {
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-7 4 14L16 12h5" />,
  brain: (
    <>
      <path d="M9.5 3.5A2.5 2.5 0 0 0 7 6v.3A2.8 2.8 0 0 0 4.5 9c0 .9.4 1.7 1 2.2A3 3 0 0 0 6 15c.5 0 1-.1 1.5-.4V19a2 2 0 0 0 4 0V6a2.5 2.5 0 0 0-2-2.5z" />
      <path d="M14.5 3.5A2.5 2.5 0 0 1 17 6v.3A2.8 2.8 0 0 1 19.5 9c0 .9-.4 1.7-1 2.2A3 3 0 0 1 18 15c-.5 0-1-.1-1.5-.4V19a2 2 0 0 1-4 0V6a2.5 2.5 0 0 1 2-2.5z" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M7.5 9.5l3 2.5-3 2.5M13 15h4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5 10-11" />,
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.8 2.8L16 10" />
    </>
  ),
  "x-circle": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5L21.5 20H2.5L12 3.5z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r=".6" fill="currentColor" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.8l8 3v6c0 4.7-3.4 8.8-8 9.4-4.6-.6-8-4.7-8-9.4v-6l8-3z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </>
  ),
  "arrow-right": <path d="M4 12h15M13 6l6 6-6 6" />,
  "arrow-up-right": <path d="M7 17L17 7M8.5 7H17v8.5" />,
  "chevron-right": <path d="M9 5l7 7-7 7" />,
  "chevron-left": <path d="M15 5l-7 7 7 7" />,
  "chevron-down": <path d="M5 9l7 7 7-7" />,
  sparkles: (
    <>
      <path d="M11 3l1.6 4.4L17 9l-4.4 1.6L11 15l-1.6-4.4L5 9l4.4-1.6L11 3z" />
      <path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
    </>
  ),
  play: <path d="M7 4.5l12 7.5-12 7.5v-15z" />,
  rotate: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 4v5h-5" />
    </>
  ),
  seed: (
    <>
      <path d="M12 21v-7" />
      <path d="M12 14c0-3.9 3.1-7 7-7 0 3.9-3.1 7-7 7z" />
      <path d="M12 16c0-2.8-2.2-5-5-5 0 2.8 2.2 5 5 5z" />
    </>
  ),
  flask: (
    <>
      <path d="M9.5 3h5M10.5 3v6.2L5.4 18a2 2 0 0 0 1.7 3h9.8a2 2 0 0 0 1.7-3l-5.1-8.8V3" />
      <path d="M8 14.5h8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.3l3.2 2" />
    </>
  ),
  "git-branch": (
    <>
      <circle cx="6.5" cy="5.5" r="2.5" />
      <circle cx="6.5" cy="18.5" r="2.5" />
      <circle cx="17.5" cy="9" r="2.5" />
      <path d="M6.5 8v8M17.5 11.5c0 3.3-2.7 5-6 5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </>
  ),
  moon: <path d="M20.5 14.3A8.8 8.8 0 0 1 9.7 3.5 9 9 0 1 0 20.5 14.3z" />,
  "panel-left": (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </>
  ),
  cpu: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
      <path d="M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8z" />
      <path d="M12 16.5V21" />
    </>
  ),
  scale: (
    <>
      <path d="M12 3.5v17M7 20.5h10" />
      <path d="M4 8.5h16M6.5 8.5L4 14.5h5L6.5 8.5zM17.5 8.5L15 14.5h5l-2.5-6z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 13.5L6 5.5h12l2.5 8" />
      <path d="M3.5 13.5V18a1.5 1.5 0 0 0 1.5 1.5h14a1.5 1.5 0 0 0 1.5-1.5v-4.5" />
      <path d="M3.5 13.5H9a3 3 0 0 0 6 0h5.5" />
    </>
  ),
  loader: (
    <>
      <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" />
      <path d="M12 20.5A8.5 8.5 0 0 1 3.5 12" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  filter: <path d="M3.5 5.5h17l-6.5 7.5V20l-4-2v-5L3.5 5.5z" />,
  zap: <path d="M13.5 2.5L4.5 14h6l-1 7.5L19.5 10h-6l1-7.5z" />,
  book: (
    <>
      <path d="M4 4.5h6a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H4V4.5z" />
      <path d="M20 4.5h-6a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H20V4.5z" />
    </>
  ),
  trend: <path d="M3.5 16.5L9.5 10l4 4 7-7.5M15.5 6.5h5v5" />,
};

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.7,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="mkt-logo-mark"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      IP
    </span>
  );
}
