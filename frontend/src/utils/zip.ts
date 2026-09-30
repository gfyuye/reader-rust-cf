/**
 * Lightweight, zero-dependency ZIP encoder & decoder using standard Web APIs.
 * Compatible with PKZIP, Legado (阅读 3.0), WinRAR, 7-Zip, and macOS Archive Utility.
 */

// CRC-32 Lookup Table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Compress data with Deflate-raw if supported, or fallback to uncompressed (Store)
 */
async function compressDeflate(data: Uint8Array): Promise<{ bytes: Uint8Array; method: number }> {
  if (typeof CompressionStream !== "undefined") {
    try {
      const cs = new CompressionStream("deflate-raw");
      const writer = cs.writable.getWriter();
      writer.write(data);
      writer.close();
      const compressed = await new Response(cs.readable).arrayBuffer();
      return { bytes: new Uint8Array(compressed), method: 8 }; // Deflated
    } catch {
      // Fallback to uncompressed
    }
  }
  return { bytes: data, method: 0 }; // Stored
}

/**
 * Decompress Deflate-raw data using standard DecompressionStream
 */
async function decompressDeflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();
    const decompressed = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(decompressed);
  }
  throw new Error("当前环境不支持 DecompressionStream，无法解压 Deflate 数据");
}

/**
 * Creates a standard ZIP archive from a dictionary of file names to content.
 * @param files Key-value map of file name to string or Uint8Array
 */
export async function createZipArchive(
  files: Record<string, string | Uint8Array>
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const fileRecords: Array<{
    nameBytes: Uint8Array;
    crc: number;
    compressedBytes: Uint8Array;
    uncompressedSize: number;
    method: number;
    localHeaderOffset: number;
  }> = [];

  const localChunks: Uint8Array[] = [];
  let currentOffset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const uncompressedSize = data.length;

    // Compress
    const { bytes: compressedBytes, method } = await compressDeflate(data);

    const localHeaderOffset = currentOffset;

    // Local file header (30 bytes + name length)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true); // Local file header signature (PK\x03\x04)
    view.setUint16(4, 20, true); // Version needed (2.0)
    view.setUint16(6, 0x0800, true); // General purpose bit flag (UTF-8 filename flag)
    view.setUint16(8, method, true); // Compression method (0 or 8)
    view.setUint16(10, 0, true); // File last mod time
    view.setUint16(12, 0, true); // File last mod date
    view.setUint32(14, crc, true); // CRC-32
    view.setUint32(18, compressedBytes.length, true); // Compressed size
    view.setUint32(22, uncompressedSize, true); // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // File name length
    view.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    localChunks.push(localHeader);
    localChunks.push(compressedBytes);

    currentOffset += localHeader.length + compressedBytes.length;

    fileRecords.push({
      nameBytes,
      crc,
      compressedBytes,
      uncompressedSize,
      method,
      localHeaderOffset,
    });
  }

  const centralDirOffset = currentOffset;
  const centralChunks: Uint8Array[] = [];

  for (const record of fileRecords) {
    // Central directory header (46 bytes + name length)
    const cdHeader = new Uint8Array(46 + record.nameBytes.length);
    const view = new DataView(cdHeader.buffer);
    view.setUint32(0, 0x02014b50, true); // Central file header signature (PK\x01\x02)
    view.setUint16(4, 20, true); // Version made by
    view.setUint16(6, 20, true); // Version needed to extract
    view.setUint16(8, 0x0800, true); // General purpose bit flag (UTF-8 filename flag)
    view.setUint16(10, record.method, true); // Compression method
    view.setUint16(12, 0, true); // Last mod time
    view.setUint16(14, 0, true); // Last mod date
    view.setUint32(16, record.crc, true); // CRC-32
    view.setUint32(20, record.compressedBytes.length, true); // Compressed size
    view.setUint32(24, record.uncompressedSize, true); // Uncompressed size
    view.setUint16(28, record.nameBytes.length, true); // File name length
    view.setUint16(30, 0, true); // Extra field length
    view.setUint16(32, 0, true); // Comment length
    view.setUint16(34, 0, true); // Disk number start
    view.setUint16(36, 0, true); // Internal file attributes
    view.setUint32(38, 0, true); // External file attributes
    view.setUint32(42, record.localHeaderOffset, true); // Relative offset of local header
    cdHeader.set(record.nameBytes, 46);

    centralChunks.push(cdHeader);
    currentOffset += cdHeader.length;
  }

  const centralDirSize = currentOffset - centralDirOffset;

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // EOCD signature (PK\x05\x06)
  eocdView.setUint16(4, 0, true); // Number of this disk
  eocdView.setUint16(6, 0, true); // Disk with central directory
  eocdView.setUint16(8, fileRecords.length, true); // Total entries on disk
  eocdView.setUint16(10, fileRecords.length, true); // Total entries
  eocdView.setUint32(12, centralDirSize, true); // Size of central directory
  eocdView.setUint32(16, centralDirOffset, true); // Offset of central directory
  eocdView.setUint16(20, 0, true); // ZIP comment length

  // Concatenate all chunks
  const totalLength = currentOffset + eocd.length;
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of [...localChunks, ...centralChunks, eocd]) {
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
}

