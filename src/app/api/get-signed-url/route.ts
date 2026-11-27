import { NextRequest, NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { authorizeObject, readFileCaller } from '@/lib/file-access'

export const dynamic = 'force-dynamic'

// Cloudflare R2 Client Configuration for Server Side
const r2Client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT || '',
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
    forcePathStyle: true, // Use path-style for R2 compatibility
});

const R2_BUCKET = process.env.R2_DOCS_BUCKET_NAME || 'documents';

/**
 * API route to securely generate a signed URL for R2 objects.
 * This should be used from the client-side to avoid exposing R2 credentials.
 */
export async function GET(request: NextRequest) {
    try {
        const gate = await readFileCaller(request);
        if (!gate.ok) return gate.response;

        const { searchParams } = new URL(request.url);
        const path = searchParams.get('path');
        const bucketParam = searchParams.get('bucket');
        const bucket = bucketParam || R2_BUCKET;

        if (!path) {
            return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
        }

        const denied = await authorizeObject(gate.caller, path, bucketParam, 'read');
        if (denied) return denied;

        console.log(`[API - get-signed-url] Generating signed URL for path: ${path} in bucket: ${bucket}`);

        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: path,
        });

        // Generate signed URL valid for 1 hour
        const url = await getSignedUrl(r2Client, command, { expiresIn: 3600 });

        return NextResponse.json({ url });
    } catch (error) {
        console.error('Error in get-signed-url API:', error);
        return NextResponse.json(
            { error: 'Failed to generate signed URL' },
            { status: 500 }
        );
    }
}
