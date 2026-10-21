import { createAppServer } from './app.mjs';
import { config } from './config.mjs';

const server = createAppServer();
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Recognition API listening on http://0.0.0.0:${config.port}`);
});
