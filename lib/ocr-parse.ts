// lib/ocr-parse.ts

export interface OcrText {
  text: string;
  score: number;
}

export function parseOcr(texts: OcrText[]) {
  const joined = texts.map((t) => t.text).join(" ");

  const icao = joined.match(/\b[A-Z]{4}\b/g) || [];
  const times = joined.match(/\b([01]\d|2[0-3])[0-5]\d\b/g) || [];
  const date =
    joined.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/)?.[0] ?? null;

  return {
    departure: icao[0] ?? null,
    arrival: icao[1] ?? null,
    out: times[0] ?? null,
    off: times[1] ?? null,
    on: times[2] ?? null,
    in: times[3] ?? null,
    date,
    confidence: texts.length ? Math.min(...texts.map((t) => t.score)) : 0,
  };
}
