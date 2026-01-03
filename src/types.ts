/**
 * Environment variables configuration
 */
export interface Env {
    WEBDAV_URL: string;
    WEBDAV_USERNAME: string;
    WEBDAV_PASSWORD: string;
    S3_ACCESS_KEY_ID: string;
    S3_SECRET_ACCESS_KEY: string;
    S3_REGION: string;
}

/**
 * S3 request context parsed from incoming request
 */
export interface S3RequestContext {
    bucket: string;
    key: string;
    operation: S3Operation;
    headers: Headers;
    method: string;
    url: URL;
    body: ReadableStream<Uint8Array> | null;
}

/**
 * Supported S3 operations
 */
export type S3Operation =
    | 'GetObject'
    | 'PutObject'
    | 'DeleteObject'
    | 'HeadObject'
    | 'ListBucket'
    | 'HeadBucket'
    | 'GetObjectStream'
    | 'CreatePresignedGetUrl'
    | 'Unknown';

/**
 * S3 object metadata
 */
export interface S3Object {
    key: string;
    lastModified: Date;
    etag: string;
    size: number;
    storageClass: string;
}

/**
 * S3 common prefix (for directory-like listings)
 */
export interface S3CommonPrefix {
    prefix: string;
}

/**
 * S3 ListBucket result
 */
export interface ListBucketResult {
    name: string;
    prefix: string;
    delimiter: string;
    maxKeys: number;
    isTruncated: boolean;
    contents: S3Object[];
    commonPrefixes: S3CommonPrefix[];
}

/**
 * WebDAV PROPFIND response item
 */
export interface WebDAVResource {
    href: string;
    displayName: string;
    isCollection: boolean;
    contentLength: number;
    lastModified: Date;
    etag: string;
    contentType: string;
}

/**
 * AWS Signature V4 parsed components
 */
export interface SignatureComponents {
    algorithm: string;
    credential: string;
    signedHeaders: string[];
    signature: string;
    accessKeyId: string;
    dateStamp: string;
    region: string;
    service: string;
}
