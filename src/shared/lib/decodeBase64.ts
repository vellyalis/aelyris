/**
 * Decode a base64 string to Uint8Array.
 * Used to decode PTY output from Rust (sent as base64 over Tauri events).
 */
export function decodeBase64ToBytes(base64: string): Uint8Array {
  const decoded = atob(base64);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}
