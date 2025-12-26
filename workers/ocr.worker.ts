// workers/gutenye.worker.ts
import Ocr from "@gutenye/ocr-browser";

let ocr: any;
let ready = false;

self.onmessage = async (e) => {
  const { type, imageUrl } = e.data;

  if (type === "init" && !ready) {
    ocr = await Ocr.create({
      isDebug: true,
      models: {
        detectionPath: "/ocr-models/ch_PP-OCRv4_det_infer.onnx",
        recognitionPath: "/ocr-models/ch_PP-OCRv4_rec_infer.onnx",
        dictionaryPath: "/ocr-models/ppocr_keys_v1.txt",
      },
    });

    ready = true;
    postMessage({ type: "ready" });
    return;
  }

  if (type === "detect" && ocr) {
    const start = performance.now();
    const result = await ocr.detect(imageUrl);
    const duration = Math.round(performance.now() - start);

    postMessage({
      type: "result",
      duration,
      texts: result.texts,
    });
  }
};
