let ocr = null;

self.onmessage = async (e) => {
  const { type, imageUrl } = e.data;

  if (type === "init" && !ocr) {
    const { default: Ocr } = await import("/ocr/gutenye.bundle.js");

    ocr = await Ocr.create({
      isDebug: false,
      models: {
        detectionPath: "/assets/ch_PP-OCRv4_det_infer.onnx",
        recognitionPath: "/assets/ch_PP-OCRv4_rec_infer.onnx",
        dictionaryPath: "/assets/ppocr_keys_v1.txt",
      },
    });

    self.postMessage({ type: "ready" });
  }

  if (type === "detect" && ocr) {
    const start = performance.now();
    const result = await ocr.detect(imageUrl);

    self.postMessage({
      type: "result",
      texts: result.texts,
      duration: Math.round(performance.now() - start),
    });
  }
};
