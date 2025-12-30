import { Env, WebDAVResource } from '../types';
import { getWebDAVBaseUrl } from '../config';
import { parsePropfindResponse, buildPropfindRequestXml } from './parser';

/**
 * WebDAV client for Cloudflare Workers
 */
export class WebDAVClient {
    private baseUrl: string;
    private authHeader: string;

    constructor(env: Env) {
        this.baseUrl = getWebDAVBaseUrl(env);
        // Create Basic Auth header
        const credentials = btoa(`${env.WEBDAV_USERNAME}:${env.WEBDAV_PASSWORD}`);
        this.authHeader = `Basic ${credentials}`;
    }

    /**
     * Build full URL for a path
     */
    private buildUrl(path: string): string {
        // Remove leading slash from path if baseUrl ends with slash
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;
        return `${this.baseUrl}${cleanPath}`;
    }

    /**
     * Get common headers for all requests
     */
    private getHeaders(additionalHeaders?: Record<string, string>): Headers {
        const headers = new Headers({
            'Authorization': this.authHeader,
            ...additionalHeaders,
        });
        return headers;
    }

    /**
     * GET - Download a file
     */
    async get(path: string): Promise<Response> {
        const url = this.buildUrl(path);
        const response = await fetch(url, {
            method: 'GET',
            headers: this.getHeaders(),
        });
        return response;
    }

    /**
     * HEAD - Get file metadata
     */
    async head(path: string): Promise<Response> {
        const url = this.buildUrl(path);
        const response = await fetch(url, {
            method: 'HEAD',
            headers: this.getHeaders(),
        });
        return response;
    }

    /**
     * PUT - Upload a file
     */
    async put(path: string, body: ReadableStream<Uint8Array> | ArrayBuffer | string, contentType?: string): Promise<Response> {
        const url = this.buildUrl(path);
        const headers = this.getHeaders({
            'Content-Type': contentType || 'application/octet-stream',
        });

        const response = await fetch(url, {
            method: 'PUT',
            headers,
            body,
        });
        return response;
    }

    /**
     * DELETE - Delete a file or directory
     */
    async delete(path: string): Promise<Response> {
        const url = this.buildUrl(path);
        const response = await fetch(url, {
            method: 'DELETE',
            headers: this.getHeaders(),
        });
        return response;
    }

    /**
     * MKCOL - Create a directory
     */
    async mkcol(path: string): Promise<Response> {
        const url = this.buildUrl(path);
        const response = await fetch(url, {
            method: 'MKCOL',
            headers: this.getHeaders(),
        });
        return response;
    }

    /**
     * PROPFIND - List directory contents or get properties
     */
    async propfind(path: string, depth: '0' | '1' | 'infinity' = '1'): Promise<WebDAVResource[]> {
        const url = this.buildUrl(path);
        const response = await fetch(url, {
            method: 'PROPFIND',
            headers: this.getHeaders({
                'Content-Type': 'application/xml',
                'Depth': depth,
            }),
            body: buildPropfindRequestXml(),
        });

        if (!response.ok) {
            if (response.status === 404) {
                return [];
            }
            throw new Error(`PROPFIND failed: ${response.status} ${response.statusText}`);
        }

        const xml = await response.text();
        return parsePropfindResponse(xml, path);
    }

    /**
     * Check if a path exists
     */
    async exists(path: string): Promise<boolean> {
        const response = await this.head(path);
        return response.ok;
    }

    /**
     * Ensure parent directories exist for a path
     */
    async ensureParentDirs(path: string): Promise<void> {
        const parts = path.split('/').filter(Boolean);
        let currentPath = '';

        // Skip the last part (filename)
        for (let i = 0; i < parts.length - 1; i++) {
            currentPath += '/' + parts[i];

            // Check if directory exists
            const headResponse = await this.head(currentPath + '/');
            if (!headResponse.ok) {
                // Try to create it
                const mkcolResponse = await this.mkcol(currentPath + '/');
                // 201 Created or 405 Method Not Allowed (already exists) are OK
                if (!mkcolResponse.ok && mkcolResponse.status !== 405) {
                    console.warn(`Failed to create directory ${currentPath}: ${mkcolResponse.status}`);
                }
            }
        }
    }
}
