import { supabase } from '@/lib/supabase';
import type { CommodityType } from '@/lib/document-presets';
import { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Cloudflare R2 Client Configuration
export const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || '',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
  forcePathStyle: true, // Crucial for R2 compatibility with standard SDK
});

export const R2_BUCKET = process.env.R2_DOCS_BUCKET_NAME || 'documents';

export async function r2ObjectExists(key: string): Promise<boolean> {
  if (typeof window !== 'undefined' || !key?.trim()) return false;
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * อัปโหลดไฟล์ไปยัง Supabase Storage
 * @param bucket ชื่อ bucket ('documents', 'company-logos', 'quotation-attachments')
 * @param path พาธของไฟล์ใน bucket
 * @param file ไฟล์ที่ต้องการอัปโหลด
 * @returns URL ของไฟล์หรือ null หากเกิดข้อผิดพลาด
 */
export async function uploadFile(
  bucket: string,
  path: string,
  file: File
): Promise<string | null> {
  try {
    // แก้ไขปัญหาชื่อไฟล์ภาษาไทย โดยการสร้างชื่อไฟล์ใหม่ที่ปลอดภัย
    // สร้าง path ใหม่โดยเปลี่ยนชื่อไฟล์เป็น timestamp และนามสกุลเดิม
    const fileExtension = file.name.split('.').pop() || '';
    const timestamp = Date.now();
    const sanitizedFileName = `file_${timestamp}.${fileExtension}`;

    // แยก path เป็นส่วนของโฟลเดอร์และชื่อไฟล์
    const lastSlashIndex = path.lastIndexOf('/');
    const folderPath = lastSlashIndex !== -1 ? path.substring(0, lastSlashIndex) : '';

    // สร้าง path ใหม่
    const safePath = lastSlashIndex !== -1
      ? `${folderPath}/${sanitizedFileName}`
      : sanitizedFileName;

    // เก็บชื่อไฟล์ดั้งเดิมไว้ใน metadata
    const metadata = {
      originalFileName: file.name
    };

    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(safePath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type,
        metadata
      });

    if (error) {
      console.error('Error uploading file:', error);
      return null;
    }

    // สร้าง public URL สำหรับไฟล์
    const { data: publicUrl } = supabase.storage
      .from(bucket)
      .getPublicUrl(data.path);

    return publicUrl.publicUrl;
  } catch (error) {
    console.error('Unexpected error uploading file:', error);
    return null;
  }
}

/**
 * ดาวน์โหลดไฟล์จาก Supabase Storage
 * @param bucket ชื่อ bucket
 * @param path พาธของไฟล์ใน bucket
 * @returns ข้อมูลไฟล์หรือ null หากเกิดข้อผิดพลาด
 */
export async function downloadFile(
  bucket: string,
  path: string
): Promise<Blob | null> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(path);

    if (error) {
      console.error('Error downloading file:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Unexpected error downloading file:', error);
    return null;
  }
}

/**
 * ลบไฟล์จาก Supabase Storage
 * @param bucket ชื่อ bucket
 * @param path พาธของไฟล์ใน bucket
 * @returns true หากลบสำเร็จ, false หากเกิดข้อผิดพลาด
 */
export async function deleteFile(
  bucket: string,
  path: string,
  provider: 'supabase' | 'r2' = 'supabase'
): Promise<boolean> {
  try {
    if (provider === 'r2') {
      // Check if we are running in the browser
      if (typeof window !== 'undefined') {
        const response = await fetch(`/api/delete-file?path=${encodeURIComponent(path)}&bucket=${encodeURIComponent(bucket)}`, {
          method: 'DELETE',
        });
        return response.ok;
      }

      // Server-side: Delete directly
      const command = new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: path,
      });
      await r2Client.send(command);
      return true;
    }

    // Default to Supabase
    let finalPath = path;

    // If path is a full Supabase URL, extract the relative path
    // Format: https://.../storage/v1/object/public/bucketName/filePath
    if (finalPath.includes('/storage/v1/object/public/')) {
      try {
        const parts = finalPath.split('/storage/v1/object/public/');
        if (parts.length > 1) {
          const bucketAndPath = parts[1]; // e.g. "documents/folder/file.pdf"
          const firstSlashIndex = bucketAndPath.indexOf('/');
          if (firstSlashIndex !== -1) {
            // Extract everything after the bucket name
            finalPath = bucketAndPath.substring(firstSlashIndex + 1);
          }
        }
      } catch (err) {
        console.error('Error parsing Supabase storage URL:', err);
      }
    }

    // Ensure path is decoded if it was a URL
    finalPath = decodeURIComponent(finalPath);

    console.log(`[storage] Deleting from Supabase: bucket=${bucket}, path=${finalPath}`);

    const { error } = await supabase.storage
      .from(bucket)
      .remove([finalPath]);

    if (error) {
      console.error('Error deleting file:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Unexpected error deleting file:', error);
    return false;
  }
}

