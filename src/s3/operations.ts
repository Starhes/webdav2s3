import { Env, S3RequestContext, S3Operation, S3Object, ListBucketResult } from '../types';
import { WebDAVClient } from '../webdav/client';
import { generateListBucketResultXml, S3Errors } from './xml';
import { createPresignedUrl } from './presign';

/**
 * Parse S3 request to extract bucket, key, and operation
 */
export function parseS3Request(request: Request): S3RequestContext {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // Path format: /{bucket}/{key} or /{bucket}
    const pathParts = url.pathname.split('/').filter(Boolean);
    const bucket = pathParts[0] || '';
    const key = pathParts.slice(1).join('/');

    let operation: S3Operation = 'Unknown';

    if (method === 'GET') {
        operation = key ? 'GetObject' : 'ListBucket';
    } else if (method === 'PUT') {
        operation = 'PutObject';
    } else if (method === 'DELETE') {
        operation = 'DeleteObject';
    } else if (method === 'HEAD') {
        operation = key ? 'HeadObject' : 'HeadBucket';
    }

    return {
        bucket,
        key,
        operation,
        headers: request.headers,
        method,
        url,
        body: request.body,
    };
}

/**
 * Build WebDAV path from bucket and key
 * Maps S3 bucket to WebDAV directory
 */
function buildWebDAVPath(bucket: string, key: string): string {
    if (!bucket) {
        return key || '/';
    }
    if (!key) {
        return `${bucket}/`;
    }
    return `${bucket}/${key}`;
}

/**
 * Handle GetObject operation
 */
async function handleGetObject(
    ctx: S3RequestContext,
    client: WebDAVClient
): Promise<Response> {
    const webdavPath = buildWebDAVPath(ctx.bucket, ctx.key);
    const response = await client.get(webdavPath);

    if (!response.ok) {
        if (response.status === 404) {
            return S3Errors.NoSuchKey(ctx.key);
        }
        return S3Errors.InternalError(`WebDAV error: ${response.status}`);
    }

    // Forward response with S3-compatible headers
    const headers = new Headers();
    headers.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');
    headers.set('Content-Length', response.headers.get('Content-Length') || '0');
    headers.set('x-amz-request-id', crypto.randomUUID());

    const lastModified = response.headers.get('Last-Modified');
    if (lastModified) {
        headers.set('Last-Modified', lastModified);
    }

    const etag = response.headers.get('ETag');
    if (etag) {
        headers.set('ETag', etag);
    }

    return new Response(response.body, {
        status: 200,
        headers,
    });
}

/**
 * Handle PutObject operation
 */
async function handlePutObject(
    ctx: S3RequestContext,
    client: WebDAVClient
): Promise<Response> {
    if (!ctx.body) {
        return S3Errors.InternalError('Missing request body');
    }

    const webdavPath = buildWebDAVPath(ctx.bucket, ctx.key);

    // Ensure parent directories exist (including bucket directory)
    await client.ensureParentDirs(webdavPath);

    const contentType = ctx.headers.get('Content-Type') || 'application/octet-stream';
    const response = await client.put(webdavPath, ctx.body, contentType);

    if (!response.ok && response.status !== 201 && response.status !== 204) {
        return S3Errors.InternalError(`WebDAV PUT failed: ${response.status}`);
    }

    // Generate simple ETag
    const etag = `"${crypto.randomUUID().replace(/-/g, '')}"`;

    return new Response(null, {
        status: 200,
        headers: {
            'ETag': etag,
            'x-amz-request-id': crypto.randomUUID(),
        },
    });
}

/**
 * Handle DeleteObject operation
 */
async function handleDeleteObject(
    ctx: S3RequestContext,
    client: WebDAVClient
): Promise<Response> {
    const webdavPath = buildWebDAVPath(ctx.bucket, ctx.key);
    const response = await client.delete(webdavPath);

    // 204 No Content or 404 Not Found are both acceptable for delete
    // Note: response.ok is true for 2xx status codes, so 204 is already covered by response.ok
    if (!response.ok && response.status !== 404) {
        return S3Errors.InternalError(`WebDAV DELETE failed: ${response.status}`);
    }

    return new Response(null, {
        status: 204,
        headers: {
            'x-amz-request-id': crypto.randomUUID(),
        },
    });
}

