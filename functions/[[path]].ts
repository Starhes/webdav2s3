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

    const url = new URL(request.url);

    // Debug endpoint - shows request details
    if (url.pathname === '/_debug') {
        const headers: Record<string, string> = {};
        request.headers.forEach((value, key) => {
            headers[key] = value;
        });
        return new Response(JSON.stringify({
            method: request.method,
            url: request.url,
            pathname: url.pathname,
            headers,
        }, null, 2), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Length, Host, x-amz-date, x-amz-content-sha256, x-amz-acl, x-amz-storage-class, x-amz-meta-*, x-amz-security-token, x-amz-user-agent, x-amz-expected-bucket-owner, Expect',
                'Access-Control-Expose-Headers': 'ETag, x-amz-request-id, x-amz-version-id',
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

        // Return debug info for signature mismatch diagnosis
        if (signatureResult.debug) {
            const debugResponse = new Response(JSON.stringify({
                error: 'SignatureDoesNotMatch',
                message: signatureResult.error,
                debug: signatureResult.debug
            }, null, 2), {
                status: 403,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'x-amz-request-id': crypto.randomUUID(),
                },
            });
            return debugResponse;
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
