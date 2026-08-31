const { defineConfig } = require('playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45_000,
  fullyParallel: true,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
});