/**
 * รับลิสต์ของไฟล์ในโฟลเดอร์
 * @param bucket ชื่อ bucket
 * @param folderPath พาธของโฟลเดอร์ใน bucket
 * @returns รายการไฟล์หรือ empty array หากเกิดข้อผิดพลาด
 */
export async function listFiles(
  bucket: string,
  folderPath: string
): Promise<Array<{
  name: string;
  size: number;
  created_at: string;
  url: string;
}>> {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(folderPath);

    if (error) {
      console.error('Error listing files:', error);
      return [];
    }

    // แปลงข้อมูลเป็นรูปแบบที่ใช้งานง่าย
    const files = data
      .filter(item => !item.id.endsWith('/')) // กรองโฟลเดอร์ออก
      .map(item => {
        const fullPath = folderPath ? `${folderPath}/${item.name}` : item.name;
        const { data: urlData } = supabase.storage
          .from(bucket)
          .getPublicUrl(fullPath);

        return {
          name: item.name,
          size: item.metadata.size,
          created_at: item.created_at,
          url: urlData.publicUrl
        };
      });

    return files;
  } catch (error) {
    console.error('Unexpected error listing files:', error);
    return [];
  }
}

/**
 * สร้างลิงก์แชร์สำหรับอัปโหลดเอกสาร
 * @param quotationId ID ของใบเสนอราคา
 * @param companyName ชื่อบริษัทลูกค้า
 * @param destination ปลายทาง
 * @returns URL สำหรับแชร์กับลูกค้า
 */
export function generateDocumentUploadLink(
  quotationId: string,
  companyName: string,
  destination: string,
  commodity?: CommodityType
): string {
  // สร้าง URL ไปยังหน้าอัปโหลดเอกสาร
  const baseUrl = typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || 'https://your-app-url.com';

  const url = new URL(`${baseUrl}/documents-upload/${quotationId}`);
  url.searchParams.append('company', companyName);
  url.searchParams.append('destination', destination);
  if (commodity) {
    url.searchParams.append('commodity', commodity);
  }

  return url.toString();
}

/**
 * คำนวณขนาดไฟล์ให้อยู่ในรูปแบบที่อ่านง่าย
 * @param bytes ขนาดไฟล์เป็นไบต์
 * @returns ขนาดไฟล์ในรูปแบบที่อ่านง่าย (KB, MB, GB)
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return bytes + ' bytes';
  } else if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(2) + ' KB';
  } else if (bytes < 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  } else {
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }
}

/**
 * ดึง URL ของไฟล์โดยระบุ Provider (Supabase หรือ R2)
 * @param path พาธของไฟล์
 * @param provider 'supabase' หรือ 'r2'
 * @param bucket ชื่อ bucket (สำหรับ Supabase)
 * @returns URL สำหรับเข้าถึงไฟล์
 */
/** Run async work with a max concurrency (avoids flooding /api/get-signed-url). */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/** Resolve a stored path or legacy URL to a browser-openable URL. */
/**
 * Download an object directly from R2 (server-side only) and return base64.
 * Avoids re-fetching a presigned URL over HTTP, which R2 can reject with 400.
 */
export async function downloadR2ObjectAsBase64(path: string): Promise<string> {
  const bytes = await downloadR2ObjectAsBytes(path);
  return Buffer.from(bytes).toString('base64');
}

/** Download an R2 object as raw bytes (server-side only). */
export async function downloadR2ObjectAsBytes(path: string): Promise<Uint8Array> {
  if (!path) throw new Error('Missing R2 object path');
  const key = path.startsWith('http')
    ? new URL(path).pathname.replace(/^\/+/, '').replace(`${R2_BUCKET}/`, '')
    : path;
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  const response = await r2Client.send(command);
  const body = response.Body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (!body?.transformToByteArray) {
    throw new Error('Empty R2 object body');
  }
  return body.transformToByteArray();
}

