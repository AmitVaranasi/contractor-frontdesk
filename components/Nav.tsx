"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/setup", label: "Business setup" },
  { href: "/phone", label: "Phone line" },
  { href: "/team", label: "Your AI team" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm text-white">FD</span>
          Front Desk Co. <span className="text-xs font-normal text-muted">owner portal</span>
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-1.5 ${path === l.href ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-fg"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
