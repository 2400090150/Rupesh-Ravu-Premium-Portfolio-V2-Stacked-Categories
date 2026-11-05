const { createApp, createVercelFallbackApp } = require('../server');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  module.exports = createVercelFallbackApp();
} else {
  try {
    module.exports = createApp();
  } catch (error) {
    console.error('Portfolio API initialization failed:', error);
    module.exports = createVercelFallbackApp({ storageUnavailable: true });
  }
}
