import { NextRequest, NextResponse } from 'next/server'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
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
 * API route to securely delete an object from R2.
 */
export async function DELETE(request: NextRequest) {
    try {
        const gate = await readFileCaller(request);
        if (!gate.ok) return gate.response;

        const { searchParams } = new URL(request.url);
        const path = searchParams.get('path');
        const bucketParam = searchParams.get('bucket');

        // Prioritize the environment variable R2_BUCKET if the param is default or missing
        const bucket = (bucketParam && bucketParam !== 'documents') ? bucketParam : R2_BUCKET;

        if (!path) {
            return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
        }

        const denied = await authorizeObject(gate.caller, path, bucketParam, 'delete');
        if (denied) return denied;

        console.log(`[API - delete-file] Deleting object at path: ${path} from bucket: ${bucket}`);

        const command = new DeleteObjectCommand({
            Bucket: bucket,
            Key: path,
        });

        await r2Client.send(command);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error in delete-file API:', error);
        return NextResponse.json(
            { error: 'Failed to delete file from storage' },
            { status: 500 }
        );
    }
}
