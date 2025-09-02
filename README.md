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

Note: The server (`npm start`) currently reads proxies only from `PROXY_URLS`.

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