/**
 * Handle HeadObject operation
 */
async function handleHeadObject(
    ctx: S3RequestContext,
    client: WebDAVClient
): Promise<Response> {
    const webdavPath = buildWebDAVPath(ctx.bucket, ctx.key);
    const response = await client.head(webdavPath);

    if (!response.ok) {
        if (response.status === 404) {
            return S3Errors.NoSuchKey(ctx.key);
        }
        return S3Errors.InternalError(`WebDAV HEAD failed: ${response.status}`);
    }

    const headers = new Headers();
    headers.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');
    headers.set('Content-Length', response.headers.get('Content-Length') || '0');
    headers.set('x-amz-request-id', crypto.randomUUID());

    const lastModified = response.headers.get('Last-Modified');
    if (lastModified) {
        headers.set('Last-Modified', lastModified);
    }

    const etag = response.headers.get('ETag');
    if (etag) {
        headers.set('ETag', etag);
    }

    return new Response(null, {
        status: 200,
        headers,
    });
}

/**
 * Handle ListBucket operation
 */
async function handleListBucket(
    ctx: S3RequestContext,
    client: WebDAVClient
): Promise<Response> {
    const prefix = ctx.url.searchParams.get('prefix') || '';
    const delimiter = ctx.url.searchParams.get('delimiter') || '';
    const maxKeysStr = ctx.url.searchParams.get('max-keys');
    const maxKeys = maxKeysStr ? parseInt(maxKeysStr, 10) : 1000;

    // PROPFIND on the bucket/prefix path
    const bucketPath = ctx.bucket ? `${ctx.bucket}/` : '/';
    const searchPath = prefix ? `${ctx.bucket}/${prefix}` : bucketPath;
    let resources;

    try {
        resources = await client.propfind(searchPath, '1');
    } catch (error) {
        console.error('PROPFIND error:', error);
        return S3Errors.InternalError('Failed to list directory');
    }

    // Convert WebDAV resources to S3 objects
    const contents: S3Object[] = [];
    const commonPrefixes: { prefix: string }[] = [];
    const seenPrefixes = new Set<string>();

    // The first resource is usually the directory itself, skip it
    const childResources = resources.slice(1);

    for (const resource of childResources) {
        // Calculate the key relative to the root
        let key = resource.href;

        // Handle href - it could be a full URL, absolute path, or relative path
        let urlPath: string;
        if (resource.href.startsWith('http://') || resource.href.startsWith('https://')) {
            // Full URL
            urlPath = new URL(resource.href).pathname;
        } else if (resource.href.startsWith('/')) {
            // Absolute path
            urlPath = resource.href;
        } else {
            // Relative path - prepend base URL origin
            urlPath = new URL(ctx.url.origin + '/' + resource.href).pathname;
        }
        
        key = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;

        // Remove bucket name from path if present
        if (key.startsWith(ctx.bucket + '/')) {
            key = key.slice(ctx.bucket.length + 1);
        }

        // Handle directory delimiter
        if (delimiter && resource.isCollection) {
            // Ensure trailing slash for directories
            const dirKey = key.endsWith('/') ? key : key + '/';

            if (!seenPrefixes.has(dirKey)) {
                seenPrefixes.add(dirKey);
                commonPrefixes.push({ prefix: dirKey });
            }
            continue;
        }

        if (!resource.isCollection) {
            contents.push({
                key,
                lastModified: resource.lastModified,
                etag: resource.etag,
                size: resource.contentLength,
                storageClass: 'STANDARD',
            });
        }
    }

    // Sort contents by key
    contents.sort((a, b) => a.key.localeCompare(b.key));

    // Limit results
    const limitedContents = contents.slice(0, maxKeys);
    const isTruncated = contents.length > maxKeys;

    const result: ListBucketResult = {
        name: ctx.bucket,
        prefix,
        delimiter,
        maxKeys,
        isTruncated,
        contents: limitedContents,
        commonPrefixes,
    };

    const xml = generateListBucketResultXml(result);

    return new Response(xml, {
        status: 200,
        headers: {
            'Content-Type': 'application/xml',
            'x-amz-request-id': crypto.randomUUID(),
        },
    });
}

