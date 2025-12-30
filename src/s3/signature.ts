import { SignatureComponents, Env } from '../types';

/**
 * Parse AWS Signature V4 Authorization header
 */
export function parseAuthorizationHeader(authHeader: string): SignatureComponents | null {
    // Format: AWS4-HMAC-SHA256 Credential=AKID/20231230/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=xxx
    const match = authHeader.match(
        /^AWS4-HMAC-SHA256\s+Credential=([^,]+),\s*SignedHeaders=([^,]+),\s*Signature=([a-f0-9]+)$/i
    );

    if (!match) {
        return null;
    }

    const [, credential, signedHeadersStr, signature] = match;
    const signedHeaders = signedHeadersStr.split(';');

    // Parse credential: AKID/20231230/us-east-1/s3/aws4_request
    const credentialParts = credential.split('/');
    if (credentialParts.length !== 5) {
        return null;
    }

    const [accessKeyId, dateStamp, region, service] = credentialParts;

    return {
        algorithm: 'AWS4-HMAC-SHA256',
        credential,
        signedHeaders,
        signature,
        accessKeyId,
        dateStamp,
        region,
        service,
    };
}

/**
 * Convert ArrayBuffer to hex string
 */
function arrayBufferToHex(buffer: ArrayBuffer): string {
    const byteArray = new Uint8Array(buffer);
    return Array.from(byteArray)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * HMAC-SHA256 using Web Crypto API
 */
async function hmacSha256(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
    const keyData = typeof key === 'string'
        ? new TextEncoder().encode(key)
        : key;

    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

/**
 * SHA-256 hash using Web Crypto API
 */
async function sha256(message: string | ArrayBuffer): Promise<string> {
    const data = typeof message === 'string'
        ? new TextEncoder().encode(message)
        : message;
    const hash = await crypto.subtle.digest('SHA-256', data);
    return arrayBufferToHex(hash);
}

/**
 * Get signing key for AWS Signature V4
 */
async function getSigningKey(
    secretKey: string,
    dateStamp: string,
    region: string,
    service: string
): Promise<ArrayBuffer> {
    const kDate = await hmacSha256(`AWS4${secretKey}`, dateStamp);
    const kRegion = await hmacSha256(kDate, region);
    const kService = await hmacSha256(kRegion, service);
    const kSigning = await hmacSha256(kService, 'aws4_request');
    return kSigning;
}

/**
 * Create canonical request string
 */
async function createCanonicalRequest(
    method: string,
    canonicalUri: string,
    canonicalQueryString: string,
    canonicalHeaders: string,
    signedHeaders: string,
    payloadHash: string
): Promise<string> {
    return [
        method,
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders,
        '',
        signedHeaders,
        payloadHash,
    ].join('\n');
}

/**
 * Create string to sign
 */
async function createStringToSign(
    algorithm: string,
    requestDateTime: string,
    credentialScope: string,
    canonicalRequest: string
): Promise<string> {
    const hashedCanonicalRequest = await sha256(canonicalRequest);
    return [algorithm, requestDateTime, credentialScope, hashedCanonicalRequest].join('\n');
}

/**
 * URI encode a string according to AWS rules
 */
function uriEncode(str: string, encodeSlash: boolean = true): string {
    const encoded = encodeURIComponent(str)
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A');

    if (!encodeSlash) {
        return encoded.replace(/%2F/gi, '/');
    }
    return encoded;
}

/**
 * Verify AWS Signature V4 for incoming request
 */
export async function verifySignature(
    request: Request,
    env: Env,
    bodyHash?: string
): Promise<{ valid: boolean; error?: string }> {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
        return { valid: false, error: 'Missing Authorization header' };
    }

    const components = parseAuthorizationHeader(authHeader);
    if (!components) {
        return { valid: false, error: 'Invalid Authorization header format' };
    }

    // Verify access key
    if (components.accessKeyId !== env.S3_ACCESS_KEY_ID) {
        return { valid: false, error: 'Invalid access key' };
    }

    // Verify region
    if (components.region !== env.S3_REGION) {
        return { valid: false, error: 'Invalid region' };
    }

    // Verify service
    if (components.service !== 's3') {
        return { valid: false, error: 'Invalid service' };
    }

    const url = new URL(request.url);

    // Get x-amz-date or Date header
    const amzDate = request.headers.get('x-amz-date');
    const dateHeader = request.headers.get('date');
    const requestDateTime = amzDate || dateHeader;

    if (!requestDateTime) {
        return { valid: false, error: 'Missing date header' };
    }

    // Build canonical headers
    const canonicalHeadersList: string[] = [];
    for (const headerName of components.signedHeaders) {
        const headerValue = request.headers.get(headerName);
        if (headerValue === null) {
            return { valid: false, error: `Missing signed header: ${headerName}` };
        }
        canonicalHeadersList.push(`${headerName.toLowerCase()}:${headerValue.trim()}`);
    }
    const canonicalHeaders = canonicalHeadersList.join('\n');
    const signedHeadersStr = components.signedHeaders.join(';');

    // Build canonical URI
    const canonicalUri = uriEncode(url.pathname, false) || '/';

    // Build canonical query string
    const queryParams = Array.from(url.searchParams.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => `${uriEncode(key)}=${uriEncode(value)}`)
        .join('&');

    // Get payload hash
    const payloadHash = bodyHash || request.headers.get('x-amz-content-sha256') || 'UNSIGNED-PAYLOAD';

    // Create canonical request
    const canonicalRequest = await createCanonicalRequest(
        request.method,
        canonicalUri,
        queryParams,
        canonicalHeaders,
        signedHeadersStr,
        payloadHash
    );

    // Create credential scope
    const credentialScope = `${components.dateStamp}/${components.region}/${components.service}/aws4_request`;

    // Create string to sign
    const stringToSign = await createStringToSign(
        components.algorithm,
        requestDateTime,
        credentialScope,
        canonicalRequest
    );

    // Calculate signature
    const signingKey = await getSigningKey(
        env.S3_SECRET_ACCESS_KEY,
        components.dateStamp,
        components.region,
        components.service
    );

    const signatureBuffer = await hmacSha256(signingKey, stringToSign);
    const calculatedSignature = arrayBufferToHex(signatureBuffer);

    if (calculatedSignature !== components.signature) {
        return { valid: false, error: 'Signature mismatch' };
    }

    return { valid: true };
}

/**
 * Hash request body for signature verification
 */
export async function hashBody(body: ArrayBuffer | null): Promise<string> {
    if (!body || body.byteLength === 0) {
        return await sha256('');
    }
    return await sha256(body);
}
