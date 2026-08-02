"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./logo";

/** Client-side only because the active link needs the current path. */
const LINKS = [
  { href: "/", label: "Builds" },
  { href: "/notifications", label: "Notifications" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand">
          <Logo size={24} />
          <span>
            AXE <em>BUILD</em>
          </span>
        </Link>

        <div className="nav-links">
          {LINKS.map((link) => {
            // "/" would otherwise light up on every page.
            const active =
              link.href === "/" ? pathname === "/" || pathname.startsWith("/builds") : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className="nav-link"
                aria-current={active ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <span className="nav-tag">self-hosted</span>
      </div>
    </nav>
  );
}
