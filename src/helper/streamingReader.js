/**
 * Streaming file reader for large files
 * Provides efficient reading of large markdown/text files
 */
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

// Threshold for streaming vs regular read (1MB)
const LARGE_FILE_THRESHOLD = 1 * 1024 * 1024;

// Chunk size for streaming reads
const STREAM_CHUNK_SIZE = 64 * 1024; // 64KB chunks

/**
 * Check if a file should use streaming based on size
 * @param {string} filePath - Path to the file
 * @returns {Promise<{size: number, useStreaming: boolean}>}
 */
export async function checkFileSize(filePath) {
  try {
    const stats = await stat(filePath);
    return {
      size: stats.size,
      useStreaming: stats.size > LARGE_FILE_THRESHOLD
    };
  } catch (e) {
    return { size: 0, useStreaming: false };
  }
}

/**
 * Read a file using streaming for large files
 * @param {string} filePath - Path to the file
 * @param {string} encoding - File encoding (default: 'utf8')
 * @returns {Promise<string>} File contents
 */
export async function readFileStreaming(filePath, encoding = 'utf8') {
  return new Promise((resolve, reject) => {
    const chunks = [];
    
    const stream = createReadStream(filePath, {
      encoding,
      highWaterMark: STREAM_CHUNK_SIZE
    });
    
    stream.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    stream.on('end', () => {
      resolve(chunks.join(''));
    });
    
    stream.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Read a file, using streaming for large files
 * @param {string} filePath - Path to the file
 * @param {string} encoding - File encoding (default: 'utf8')
 * @param {Function} regularReadFn - Regular read function to use for small files
 * @returns {Promise<{content: string, streamed: boolean, size: number}>}
 */
export async function smartReadFile(filePath, encoding = 'utf8', regularReadFn = null) {
  const { size, useStreaming } = await checkFileSize(filePath);
  
  if (useStreaming) {
    const content = await readFileStreaming(filePath, encoding);
    return { content, streamed: true, size };
  }
  
  // Use provided regular read function or return null to indicate caller should handle
  if (regularReadFn) {
    const content = await regularReadFn(filePath, encoding);
    return { content, streamed: false, size };
  }
  
  // Return null to indicate caller should use their own read function
  return { content: null, streamed: false, size, useNormalRead: true };
}

/**
 * Get threshold configuration
 */
export function getStreamingConfig() {
  return {
    threshold: LARGE_FILE_THRESHOLD,
    chunkSize: STREAM_CHUNK_SIZE
  };
}

/**
 * Format file size for logging
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}
