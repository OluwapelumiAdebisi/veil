"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrImg({ value, size = 196 }: { value: string; size?: number }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    if (!value) {
      setSrc("");
      return;
    }
    void QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: { dark: "#0c0b09", light: "#efe8d8" },
    }).then(setSrc);
  }, [value, size]);

  if (!src) {
    return <div className="h-[196px] w-[196px] rounded-lg border border-[var(--line)]" />;
  }
  return <img src={src} width={size} height={size} alt="Zcash QR" className="rounded-lg" />;
}
