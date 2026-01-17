# OCR Model Files

This directory contains the PaddleOCR model files required for the OCR functionality.

## Required Files

You need to download the following three files from the gutenye/ocr repository:

1. **ch_PP-OCRv4_det_infer.onnx** - Text detection model (~3 MB)
2. **ch_PP-OCRv4_rec_infer.onnx** - Text recognition model (~10 MB)
3. **ppocr_keys_v1.txt** - Character dictionary (~6 KB)

## Download Instructions

### Option 1: Manual Download

Download these files from:
https://github.com/gutenye/ocr/tree/main/packages/models/assets

Place all three files in this directory (`/public/models/`).

### Option 2: Using Git (Requires Git LFS)

```bash
# Clone the repository with Git LFS
git clone https://github.com/gutenye/ocr.git /tmp/ocr-temp

# Copy the model files
cp /tmp/ocr-temp/packages/models/assets/ch_PP-OCRv4_det_infer.onnx ./public/models/
cp /tmp/ocr-temp/packages/models/assets/ch_PP-OCRv4_rec_infer.onnx ./public/models/
cp /tmp/ocr-temp/packages/models/assets/ppocr_keys_v1.txt ./public/models/

# Clean up
rm -rf /tmp/ocr-temp
```

### Option 3: Copy from node_modules (after npm install)

After successfully running `npm install`, the model files might be available in:
```bash
cp node_modules/@gutenye/ocr-models/assets/* ./public/models/
```

## File Verification

After downloading, verify you have all three files:
```bash
ls -lh public/models/
```

You should see:
- ch_PP-OCRv4_det_infer.onnx
- ch_PP-OCRv4_rec_infer.onnx
- ppocr_keys_v1.txt

## Note

These models support multilingual text recognition including English and Chinese characters. The "ch_" prefix indicates they were trained with Chinese datasets, but they work well for English text too.
