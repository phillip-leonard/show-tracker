// @ts-check
'use strict';

const testConfig = {
  // Base URL for the app under test
  baseUrl: process.env.TEST_BASE_URL || 'https://mysetlists.net',

  // Netlify functions base
  functionsUrl: process.env.TEST_BASE_URL
    ? `${process.env.TEST_BASE_URL}/.netlify/functions`
    : 'https://mysetlists.net/.netlify/functions',

  // Environment: 'local' | 'staging' | 'production'
  env: process.env.ENVIRONMENT || 'production',

  // Test data prefix — all test-created records use this prefix so cleanup
  // can identify and delete them without touching real user data.
  testPrefix: 'test-',

  // Timeouts
  defaultTimeout: 30000,
  integrationTimeout: 60000,
  deployBlockTimeout: 300000, // 5 min for full suite

  // Test credentials — throwaway accounts used only for automated testing.
  // TEST_USER_PASSWORD must be set; email is stable so a pre-existing account
  // can be reused across runs (signup is idempotent for the smoke test).
  testUserEmail: process.env.TEST_EMAIL || null,
  testUserPassword: process.env.TEST_PASSWORD || null,

  // Optional second test account for social tests (friend-tagging, etc.)
  testUser2Email: process.env.TEST_EMAIL_2 || null,
  testUser2Password: process.env.TEST_PASSWORD_2 || null,

  // Notion reporting
  notionApiKey: process.env.NOTION_API_KEY || null,
  notionTestDatabaseId: process.env.NOTION_TEST_DATABASE_ID || null,

  // External API keys (for connectivity pre-checks)
  setlistFmApiKey: process.env.SETLISTFM_API_KEY || null,
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || null,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  resendApiKey: process.env.RESEND_API_KEY || null,
};

module.exports = { testConfig };
