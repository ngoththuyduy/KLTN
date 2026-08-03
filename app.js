import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env using absolute paths for Plesk / Phusion Passenger compatibility
dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.PORT = process.env.PORT || '6612';

// Import compiled ESM backend bundle from dist/server.js
const serverModule = await import('./dist/server.js');
const app = serverModule.app || serverModule.default || serverModule;

if (process.argv[1] && (process.argv[1].endsWith('app.js') || process.argv[1].endsWith('app.cjs'))) {
  await serverModule.startServer();
}

export default app;
