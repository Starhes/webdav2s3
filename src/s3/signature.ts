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
 * Format:
 * HTTPMethod + '\n' +
 * CanonicalURI + '\n' +
 * CanonicalQueryString + '\n' +
 * CanonicalHeaders + '\n' +
 * SignedHeaders + '\n' +
 * HashedPayload
 *
 * Note: CanonicalHeaders already ends with '\n'
 */
async function createCanonicalRequest(
    method: string,
    canonicalUri: string,
    canonicalQueryString: string,
    canonicalHeaders: string,  // Must end with '\n'
    signedHeaders: string,
    payloadHash: string
): Promise<string> {
    // canonicalHeaders already ends with \n, so we don't need empty string
    return [
        method,
        canonicalUri,
        canonicalQueryString,
        canonicalHeaders + signedHeaders,
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
 * Convert RFC 7231 date format to AWS ISO 8601 format
 * Input: "Wed, 01 Jan 2020 00:00:00 GMT"
 * Output: "20200101T000000Z"
 */
function convertToAwsDateFormat(dateStr: string): string | null {
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
            return null;
        }
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
    } catch {
        return null;
    }
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
): Promise<{ valid: boolean; error?: string; debug?: Record<string, string> }> {
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
    // x-amz-date is in ISO 8601 basic format: YYYYMMDD'T'HHMMSS'Z'
    // Date header is in RFC 7231 format: "Wed, 01 Jan 2020 00:00:00 GMT"
    const amzDate = request.headers.get('x-amz-date');
    const dateHeader = request.headers.get('date');
    
    let requestDateTime: string | null = null;
    
    if (amzDate) {
        // x-amz-date is already in the correct format
        requestDateTime = amzDate;
    } else if (dateHeader) {
        // Convert Date header to AWS format
        requestDateTime = convertToAwsDateFormat(dateHeader);
        if (!requestDateTime) {
            return { valid: false, error: 'Invalid Date header format' };
        }
    }

    if (!requestDateTime) {
        return { valid: false, error: 'Missing date header' };
    }

    // Build canonical headers
    // AWS SigV4 spec: lowercase header names, trim and collapse multiple spaces in values
    const canonicalHeadersList: string[] = [];
    for (const headerName of components.signedHeaders) {
        const headerValue = request.headers.get(headerName);
        if (headerValue === null) {
            return { valid: false, error: `Missing signed header: ${headerName}` };
        }
        // Trim leading/trailing whitespace and collapse multiple spaces into one
        const normalizedValue = headerValue.trim().replace(/\s+/g, ' ');
        canonicalHeadersList.push(`${headerName.toLowerCase()}:${normalizedValue}`);
    }
    // Each header line must end with \n, so join with \n and add trailing \n
    const canonicalHeaders = canonicalHeadersList.join('\n') + '\n';
    const signedHeadersStr = components.signedHeaders.join(';');

    // Build canonical URI
    // url.pathname is already percent-encoded in some environments (e.g. Workers)
    // We need to decode it first to avoid double encoding
    const decodedPath = decodeURIComponent(url.pathname);
    const canonicalUri = uriEncode(decodedPath, false) || '/';

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
        // Debug logging for signature mismatch
        console.log('=== Signature Verification Debug ===');
        console.log('Request Method:', request.method);
        console.log('Request URL:', request.url);
        console.log('Canonical URI:', canonicalUri);
        console.log('Canonical Query String:', queryParams);
        console.log('Canonical Headers:', canonicalHeaders);
        console.log('Signed Headers:', signedHeadersStr);
        console.log('Payload Hash:', payloadHash);
        console.log('Canonical Request:');
        console.log(canonicalRequest);
        console.log('---');
        console.log('String to Sign:');
        console.log(stringToSign);
        console.log('---');
        console.log('Expected Signature:', components.signature);
        console.log('Calculated Signature:', calculatedSignature);
        console.log('=== End Debug ===');

        const debugInfo = {
            method: request.method,
            url: request.url,
            canonicalUri,
            queryParams,
            canonicalHeaders: canonicalHeaders.replace(/\n/g, '\\n'),
            signedHeaders: signedHeadersStr,
            payloadHash,
            canonicalRequest: canonicalRequest.replace(/\n/g, '\\n'),
            stringToSign: stringToSign.replace(/\n/g, '\\n'),
            expectedSignature: components.signature,
            calculatedSignature,
        };

        return {
            valid: false,
            error: `Signature mismatch`,
            debug: debugInfo
        };
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
