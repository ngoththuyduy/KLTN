import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Explicitly load .env using absolute paths for Plesk / Phusion Passenger compatibility
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Import compiled CommonJS backend bundle from dist/server.cjs
const serverModule = require('./dist/server.cjs');
const app = serverModule.app || serverModule.default || serverModule;

const PORT = Number(process.env.PORT) || 6612;

if (process.argv[1] && (process.argv[1].endsWith('app.js') || process.argv[1].endsWith('app.cjs'))) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Plesk/Production] Express server listening on port ${PORT}`);
  });
}

export default app;
