import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createApp } from './app';

const port = Number(process.env.PORT ?? 4000);
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
const { httpServer } = createApp(frontendUrl);
httpServer.listen(port, '127.0.0.1', () => {
  console.log(`The Great Secret Unlock backend listening on http://localhost:${port}`);
  console.log('Game state is stored in memory and will be cleared when the backend stops.');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => httpServer.close(() => process.exit(0)));
}
