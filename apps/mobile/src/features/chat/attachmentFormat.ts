import { File } from 'expo-file-system';

export type ChatImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'heic' | 'heif';

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

/** Detects the encoded image format. File names and provider MIME values are not trusted. */
export function detectChatImageFormat(bytes: Uint8Array): ChatImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))) return 'gif';

  if (bytes.length >= 16 && ascii(bytes, 4, 4) === 'ftyp') {
    const brands = ascii(bytes, 8, Math.min(bytes.length - 8, 56)).toLowerCase();
    if (brands.includes('avif') || brands.includes('avis')) return 'avif';
    if (brands.includes('heic') || brands.includes('heix') || brands.includes('hevc') || brands.includes('hevx')) return 'heic';
    if (brands.includes('mif1') || brands.includes('msf1')) return 'heif';
  }

  return null;
}

async function readHeader(uri: string): Promise<Uint8Array> {
  // FileHandle.open() is present in the Expo TypeScript declarations, but the
  // installed Android native module does not expose it for every provider URI.
  // React Native's Blob also lacks arrayBuffer() in this runtime. File.bytes()
  // is implemented by the installed native module for file and content URIs.
  const bytes = await new File(uri).bytes();
  return bytes.slice(0, 64);
}

export async function detectChatImageFormatFromUri(uri: string): Promise<ChatImageFormat | null> {
  return detectChatImageFormat(await readHeader(uri));
}

export type ChatDocumentFormat =
  | 'pdf'
  | 'doc'
  | 'docx'
  | 'xls'
  | 'xlsx'
  | 'ppt'
  | 'pptx'
  | 'txt'
  | 'csv'
  | 'zip'
  | 'rar'
  | '7z';

export type ChatAttachmentFormat = ChatImageFormat | 'mp4' | ChatDocumentFormat;

const DOCUMENT_EXTENSIONS = new Set<ChatDocumentFormat>([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z',
]);

function documentExtension(fileName?: string): ChatDocumentFormat | null {
  const extension = fileName?.split('.').pop()?.toLowerCase() as ChatDocumentFormat | undefined;
  return extension && DOCUMENT_EXTENSIONS.has(extension) ? extension : null;
}

function isMostlyText(bytes: Uint8Array): boolean {
  if (!bytes.length) return false;
  let printable = 0;
  for (const byte of bytes) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte !== 127)) printable += 1;
  }
  return printable / bytes.length > 0.92;
}

/** Detects the stored bytes so a document keeps its original encoded format. */
export async function detectChatAttachmentFormatFromUri(
  uri: string,
  fileName?: string,
  mimeType?: string,
): Promise<ChatAttachmentFormat | null> {
  const bytes = await readHeader(uri);
  const image = detectChatImageFormat(bytes);
  if (image) return image;
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === '%PDF') return 'pdf';
  if (bytes.length >= 16 && ascii(bytes, 4, 4) === 'ftyp') return 'mp4';
  const extension = documentExtension(fileName);
  const isZip = bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
  if (isZip) {
    if (extension && ['docx', 'xlsx', 'pptx', 'zip'].includes(extension)) return extension;
    if (mimeType?.includes('wordprocessingml')) return 'docx';
    if (mimeType?.includes('spreadsheetml')) return 'xlsx';
    if (mimeType?.includes('presentationml')) return 'pptx';
    return 'zip';
  }
  const isOle = bytes.length >= 8
    && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value);
  if (isOle && extension && ['doc', 'xls', 'ppt'].includes(extension)) return extension;
  if (bytes.length >= 7 && ascii(bytes, 0, 7) === 'Rar!\u001a\u0007\u0000') return 'rar';
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === 'Rar!\u001a\u0007\u0001\u0000') return 'rar';
  if (bytes.length >= 6 && [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c].every((value, index) => bytes[index] === value)) return '7z';
  if (isMostlyText(bytes) && extension && ['txt', 'csv'].includes(extension)) return extension;
  return null;
}
