import { ListBucketResult, S3Object, S3CommonPrefix } from '../types';

/**
 * Generate S3 ListBucketResult XML response
 */
export function generateListBucketResultXml(result: ListBucketResult): string {
    const contentsXml = result.contents
        .map(
            (obj) => `
    <Contents>
      <Key>${escapeXml(obj.key)}</Key>
      <LastModified>${obj.lastModified.toISOString()}</LastModified>
      <ETag>"${escapeXml(obj.etag)}"</ETag>
      <Size>${obj.size}</Size>
      <StorageClass>${obj.storageClass}</StorageClass>
    </Contents>`
        )
        .join('');

    const commonPrefixesXml = result.commonPrefixes
        .map(
            (prefix) => `
    <CommonPrefixes>
      <Prefix>${escapeXml(prefix.prefix)}</Prefix>
    </CommonPrefixes>`
        )
        .join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>${escapeXml(result.name)}</Name>
  <Prefix>${escapeXml(result.prefix)}</Prefix>
  <Delimiter>${escapeXml(result.delimiter)}</Delimiter>
  <MaxKeys>${result.maxKeys}</MaxKeys>
  <IsTruncated>${result.isTruncated}</IsTruncated>${contentsXml}${commonPrefixesXml}
</ListBucketResult>`;
}

/**
 * Generate S3 error XML response
 */
export function generateErrorXml(
    code: string,
    message: string,
    resource?: string,
    requestId?: string
): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Error>
  <Code>${escapeXml(code)}</Code>
  <Message>${escapeXml(message)}</Message>
  ${resource ? `<Resource>${escapeXml(resource)}</Resource>` : ''}
  ${requestId ? `<RequestId>${escapeXml(requestId)}</RequestId>` : ''}
</Error>`;
}

/**
 * Generate CopyObjectResult XML
 */
export function generateCopyObjectResultXml(etag: string, lastModified: Date): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<CopyObjectResult>
  <LastModified>${lastModified.toISOString()}</LastModified>
  <ETag>"${escapeXml(etag)}"</ETag>
</CopyObjectResult>`;
}

/**
 * Generate DeleteResult XML for batch deletes
 */
export function generateDeleteResultXml(
    deleted: { key: string }[],
    errors: { key: string; code: string; message: string }[]
): string {
    const deletedXml = deleted
        .map((d) => `<Deleted><Key>${escapeXml(d.key)}</Key></Deleted>`)
        .join('');

    const errorsXml = errors
        .map(
            (e) => `<Error><Key>${escapeXml(e.key)}</Key><Code>${escapeXml(e.code)}</Code><Message>${escapeXml(e.message)}</Message></Error>`
        )
        .join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  ${deletedXml}
  ${errorsXml}
</DeleteResult>`;
}

/**
 * Escape special XML characters
 */
function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Create S3 error response
 */
export function createErrorResponse(
    statusCode: number,
    code: string,
    message: string,
    resource?: string
): Response {
    const requestId = crypto.randomUUID();
    const xml = generateErrorXml(code, message, resource, requestId);

    return new Response(xml, {
        status: statusCode,
        headers: {
            'Content-Type': 'application/xml',
            'x-amz-request-id': requestId,
        },
    });
}

/**
 * Common S3 error responses
 */
export const S3Errors = {
    AccessDenied: (resource?: string) =>
        createErrorResponse(403, 'AccessDenied', 'Access Denied', resource),

    NoSuchKey: (key: string) =>
        createErrorResponse(404, 'NoSuchKey', 'The specified key does not exist.', key),

    NoSuchBucket: (bucket: string) =>
        createErrorResponse(404, 'NoSuchBucket', 'The specified bucket does not exist.', bucket),

    InvalidAccessKeyId: () =>
        createErrorResponse(403, 'InvalidAccessKeyId', 'The AWS Access Key Id you provided does not exist in our records.'),

    SignatureDoesNotMatch: () =>
        createErrorResponse(403, 'SignatureDoesNotMatch', 'The request signature we calculated does not match the signature you provided.'),

    InternalError: (message?: string) =>
        createErrorResponse(500, 'InternalError', message || 'We encountered an internal error. Please try again.'),

    MethodNotAllowed: (method: string) =>
        createErrorResponse(405, 'MethodNotAllowed', `The specified method is not allowed: ${method}`),
};
