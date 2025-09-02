#!/usr/bin/env node

import { PlaywrightCrawler, ProxyConfiguration, Configuration } from 'crawlee';
import { firefox } from 'playwright';

// Get URL from command line arguments
const url = process.argv[2];

if (!url) {
    console.error('Error: URL parameter is required');
    console.log('Usage: node cli.js <url>');
    process.exit(1);
}

try {
    // Validate URL format
    new URL(url);
} catch (error) {
    console.error('Error: Invalid URL format');
    process.exit(1);
}

async function fetchHtml(url) {
    try {
        // Create proxy configuration with rotation if proxies are provided
        let proxyConfiguration = undefined;
        const proxyUrls = process.env.PROXY_URLS ? process.env.PROXY_URLS.split(',') : [];
        
        // Only create proxy configuration if we have proxy URLs
        if (proxyUrls.length > 0) {
            proxyConfiguration = new ProxyConfiguration({
                proxyUrls: proxyUrls,
            });
        }
        
        // Store the result
        let result = null;
        
        // Create crawler with anti-detection features
        const crawler = new PlaywrightCrawler({
            // Proxy configuration (only if proxies are provided)
            proxyConfiguration,
            
            // Browser fingerprinting for anti-detection
            browserPoolOptions: {
                useFingerprints: true, // Enable browser fingerprinting
                fingerprintOptions: {
                    fingerprintGeneratorOptions: {
                        // Rotate between different browsers, devices, and operating systems
                        browsers: [{ name: 'firefox', minVersion: 90 }, { name: 'chrome', minVersion: 90 }],
                        devices: ['desktop', 'mobile'],
                        operatingSystems: ['windows', 'macos', 'linux'],
                        locales: ['en-US', 'en-GB'],
                    },
                },
            },
            
            // Launch context
            launchContext: {
                launcher: firefox,
                launchOptions: {
                    headless: true,
                },
            },
            
            // Enable session pool for IP rotation
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 20,
                sessionOptions: {
                    maxUsageCount: 50,
                    maxErrorScore: 3,
                },
            },
            
            // Request handler
            async requestHandler({ page, request, response }) {
                console.log(`Processing ${request.url}...`);
                try {
                    const html = await page.content();
                    result = {
                        url: request.url,
                        html,
                        status: typeof response?.status === 'function' ? response.status() : (response?.status ?? 200),
                    };
                } catch (e) {
                    try {
                        const html = await page.content();
                        result = { url: request.url, html, status: 200 };
                    } catch (_) {
                        console.error('Failed to extract page content:', e);
                    }
                }
            },
            
            // Failed request handler
            async failedRequestHandler({ request }) {
                console.log(`Request ${request.url} failed.`);
                throw new Error(`Failed to fetch ${request.url}`);
            },
            
            // Crawler options
            maxRequestRetries: 2,
        }, new Configuration({ persistStorage: false }));
        
        // Run crawler with an in-memory request list for this single URL
        await crawler.run([url]);
        
        // Return HTML content
        if (result) {
            console.log(result.html);
        } else {
            console.error('Error: Failed to fetch content');
            process.exit(1);
        }
    } catch (error) {
        console.error('Error fetching URL:', error.message);
        process.exit(1);
    }
}

// Run the fetch function
await fetchHtml(url);
