'use strict';
// Zero-dependency static file server for the MICRONS marketing site.
// Serves this folder, maps "/" -> index.html, and returns 404.html (status 404)
// for anything missing. Designed for Railway / any Node host.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': status === 200 ? 'public, max-age=3600' : 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

const CANONICAL_HOST = 'www.micronsai.com';

const server = http.createServer((req, res) => {
  try {
    // redirect the bare apex to the canonical www host (only for the real domain)
    const host = (req.headers.host || '').toLowerCase();
    if (host === 'micronsai.com') {
      res.writeHead(301, { Location: `https://${CANONICAL_HOST}${req.url || '/'}` });
      return res.end();
    }
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    if (urlPath.endsWith('/')) urlPath += 'index.html';

    let filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');

    if (!fs.existsSync(filePath) && !path.extname(filePath)) {
      const asHtml = filePath + '.html';
      if (fs.existsSync(asHtml)) filePath = asHtml;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return send(res, 200, fs.readFileSync(filePath), type);
    }

    const notFound = path.join(ROOT, '404.html');
    if (fs.existsSync(notFound)) {
      return send(res, 404, fs.readFileSync(notFound), TYPES['.html']);
    }
    return send(res, 404, 'Not found');
  } catch (err) {
    return send(res, 500, 'Server error');
  }
});

server.listen(PORT, () => console.log(`MICRONS site on :${PORT}`));
