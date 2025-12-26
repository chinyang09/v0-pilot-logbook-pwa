"use client";

import { useEffect, useRef, useState } from "react";

export default function GutenyeOcrPage() {
  const workerRef = useRef<Worker | null>(null);

  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [resultText, setResultText] = useState("");
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    workerRef.current = new Worker(
      new URL("../../workers/ocr.worker.ts", import.meta.url),
      { type: "module" }
    );

    workerRef.current.onmessage = (e) => {
      const { type } = e.data;

      if (type === "ready") {
        setReady(true);
      }

      if (type === "result") {
        const { texts, duration } = e.data;

        setResultText(
          texts.map((v: any) => `${v.mean.toFixed(2)} ${v.text}`).join("\n")
        );
        setDuration(duration);
        setWorking(false);
      }
    };

    workerRef.current.postMessage({ type: "init" });

    return () => workerRef.current?.terminate();
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !workerRef.current) return;

    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setWorking(true);
    setResultText("Working in progress...");
    setDuration(null);

    workerRef.current.postMessage({
      type: "detect",
      imageUrl: url,
    });
  }

  return (
    <div style={{ padding: 16 }}>
      <h2 id="title">{ready ? "OCR is ready" : "Loading OCR…"}</h2>

      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        disabled={!ready || working}
      />

      {imageUrl && (
        <div style={{ marginTop: 16 }}>
          <img src={imageUrl} alt="Input" style={{ maxWidth: "100%" }} />
        </div>
      )}

      <pre
        style={{
          whiteSpace: "pre-wrap",
          marginTop: 16,
          background: "#111",
          color: "#0f0",
          padding: 12,
        }}
      >
        {resultText}
      </pre>

      {duration !== null && (
        <p id="performance">
          Performance: {duration}ms
          <br />
          (Close DevTools for accurate timing)
        </p>
      )}
    </div>
  );
}
