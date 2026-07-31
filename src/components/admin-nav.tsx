"use client";

import Link from "next/link";

const links = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/positions", label: "Positions" },
  { href: "/admin/templates", label: "Templates" },
  { href: "/admin/assignments", label: "Assignments" },
  { href: "/admin/sessions", label: "Live Sessions" },
  { href: "/admin/attempts", label: "Reports" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminNav() {
  return (
    <nav className="nav">
      <Link href="/admin" className="nav-brand">
        Practicum Vault
      </Link>
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="nav-link">
          {link.label}
        </Link>
      ))}
      <div className="nav-spacer" />
      <form action="/api/auth/logout" method="post">
        <button className="btn btn-secondary btn-sm" type="submit">
          Sign out
        </button>
      </form>
    </nav>
  );
}
