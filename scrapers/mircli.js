import { PlaywrightCrawler, Configuration } from 'crawlee';
import { chromium } from 'playwright';

// Specialized scraper for mircli.ru
// - Uses Crawlee PlaywrightCrawler with browser fingerprinting (Chrome desktop)
// - Mimics Russian locale and timezone via headers and waits for dynamic scripts
// - Detects typical JS challenges and waits until they disappear
// - Supports proxyConfiguration passed from caller
// - Returns final HTML after page fully loads

/**
 * @param {string} url
 * @param {object} [opts]
 * @param {import('crawlee').ProxyConfiguration} [opts.proxyConfiguration]
 * @param {string} [opts.waitForSelector]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.headless]
 * @returns {Promise<string>} HTML content
 */
export async function fetchMircliHtml(url, opts = {}) {
  const {
    proxyConfiguration,
    waitForSelector,
    timeoutMs = 45000,
    headless = String(process.env.MIRCLI_HEADLESS || '').toLowerCase() !== 'false',
  } = opts;

  let resultHtml = '';

  const crawler = new PlaywrightCrawler({
    proxyConfiguration,

    browserPoolOptions: {
      useFingerprints: true,
      fingerprintOptions: {
        fingerprintGeneratorOptions: {
          // Prefer Chrome on desktop with RU locales to look natural for this site
          browsers: [{ name: 'chrome', minVersion: 100 }],
          devices: ['desktop'],
          operatingSystems: ['windows', 'macos'],
          locales: ['ru-RU', 'ru'],
        },
      },
    },

    launchContext: {
      launcher: chromium,
      launchOptions: {
        headless,
        // slowMo: 50, // uncomment for debugging
      },
      // browserContextOptions (locale/timezone) are auto-aligned with fingerprints;
      // additionally we set Accept-Language header in preNavigationHook below.
    },

    navigationTimeoutSecs: Math.ceil(timeoutMs / 1000),

    preNavigationHooks: [
      async ({ page }, goToOptions) => {
        // Emulate Russian locale preference
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        });
        // Ensure we wait for substantial network activity to settle
        goToOptions.waitUntil = 'load';
      },
    ],

    async requestHandler({ page, request, response, log }) {
      // Basic load states
      try { await page.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch (_) {}
      try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch (_) {}

      // Wait for common JS challenge indicators to disappear
      const challengeGone = await page.waitForFunction(() => {
        const text = document.body?.innerText || '';
        const html = document.documentElement?.outerHTML || '';
        const hasCloudflare = /checking your browser|verify you are human|attention required/i.test(text) ||
          !!document.querySelector('[class*="cf-"], [id*="cf-"], form#challenge-form, #cf-challenge-running');
        const hasSucuri = /sucuri/i.test(text) || !!document.querySelector('script[src*="sucuri"], input[name="sucuri_cloudproxy_js"]');
        const hasPerimeterX = /perimeterx|px-captcha|_px/i.test(html);
        const hasDistil = /distil|dstl/i.test(html) || !!document.querySelector('script[src*="distil"]');
        return !(hasCloudflare || hasSucuri || hasPerimeterX || hasDistil);
      }, { timeout: 20000 }).catch(() => false);
      if (!challengeGone) log.debug?.('Challenge indicators not detected or timeout — continuing.');

      // Optionally wait for a specific selector (caller-specified), else wait for key site areas
      if (waitForSelector) {
        try { await page.waitForSelector(waitForSelector, { timeout: 15000 }); } catch (e) { log.debug?.(`waitForSelector timeout: ${waitForSelector}`); }
      } else {
        // MirCli homepage contains prominent navigation and product blocks
        const fallbacks = ['header', 'main', '#page', '.menu', '.block-products', '#catalog'];
        for (const sel of fallbacks) {
          try { await page.waitForSelector(sel, { timeout: 3000 }); break; } catch (_) {}
        }
      }

      // Close potential subscription modal if it blocks rendering interactions (best-effort)
      try {
        const closeBtn = await page.$('text=×, [aria-label="Close"], .fancybox-close, .modal .close');
        if (closeBtn) await closeBtn.click().catch(() => {});
      } catch (_) {}

      // Final network idle grace period
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch (_) {}

      resultHtml = await page.content();
    },

    async failedRequestHandler({ request, log }) {
      log.error(`Failed to fetch ${request.url}`);
    },

    maxRequestRetries: 2,
  }, new Configuration({ persistStorage: false }));

  await crawler.run([{ url }]);

  if (!resultHtml) throw new Error('Failed to retrieve HTML from mircli.ru');
  return resultHtml;
}
