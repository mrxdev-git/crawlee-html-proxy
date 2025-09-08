import express from 'express';
import {Configuration, PlaywrightCrawler, ProxyConfiguration} from 'crawlee';
import {firefox} from 'playwright';
import fs from 'fs';
import { fetchMircliHtml } from './scrapers/mircli.js';

const app = express();
const port = process.env.PORT || 3000;
const persistentCrawlerMode = String(process.env.PERSISTENT_CRAWLER || '').toLowerCase() === 'true';

// Shared crawler instance for persistent mode
let sharedCrawler = null;
// Collected results keyed by request-scoped id
const resultsById = new Map();
// Serialize runs in persistent mode to avoid "already running"
let runMutex = Promise.resolve();

function loadProxyUrls() {
  const fromEnv = process.env.PROXY_URLS ? process.env.PROXY_URLS.split(',') : [];
  const filePath = process.env.PROXY_FILE || 'proxy.txt';
  let fromFile = [];
  try {
    if (fs.existsSync(filePath)) {
      fromFile = fs.readFileSync(filePath, 'utf-8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
    }
  } catch (e) {
    console.warn(`Warning: Failed to read proxy file "${filePath}": ${e.message}`);
  }
  const combined = [...fromEnv, ...fromFile]
    .map((raw) => {
      let v = String(raw || '').trim();
      if (!v) return '';
      if (!/^\w+:\/\//i.test(v)) v = `http://${v}`;
      try {
        // eslint-disable-next-line no-new
        new URL(v);
        return v;
      } catch (_) {
        return '';
      }
    })
    .filter(Boolean);
  const seen = new Set();
  const deduped = [];
  for (const u of combined) {
    if (!seen.has(u)) {
      deduped.push(u);
      seen.add(u);
    }
  }
  return deduped;
}

async function createCrawler(proxyConfiguration) {
  // Define a crawler whose requestHandler resolves per-request promises via request.userData
    return new PlaywrightCrawler({
      // Proxy configuration (only if proxies are provided)
      proxyConfiguration,

      // Browser fingerprinting for anti-detection
      browserPoolOptions: {
          useFingerprints: true,
          fingerprintOptions: {
              fingerprintGeneratorOptions: {
                  browsers: [{name: 'firefox', minVersion: 90}, {name: 'chrome', minVersion: 90}],
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

      // Request handler collects result in resultsById
      async requestHandler({page, request, response, log}) {
        const reqId = request.userData?.__id;
        try {
          const html = await page.content();
          const payload = {
            url: request.url,
            html,
            status: typeof response?.status === 'function' ? response.status() : (response?.status ?? 200),
          };
          if (reqId) resultsById.set(reqId, { ok: true, payload });
        } catch (e) {
          // Fallback attempt
          try {
            const html = await page.content();
            const payload = {url: request.url, html, status: 200};
            if (reqId) resultsById.set(reqId, { ok: true, payload });
          } catch (err) {
            log?.error?.(`Failed to extract page content: ${err?.message || err}`);
            if (reqId) resultsById.set(reqId, { ok: false, error: err });
          }
        }
        // no cleanup here; route cleans up after reading
      },

      async failedRequestHandler({request}) {
        const reqId = request.userData?.__id;
        if (reqId) resultsById.set(reqId, { ok: false, error: new Error(`Failed to fetch ${request.url}`) });
      },

      maxRequestRetries: 2,
    }, new Configuration({persistStorage: false}));
}

async function getCrawler({proxyConfiguration, forceReset = false} = {}) {
  if (!persistentCrawlerMode) {
    // Stateless mode: create a new crawler per request
    return createCrawler(proxyConfiguration);
  }

  if (forceReset && sharedCrawler) {
    try { await sharedCrawler.teardown?.(); } catch (_) {}
    sharedCrawler = null;
  }
  if (!sharedCrawler) {
    sharedCrawler = await createCrawler(proxyConfiguration);
  }
  return sharedCrawler;
}

// Middleware to parse query parameters
app.use(express.json());

// /fetch endpoint
app.get('/fetch', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }
  
  try {
    // Validate URL format
    new URL(url);
  } catch (error) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  try {
    // Create proxy configuration with rotation if proxies are provided
    let proxyConfiguration = undefined;
    const proxyUrls = loadProxyUrls();
    if (proxyUrls.length > 0) {
      proxyConfiguration = new ProxyConfiguration({ proxyUrls });
    }

    // Specialized handling for mircli.ru
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.endsWith('mircli.ru')) {
      const html = await fetchMircliHtml(String(url), {
        proxyConfiguration,
        waitForSelector: typeof req.query.waitForSelector === 'string' ? req.query.waitForSelector : undefined,
        timeoutMs: Number(req.query.timeoutMs) || 45000,
        headless: String(process.env.MIRCLI_HEADLESS || '').toLowerCase() !== 'false',
      });
      res.set('Content-Type', 'text/html');
      return res.send(html);
    }

    const forceReset = String(req.query.forceReset || '').toLowerCase() === 'true' || req.query.forceReset === '1';
    // In persistent mode, serialize runs via runMutex
    const runner = async () => {
      const crawler = await getCrawler({ proxyConfiguration, forceReset });

      const uniqueKey = `${url}#${Date.now()}-${Math.random()}`;
      const reqId = `id_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      try {
        const runPromise = crawler.run([{ url, uniqueKey, userData: { __id: reqId } }]);
        // 30s timeout guard
        await Promise.race([
          runPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout fetching URL')), 30000)),
        ]);
      } finally {
        // After a run in persistent mode, tear down and null to prevent stale queue issues
        if (persistentCrawlerMode && sharedCrawler) {
          try { await sharedCrawler.teardown?.(); } catch (_) {}
          sharedCrawler = null;
        }
      }

      const result = resultsById.get(reqId);
      resultsById.delete(reqId);
      return result;
    };

    const result = persistentCrawlerMode
      ? await (runMutex = runMutex.then(runner, runner))
      : await runner();

    if (result?.ok && result?.payload?.html) {
      res.set('Content-Type', 'text/html');
      res.send(result.payload.html);
    } else {
      const err = result?.error || new Error('Failed to fetch content');
      res.status(500).json({ error: err.message || String(err) });
    }
  } catch (error) {
    console.error('Error fetching URL:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Admin endpoint to force reset the shared crawler (only meaningful in persistent mode)
app.post('/admin/reset-crawler', async (req, res) => {
  if (!persistentCrawlerMode) return res.status(400).json({ error: 'Persistent crawler mode is disabled' });
  try {
    if (sharedCrawler) {
      try { await sharedCrawler.teardown?.(); } catch (_) {}
      sharedCrawler = null;
    }
    // Recreate immediately to prepare instance
    let proxyConfiguration = undefined;
    const proxyUrls = loadProxyUrls();
    if (proxyUrls.length > 0) proxyConfiguration = new ProxyConfiguration({ proxyUrls });
    sharedCrawler = await createCrawler(proxyConfiguration);
    res.json({ ok: true, message: 'Crawler reset' });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.listen(port, () => {
  console.log(`HTML Proxy server listening on port ${port}`);
});
