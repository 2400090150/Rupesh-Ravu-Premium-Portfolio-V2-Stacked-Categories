const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { getDatabase } = require('../server');

const ROOT = path.join(__dirname, '..');
const BUCKET = 'portfolio-assets';
const TABLES = [
  ['categories', 'slug'],
  ['internal_sections', 'id'],
  ['site_settings', 'key'],
  ['admin_credentials', 'key'],
  ['designs', 'id'],
  ['featured_designs', 'category_slug,position'],
  ['certificates', 'id'],
  ['tools', 'id'],
  ['custom_home_sections', 'id']
];
const ASSET_COLUMNS = [
  ['designs', 'image_url'],
  ['certificates', 'file_url'],
  ['tools', 'image_url'],
  ['site_settings', 'value']
];
const CONTENT_TYPES = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function assertResult(result) {
  if (result.error) throw new Error(result.error.message || 'Supabase migration request failed.');
}

function localUploadFilename(url) {
  try {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.origin !== 'http://localhost' || !parsed.pathname.startsWith('/uploads/')) return null;
    const filename = decodeURIComponent(parsed.pathname.slice('/uploads/'.length));
    return /^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(filename) ? filename : null;
  } catch {
    return null;
  }
}

function normalizeRow(table, row) {
  if (['categories', 'tools', 'custom_home_sections'].includes(table)) {
    return { ...row, visible: Boolean(row.visible) };
  }
  return row;
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before migration.');

  const localDatabase = getDatabase();
  const cloud = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const records = new Map(TABLES.map(([table]) => [
    table, localDatabase.prepare(`SELECT * FROM "${table}"`).all()
  ]));
  const assetUrls = new Set(ASSET_COLUMNS.flatMap(([table, column]) =>
    records.get(table).map(row => row[column]).filter(url => localUploadFilename(url))));
  const uploadedUrls = new Map();

  for (const url of assetUrls) {
    const filename = localUploadFilename(url);
    const filePath = path.join(ROOT, 'uploads', filename);
    if (!fs.existsSync(filePath)) throw new Error(`Referenced local upload is missing: ${filename}`);
    const extension = path.extname(filename).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) throw new Error(`Unsupported upload file type during migration: ${extension}`);
    const result = await cloud.storage.from(BUCKET).upload(filename, fs.readFileSync(filePath), {
      contentType, cacheControl: '31536000', upsert: true
    });
    assertResult(result);
    const publicUrl = cloud.storage.from(BUCKET).getPublicUrl(filename).data?.publicUrl;
    if (!publicUrl) throw new Error(`Supabase did not return a public URL for ${filename}.`);
    uploadedUrls.set(url, publicUrl);
  }

  for (const [table, column] of ASSET_COLUMNS) {
    records.set(table, records.get(table).map(row => uploadedUrls.has(row[column])
      ? { ...row, [column]: uploadedUrls.get(row[column]) }
      : row));
  }
  for (const [table, onConflict] of TABLES) {
    const rows = records.get(table).map(row => normalizeRow(table, row));
    if (!rows.length) continue;
    const result = await cloud.from(table).upsert(rows, { onConflict });
    assertResult(result);
    console.log(`Migrated ${rows.length} ${table} record(s).`);
  }
  console.log(`Migrated ${uploadedUrls.size} uploaded asset(s) to Supabase Storage.`);
}

main().catch(error => {
  console.error(`Supabase migration failed: ${error.message}`);
  process.exitCode = 1;
});