/**
 * Extracts all files from a standard ZIP archive into a map of file names to bytes.
 */
export async function unzipArchive(
  zipData: Uint8Array
): Promise<Record<string, Uint8Array>> {
  // 1. Locate End of Central Directory (EOCD)
  if (zipData.length < 22) throw new Error("文件太小，不是有效 ZIP 文件");

  let eocdOffset = -1;
  const searchStart = Math.max(0, zipData.length - 65536 - 22);
  for (let i = zipData.length - 22; i >= searchStart; i--) {
    if (
      zipData[i] === 0x50 &&
      zipData[i + 1] === 0x4b &&
      zipData[i + 2] === 0x05 &&
      zipData[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("未找到 ZIP EOCD 记录，文件可能已损坏");
  }

  const eocdView = new DataView(zipData.buffer, zipData.byteOffset + eocdOffset, 22);
  const totalEntries = eocdView.getUint16(10, true);
  const cdSize = eocdView.getUint32(12, true);
  const cdOffset = eocdView.getUint32(16, true);

  if (cdOffset + cdSize > zipData.length) {
    throw new Error("ZIP 中央目录越界");
  }

  const files: Record<string, Uint8Array> = {};
  const decoder = new TextDecoder();
  let pos = cdOffset;

  // 2. Parse Central Directory headers
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > zipData.length) break;
    const cdView = new DataView(zipData.buffer, zipData.byteOffset + pos, 46);
    if (cdView.getUint32(0, true) !== 0x02014b50) break;

    const compressionMethod = cdView.getUint16(10, true);
    const compressedSize = cdView.getUint32(20, true);
    const uncompressedSize = cdView.getUint32(24, true);
    const nameLen = cdView.getUint16(28, true);
    const extraLen = cdView.getUint16(30, true);
    const commentLen = cdView.getUint16(32, true);
    const localHeaderOffset = cdView.getUint32(42, true);

    const nameBytes = zipData.subarray(pos + 46, pos + 46 + nameLen);
    const fileName = decoder.decode(nameBytes);

    pos += 46 + nameLen + extraLen + commentLen;

    // Skip directories
    if (fileName.endsWith("/")) continue;

    // Read Local Header to find exact data offset
    if (localHeaderOffset + 30 > zipData.length) continue;
    const localView = new DataView(
      zipData.buffer,
      zipData.byteOffset + localHeaderOffset,
      30
    );
    if (localView.getUint32(0, true) !== 0x04034b50) continue;
    const localNameLen = localView.getUint16(26, true);
    const localExtraLen = localView.getUint16(28, true);

    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedData = zipData.subarray(dataOffset, dataOffset + compressedSize);

    if (compressionMethod === 0) {
      files[fileName] = compressedData.slice();
    } else if (compressionMethod === 8) {
      files[fileName] = await decompressDeflate(compressedData);
    } else {
      throw new Error(`不支持的 ZIP 压缩格式: ${compressionMethod} (${fileName})`);
    }
  }

  return files;
}
