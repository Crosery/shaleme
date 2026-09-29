import { defineConfig, sessionDrivers } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    remoteBindings: false,
  }),
  // The submission endpoint is a cross-site HTML form POST, so the origin check
  // would reject it. CSRF is handled by the OAuth `state` cookie instead.
  security: {
    checkOrigin: false,
  },
  session: {
    driver: sessionDrivers.null(),
  },
});
