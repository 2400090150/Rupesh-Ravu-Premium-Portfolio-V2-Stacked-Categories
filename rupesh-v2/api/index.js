const { createApp, createVercelFallbackApp } = require('../server');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

module.exports = supabaseUrl && supabaseKey ? createApp() : createVercelFallbackApp();
