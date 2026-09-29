import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./app-shell";

export const metadata: Metadata = {
  title: "IncidentPilot — AI SRE Console",
  description:
    "Autonomous incident investigation with long-term memory that learns from engineer feedback.",
};

// Applies the saved (or system) theme before first paint so the dark
// mission-control default never flashes light on reload.
const themeBootstrap = `
(function () {
  try {
    var stored = localStorage.getItem("ip.theme");
    var system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    var theme = stored === "light" || stored === "dark" ? stored : system;
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
