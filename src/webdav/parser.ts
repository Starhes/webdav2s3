import { WebDAVResource } from '../types';

/**
 * Parse WebDAV PROPFIND XML response
 */
export function parsePropfindResponse(xml: string, baseHref: string): WebDAVResource[] {
    const resources: WebDAVResource[] = [];

    // Simple regex-based XML parsing for WebDAV responses
    // Note: This is a lightweight parser for Cloudflare Workers environment
    const responseRegex = /<(?:D:|d:|)response[^>]*>([\s\S]*?)<\/(?:D:|d:|)response>/gi;
    let responseMatch;

    while ((responseMatch = responseRegex.exec(xml)) !== null) {
        const responseContent = responseMatch[1];

        // Extract href
        const hrefMatch = responseContent.match(/<(?:D:|d:|)href[^>]*>([^<]+)<\/(?:D:|d:|)href>/i);
        if (!hrefMatch) continue;

        let href = decodeURIComponent(hrefMatch[1]);

        // Extract properties
        const propContent = extractTagContent(responseContent, 'prop');
        if (!propContent) continue;

        // Check if it's a collection (directory)
        const isCollection = /<(?:D:|d:|)collection/i.test(propContent);

        // Extract displayname
        const displayName = extractTagContent(propContent, 'displayname') || getFilenameFromHref(href);

        // Extract content length
        const contentLengthStr = extractTagContent(propContent, 'getcontentlength');
        const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : 0;

        // Extract last modified
        const lastModifiedStr = extractTagContent(propContent, 'getlastmodified');
        const lastModified = lastModifiedStr ? new Date(lastModifiedStr) : new Date();

        // Extract etag
        let etag = extractTagContent(propContent, 'getetag') || '';
        // Remove quotes from etag if present
        etag = etag.replace(/^"(.*)"$/, '$1');

        // Extract content type
        const contentType = extractTagContent(propContent, 'getcontenttype') || 'application/octet-stream';

        resources.push({
            href,
            displayName,
            isCollection,
            contentLength,
            lastModified,
            etag: etag || generateSimpleEtag(href, lastModified, contentLength),
            contentType,
        });
    }

    return resources;
}

/**
 * Extract content from XML tag (handles different namespace prefixes)
 */
function extractTagContent(xml: string, tagName: string): string | null {
    // Try different namespace prefix patterns
    const patterns = [
        new RegExp(`<(?:D:|d:|)${tagName}[^>]*>([^<]*)<\/(?:D:|d:|)${tagName}>`, 'i'),
        new RegExp(`<(?:D:|d:|)${tagName}[^>]*>([\\s\\S]*?)<\/(?:D:|d:|)${tagName}>`, 'i'),
        new RegExp(`<${tagName}[^>]*>([^<]*)<\/${tagName}>`, 'i'),
    ];

    for (const pattern of patterns) {
        const match = xml.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }
    return null;
}

/**
 * Get filename from href path
 */
function getFilenameFromHref(href: string): string {
    const parts = href.replace(/\/$/, '').split('/');
    return parts[parts.length - 1] || '';
}

/**
 * Generate a simple etag from file properties
 */
function generateSimpleEtag(href: string, lastModified: Date, size: number): string {
    const data = `${href}-${lastModified.getTime()}-${size}`;
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

/**
 * Build PROPFIND request XML
 */
export function buildPropfindRequestXml(): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
    <D:getlastmodified/>
    <D:getetag/>
    <D:getcontenttype/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`;
}
