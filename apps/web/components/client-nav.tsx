"use client";

import { useEffect, useState } from "react";
import { Nav } from "./nav";

export function ClientNav() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const ignore = (event: ErrorEvent | PromiseRejectionEvent) => {
      const msg = "message" in event ? event.message : String(event.reason ?? "");
      if (String(msg).includes("Cannot redefine property: ethereum")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("error", ignore, true);
    window.addEventListener("unhandledrejection", ignore, true);
    setReady(true);
    return () => {
      window.removeEventListener("error", ignore, true);
      window.removeEventListener("unhandledrejection", ignore, true);
    };
  }, []);
  if (!ready) {
    return <header className="h-[69px] border-b border-[var(--line)]" />;
  }
  return <Nav />;
}
