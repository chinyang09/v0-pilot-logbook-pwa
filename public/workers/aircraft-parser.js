// Aircraft database parser worker
// Handles gzip decompression and NDJSON parsing off the main thread

importScripts('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js')

self.onmessage = async function(e) {
  const { arrayBuffer, type } = e.data

  if (type === 'parse') {
    try {
      // Report start
      self.postMessage({ type: 'progress', stage: 'Decompressing', percent: 10 })

      const uint8Array = new Uint8Array(arrayBuffer)
      let ndjsonText

      // Check for gzip magic bytes
      if (uint8Array[0] === 0x1f && uint8Array[1] === 0x8b) {
        // Decompress with pako
        const decompressed = pako.ungzip(uint8Array)
        ndjsonText = new TextDecoder('utf-8').decode(decompressed)
      } else {
        ndjsonText = new TextDecoder('utf-8').decode(uint8Array)
      }

      self.postMessage({ type: 'progress', stage: 'Parsing', percent: 40 })

      // Parse NDJSON
      const lines = ndjsonText.split('\n')
      const totalLines = lines.length
      const records = []
      let parsed = 0

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        try {
          const record = JSON.parse(line)
          if (record && record.icao24) {
            records.push({
              registration: record.icao24.toUpperCase(),
              data: line
            })
          }
        } catch (err) {
          // Skip invalid lines
        }

        parsed++

        // Report progress every 10000 records
        if (parsed % 10000 === 0) {
          const percent = 40 + Math.floor((parsed / totalLines) * 50)
          self.postMessage({
            type: 'progress',
            stage: 'Parsing',
            percent,
            count: parsed
          })
        }
      }

      self.postMessage({ type: 'progress', stage: 'Complete', percent: 100, count: records.length })
      self.postMessage({ type: 'complete', records })

    } catch (error) {
      self.postMessage({ type: 'error', error: error.message })
    }
  }
}
