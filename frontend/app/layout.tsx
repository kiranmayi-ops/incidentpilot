"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const links = [
    { href: "/", label: "Dashboard" },
    { href: "/learning", label: "Learning Evolution" },
    { href: "/compare", label: "Baseline vs Memory" },
  ];
  return (
    <html lang="en">
      <body>
        <nav className="topnav">
          <Link href="/" className="brand">
            IncidentPilot
          </Link>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`link${path === l.href ? " active" : ""}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}