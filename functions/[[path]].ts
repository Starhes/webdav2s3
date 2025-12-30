import { Env } from '../src/types';
import { validateConfig } from '../src/config';
import { verifySignature } from '../src/s3/signature';
import { parseS3Request, handleS3Operation } from '../src/s3/operations';
import { S3Errors } from '../src/s3/xml';

interface PagesContext {
    request: Request;
    env: Env;
    params: { path?: string[] };
}

/**
 * Cloudflare Pages Functions entry point
 * Handles all S3 API requests
 */
export async function onRequest(context: PagesContext): Promise<Response> {
    const { request, env } = context;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type, x-amz-date, x-amz-content-sha256',
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    try {
        // Validate configuration
        validateConfig(env);
    } catch (error: any) {
        console.error('Configuration error:', error.message);
        return S3Errors.InternalError('Server configuration error');
    }

    // Verify AWS Signature V4
    const signatureResult = await verifySignature(request, env);
    if (!signatureResult.valid) {
        console.error('Signature verification failed:', signatureResult.error);

        if (signatureResult.error?.includes('access key')) {
            return S3Errors.InvalidAccessKeyId();
        }
        return S3Errors.SignatureDoesNotMatch();
    }

    // Parse and handle S3 request
    const s3Request = parseS3Request(request);

    console.log(`S3 ${s3Request.operation}: bucket=${s3Request.bucket}, key=${s3Request.key}`);

    try {
        const response = await handleS3Operation(s3Request, env);

        // Add CORS headers to response
        const corsResponse = new Response(response.body, response);
        corsResponse.headers.set('Access-Control-Allow-Origin', '*');

        return corsResponse;
    } catch (error: any) {
        console.error('Operation error:', error);
        return S3Errors.InternalError(error.message);
    }
}
