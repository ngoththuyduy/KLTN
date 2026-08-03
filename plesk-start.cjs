const fs = require('fs');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const dotenv = require('dotenv');

const rootDir = __dirname;
const port = Number(process.env.PORT || '6612');

dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(rootDir, '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.PORT = String(port);

function startDiagnosticServer(error) {
  const message = error && error.stack ? error.stack : String(error || 'Unknown startup error');
  console.error('[Plesk Start] Failed to start backend:', message);

  http.createServer((req, res) => {
    const payload = {
      status: 'startup_error',
      message: 'Backend could not start. Check this JSON and Passenger logs.',
      rootDir,
      node: process.version,
      port,
      distServerExists: fs.existsSync(path.join(rootDir, 'dist', 'server.js')),
      error: message
    };

    res.statusCode = req.url && req.url.startsWith('/api/health') ? 500 : 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload, null, 2));
  }).listen(port, '0.0.0.0', () => {
    console.log(`[Plesk Start] Diagnostic server listening on port ${port}`);
  });
}

(async () => {
  try {
    const serverPath = path.join(rootDir, 'dist', 'server.js');
    if (!fs.existsSync(serverPath)) {
      throw new Error(`Missing production backend bundle: ${serverPath}. Run npm install && npm run build on the host.`);
    }

    const serverModule = await import(pathToFileURL(serverPath).href);
    if (typeof serverModule.startServer !== 'function') {
      throw new Error('dist/server.js does not export startServer(). Rebuild the project.');
    }

    await serverModule.startServer();
  } catch (error) {
    startDiagnosticServer(error);
  }
})();
