/**
 * `npm run reset-admin`: forgets the organiser password and prints a new
 * setup QR code. Works under a running server, which reads the file on every
 * login. In Docker: `docker compose exec rally-server node
 * apps/rally-server/dist/reset-admin.js`.
 */
import {
  ensureSetupToken,
  organiserFile,
  setupInstructions,
} from './modules/auth/organiser';

void setupInstructions(ensureSetupToken(true)).then((text) => {
  console.log(text);
  console.log(`(${organiserFile()})`);
});
