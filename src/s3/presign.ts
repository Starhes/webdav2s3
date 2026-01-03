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

    return await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
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
 * Create a presigned URL for GET object
 * This generates a URL that can be used to access the S3 object without authentication
 */
export async function createPresignedUrl(
    accessKeyId: string,
    secretAccessKey: string,
    region: string,
    bucket: string,
    key: string,
    expiresIn: number = 86400 // Default 24 hours in seconds
): Promise<string> {
    const method = 'GET';
    const service = 's3';
    const host = `${bucket}.s3.${region}.amazonaws.com`;
    
    // Create date in ISO 8601 format
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const dateStamp = amzDate.slice(0, 8);
    
    // Create canonical query string
    const canonicalQueryParams = [
        `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
        `X-Amz-Credential=${accessKeyId}/${dateStamp}/${region}/${service}/aws4_request`,
        `X-Amz-Date=${amzDate}`,
        `X-Amz-Expires=${expiresIn}`,
        `X-Amz-SignedHeaders=host`,
    ].join('&');
    
    // Create canonical URI
    const canonicalUri = '/' + key.split('/').map(part => uriEncode(part, true)).join('/');
    
    // Create canonical headers (must end with newline)
    const canonicalHeaders = `host:${host}\n`;
    
    // Create payload hash (UNSIGNED-PAYLOAD for presigned URLs)
    const payloadHash = 'UNSIGNED-PAYLOAD';
    
    // Create canonical request
    const canonicalRequest = [
        method,
        canonicalUri,
        canonicalQueryParams,
        canonicalHeaders,
        'host',
        payloadHash,
    ].join('\n');
    
    // Create string to sign
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const hashedCanonicalRequest = await sha256(canonicalRequest);
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        credentialScope,
        hashedCanonicalRequest,
    ].join('\n');
    
    // Calculate signing key
    const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, service);
    
    // Calculate signature
    const signatureBuffer = await hmacSha256(signingKey, stringToSign);
    const signature = arrayBufferToHex(signatureBuffer);
    
    // Build final URL
    const finalUrl = `https://${host}${canonicalUri}?${canonicalQueryParams}&X-Amz-Signature=${signature}`;
    
    return finalUrl;
}