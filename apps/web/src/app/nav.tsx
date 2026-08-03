"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "./logo";

/**
 * The app shell: a fixed sidebar rail and the page beside it.
 *
 * Client-side because the active link needs the current path, and because the
 * rail turns into a drawer on a phone. The drawer closes on navigation — the
 * alternative is arriving at a new page with the menu still covering it.
 */
const LINKS: { href: string; label: string; icon: ReactNode }[] = [
  {
    href: "/",
    label: "Builds",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M2.5 4.6 8 1.8l5.5 2.8v6.8L8 14.2 2.5 11.4V4.6Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M2.6 4.7 8 7.5l5.4-2.8M8 7.5v6.6" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
  {
    href: "/notifications",
    label: "Notifications",
    icon: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M4 6.6a4 4 0 1 1 8 0c0 2.4.6 3.5 1.2 4.1.3.3.1.8-.3.8H3.1c-.4 0-.6-.5-.3-.8C3.4 10.1 4 9 4 6.6Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path d="M6.6 13.4a1.6 1.6 0 0 0 2.8 0" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
];

function isActive(href: string, pathname: string): boolean {
  // "/" would otherwise light up on every page.
  if (href === "/") return pathname === "/" || pathname.startsWith("/builds");
  return pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="shell">
      <aside className={open ? "sidebar is-open" : "sidebar"}>
        <Link href="/" className="brand">
          <Logo size={22} />
          <span>
            AXE <em>BUILD</em>
          </span>
        </Link>

        <nav className="side-links" aria-label="Main">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="side-link"
              aria-current={isActive(link.href, pathname) ? "page" : undefined}
            >
              {link.icon}
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-foot">self-hosted</div>
      </aside>

      {open && (
        <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
      )}

      <div className="content">
        <header className="topbar">
          <button
            className="icon-btn"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
          <Link href="/" className="brand" style={{ padding: 0 }}>
            <Logo size={20} />
            <span>
              AXE <em>BUILD</em>
            </span>
          </Link>
        </header>

        {children}
      </div>
    </div>
  );
}