/**
 * Handle HeadBucket operation
 */
async function handleHeadBucket(
    ctx: S3RequestContext,
    client: WebDAVClient
): Promise<Response> {
    const bucketPath = ctx.bucket ? `${ctx.bucket}/` : '/';
    try {
        const resources = await client.propfind(bucketPath, '0');

        if (resources.length > 0) {
            return new Response(null, {
                status: 200,
                headers: {
                    'x-amz-request-id': crypto.randomUUID(),
                    'x-amz-bucket-region': 'us-east-1',
                },
            });
        }
    } catch (error) {
        console.error('HeadBucket error:', error);
    }

    return S3Errors.NoSuchBucket(ctx.bucket);
}

/**
 * Handle GetObjectStream operation - returns the object as a stream
 */
async function handleGetObjectStream(
    ctx: S3RequestContext,
    client: WebDAVClient
): Promise<Response> {
    const webdavPath = buildWebDAVPath(ctx.bucket, ctx.key);
    const response = await client.get(webdavPath);

    if (!response.ok) {
        if (response.status === 404) {
            return S3Errors.NoSuchKey(ctx.key);
        }
        return S3Errors.InternalError(`WebDAV error: ${response.status}`);
    }

    // Forward response with S3-compatible headers
    const headers = new Headers();
    headers.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');
    headers.set('Content-Length', response.headers.get('Content-Length') || '0');
    headers.set('x-amz-request-id', crypto.randomUUID());

    const lastModified = response.headers.get('Last-Modified');
    if (lastModified) {
        headers.set('Last-Modified', lastModified);
    }

    const etag = response.headers.get('ETag');
    if (etag) {
        headers.set('ETag', etag);
    }

    return new Response(response.body, {
        status: 200,
        headers,
    });
}

/**
 * Handle CreatePresignedGetUrl operation - generates a presigned URL for GET
 */
async function handleCreatePresignedGetUrl(
    ctx: S3RequestContext,
    env: Env
): Promise<Response> {
    const expiresIn = parseInt(ctx.url.searchParams.get('Expires') || '86400', 10); // Default 24 hours
    
    try {
        const presignedUrl = await createPresignedUrl(
            env.S3_ACCESS_KEY_ID,
            env.S3_SECRET_ACCESS_KEY,
            env.S3_REGION,
            ctx.bucket,
            ctx.key,
            expiresIn
        );

        return new Response(presignedUrl, {
            status: 200,
            headers: {
                'Content-Type': 'text/plain',
                'x-amz-request-id': crypto.randomUUID(),
            },
        });
    } catch (error: any) {
        return S3Errors.InternalError(`Failed to create presigned URL: ${error.message}`);
    }
}

/**
 * Route S3 operation to appropriate handler
 */
export async function handleS3Operation(
    ctx: S3RequestContext,
    env: Env
): Promise<Response> {
    const client = new WebDAVClient(env);

    switch (ctx.operation) {
        case 'GetObject':
            return handleGetObject(ctx, client);
        case 'PutObject':
            return handlePutObject(ctx, client);
        case 'DeleteObject':
            return handleDeleteObject(ctx, client);
        case 'HeadObject':
            return handleHeadObject(ctx, client);
        case 'ListBucket':
            return handleListBucket(ctx, client);
        case 'HeadBucket':
            return handleHeadBucket(ctx, client);
        case 'GetObjectStream':
            return handleGetObjectStream(ctx, client);
        case 'CreatePresignedGetUrl':
            return handleCreatePresignedGetUrl(ctx, env);
        default:
            return S3Errors.MethodNotAllowed(ctx.method);
    }
}
