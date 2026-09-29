import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "./app-shell";

export const metadata: Metadata = {
  title: "IncidentPilot — AI SRE Console",
  description:
    "Autonomous incident investigation with long-term memory that learns from engineer feedback.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}