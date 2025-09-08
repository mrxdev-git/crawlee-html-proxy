# HTML Proxy API

A Node.js application that serves a small API with a single endpoint `/fetch` which fetches the actual HTML content of any valid URL. The API uses the Crawlee JavaScript library with advanced anti-detection capabilities and supports proxy rotation to avoid detection as an automated script.

## Features

- **Anti-detection capabilities**: Uses Crawlee's browser fingerprinting to mimic real browser behavior
- **Proxy rotation**: Supports rotating through multiple proxy servers to avoid IP blocking
- **Session management**: Automatically manages browser sessions for better scraping reliability
- **Error handling**: Graceful error handling for invalid URLs and fetch failures

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

### As a Server

Start the server:
```bash
npm start
```

Or for development:
```bash
npm run dev
```

The server will start on port 3000 by default.

Make a GET request to the `/fetch` endpoint with a URL parameter:
```bash
curl "http://localhost:3000/fetch?url=https://example.com"
```

### As a CLI Script

You can also use the application directly from the command line without running the server:
```bash
npm run fetch <url>
```

Or directly with node:
```bash
node cli.js <url>
```

Example:
```bash
node cli.js https://mircli.ru
```

## Specialized Scraper: mircli.ru

This project includes a specialized scraper for the site https://mircli.ru/ that better mimics a real browser and handles the site's first-visit JavaScript challenges/popups.

- The specialized scraper lives in `scrapers/mircli.js` and uses Crawlee's `PlaywrightCrawler` with Chrome-like fingerprints and Russian locale headers.
- The server and CLI automatically route requests to this specialized scraper when the request URL's hostname ends with `mircli.ru`.

### Server Usage (auto-routed)

```bash
# Basic
curl "http://localhost:3000/fetch?url=https://mircli.ru/"

# Optional: wait for a specific selector before returning HTML
curl "http://localhost:3000/fetch?url=https://mircli.ru/&waitForSelector=main"

# Optional: adjust timeout (ms)
curl "http://localhost:3000/fetch?url=https://mircli.ru/&timeoutMs=60000"
```

Environment variables affecting the specialized scraper:

- `MIRCLI_HEADLESS` — Set to `false` to run headful (default is headless). Example: `MIRCLI_HEADLESS=false npm start`
- `MIRCLI_TIMEOUT_MS` — Default overall timeout for CLI (server uses `timeoutMs` query param)

The server also continues to support `PROXY_URLS` and `PROXY_FILE` for proxy rotation. These are applied to the specialized scraper as well.

### CLI Usage (auto-routed)

```bash
# Basic
node cli.js https://mircli.ru/

# Optional: wait for a specific selector
node cli.js https://mircli.ru/ 'main'

# With proxies
PROXY_URLS="http://proxy1:8000,http://proxy2:8000" node cli.js https://mircli.ru/

# Headful for debugging
MIRCLI_HEADLESS=false node cli.js https://mircli.ru/

# Increase timeout
MIRCLI_TIMEOUT_MS=60000 node cli.js https://mircli.ru/
```

### Implementation Notes

- Uses Chrome desktop fingerprints and Russian locales to match site expectations.
- Adds `Accept-Language: ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7` header and waits for `domcontentloaded` and `networkidle` where helpful.
- Contains a best-effort challenge detection loop for common JS challenges (Cloudflare, Sucuri, PerimeterX, Distil) and waits for them to resolve.
- Attempts to close subscription/pop-up modals before capturing the final HTML.

## Proxy Configuration

To use proxy rotation, you have two options:

1. Set the `PROXY_URLS` environment variable with a comma-separated list of proxy URLs
2. Provide a text file with one proxy URL per line (CLI only)

```bash
PROXY_URLS="http://proxy1.com:8000,http://proxy2.com:8000" npm start
```

Or for CLI usage:
```bash
PROXY_URLS="http://proxy1.com:8000,http://proxy2.com:8000" node cli.js <url>
```

### Using a Proxy File (CLI only)

For the CLI (`node cli.js <url>`), you can load proxies from a text file, one per line. Empty lines and lines starting with `#` are ignored. The list from the file is merged with `PROXY_URLS` (with de-duplication):

- Use `PROXY_FILE` to specify a custom path
- If `PROXY_FILE` is not set, the CLI looks for `proxy.txt` in the project root

Examples:

```bash
# Use default proxy.txt (one URL per line)
node cli.js https://example.com

# Use a custom file
PROXY_FILE=./my-proxies.txt node cli.js https://example.com

# Combine with PROXY_URLS (all unique proxies will be used)
PROXY_URLS="http://proxy1:8000" PROXY_FILE=./my-proxies.txt node cli.js https://example.com
```

Server support: The server (`npm start`) also supports loading proxies from `PROXY_FILE` (or default `proxy.txt`) in addition to `PROXY_URLS`. The two sources are merged and de-duplicated.

Examples (server):

```bash
# Using PROXY_URLS only
PROXY_URLS="http://proxy1.com:8000,http://proxy2.com:8000" npm start

# Using default proxy.txt
npm start

# Using a custom file
PROXY_FILE=./my-proxies.txt npm start

# Combine both
PROXY_URLS="http://proxy3:8000" PROXY_FILE=./my-proxies.txt npm start
```

## How It Works

The API uses Crawlee's `PlaywrightCrawler` with the following anti-detection features:

1. **Browser fingerprinting**: Enabled by default to mimic different browsers, operating systems, and devices
2. **Session pool**: Manages browser sessions with rotation to avoid detection
3. **Proxy rotation**: Automatically rotates through provided proxy URLs
4. **Headless browser**: Runs in headless mode for efficiency

## Dependencies

- [Express](https://expressjs.com/) - Web framework
- [Crawlee](https://crawlee.dev/) - Web scraping and browser automation library
- [Playwright](https://playwright.dev/) - Browser automation library

## Configuration

The following environment variables can be used to configure the server:

- `PORT` - Server port (default: 3000)
- `PROXY_URLS` - Comma-separated list of proxy URLs for rotation
- `PERSISTENT_CRAWLER` - Enable persistent crawler mode when set to `true` (default: `false`)

## Persistent Crawler Mode

The server supports two modes of operation:

- Dynamic (default): A new crawler instance is created per request.
- Persistent: A shared crawler instance is used and requests are serialized.

Enable persistent mode by setting the environment variable before starting the server:

```bash
PERSISTENT_CRAWLER=true npm start
```

Usage remains the same:

```bash
curl "http://localhost:3000/fetch?url=https://example.com"
```

Behavior notes in persistent mode:

- Requests are serialized to avoid concurrent runs on the shared crawler.
- After each run, the shared crawler is torn down and re-created on the next request to prevent stale internal queues.
- You can force a fresh crawler for a specific request with `forceReset`:

```bash
curl "http://localhost:3000/fetch?url=https://example.com&forceReset=1"
```

CLI note: `PERSISTENT_CRAWLER` affects the server only. The CLI (`node cli.js <url>`) always runs a single, isolated crawl.

## Admin and Health Endpoints

- Health check:

  ```bash
  curl "http://localhost:3000/health"
  # { "status": "ok", "timestamp": "..." }
  ```

- Reset shared crawler (only meaningful when `PERSISTENT_CRAWLER=true`):

  ```bash
  curl -X POST "http://localhost:3000/admin/reset-crawler"
  # { "ok": true, "message": "Crawler reset" }
  ```
