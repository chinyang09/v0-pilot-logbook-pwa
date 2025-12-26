'use client'

import { useEffect, useState, useRef } from 'react'
import { createWorker } from '@gutenye/ocr-browser'

export default function OCRScanner() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [worker, setWorker] = useState(null)
  const [initializing, setInitializing] = useState(true)
  const [progress, setProgress] = useState(0)
  const [imagePreview, setImagePreview] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    const initWorker = async () => {
      try {
        setInitializing(true)
        const ocrWorker = await createWorker('eng', 1, {
          logger: m => {
            console.log(m)
            if (m.status === 'recognizing text') {
              setProgress(Math.round(m.progress * 100))
            }
          }
        })
        setWorker(ocrWorker)
        setInitializing(false)
      } catch (error) {
        console.error('Failed to initialize OCR worker:', error)
        setInitializing(false)
        alert('Failed to initialize OCR. Please refresh the page.')
      }
    }
    
    initWorker()
    
    return () => {
      if (worker) {
        worker.terminate()
      }
    }
  }, [])

  const handleImageUpload = async (e) => {
    const file = e.target.files[0]
    if (!file || !worker) return

    // Create preview
    const reader = new FileReader()
    reader.onload = (e) => setImagePreview(e.target.result)
    reader.readAsDataURL(file)

    setLoading(true)
    setProgress(0)
    setText('')

    try {
      const { data: { text } } = await worker.recognize(file)
      setText(text)
    } catch (error) {
      console.error('OCR Error:', error)
      alert('Failed to process image. Please try again.')
    } finally {
      setLoading(false)
      setProgress(0)
    }
  }

  const handleClear = () => {
    setText('')
    setImagePreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    alert('Text copied to clipboard!')
  }

  return (
    <div className="ocr-container">
      <div className="upload-section">
        <input 
          ref={fileInputRef}
          type="file" 
          accept="image/*" 
          capture="environment"
          onChange={handleImageUpload}
          disabled={initializing || loading}
          id="file-input"
          className="file-input"
        />
        <label htmlFor="file-input" className="upload-button">
          {initializing ? '⏳ Initializing OCR...' : loading ? '⏳ Processing...' : '📷 Scan Image'}
        </label>
        
        {initializing && <p className="status-text">Loading OCR engine... This may take a moment.</p>}
      </div>

      {loading && (
        <div className="progress-section">
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="progress-text">{progress}%</p>
        </div>
      )}

      {imagePreview && (
        <div className="preview-section">
          <h3>📸 Image Preview</h3>
          <img src={imagePreview} alt="Preview" className="image-preview" />
        </div>
      )}

      {text && (
        <div className="result-section">
          <div className="result-header">
            <h3>📝 Extracted Text</h3>
            <div className="button-group">
              <button onClick={handleCopy} className="action-button copy">
                📋 Copy
              </button>
              <button onClick={handleClear} className="action-button clear">
                🗑️ Clear
              </button>
            </div>
          </div>
          <pre className="text-output">{text}</pre>
        </div>
      )}

      {!initializing && !loading && !text && !imagePreview && (
        <div className="info-section">
          <p>📱 Take a photo or upload an image to extract text</p>
          <p>🌐 Works offline after first load</p>
          <p>🔒 All processing happens in your browser</p>
        </div>
      )}
    </div>
  )
}