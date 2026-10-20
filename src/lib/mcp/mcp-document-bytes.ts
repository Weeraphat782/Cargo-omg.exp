export const MCP_DOC_MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_EXT = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

export function assertAllowedUploadFilename(filename: string): void {
  const i = filename.lastIndexOf('.');
  const ext = i >= 0 ? filename.slice(i).toLowerCase() : '';
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error('File type not allowed. Use PDF, JPG, or PNG.');
  }
}

export function guessContentTypeFromFilename(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return map[ext] || 'application/octet-stream';
}

export async function loadMcpDocumentBytes(input: {
  file_base64?: string;
  file_url?: string;
}): Promise<Uint8Array> {
  const hasB64 = Boolean(input.file_base64?.trim());
  const hasUrl = Boolean(input.file_url?.trim());
  if (hasB64 === hasUrl) {
    throw new Error('Provide exactly one of file_base64 or file_url.');
  }
  if (hasB64) {
    const buf = Buffer.from(input.file_base64!.trim(), 'base64');
    if (buf.length > MCP_DOC_MAX_BYTES) throw new Error('File exceeds 20 MB limit.');
    return new Uint8Array(buf);
  }
  const url = input.file_url!.trim();
  if (!url.startsWith('https://')) throw new Error('file_url must be a public https URL.');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch file_url: ${res.status}`);
  const arr = new Uint8Array(await res.arrayBuffer());
  if (arr.length > MCP_DOC_MAX_BYTES) throw new Error('File exceeds 20 MB limit.');
  return arr;
}
