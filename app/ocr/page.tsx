"use client";

import dynamic from "next/dynamic";

// This ensures the library is only loaded in the browser
const OcrEditor = dynamic(() => import("../../components/OCR"), {
  ssr: false,
  loading: () => <p>Loading OCR Engine...</p>,
});

export default function Page() {
  return (
    <main>
      <h1>My OCR PWA</h1>
      <OcrEditor />
    </main>
  );
}
