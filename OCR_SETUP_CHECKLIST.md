# OCR Setup Checklist

Follow these steps to complete the OCR integration setup:

## ✅ Completed

- [x] Added `@gutenye/ocr-browser` to package.json
- [x] Created OCR service module (`/lib/ocr/ocr-service.ts`)
- [x] Created OOOI data extractor (`/lib/ocr/oooi-extractor.ts`)
- [x] Created ImageImportButton component
- [x] Integrated OCR into FlightForm
- [x] Added OCR button to Logbook page
- [x] Created documentation

## ⚠️ Required Actions

### 1. Fix npm install Issues

The npm install is currently failing due to MongoDB native module compilation. You need to:

```bash
# Option A: Clean install
rm -rf node_modules package-lock.json
npm install

# Option B: Use --legacy-peer-deps
npm install --legacy-peer-deps

# Option C: Skip optional dependencies
npm install --no-optional
```

### 2. Download OCR Model Files

**CRITICAL**: The OCR will not work without these model files.

Download these three files and place them in `/public/models/`:

1. **ch_PP-OCRv4_det_infer.onnx** (~3 MB)
   - Detection model for finding text regions

2. **ch_PP-OCRv4_rec_infer.onnx** (~10 MB)
   - Recognition model for reading text

3. **ppocr_keys_v1.txt** (~6 KB)
   - Character dictionary

**Download from**: https://github.com/gutenye/ocr/tree/main/packages/models/assets

**Quick command** (if you have git with LFS):
```bash
cd /home/user/v0-pilot-logbook-pwa
git clone https://github.com/gutenye/ocr.git /tmp/ocr-temp
cp /tmp/ocr-temp/packages/models/assets/ch_PP-OCRv4_det_infer.onnx ./public/models/
cp /tmp/ocr-temp/packages/models/assets/ch_PP-OCRv4_rec_infer.onnx ./public/models/
cp /tmp/ocr-temp/packages/models/assets/ppocr_keys_v1.txt ./public/models/
rm -rf /tmp/ocr-temp
```

### 3. Verify Installation

```bash
# Check model files
ls -lh public/models/

# Should show:
# ch_PP-OCRv4_det_infer.onnx
# ch_PP-OCRv4_rec_infer.onnx
# ppocr_keys_v1.txt

# Check package installation
npm list @gutenye/ocr-browser
```

### 4. Test Build

```bash
npm run build
```

If successful, you should see no TypeScript errors related to OCR components.

### 5. Test Functionality

```bash
npm run dev
```

Then:
1. Open http://localhost:3000
2. Navigate to "New Flight"
3. Click the camera icon in the header
4. Upload a test image with flight data
5. Verify data extraction works

## 📋 Test Image Requirements

For best OCR results, test with images that have:
- ✅ Clear, printed text
- ✅ Good lighting
- ✅ High contrast (dark text on light background)
- ✅ OOOI times clearly labeled
- ✅ Straight orientation

## 🐛 Troubleshooting

### Issue: "Cannot find module @gutenye/ocr-browser"

**Solution**: Run `npm install` successfully first.

### Issue: "Failed to initialize OCR: Failed to fetch"

**Solution**: Ensure model files are in `/public/models/` and accessible.

### Issue: "Low confidence scores"

**Solution**:
- Use better quality images
- Ensure proper lighting
- Try images with clearer text

### Issue: "OCR button not appearing"

**Solution**:
- Check browser console for errors
- Verify imports in flight-form.tsx and logbook/page.tsx
- Rebuild the application

## 📦 Files Modified/Created

### Created:
- `/lib/ocr/index.ts`
- `/lib/ocr/ocr-service.ts`
- `/lib/ocr/oooi-extractor.ts`
- `/components/image-import-button.tsx`
- `/public/models/README.md`
- `/OCR_INTEGRATION.md`
- `/OCR_SETUP_CHECKLIST.md`

### Modified:
- `/package.json` (added @gutenye/ocr-browser)
- `/components/flight-form.tsx` (added OCR integration)
- `/app/(app)/logbook/page.tsx` (added ImageImportButton)

## 🎯 Next Steps After Setup

1. Test with real flight log images
2. Fine-tune extraction patterns if needed
3. Add custom patterns for your airline's format
4. Consider adding preprocessing for image enhancement
5. Monitor performance and optimize as needed

## 📝 Notes

- OCR runs entirely client-side (privacy-friendly)
- Works offline after initial model load
- Models are cached by the browser
- Total model size: ~13 MB
- Initial load time: 2-3 seconds
- Processing time: 1-5 seconds per image

---

**Need Help?** See `OCR_INTEGRATION.md` for detailed documentation.
