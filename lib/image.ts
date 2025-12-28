// lib/image.ts

export async function preprocessImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const MAX_WIDTH = 1600;
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);

  const canvas = new OffscreenCanvas(
    Math.round(bitmap.width * scale),
    Math.round(bitmap.height * scale)
  );

  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  return await canvas.convertToBlob({
    type: "image/jpeg",
    quality: 0.9,
  });
}
