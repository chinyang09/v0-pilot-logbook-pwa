/**
 * The longest side, in pixels, an image is read at — on the client before
 * upload or before the in-browser engine, and again on the server.
 *
 * Detection runs at whatever resolution it is handed, and its cost grows with
 * the pixel count; recognition does not care (every line is resized to 48px
 * high). Measured on seven real MCDU photos: every OOOI value read identically
 * at 800, 1024, 1280 and full size, while detection went from 19.4s on a 12MP
 * photo to ~0.3s. 1024 keeps headroom over 800 for a photo taken from further
 * back, where the screen is a smaller part of the frame.
 */
export const OCR_MAX_SIDE = 1024
