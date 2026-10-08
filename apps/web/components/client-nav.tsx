"use client";

import { useEffect, useState } from "react";
import { Nav } from "./nav";

export function ClientNav() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) {
    return <header className="h-[69px] border-b border-[var(--line)]" />;
  }
  return <Nav />;
}
