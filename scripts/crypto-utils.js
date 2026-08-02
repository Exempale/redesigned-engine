// crypto-utils.js
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Generate a consistent key from chat ID using SHA-256
async function getKeyFromChatId(chatId) {
  // First, hash the chat ID to get a consistent 32-byte key
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(chatId));
  
  // Import as AES-GCM key
  return crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

// Helper: Convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper: Convert Base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Encrypt a message using AES-GCM with chat ID as key source
 * Returns: base64(iv + ciphertext)
 */
export async function encryptMessage(chatId, message) {
  try {
    // Generate random IV (12 bytes for GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Get key from chat ID
    const key = await getKeyFromChatId(chatId);
    
    // Encrypt the message
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      encoder.encode(message)
    );
    
    // Combine IV + ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    
    // Return as base64
    return arrayBufferToBase64(combined.buffer);
    
  } catch (err) {
    console.error('Encryption error:', err);
    throw err;
  }
}

/**
 * Decrypt a message using AES-GCM
 * Input: base64(iv + ciphertext)
 */
export async function decryptMessage(chatId, encryptedData) {
  try {
    // Decode from base64
    const combinedBuffer = base64ToArrayBuffer(encryptedData);
    const combined = new Uint8Array(combinedBuffer);
    
    // Extract IV (first 12 bytes) and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    
    // Get key from chat ID
    const key = await getKeyFromChatId(chatId);
    
    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      ciphertext
    );
    
    return decoder.decode(decrypted);
    
  } catch (err) {
    console.error('Decryption error:', err);
    // Return the raw encrypted data for debugging
    return `[🔐 Encrypted: ${encryptedData.substring(0, 20)}...]`;
  }
}

export async function encryptFile(chatId, file) {
    // Generate random IV for this file (12 bytes for GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Derive key from chat ID
    const key = await getKeyFromChatId(chatId);
    
    // Read file as ArrayBuffer
    const fileBuffer = await file.arrayBuffer();
    
    // Encrypt
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        fileBuffer
    );
    
    // Combine IV + ciphertext for storage
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    
    // Return as blob for upload
    return new Blob([combined], { type: 'application/octet-stream' });
}

// Decrypt a file (image/video/audio) using the chat ID as key
export async function decryptFile(chatId, encryptedBlob) {
    // Read blob as ArrayBuffer
    const combined = new Uint8Array(await encryptedBlob.arrayBuffer());
    
    // Extract IV (first 12 bytes) and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    
    // Derive key from chat ID
    const key = await getKeyFromChatId(chatId);
    
    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        ciphertext
    );
    
    // Return as blob
    return new Blob([decrypted]);
}

// Check if a message is encrypted (just check if it's valid base64 and long enough)
export function isEncrypted(message) {
  try {
    // Try to decode it - if it fails, it's not valid base64
    atob(message);
    return message.length > 20; // Encrypted messages are usually longer
  } catch {
    return false;
  }
}
