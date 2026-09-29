import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://incidentpilot.dev"),
  title: {
    default: "IncidentPilot — the SRE investigation agent that remembers",
    template: "%s · IncidentPilot",
  },
  description:
    "IncidentPilot recalls your past incidents from long-term memory, weighs them against live telemetry, and opens the next investigation where your engineers already learned the answer.",
  applicationName: "IncidentPilot",
  keywords: [
    "SRE agent",
    "incident response",
    "AIOps",
    "long-term memory",
    "root cause analysis",
    "Hindsight",
    "incident investigation",
  ],
  authors: [{ name: "IncidentPilot" }],
  openGraph: {
    type: "website",
    title: "IncidentPilot — the SRE investigation agent that remembers",
    description:
      "Past incidents stop being tribal knowledge. IncidentPilot recalls them, challenges them against live telemetry, and starts the next investigation at the right layer.",
    siteName: "IncidentPilot",
  },
  twitter: {
    card: "summary_large_image",
    title: "IncidentPilot — the SRE investigation agent that remembers",
    description:
      "A memory-first SRE investigation agent. Open the live console and watch recall change the first check.",
  },
  robots: { index: true, follow: true },
};

// Applies the saved (or system) theme before first paint so neither the
// light marketing surface nor the dark console ever flashes the wrong canvas.
const themeBootstrap = `
(function () {
  try {
    var stored = localStorage.getItem("ip.theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.dataset.theme = stored;
      return;
    }
    var consoleMode = /\\/console(\\/|$)/.test(window.location.pathname);
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = consoleMode || prefersDark ? "dark" : "light";
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        {children}
      </body>
    </html>
  );
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#06070b" },
  ],
};
