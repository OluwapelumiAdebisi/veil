"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import { parseZcashPayload } from "../lib/zcash-uri";

export function QrScan({ onAddress }: { onAddress: (address: string) => void | Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) {
      return;
    }
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        const video = videoRef.current;
        if (!video) {
          return;
        }
        video.srcObject = stream;
        await video.play();
        const tick = () => {
          if (stopped) {
            return;
          }
          const canvas = canvasRef.current;
          if (video && canvas && video.readyState >= 2) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(video, 0, 0);
              const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(image.data, image.width, image.height);
              if (code?.data) {
                const address = parseZcashPayload(code.data);
                if (address) {
                  onAddress(address);
                  return;
                }
              }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setError("Camera blocked. Upload a screenshot of your Zodl receive QR instead.");
      }
    }

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [active, onAddress]);

  async function onFile(file: File) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height);
    const address = code?.data ? parseZcashPayload(code.data) : null;
    if (!address) {
      setError("No Zcash address found in that image.");
      return;
    }
    onAddress(address);
  }

  return (
    <div className="space-y-3">
      {!active ? (
        <button
          onClick={() => setActive(true)}
          className="w-full rounded-full bg-[var(--gold)] px-4 py-2 text-sm text-black"
        >
          Scan Zodl receive QR
        </button>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--line)]">
          <video ref={videoRef} className="h-48 w-full bg-black object-cover" muted playsInline />
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}
      <label className="block text-center text-xs text-[var(--muted)]">
        Or upload a QR screenshot
        <input
          type="file"
          accept="image/*"
          className="mt-2 block w-full text-xs"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void onFile(file);
            }
          }}
        />
      </label>
      {error && <p className="text-xs text-[var(--gold)]">{error}</p>}
    </div>
  );
}
