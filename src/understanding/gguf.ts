import {closeSync, openSync, readSync} from 'node:fs';

/**
 * Reads only the leading metadata of a GGUF file (bounded), never tensors:
 * enough to name the model and judge compatibility without loading it.
 */
export interface GgufMetadata {
  architecture?: string;
  name?: string;
  sizeLabel?: string;
  /** llama.cpp file type id (quantization). */
  fileType?: number;
  contextLength?: number;
  /** Present for vision projector files (mmproj), which are not language models. */
  visionProjector?: boolean;
}

/** llama.cpp `general.file_type` ids for the common quantizations. */
export const FILE_TYPES: Record<number, string> = {0: 'F32', 1: 'F16', 2: 'Q4_0', 3: 'Q4_1', 7: 'Q8_0', 8: 'Q5_0', 9: 'Q5_1', 10: 'Q2_K', 11: 'Q3_K_S',
  12: 'Q3_K_M', 13: 'Q3_K_L', 14: 'Q4_K_S', 15: 'Q4_K_M', 16: 'Q5_K_S', 17: 'Q5_K_M', 18: 'Q6_K', 19: 'IQ2_XXS', 20: 'IQ2_XS', 30: 'IQ4_XS', 32: 'BF16'};

const WANTED = new Set(['general.architecture', 'general.name', 'general.size_label', 'general.file_type']);
const MAX_BYTES = 4 * 1024 * 1024;

class Reader {
  offset = 0;
  constructor(private readonly buffer: Buffer) {}
  has(bytes: number): boolean { return this.offset + bytes <= this.buffer.length; }
  u32(): number { const value = this.buffer.readUInt32LE(this.offset); this.offset += 4; return value; }
  u64(): number { const value = this.buffer.readBigUInt64LE(this.offset); this.offset += 8; return Number(value); }
  string(): string {
    const length = this.u64();
    if (length > 1 << 20 || !this.has(length)) throw new RangeError('string');
    const value = this.buffer.toString('utf8', this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
}

// GGUF value types: 0 u8, 1 i8, 2 u16, 3 i16, 4 u32, 5 i32, 6 f32, 7 bool, 8 string, 9 array, 10 u64, 11 i64, 12 f64.
const SCALAR_SIZES: Record<number, number> = {0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8};

function readValue(reader: Reader, type: number): unknown {
  if (type === 8) return reader.string();
  if (type === 9) {
    const elementType = reader.u32();
    const count = reader.u64();
    if (elementType === 8) { for (let index = 0; index < count; index += 1) reader.string(); return undefined; }
    const size = SCALAR_SIZES[elementType];
    if (!size || !reader.has(size * count)) throw new RangeError('array');
    reader.offset += size * count;
    return undefined;
  }
  const size = SCALAR_SIZES[type];
  if (!size || !reader.has(size)) throw new RangeError('scalar');
  if (type === 4) return reader.u32();
  if (type === 10) return reader.u64();
  reader.offset += size;
  return undefined;
}

export function parseGgufMetadata(buffer: Buffer): GgufMetadata | undefined {
  if (buffer.length < 24 || buffer.toString('ascii', 0, 4) !== 'GGUF') return undefined;
  const reader = new Reader(buffer);
  reader.offset = 4;
  const version = reader.u32();
  if (version < 2 || version > 3) return undefined;
  reader.u64(); // tensors
  const count = reader.u64();
  const metadata: GgufMetadata = {};
  try {
    for (let index = 0; index < count && index < 100_000; index += 1) {
      const key = reader.string();
      const type = reader.u32();
      const value = readValue(reader, type);
      if (key === 'general.architecture' && typeof value === 'string') metadata.architecture = value;
      else if (key === 'general.name' && typeof value === 'string') metadata.name = value.slice(0, 120);
      else if (key === 'general.size_label' && typeof value === 'string') metadata.sizeLabel = value.slice(0, 20);
      else if (key === 'general.file_type' && typeof value === 'number') metadata.fileType = value;
      else if (key.endsWith('.context_length') && typeof value === 'number') metadata.contextLength = value;
      else if (key.startsWith('clip.')) metadata.visionProjector = true;
      if ([...WANTED].every(wanted => wanted === 'general.architecture' ? metadata.architecture : wanted === 'general.name' ? metadata.name
        : wanted === 'general.size_label' ? metadata.sizeLabel : metadata.fileType !== undefined) && metadata.contextLength) break;
    }
  } catch { /* metadata beyond the bounded read: keep what was found */ }
  return metadata;
}

export function readGgufMetadata(path: string, maxBytes = MAX_BYTES): GgufMetadata | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(maxBytes);
    const read = readSync(fd, buffer, 0, maxBytes, 0);
    return parseGgufMetadata(buffer.subarray(0, read));
  } catch { return undefined; } finally { if (fd !== undefined) closeSync(fd); }
}

/** Minimal GGUF header for tests and fixtures: string and u32 metadata only. */
export function ggufFixture(entries: Record<string, string | number>): Buffer {
  const parts: Buffer[] = [];
  const u32 = (value: number) => { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value); return buffer; };
  const u64 = (value: number) => { const buffer = Buffer.alloc(8); buffer.writeBigUInt64LE(BigInt(value)); return buffer; };
  const str = (value: string) => Buffer.concat([u64(Buffer.byteLength(value)), Buffer.from(value)]);
  parts.push(Buffer.from('GGUF'), u32(3), u64(0), u64(Object.keys(entries).length));
  for (const [key, value] of Object.entries(entries)) {
    parts.push(str(key));
    if (typeof value === 'string') parts.push(u32(8), str(value));
    else parts.push(u32(4), u32(value));
  }
  return Buffer.concat(parts);
}
