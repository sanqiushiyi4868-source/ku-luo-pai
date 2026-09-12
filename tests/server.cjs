const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/ku-luo-pai\//, '/');
    const file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
        if (error) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
    });
});
module.exports = server;
if (require.main === module) server.listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173/ku-luo-pai/'));