/** Download a stored submission file as bytes (server-side only). */
export async function downloadSubmissionFileBytes(params: {
  file_path?: string | null;
  file_url?: string | null;
  storage_provider?: 'supabase' | 'r2';
  bucket?: string;
}): Promise<Uint8Array> {
  const pathOrUrl = (params.file_path || params.file_url || '').trim();
  if (!pathOrUrl) throw new Error('Missing file path');

  if (pathOrUrl.startsWith('http')) {
    const response = await fetch(pathOrUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  if ((params.storage_provider || 'r2') === 'r2') {
    return downloadR2ObjectAsBytes(pathOrUrl);
  }

  const url = await getFileUrl(pathOrUrl, 'supabase', params.bucket || 'documents');
  if (!url) throw new Error('Could not resolve file URL');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function resolveDocumentFileUrl(params: {
  file_path?: string | null;
  file_url?: string | null;
  storage_provider?: 'supabase' | 'r2';
  bucket?: string;
}): Promise<string> {
  const pathOrUrl = (params.file_path || params.file_url || '').trim();
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('http')) return pathOrUrl;
  return getFileUrl(
    pathOrUrl,
    params.storage_provider || 'r2',
    params.bucket || 'documents'
  );
}

export async function getFileUrl(
  path: string,
  provider: 'supabase' | 'r2' = 'supabase',
  bucket: string = 'documents'
): Promise<string> {
  // Guard: empty or missing path — nothing to resolve
  if (!path) return '';

  // If path is already a full URL, return it directly
  if (path.startsWith('http')) {
    return path;
  }

  if (provider === 'r2') {
    try {
      // Check if we are running in the browser
      if (typeof window !== 'undefined') {
        // #region agent log
        const __t0 = Date.now();
        fetch('http://127.0.0.1:7320/ingest/4b64fd98-742a-4a5c-9fe7-b64daefbd016',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a9b11d'},body:JSON.stringify({sessionId:'a9b11d',runId:'r1',hypothesisId:'H1H2',location:'storage.ts:getFileUrl:enter',message:'getFileUrl R2 fetch begin',data:{pathLen:path.length,bucket},timestamp:__t0})}).catch(()=>{});
        // #endregion
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(
            `/api/get-signed-url?path=${encodeURIComponent(path)}&bucket=${encodeURIComponent(bucket)}`,
            { signal: controller.signal }
          );
          if (!response.ok) {
            // #region agent log
            fetch('http://127.0.0.1:7320/ingest/4b64fd98-742a-4a5c-9fe7-b64daefbd016',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a9b11d'},body:JSON.stringify({sessionId:'a9b11d',runId:'r1',hypothesisId:'H2',location:'storage.ts:getFileUrl:non-ok',message:'/api/get-signed-url non-ok',data:{status:response.status,elapsed:Date.now()-__t0,bucket},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            throw new Error('Failed to fetch signed URL from server');
          }
          const data = await response.json();
          // #region agent log
          fetch('http://127.0.0.1:7320/ingest/4b64fd98-742a-4a5c-9fe7-b64daefbd016',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a9b11d'},body:JSON.stringify({sessionId:'a9b11d',runId:'r1',hypothesisId:'H1',location:'storage.ts:getFileUrl:ok',message:'getFileUrl ok',data:{elapsed:Date.now()-__t0,bucket,hasUrl:!!data?.url},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          return data.url as string;
        } finally {
          clearTimeout(timeoutId);
        }
      }

      // Server-side: Generate signed URL directly
      const command = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: path,
      });
      return await getSignedUrl(r2Client, command, { expiresIn: 3600 });
    } catch (error) {
      // #region agent log
      if (typeof window !== 'undefined') {
        fetch('http://127.0.0.1:7320/ingest/4b64fd98-742a-4a5c-9fe7-b64daefbd016',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a9b11d'},body:JSON.stringify({sessionId:'a9b11d',runId:'r1',hypothesisId:'H1H2',location:'storage.ts:getFileUrl:catch',message:'getFileUrl caught error',data:{err:String((error as Error)?.message||error),name:(error as Error)?.name},timestamp:Date.now()})}).catch(()=>{});
      }
      // #endregion
      console.error('Error generating R2 signed URL:', error);
      return '';
    }
  }

  // Default to Supabase
  try {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  } catch (error) {
    console.error('Error generating Supabase public URL:', error);
    return '';
  }
}