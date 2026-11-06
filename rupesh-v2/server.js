const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');
const multer = require('multer');

const ROOT = __dirname;
const SESSION_COOKIE = 'ravu_admin';
const SESSION_DURATION = 8 * 60 * 60;
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const MAX_CERTIFICATE_SIZE = 25 * 1024 * 1024;
const STORAGE_BUCKET = 'portfolio-assets';
const CATEGORY_DEFINITIONS = [
  { slug: 'logo-designs', title: 'LOGO DESIGNS', description: 'Identity marks, symbols and visual systems.' },
  { slug: 'product-design', title: 'FOOD & BAVERAGE', description: 'Product-led visuals, objects and presentation concepts.' },
  { slug: 'marketing-branding', title: 'MARKETING & BRANDING', description: 'Campaigns, event visuals and brand communication.' },
  { slug: 'typography', title: 'TYPOGRAPHY', description: 'Type-led compositions and expressive visual studies.' }
];
const CATEGORY_LABELS = Object.fromEntries(CATEGORY_DEFINITIONS.map(category => [category.slug, category.title]));
const MARQUEE_SETTING_BY_SLUG = {
  'logo-designs': 'marqueeLogoDesigns',
  'product-design': 'marqueeProductDesign',
  'marketing-branding': 'marqueeMarketingBranding',
  typography: 'marqueeTypography'
};
const DARK_LOGOS = new Set(['Orbital Systems', 'Synapse Studios 1', 'Synapse Studios', 'Wave Front Media']);
const RAW_CATEGORY_MAP = {
  'baked by beth': 'logo-designs', 'clay making 2': 'marketing-branding', 'elevate co.': 'logo-designs',
  'floura and faouna': 'logo-designs', 'indown.ai 651549052 18043638698726024 3638122456973932506 n': 'marketing-branding',
  'leaf craft': 'marketing-branding', 'nomad travel': 'logo-designs', 'onam banner': 'marketing-branding',
  'orbital systems': 'logo-designs', 'samyak ganesh chaturthii': 'marketing-branding',
  'ethnic day - surabhi': 'marketing-branding', 'main poster - samyak 2025': 'marketing-branding',
  'media pertner': 'marketing-branding', 'flash mob': 'marketing-branding', 'flash mob - femflare': 'marketing-branding',
  'ethnic day': 'marketing-branding', 'ethnic day surabhi': 'marketing-branding', 'carnval': 'marketing-branding',
  '1 day to go - samyak': 'marketing-branding', '1 day to go samyak': 'marketing-branding', 'dj night': 'marketing-branding',
  'dj night femflare': 'marketing-branding', 'femflare brochure': 'marketing-branding',
  'saveinta.com 653403891 18044279126726024 8900326332029412482 n copy (2)': 'marketing-branding',
  'saveinta.com 655064153 18044693678726024 1061128340456383638 n copy (2)': 'marketing-branding',
  'synapse studios 1': 'logo-designs', 'synapse studios': 'logo-designs', 'untitled design (1)': 'typography',
  'porsche 911 gte rs': 'marketing-branding', 'porsche f8 spider': 'typography', 'billie ellish': 'typography',
  'ferrari f1': 'marketing-branding', 'pizza': 'product-design', 'ferrari f1 - speed': 'marketing-branding',
  'ferrari f1 speed': 'marketing-branding', 'screening': 'typography', 'porsche': 'marketing-branding',
  'mocktails': 'product-design', 'typography': 'typography', 'ferrari f8 spider': 'marketing-branding',
  'untitled design copy (2)': 'typography', 'wave front media': 'logo-designs', 'ora coffee': 'logo-designs',
  'package design 1': 'product-design', 'package design 2': 'product-design', 'tug of war': 'marketing-branding',
  'untitled design (10) copy': 'typography', 'untitled design (11) copy': 'typography',
  'main poster samyak 2025': 'marketing-branding'
};
const CATEGORY_MAP = new Map(Object.entries(RAW_CATEGORY_MAP).map(([title, slug]) => [normalizeTitle(title), slug]));
const DEFAULT_CONTENT = {
  heroTitle: 'MAKE\nIT\nSTAY.',
  heroLead: 'Bold visual systems, posters and brand worlds built around typography, contrast and tension.',
  aboutName: 'RUPESH RAVU',
  aboutSummary: 'Graphic designer focused on posters, brand visuals, event identities and visual experimentation.',
  aboutText: 'My work moves between cinematic imagery and stripped-back typography. I like strong contrast, a clear hero, unexpected cropping and compositions that feel considered rather than crowded.',
  contactPhone: '+91 950 251 5671',
  contactEmail: 'ravu.fx@gmail.com',
  contactInstagram: '@ravu.fx',
  headerLogoUrl: '/assets/ravu-fx-logo.png?v=4',
  marqueeLogoDesigns: 'LOGOPHOLIO',
  marqueeProductDesign: 'PACKAGING',
  marqueeMarketingBranding: 'BRANDING',
  marqueeTypography: 'TYPOPHOLIO'
};

function normalizeTitle(title) {
  return String(title || '').toLowerCase().replace(/\.(jpg|jpeg|png|gif|webp)$/i, '')
    .replace(/[_.]+/g, ' ').replace(/[-()]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function validHexColor(value) { return /^#[0-9a-f]{6}$/i.test(value); }
function classifyWork(work) { return CATEGORY_MAP.get(normalizeTitle(work.title)) || 'marketing-branding'; }

function resolveLegacyImage(work, category) {
  if (category === 'logo-designs' && DARK_LOGOS.has(work.title)) {
    if (work.title === 'Wave Front Media') return 'assets/gallery/Wave Front Media dark.png';
    if (work.title === 'Synapse Studios') return work.src;
    return `assets/raw/BCA Id cards/${encodeURIComponent(work.original || '')}`;
  }
  if (category === 'logo-designs') return work.src;
  if (work.original && /\.png$/i.test(work.original)) return `assets/raw/BCA Id cards/${encodeURIComponent(work.original)}`;
  return work.src;
}

function createError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function fail(result) {
  if (result.error) {
    const error = new Error(result.error.message || 'Database request failed.');
    error.code = result.error.code;
    error.status = result.error.status;
    throw error;
  }
  return result.data;
}

function isTransientStorageError(error) {
  const status = Number(error.status);
  return error instanceof TypeError || status === 429 || status >= 500 ||
    /fetch failed|network error|timed out|connection (?:reset|closed)|econnreset|econnrefused|etimedout|eai_again/i
      .test(`${error.message} ${error.code || ''}`);
}

async function initializeWithRetry(client, delay = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds))) {
  for (let attempt = 0; ; attempt++) {
    try {
      await initialize(client);
      return;
    } catch (error) {
      if (!isTransientStorageError(error) || attempt >= 4) throw error;
      console.warn(`Portfolio storage initialization attempt ${attempt + 1} failed; retrying.`);
      await delay(200 * (attempt + 1));
    }
  }
}

function createRetryingFetch(fetchImplementation = globalThis.fetch, delay = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds))) {
  return async (input, init) => {
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const retrySafe = method === 'GET' || method === 'HEAD';
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetchImplementation(input, init);
        if (retrySafe && attempt < 4 && (response.status === 429 || response.status >= 500)) {
          await response.body?.cancel();
          await delay(100 * (attempt + 1));
          continue;
        }
        return response;
      } catch (error) {
        if (!retrySafe || attempt >= 2) throw error;
        await delay(100 * (attempt + 1));
      }
    }
  };
}

const SQLITE_SCHEMA = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS categories (
    slug TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS internal_sections (
    id TEXT PRIMARY KEY, category_slug TEXT NOT NULL REFERENCES categories(slug) ON DELETE CASCADE,
    title TEXT NOT NULL, position INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS designs (
    id TEXT PRIMARY KEY, category_slug TEXT NOT NULL REFERENCES categories(slug),
    title TEXT NOT NULL, description TEXT NOT NULL, image_url TEXT NOT NULL,
    position INTEGER NOT NULL, created_at TEXT NOT NULL,
    display_background_color TEXT NOT NULL DEFAULT '#ffffff',
    section_id TEXT REFERENCES internal_sections(id) ON DELETE SET NULL
  );
  CREATE TABLE IF NOT EXISTS featured_designs (
    category_slug TEXT NOT NULL REFERENCES categories(slug) ON DELETE CASCADE,
    design_id TEXT NOT NULL UNIQUE REFERENCES designs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, PRIMARY KEY(category_slug, position)
  );
  CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS admin_credentials (
    key TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT 'ravu.fx@gmail.com'
  );
  CREATE TABLE IF NOT EXISTS certificates (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
    file_url TEXT NOT NULL, file_type TEXT NOT NULL, position INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tools (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL, visible INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS custom_home_sections (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL
  );
`;

const SQLITE_TABLES = new Set([
  'categories', 'internal_sections', 'designs', 'featured_designs', 'site_settings', 'admin_credentials',
  'certificates', 'tools', 'custom_home_sections'
]);
const SQLITE_PRIMARY_KEYS = {
  categories: ['slug'],
  site_settings: ['key'],
  featured_designs: ['category_slug', 'position']
};
let database;

function getDatabase() {
  if (database) return database;
  const dataDirectory = process.env.PORTFOLIO_DATA_DIR || path.join(ROOT, '.data');
  const databasePath = process.env.PORTFOLIO_DB_PATH || path.join(dataDirectory, 'portfolio.sqlite');
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec(SQLITE_SCHEMA);
  const designColumns = database.prepare('PRAGMA table_info("designs")').all();
  if (!designColumns.some(column => column.name === 'section_id')) {
    database.exec('ALTER TABLE designs ADD COLUMN section_id TEXT REFERENCES internal_sections(id) ON DELETE SET NULL');
  }
  return database;
}

function quoteIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) throw new Error('Invalid database identifier.');
  return `"${identifier}"`;
}

function sqliteError(error) {
  return {
    message: error.message,
    code: error.code?.startsWith('SQLITE_CONSTRAINT') ? '23505' : error.code
  };
}

function normalizeSQLiteValue(value) {
  return typeof value === 'boolean' ? Number(value) : value;
}

class SQLiteQuery {
  constructor(database, table) {
    if (!SQLITE_TABLES.has(table)) throw new Error('Unknown database table.');
    this.database = database;
    this.table = table;
    this.action = 'select';
    this.values = [];
    this.filters = [];
    this.orders = [];
    this.returning = null;
    this.singleResult = null;
    this.rows = null;
    this.options = {};
  }

  select(columns = '*') {
    this.returning = columns.split(',').map(column => column.trim()).join(', ');
    for (const column of this.returning.split(',').map(column => column.trim())) {
      if (column !== '*') quoteIdentifier(column);
    }
    return this;
  }

  insert(rows) {
    this.action = 'insert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows, options = {}) {
    this.action = 'upsert';
    this.rows = Array.isArray(rows) ? rows : [rows];
    this.options = options;
    return this;
  }

  update(row) {
    this.action = 'update';
    this.values = row;
    return this;
  }

  delete() {
    this.action = 'delete';
    return this;
  }

  eq(column, value) { return this.filter(column, '=', value); }
  neq(column, value) { return this.filter(column, '!=', value); }

  in(column, values) {
    quoteIdentifier(column);
    if (!Array.isArray(values)) throw new Error('Database IN filter requires an array.');
    this.filters.push({ column, operator: 'IN', value: values });
    return this;
  }

  filter(column, operator, value) {
    quoteIdentifier(column);
    this.filters.push({ column, operator, value });
    return this;
  }

  order(column) {
    quoteIdentifier(column);
    this.orders.push(column);
    return this;
  }

  limit(count) {
    if (!Number.isInteger(count) || count < 0) throw new Error('Database limit must be a non-negative integer.');
    this.limitCount = count;
    return this;
  }

  single() { return this.execute('single'); }
  maybeSingle() { return this.execute('maybeSingle'); }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute(singleResult = null) {
    try {
      const data = this.run();
      if (singleResult === 'single') {
        if (data.length !== 1) throw Object.assign(new Error('Expected exactly one database row.'), { code: 'PGRST116' });
        return { data: data[0], error: null };
      }
      if (singleResult === 'maybeSingle') {
        if (data.length > 1) throw Object.assign(new Error('Expected at most one database row.'), { code: 'PGRST116' });
        return { data: data[0] || null, error: null };
      }
      return { data: this.action === 'select' || this.returning ? data : null, error: null };
    } catch (error) {
      return { data: null, error: sqliteError(error) };
    }
  }

  run() {
    const table = quoteIdentifier(this.table);
    if (this.action === 'select') return this.selectRows(table);
    if (this.action === 'insert' || this.action === 'upsert') return this.writeRows(table);
    if (this.action === 'update') return this.updateRows(table);
    this.deleteRows(table);
    return [];
  }

  whereClause() {
    const values = [];
    const clauses = this.filters.map(({ column, operator, value }) => {
      if (operator === 'IN') {
        if (!value.length) return '0';
        values.push(...value.map(normalizeSQLiteValue));
        return `${quoteIdentifier(column)} IN (${value.map(() => '?').join(', ')})`;
      }
      values.push(normalizeSQLiteValue(value));
      return `${quoteIdentifier(column)} ${operator} ?`;
    });
    return { clause: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', values };
  }

  selectRows(table, extraWhere = null) {
    const columns = this.returning || '*';
    const { clause, values } = this.whereClause();
    const order = this.orders.length ? ` ORDER BY ${this.orders.map(quoteIdentifier).join(', ')}` : '';
    const limit = this.limitCount === undefined ? '' : ` LIMIT ${this.limitCount}`;
    return this.database.prepare(`SELECT ${columns} FROM ${table}${extraWhere || clause}${order}${limit}`)
      .all(...values);
  }

  writeRows(table) {
    const rows = this.rows || [];
    if (!rows.length) return [];
    const conflict = this.action === 'upsert' && this.options.onConflict
      ? String(this.options.onConflict).split(',').map(column => quoteIdentifier(column.trim())).join(', ')
      : null;
    const statements = rows.map(row => {
      const columns = Object.keys(row);
      if (!columns.length) throw new Error('Cannot insert an empty database row.');
      const names = columns.map(quoteIdentifier).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      let suffix = '';
      if (conflict) {
        suffix = this.options.ignoreDuplicates ? ` ON CONFLICT (${conflict}) DO NOTHING`
          : ` ON CONFLICT (${conflict}) DO UPDATE SET ${columns
            .filter(column => !conflict.includes(quoteIdentifier(column)))
            .map(column => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`).join(', ')}`;
      }
      return {
        sql: `INSERT INTO ${table} (${names}) VALUES (${placeholders})${suffix}`,
        values: columns.map(column => normalizeSQLiteValue(row[column]))
      };
    });
    this.transaction(statements);
    if (!this.returning) return [];
    return rows.flatMap(row => {
      const keyColumns = SQLITE_PRIMARY_KEYS[this.table] || ['id'];
      const where = keyColumns.map(column => `${quoteIdentifier(column)} = ?`).join(' AND ');
      const keyValues = keyColumns.map(column => row[column]);
      return this.database.prepare(`SELECT ${this.returning} FROM ${table} WHERE ${where}`)
        .all(...keyValues);
    });
  }

  updateRows(table) {
    const columns = Object.keys(this.values || {});
    if (!columns.length) throw new Error('Cannot update an empty database row.');
    const { clause, values } = this.whereClause();
    const set = columns.map(column => `${quoteIdentifier(column)} = ?`).join(', ');
    this.database.prepare(`UPDATE ${table} SET ${set}${clause}`)
      .run(...columns.map(column => normalizeSQLiteValue(this.values[column])), ...values);
    return this.returning ? this.selectRows(table) : [];
  }

  deleteRows(table) {
    if (!this.filters.length) throw new Error('Refusing to delete database rows without a filter.');
    const { clause, values } = this.whereClause();
    this.database.prepare(`DELETE FROM ${table}${clause}`).run(...values);
  }

  transaction(statements) {
    this.database.exec('BEGIN');
    try {
      for (const statement of statements) {
        this.database.prepare(statement.sql).run(...statement.values);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function createLocalClient(database, uploadDirectory) {
  return {
    from: table => new SQLiteQuery(database, table),
    storage: {
      from: () => ({
        upload: async (filename, buffer) => {
          try {
            fs.mkdirSync(uploadDirectory, { recursive: true });
            fs.writeFileSync(path.join(uploadDirectory, filename), buffer, { flag: 'wx' });
            return { data: { path: filename }, error: null };
          } catch (error) {
            return { data: null, error: sqliteError(error) };
          }
        },
        getPublicUrl: filename => ({ data: { publicUrl: `/uploads/${encodeURIComponent(filename)}` } }),
        remove: async filenames => {
          try {
            for (const filename of filenames) {
              if (path.basename(filename) !== filename) throw new Error('Invalid uploaded asset path.');
              try { fs.unlinkSync(path.join(uploadDirectory, filename)); } catch (error) {
                if (error.code !== 'ENOENT') throw error;
              }
            }
            return { data: filenames, error: null };
          } catch (error) {
            return { data: null, error: sqliteError(error) };
          }
        }
      })
    }
  };
}

async function select(client, table, columns = '*', configure = query => query) {
  return fail(await configure(client.from(table).select(columns)));
}

async function one(client, table, configure) {
  return fail(await configure(client.from(table).select('*')).maybeSingle());
}

async function insertOne(client, table, row, columns = '*') {
  return fail(await client.from(table).insert(row).select(columns).single());
}

async function updateOne(client, table, id, row, columns = '*') {
  return fail(await client.from(table).update(row).eq('id', id).select(columns).single());
}

async function initialize(client) {
  const existingCategories = new Set((await select(client, 'categories', 'slug')).map(category => category.slug));
  const missingCategories = CATEGORY_DEFINITIONS.filter(category => !existingCategories.has(category.slug));
  if (missingCategories.length) {
    fail(await client.from('categories').upsert(missingCategories.map(category => ({
      ...category, visible: true, sort_order: CATEGORY_DEFINITIONS.indexOf(category)
    })), { onConflict: 'slug', ignoreDuplicates: true }));
  }
  fail(await client.from('categories').update({ title: 'FOOD & BAVERAGE' })
    .eq('slug', 'product-design').eq('title', 'PRODUCT DESIGN'));
  const existingSettings = new Set((await select(client, 'site_settings', 'key')).map(setting => setting.key));
  const missingSettings = Object.entries(DEFAULT_CONTENT)
    .filter(([key]) => !existingSettings.has(key))
    .map(([key, value]) => ({ key, value }));
  if (missingSettings.length) {
    fail(await client.from('site_settings').upsert(missingSettings, { onConflict: 'key', ignoreDuplicates: true }));
  }
  const existing = await select(client, 'designs', 'id', query => query.limit(1));
  if (existing.length === 0) await seedLegacyDesigns(client);
  for (const category of CATEGORY_DEFINITIONS) await ensureFeaturedDesigns(client, category.slug);
}

async function seedLegacyDesigns(client) {
  const designs = buildLegacyDesigns();
  if (designs.length) fail(await client.from('designs').insert(designs));
}

function buildLegacyDesigns() {
  const legacyWorks = JSON.parse(fs.readFileSync(path.join(ROOT, 'works.json'), 'utf8'));
  const extras = [
    { title: 'ORA Coffee', description: 'A coffee identity and logo design.', src: 'assets/gallery/ORA%20(2).png' },
    { title: 'Package Design 1', description: 'Product packaging design from the original portfolio.', src: 'assets/gallery/Package%20design%201.png' },
    { title: 'Package Design 2', description: 'Product packaging design from the original portfolio.', src: 'assets/gallery/Package%20design%202.png' },
    { title: 'Tug of War', description: 'A campaign poster from the original portfolio.', src: 'assets/gallery/TUG%20OF%20WAR.jpeg' }
  ];
  const positions = Object.fromEntries(CATEGORY_DEFINITIONS.map(category => [category.slug, 0]));
  const createdAt = new Date().toISOString();
  const designs = [...legacyWorks.map(work => {
    const category = classifyWork(work);
    return {
      id: crypto.randomUUID(), category_slug: category, title: String(work.title || 'Untitled design').trim(),
      description: `${CATEGORY_LABELS[category]} from the original Ravu.FX portfolio.`,
      image_url: resolveLegacyImage(work, category), display_background_color: '#ffffff',
      position: positions[category]++, created_at: createdAt
    };
  }), ...extras.map(work => {
    const category = classifyWork(work);
    return {
      id: crypto.randomUUID(), category_slug: category, title: work.title, description: work.description,
      image_url: work.src, display_background_color: '#ffffff', position: positions[category]++, created_at: createdAt
    };
  })];
  return designs;
}

async function ensureFeaturedDesigns(client, category, initialCount = 4) {
  const designs = await select(client, 'designs', 'id', query =>
    query.eq('category_slug', category).order('position').order('created_at').order('id'));
  const available = designs.map(row => row.id);
  const rows = await select(client, 'featured_designs', 'design_id,position', query =>
    query.eq('category_slug', category).order('position'));
  const existing = rows.filter(row => available.includes(row.design_id));
  if (existing.length) return;
  const featured = available.slice(0, Math.min(initialCount, available.length));
  if (featured.length) fail(await client.from('featured_designs').upsert(
    featured.map((design_id, position) => ({ category_slug: category, design_id, position })),
    { onConflict: 'category_slug,position', ignoreDuplicates: true }
  ));
}

async function getContent(client) {
  const content = { ...DEFAULT_CONTENT };
  const rows = await select(client, 'site_settings', 'key,value');
  for (const row of rows) if (Object.hasOwn(content, row.key)) content[row.key] = row.value;
  return content;
}

async function getCategories(client) {
  const content = await getContent(client);
  return (await select(client, 'categories', 'slug,title,description,visible,sort_order',
    query => query.order('sort_order'))).map(({ sort_order, ...category }) => ({
    ...category, visible: Boolean(category.visible),
    marqueeText: content[MARQUEE_SETTING_BY_SLUG[category.slug]] || category.title
  }));
}

async function getCustomSections(client) {
  return (await select(client, 'custom_home_sections', 'id,title,description,visible,position',
    query => query.order('position').order('id'))).map(section => ({ ...section, visible: Boolean(section.visible) }));
}

function designForApi(row, featured = false) {
  return {
    id: row.id, category: row.category_slug, title: row.title, description: row.description,
    image: row.image_url, displayBackgroundColor: row.display_background_color || '#ffffff',
    position: row.position, createdAt: row.created_at, featured,
    sectionId: row.section_id || null, sectionTitle: row.section_title || null
  };
}

async function getDesigns(client, category) {
  const [designs, featured, sections] = await Promise.all([
    select(client, 'designs', '*', query => query.eq('category_slug', category)
      .order('position').order('created_at').order('id')),
    select(client, 'featured_designs', 'design_id', query => query.eq('category_slug', category)),
    select(client, 'internal_sections', 'id,title', query => query.eq('category_slug', category))
  ]);
  const featuredIds = new Set(featured.map(row => row.design_id));
  const sectionTitles = new Map(sections.map(section => [section.id, section.title]));
  return designs.map(row => designForApi({
    ...row, section_title: sectionTitles.get(row.section_id) || null
  }, featuredIds.has(row.id)));
}

async function getInternalSections(client, category, categoryDesigns = getDesigns(client, category)) {
  const [sections, designs] = await Promise.all([
    select(client, 'internal_sections', 'id,category_slug,title,position',
      query => query.eq('category_slug', category).order('position').order('id')),
    categoryDesigns
  ]);
  return sections.map(section => ({
    id: section.id, category: section.category_slug, title: section.title, position: section.position,
    designs: designs.filter(design => design.sectionId === section.id)
  }));
}

async function getDesignLibrary(client, category) {
  const [rows, featured, sections] = await Promise.all([
    select(client, 'designs', '*', query => query.eq('category_slug', category)
      .order('position').order('created_at').order('id')),
    select(client, 'featured_designs', 'design_id', query => query.eq('category_slug', category)),
    select(client, 'internal_sections', 'id,category_slug,title,position',
      query => query.eq('category_slug', category).order('position').order('id'))
  ]);
  const featuredIds = new Set(featured.map(row => row.design_id));
  const sectionTitles = new Map(sections.map(section => [section.id, section.title]));
  const designs = rows.map(row => designForApi({
    ...row, section_title: sectionTitles.get(row.section_id) || null
  }, featuredIds.has(row.id)));
  return {
    designs,
    sections: sections.map(section => ({
      id: section.id, category: section.category_slug, title: section.title, position: section.position,
      designs: designs.filter(design => design.sectionId === section.id)
    }))
  };
}

async function findSection(client, sectionId) {
  return one(client, 'internal_sections', query => query.eq('id', sectionId));
}

function validateSectionTitle(value) {
  return requireText(value, 'Subsection title', 80);
}

async function validateSectionForCategory(client, sectionId, category) {
  if (sectionId === null || sectionId === undefined || sectionId === '') return null;
  if (typeof sectionId !== 'string') throw createError(400, 'Choose a valid subsection.');
  const section = await findSection(client, sectionId);
  if (!section || section.category_slug !== category) {
    throw createError(400, 'Choose a subsection within the selected design category.');
  }
  return section;
}

function requireText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw createError(400, `${field} is required.`);
  const text = value.trim();
  if (text.length > maxLength) throw createError(400, `${field} must be ${maxLength} characters or fewer.`);
  return text;
}

function validateEmail(value) {
  const email = requireText(value, 'Admin email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError(400, 'Enter a valid admin email address.');
  return email;
}

function validateCertificateUrl(value) {
  try {
    if (!/^https:\/\//i.test(value)) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error();
  } catch {
    throw createError(400, 'Certificate links must use HTTPS.');
  }
  return value;
}

function validCategory(category) { return CATEGORY_DEFINITIONS.some(definition => definition.slug === category); }

function passwordHash(password, salt = crypto.randomBytes(16)) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derived) =>
    error ? reject(error) : resolve({ salt: salt.toString('hex'), password_hash: derived.toString('hex') })));
}

async function verifyPassword(password, credential) {
  if (password.length > 200) return false;
  const { password_hash } = await passwordHash(password, Buffer.from(credential.salt, 'hex'));
  const expected = Buffer.from(credential.password_hash, 'hex');
  const actual = Buffer.from(password_hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sniffImage(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      buffer.toString('ascii', 12, 16) === 'IHDR' && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0) return '.png';
  if (buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 &&
      buffer[buffer.length - 2] === 255 && buffer[buffer.length - 1] === 217) return '.jpg';
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.readUInt32LE(4) + 8 <= buffer.length) return '.webp';
  return null;
}

function sanitizeSvg(buffer) {
  const svg = buffer.toString('utf8');
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(svg) ||
      /<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed|audio|video)\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:|javascript:)|url\s*\(\s*["']?\s*(?:https?:|\/\/|data:|javascript:)/i.test(svg)) {
    throw createError(415, 'SVG logos must be self-contained artwork without scripts or external resources.');
  }
}

function inspectUpload(file, kind) {
  if (!file) return null;
  const imageExtension = sniffImage(file.buffer);
  if (kind === 'certificate') {
    if (imageExtension === '.png' || imageExtension === '.jpg') return { extension: imageExtension, type: imageExtension.slice(1) };
    if (file.buffer.length >= 8 && file.buffer.toString('ascii', 0, 5) === '%PDF-') return { extension: '.pdf', type: 'pdf' };
    throw createError(415, 'Certificates must be genuine PDF, PNG, or JPG files.');
  }
  if (imageExtension) return { extension: imageExtension, type: imageExtension === '.jpg' ? 'image/jpeg' : `image/${imageExtension.slice(1)}` };
  if (kind === 'tool' && file.buffer.length <= MAX_IMAGE_SIZE &&
      /^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(file.buffer.toString('utf8', 0, Math.min(file.buffer.length, 2048)))) {
    sanitizeSvg(file.buffer);
    return { extension: '.svg', type: 'image/svg+xml' };
  }
  if (kind === 'certificate') throw createError(415, 'Certificates must be genuine PDF, PNG, or JPG files.');
  throw createError(415, kind === 'tool'
    ? 'Upload a genuine PNG, JPEG, WebP, or safe SVG logo.'
    : 'Upload a valid PNG, JPEG, or WebP image.');
}

async function storeAsset(client, file, kind) {
  if (!file) return null;
  const info = inspectUpload(file, kind);
  const filename = `${crypto.randomUUID()}${info.extension}`;
  const result = await client.storage.from(STORAGE_BUCKET).upload(filename, file.buffer, {
    contentType: info.type, cacheControl: '31536000', upsert: false
  });
  if (result.error) fail(result);
  const { data } = client.storage.from(STORAGE_BUCKET).getPublicUrl(filename);
  if (!data?.publicUrl) throw new Error('Asset storage did not return a public URL.');
  return { url: data.publicUrl, filename, extension: info.extension, type: info.type };
}

function storageFilename(url) {
  try {
    const parsed = new URL(url, 'http://localhost');
    let encodedFilename;
    if (parsed.origin === 'http://localhost' && parsed.pathname.startsWith('/uploads/')) {
      encodedFilename = parsed.pathname.slice('/uploads/'.length);
    } else {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl || parsed.origin !== new URL(supabaseUrl).origin) return null;
      const prefix = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
      if (!parsed.pathname.startsWith(prefix)) return null;
      encodedFilename = parsed.pathname.slice(prefix.length);
    }
    const filename = decodeURIComponent(encodedFilename);
    return /^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(filename) ? filename : null;
  } catch { return null; }
}

async function cleanUnusedUpload(client, url) {
  const filename = storageFilename(url);
  if (!filename) return;
  for (const [table, column] of [['designs', 'image_url'], ['certificates', 'file_url'], ['tools', 'image_url']]) {
    const used = await select(client, table, 'id', query => query.eq(column, url).limit(1));
    if (used.length) return;
  }
  const settingUsage = await select(client, 'site_settings', 'key', query => query.eq('value', url).limit(1));
  if (settingUsage.length) return;
  const result = await client.storage.from(STORAGE_BUCKET).remove([filename]);
  if (result.error) console.error('Could not remove unused uploaded asset:', result.error.message);
}

async function orderedRecords(client, table) {
  const columns = table === 'certificates'
    ? 'id,title,description,file_url,file_type,position,created_at'
    : 'id,name,category,image_url,visible,position,created_at';
  const rows = await select(client, table, columns, query => query.order('position').order('created_at').order('id'));
  return table === 'certificates' ? rows.map(row => ({
    id: row.id, title: row.title, description: row.description, file: row.file_url,
    fileType: row.file_type, position: row.position
  })) : rows.map(row => ({
    id: row.id, name: row.name, category: row.category, image: row.image_url,
    visible: Boolean(row.visible), position: row.position
  }));
}

async function normalizePositions(client, category) {
  const rows = await select(client, 'designs', 'id', query => query.eq('category_slug', category)
    .order('position').order('created_at').order('id'));
  for (const [position, row] of rows.entries()) {
    fail(await client.from('designs').update({ position }).eq('id', row.id));
  }
}

async function updateOrderedRecords(client, table, ids) {
  if (!['certificates', 'tools'].includes(table) || !Array.isArray(ids) ||
      ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    throw createError(400, 'Provide a complete ordered list of unique record IDs.');
  }
  const current = await select(client, table, 'id');
  const currentIds = current.map(row => row.id);
  if (ids.length !== currentIds.length || ids.some(id => !currentIds.includes(id))) {
    throw createError(400, 'The order must include every record exactly once.');
  }
  for (const [position, id] of ids.entries()) fail(await client.from(table).update({ position }).eq('id', id));
}

function verifyConfig(options) {
  const configuredSessionSecret = options.sessionSecret || process.env.ADMIN_SESSION_SECRET;
  if (process.env.NODE_ENV === 'production' &&
      (!configuredSessionSecret || Buffer.byteLength(configuredSessionSecret) < 32)) {
    throw new Error('Set ADMIN_SESSION_SECRET to a random value of at least 32 bytes in production.');
  }
  const sessionSecret = configuredSessionSecret || crypto.randomBytes(32).toString('base64url');
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (Boolean(supabaseUrl) !== Boolean(supabaseKey)) {
    throw new Error('Set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable persistent cloud storage.');
  }
  if (process.env.VERCEL && !options.client && !supabaseUrl) {
    throw new Error('Configure Supabase before deploying this portfolio to Vercel.');
  }
  const uploadDirectory = process.env.PORTFOLIO_UPLOAD_DIR || path.join(ROOT, 'uploads');
  let database = options.database;
  let client = options.client;
  if (!client && supabaseUrl && supabaseKey) {
    const { createClient } = require('@supabase/supabase-js');
    client = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: createRetryingFetch() }
    });
  }
  if (!database && !client) database = getDatabase();
  return {
    database,
    client: client || createLocalClient(database, uploadDirectory),
    uploadDirectory: client && !database ? null : uploadDirectory,
    sessionSecret,
    setupToken: options.bootstrapToken || process.env.ADMIN_SETUP_TOKEN || crypto.randomBytes(24).toString('base64url')
  };
}

function createApp(options = {}) {
  const config = verifyConfig(options);
  const client = config.client;
  const app = express();
  const loginAttempts = new Map();
  const setupTokenHash = config.setupToken ? crypto.createHash('sha256').update(config.setupToken).digest() : null;
  const storageFallback = options.storageFallback ||
    (config.client && !config.database ? createVercelFallbackApp({ storageUnavailable: true }) : null);
  app.locals.database = config.database;
  app.locals.databaseClient = client;
  app.locals.storageError = null;
  let initialization;
  const initializeStorage = () => {
    if (initialization) return initialization;
    initialization = initializeWithRetry(client).then(() => {
      app.locals.storageError = null;
    }).catch(error => {
      app.locals.storageError = error;
      if (storageFallback) console.error('Portfolio storage initialization failed:', error);
    }).finally(() => {
      initialization = null;
    });
    app.locals.ready = initialization;
    return initialization;
  };
  app.locals.ready = initializeStorage();
  app.use((req, res, next) => {
    const ready = app.locals.storageError ? initializeStorage() : app.locals.ready;
    return ready.then(() => {
      if (app.locals.storageError) {
        if (storageFallback && req.path.startsWith('/api/admin/')) return next();
        if (storageFallback && req.path.startsWith('/api/') && req.method === 'GET') {
          return storageFallback(req, res, next);
        }
        return next(app.locals.storageError);
      }
      next();
    }, next);
  });
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_SIZE, files: 1 } });
  const sectionImageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_SIZE, files: 20 } });
  const certificateUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_CERTIFICATE_SIZE, files: 1 } });

  function parseSession(req) {
    const cookie = String(req.get('cookie') || '').split(';')
      .map(value => value.trim()).find(value => value.startsWith(`${SESSION_COOKIE}=`));
    if (!cookie) return null;
    let token;
    try { token = decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)); } catch { return null; }
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const expected = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest();
    let supplied;
    try { supplied = Buffer.from(signature, 'base64url'); } catch { return null; }
    if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) return null;
    try {
      const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return session.exp > Math.floor(Date.now() / 1000) ? session : null;
    } catch { return null; }
  }

  function createAdminSession(res) {
    const session = { csrfToken: crypto.randomBytes(24).toString('base64url'), exp: Math.floor(Date.now() / 1000) + SESSION_DURATION };
    const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
    const signature = crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
    res.cookie(SESSION_COOKIE, `${payload}.${signature}`, {
      httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
      maxAge: SESSION_DURATION * 1000, path: '/'
    });
    return session;
  }

  function adminOnly(req, res, next) {
    const session = parseSession(req);
    if (!session) return res.status(401).json({ error: 'Sign in to manage the portfolio.' });
    req.adminSession = session;
    next();
  }

  function csrfOnly(req, res, next) {
    if (req.get('x-csrf-token') !== req.adminSession.csrfToken) {
      return res.status(403).json({ error: 'This admin request could not be verified. Reload the page and try again.' });
    }
    next();
  }

  function route(handler) {
    return async (req, res, next) => {
      try {
        await app.locals.ready;
        await handler(req, res);
      } catch (error) { next(error); }
    };
  }

  app.get('/api/portfolio', route(async (req, res) => {
    const categories = await getCategories(client);
    const home = await Promise.all(categories.map(async category => {
      const featured = await select(client, 'featured_designs', 'design_id,position',
        query => query.eq('category_slug', category.slug).order('position'));
      const ids = featured.map(row => row.design_id);
      const designs = ids.length ? await select(client, 'designs', '*', query => query.in('id', ids)) : [];
      const designMap = new Map(designs.map(row => [row.id, row]));
      return { ...category, designs: featured.filter(row => designMap.has(row.design_id)).map(row => {
        const design = designMap.get(row.design_id);
        return {
          id: design.id, category: design.category_slug, title: design.title, description: design.description,
          image: design.image_url, displayBackgroundColor: design.display_background_color,
          position: design.position, featuredPosition: row.position
        };
      }) };
    }));
    res.json({
      categories: home, content: await getContent(client),
      customSections: (await getCustomSections(client)).filter(section => section.visible)
    });
  }));

  app.get('/api/site-logo', route(async (req, res) => {
    const content = await getContent(client);
    res.set('Cache-Control', 'no-store').redirect(302, content.headerLogoUrl || DEFAULT_CONTENT.headerLogoUrl);
  }));

  app.get('/api/categories/:slug/designs', route(async (req, res) => {
    if (!validCategory(req.params.slug)) throw createError(404, 'Design category not found.');
    const [categories, library] = await Promise.all([
      getCategories(client), getDesignLibrary(client, req.params.slug)
    ]);
    res.json({
      category: categories.find(item => item.slug === req.params.slug),
      designs: library.designs, sections: library.sections
    });
  }));

  app.get('/api/certificates', route(async (req, res) => res.json({ certificates: await orderedRecords(client, 'certificates') })));
  app.get('/api/tools', route(async (req, res) => res.json({
    tools: (await orderedRecords(client, 'tools')).filter(tool => tool.visible).map(({ visible, ...tool }) => tool)
  })));

  app.get('/api/admin/session', route(async (req, res) => {
    const session = parseSession(req);
    if (session) return res.json({ authenticated: true, csrfToken: session.csrfToken, storageConfigured: true });
    const credential = await one(client, 'admin_credentials', query => query.eq('key', 'admin'));
    res.json({
      authenticated: false,
      requiresSetup: !credential,
      bootstrapTokenAvailable: Boolean(config.setupToken) && !credential,
      storageConfigured: true
    });
  }));

  app.post('/api/admin/setup', route(async (req, res) => {
    if (await one(client, 'admin_credentials', query => query.eq('key', 'admin'))) {
      throw createError(409, 'Admin setup is already complete. Sign in instead.');
    }
    if (!setupTokenHash) throw createError(503, 'Admin setup is disabled. Configure ADMIN_SETUP_TOKEN before initial setup.');
    const token = requireText(req.body?.token, 'Setup token', 200);
    const suppliedHash = crypto.createHash('sha256').update(token).digest();
    if (suppliedHash.length !== setupTokenHash.length || !crypto.timingSafeEqual(suppliedHash, setupTokenHash)) {
      throw createError(401, 'The setup token is incorrect.');
    }
    const email = validateEmail(req.body?.email);
    const password = requireText(req.body?.password, 'Password', 200);
    if (password.length < 12) throw createError(400, 'Choose a password with at least 12 characters.');
    const hash = await passwordHash(password);
    try {
      fail(await client.from('admin_credentials').insert({ key: 'admin', email, ...hash }));
    } catch (error) {
      if (error.code === '23505') throw createError(409, 'Admin setup is already complete. Sign in instead.');
      throw error;
    }
    res.json({ authenticated: true, csrfToken: createAdminSession(res).csrfToken });
  }));

  app.post('/api/admin/login', route(async (req, res) => {
    const now = Date.now();
    const address = req.ip || req.socket.remoteAddress || 'unknown';
    const recent = (loginAttempts.get(address) || []).filter(timestamp => timestamp > now - 60_000);
    if (recent.length >= 5) throw createError(429, 'Too many sign-in attempts. Wait a minute and try again.');
    recent.push(now);
    loginAttempts.set(address, recent);
    const credential = await one(client, 'admin_credentials', query => query.eq('key', 'admin'));
    if (!credential) throw createError(409, 'Admin setup is required before sign-in.');
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (email !== credential.email.toLowerCase() || !(await verifyPassword(password, credential))) {
      throw createError(401, 'Incorrect email or password.');
    }
    res.json({ authenticated: true, csrfToken: createAdminSession(res).csrfToken });
  }));

  app.post('/api/admin/logout', adminOnly, csrfOnly, (req, res) => {
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/'
    });
    res.json({ authenticated: false });
  });

  app.get('/api/admin/designs', adminOnly, route(async (req, res) => {
    const category = String(req.query.category || '');
    if (!validCategory(category)) throw createError(400, 'Choose one of the four design categories.');
    res.json(await getDesignLibrary(client, category));
  }));
  app.post('/api/admin/sections', adminOnly, csrfOnly, route(async (req, res) => {
    const category = requireText(req.body?.category, 'Category', 40);
    if (!validCategory(category)) throw createError(400, 'Choose one of the four design categories.');
    const title = validateSectionTitle(req.body?.title);
    const existing = await select(client, 'internal_sections', 'position',
      query => query.eq('category_slug', category));
    const section = await insertOne(client, 'internal_sections', {
      id: crypto.randomUUID(), category_slug: category, title,
      position: existing.reduce((highest, item) => Math.max(highest, item.position), -1) + 1
    });
    res.status(201).json({ section: {
      id: section.id, category: section.category_slug, title: section.title, position: section.position, designs: []
    } });
  }));
  app.put('/api/admin/sections/:id', adminOnly, csrfOnly, route(async (req, res) => {
    const section = await findSection(client, req.params.id);
    if (!section) throw createError(404, 'Subsection not found.');
    const title = validateSectionTitle(req.body?.title);
    const updated = await updateOne(client, 'internal_sections', section.id, { title });
    res.json({ section: {
      id: updated.id, category: updated.category_slug, title: updated.title, position: updated.position
    } });
  }));
  app.delete('/api/admin/sections/:id', adminOnly, csrfOnly, route(async (req, res) => {
    const section = await findSection(client, req.params.id);
    if (!section) throw createError(404, 'Subsection not found.');
    fail(await client.from('internal_sections').delete().eq('id', section.id));
    res.json({ deleted: true });
  }));
  app.put('/api/admin/section-order', adminOnly, csrfOnly, route(async (req, res) => {
    const category = requireText(req.body?.category, 'Category', 40);
    const ids = req.body?.ids;
    if (!validCategory(category) || !Array.isArray(ids) ||
        ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      throw createError(400, 'Provide a category and its ordered subsection IDs.');
    }
    const sections = await select(client, 'internal_sections', 'id',
      query => query.eq('category_slug', category));
    const currentIds = sections.map(section => section.id);
    if (ids.length !== currentIds.length || ids.some(id => !currentIds.includes(id))) {
      throw createError(400, 'The order must include every subsection exactly once.');
    }
    for (const [position, id] of ids.entries()) {
      fail(await client.from('internal_sections').update({ position }).eq('id', id));
    }
    res.json({ sections: await getInternalSections(client, category) });
  }));
  app.post('/api/admin/sections/:id/designs', adminOnly, csrfOnly,
    sectionImageUpload.array('images', 20), route(async (req, res) => {
      const section = await findSection(client, req.params.id);
      if (!section) throw createError(404, 'Subsection not found.');
      const files = req.files || [];
      if (!files.length) throw createError(400, 'Choose one or more design images to upload.');
      const records = await select(client, 'designs', 'position',
        query => query.eq('category_slug', section.category_slug));
      let nextPosition = records.reduce((highest, item) => Math.max(highest, item.position), -1) + 1;
      const assets = [];
      try {
        for (const file of files) assets.push(await storeAsset(client, file, 'design'));
        const rows = assets.map((asset, index) => {
          const sourceName = files[index].originalname.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
          return {
            id: crypto.randomUUID(), category_slug: section.category_slug, section_id: section.id,
            title: sourceName.slice(0, 120) || 'Untitled design',
            description: `${section.title} design.`, image_url: asset.url,
            display_background_color: '#ffffff', position: nextPosition++, created_at: new Date().toISOString()
          };
        });
        const inserted = fail(await client.from('designs').insert(rows).select('*'));
        res.status(201).json({ designs: inserted.map(design => designForApi(design)) });
      } catch (error) {
        const storedFiles = assets.map(asset => asset.filename);
        if (storedFiles.length) {
          const removal = await client.storage.from(STORAGE_BUCKET).remove(storedFiles);
          if (removal.error) console.error('Could not remove subsection upload after a failed save:', removal.error.message);
        }
        throw error;
      }
    }));
  app.put('/api/admin/designs/:id/section', adminOnly, csrfOnly, route(async (req, res) => {
    const design = await one(client, 'designs', query => query.eq('id', req.params.id));
    if (!design) throw createError(404, 'Design not found.');
    const section = await validateSectionForCategory(client, req.body?.sectionId, design.category_slug);
    const updated = await updateOne(client, 'designs', design.id, { section_id: section?.id || null });
    res.json({ design: designForApi(updated) });
  }));
  app.get('/api/admin/certificates', adminOnly, route(async (req, res) =>
    res.json({ certificates: await orderedRecords(client, 'certificates') })));
  app.get('/api/admin/tools', adminOnly, route(async (req, res) =>
    res.json({ tools: await orderedRecords(client, 'tools') })));

  app.put('/api/admin/site-logo', adminOnly, csrfOnly, imageUpload.single('image'), route(async (req, res) => {
    if (!req.file) throw createError(400, 'Choose a PNG, JPG, or WebP logo image.');
    const asset = await storeAsset(client, req.file, 'design');
    const content = await getContent(client);
    try {
      fail(await client.from('site_settings').upsert({ key: 'headerLogoUrl', value: asset.url }, { onConflict: 'key' }));
    } catch (error) {
      await client.storage.from(STORAGE_BUCKET).remove([asset.filename]);
      throw error;
    }
    await cleanUnusedUpload(client, content.headerLogoUrl);
    res.json({ logoUrl: asset.url });
  }));

  app.post('/api/admin/certificates', adminOnly, csrfOnly, certificateUpload.single('file'), route(async (req, res) => {
    const title = requireText(req.body?.title, 'Certificate name', 120);
    const description = String(req.body?.description || '').trim();
    if (description.length > 2000) throw createError(400, 'Description must be 2000 characters or fewer.');
    const certificateUrl = String(req.body?.certificateUrl || '').trim();
    if (certificateUrl && req.file) throw createError(400, 'Choose a certificate file or URL, not both.');
    if (!certificateUrl && !req.file) throw createError(400, 'Choose a PDF, PNG, or JPG file, or enter an HTTPS certificate URL.');
    const asset = certificateUrl ? { url: validateCertificateUrl(certificateUrl), type: 'link' }
      : await storeAsset(client, req.file, 'certificate');
    const records = await select(client, 'certificates', 'position');
    const row = {
      id: crypto.randomUUID(), title, description, file_url: asset.url,
      file_type: asset.type || asset.extension.slice(1), position: records.length,
      created_at: new Date().toISOString()
    };
    try {
      const certificate = await insertOne(client, 'certificates', row);
      res.status(201).json({ certificate: {
        id: certificate.id, title: certificate.title, description: certificate.description,
        file: certificate.file_url, fileType: certificate.file_type, position: certificate.position
      } });
    } catch (error) {
      if (req.file) await client.storage.from(STORAGE_BUCKET).remove([asset.filename]);
      throw error;
    }
  }));

  app.put('/api/admin/certificates/:id', adminOnly, csrfOnly, certificateUpload.single('file'), route(async (req, res) => {
    const certificate = await one(client, 'certificates', query => query.eq('id', req.params.id));
    if (!certificate) throw createError(404, 'Certificate not found.');
    const title = requireText(req.body?.title, 'Certificate name', 120);
    const description = String(req.body?.description || '').trim();
    if (description.length > 2000) throw createError(400, 'Description must be 2000 characters or fewer.');
    const certificateUrl = String(req.body?.certificateUrl || '').trim();
    if (certificateUrl && req.file) throw createError(400, 'Choose a certificate file or URL, not both.');
    const replacement = certificateUrl ? { url: validateCertificateUrl(certificateUrl), type: 'link' }
      : req.file ? await storeAsset(client, req.file, 'certificate') : null;
    let updated;
    try {
      updated = await updateOne(client, 'certificates', certificate.id, {
        title, description, file_url: replacement?.url || certificate.file_url,
        file_type: replacement?.type || replacement?.extension.slice(1) || certificate.file_type
      });
    } catch (error) {
      if (req.file) await client.storage.from(STORAGE_BUCKET).remove([replacement.filename]);
      throw error;
    }
    if (replacement) await cleanUnusedUpload(client, certificate.file_url);
    res.json({ certificate: {
      id: updated.id, title: updated.title, description: updated.description,
      file: updated.file_url, fileType: updated.file_type, position: updated.position
    } });
  }));

  app.delete('/api/admin/certificates/:id', adminOnly, csrfOnly, route(async (req, res) => {
    const certificate = await one(client, 'certificates', query => query.eq('id', req.params.id));
    if (!certificate) throw createError(404, 'Certificate not found.');
    fail(await client.from('certificates').delete().eq('id', certificate.id));
    await cleanUnusedUpload(client, certificate.file_url);
    res.json({ deleted: true });
  }));

  app.put('/api/admin/certificate-order', adminOnly, csrfOnly, route(async (req, res) => {
    await updateOrderedRecords(client, 'certificates', req.body?.ids);
    res.json({ certificates: await orderedRecords(client, 'certificates') });
  }));

  app.post('/api/admin/tools', adminOnly, csrfOnly, imageUpload.single('image'), route(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const category = String(req.body?.category || '').trim();
    if (name.length > 120 || category.length > 80) throw createError(400, 'Tool name or category is too long.');
    if (!req.file) throw createError(400, 'Choose an image or SVG logo to upload.');
    const asset = await storeAsset(client, req.file, 'tool');
    try {
      const records = await select(client, 'tools', 'position');
      const tool = await insertOne(client, 'tools', {
        id: crypto.randomUUID(), name: name || 'Design tool', category, image_url: asset.url,
        visible: req.body?.visible === 'true', position: records.length, created_at: new Date().toISOString()
      });
      res.status(201).json({ tool: {
        id: tool.id, name: tool.name, category: tool.category, image: tool.image_url,
        visible: Number(Boolean(tool.visible)), position: tool.position
      } });
    } catch (error) {
      await client.storage.from(STORAGE_BUCKET).remove([asset.filename]);
      throw error;
    }
  }));

  app.put('/api/admin/tools/:id', adminOnly, csrfOnly, imageUpload.single('image'), route(async (req, res) => {
    const tool = await one(client, 'tools', query => query.eq('id', req.params.id));
    if (!tool) throw createError(404, 'Tool logo not found.');
    const name = String(req.body?.name || '').trim();
    const category = String(req.body?.category || '').trim();
    if (name.length > 120 || category.length > 80) throw createError(400, 'Tool name or category is too long.');
    const asset = req.file ? await storeAsset(client, req.file, 'tool') : null;
    let updated;
    try {
      updated = await updateOne(client, 'tools', tool.id, {
        name: name || 'Design tool', category, image_url: asset?.url || tool.image_url,
        visible: req.body?.visible === 'true'
      });
    } catch (error) {
      if (asset) await client.storage.from(STORAGE_BUCKET).remove([asset.filename]);
      throw error;
    }
    if (asset) await cleanUnusedUpload(client, tool.image_url);
    res.json({ tool: {
      id: updated.id, name: updated.name, category: updated.category, image: updated.image_url,
      visible: Number(Boolean(updated.visible)), position: updated.position
    } });
  }));

  app.delete('/api/admin/tools/:id', adminOnly, csrfOnly, route(async (req, res) => {
    const tool = await one(client, 'tools', query => query.eq('id', req.params.id));
    if (!tool) throw createError(404, 'Tool logo not found.');
    fail(await client.from('tools').delete().eq('id', tool.id));
    await cleanUnusedUpload(client, tool.image_url);
    res.json({ deleted: true });
  }));
  app.put('/api/admin/tool-order', adminOnly, csrfOnly, route(async (req, res) => {
    await updateOrderedRecords(client, 'tools', req.body?.ids);
    res.json({ tools: await orderedRecords(client, 'tools') });
  }));

  app.post('/api/admin/designs', adminOnly, csrfOnly, imageUpload.single('image'), route(async (req, res) => {
    const category = requireText(req.body?.category, 'Category', 40);
    if (!validCategory(category)) throw createError(400, 'Choose one of the four design categories.');
    const title = requireText(req.body?.title, 'Design name', 120);
    const description = requireText(req.body?.description, 'Description', 2000);
    const background = req.body?.displayBackgroundColor || '#ffffff';
    if (category === 'logo-designs' && !validHexColor(background)) {
      throw createError(400, 'Logo background must be a valid six-digit HEX color.');
    }
    const section = await validateSectionForCategory(client, req.body?.sectionId, category);
    if (!req.file) throw createError(400, 'Choose an image to upload.');
    const asset = await storeAsset(client, req.file, 'design');
    try {
      const records = await select(client, 'designs', 'position', query => query.eq('category_slug', category));
      const design = await insertOne(client, 'designs', {
        id: crypto.randomUUID(), category_slug: category, section_id: section?.id || null,
        title, description, image_url: asset.url,
        display_background_color: category === 'logo-designs' ? background.toLowerCase() : '#ffffff',
        position: records.length, created_at: new Date().toISOString()
      });
      res.status(201).json({ design });
    } catch (error) {
      await client.storage.from(STORAGE_BUCKET).remove([asset.filename]);
      throw error;
    }
  }));

  app.put('/api/admin/designs/:id', adminOnly, csrfOnly, imageUpload.single('image'), route(async (req, res) => {
    const design = await one(client, 'designs', query => query.eq('id', req.params.id));
    if (!design) throw createError(404, 'Design not found.');
    const category = requireText(req.body?.category, 'Category', 40);
    if (!validCategory(category)) throw createError(400, 'Choose one of the four design categories.');
    const title = requireText(req.body?.title, 'Design name', 120);
    const description = requireText(req.body?.description, 'Description', 2000);
    const background = req.body?.displayBackgroundColor || design.display_background_color || '#ffffff';
    if (category === 'logo-designs' && !validHexColor(background)) {
      throw createError(400, 'Logo background must be a valid six-digit HEX color.');
    }
    const section = Object.hasOwn(req.body || {}, 'sectionId')
      ? await validateSectionForCategory(client, req.body.sectionId, category)
      : null;
    const oldCategory = await select(client, 'designs', 'id', query => query.eq('category_slug', design.category_slug));
    if (category !== design.category_slug && oldCategory.length <= 4) {
      throw createError(409, 'Add another design to this category before moving one out; each category needs at least four designs.');
    }
    const asset = req.file ? await storeAsset(client, req.file, 'design') : null;
    let updated;
    try {
      updated = await updateOne(client, 'designs', design.id, {
        category_slug: category,
        section_id: category === design.category_slug
          ? (Object.hasOwn(req.body || {}, 'sectionId') ? section?.id || null : design.section_id || null)
          : section?.id || null,
        title, description, image_url: asset?.url || design.image_url,
        display_background_color: category === 'logo-designs' ? background.toLowerCase() : '#ffffff'
      });
    } catch (error) {
      if (asset) await client.storage.from(STORAGE_BUCKET).remove([asset.filename]);
      throw error;
    }
    if (category !== design.category_slug) {
      await ensureFeaturedDesigns(client, design.category_slug, 1);
      await ensureFeaturedDesigns(client, category, 1);
      await normalizePositions(client, design.category_slug);
      await normalizePositions(client, category);
    }
    if (asset) await cleanUnusedUpload(client, design.image_url);
    res.json({ design: updated });
  }));

  app.delete('/api/admin/designs/:id', adminOnly, csrfOnly, route(async (req, res) => {
    const design = await one(client, 'designs', query => query.eq('id', req.params.id));
    if (!design) throw createError(404, 'Design not found.');
    const designs = await select(client, 'designs', 'id', query => query.eq('category_slug', design.category_slug));
    if (designs.length <= 4) throw createError(409, 'Each category must keep at least four designs. Add a replacement before deleting this one.');
    fail(await client.from('designs').delete().eq('id', design.id));
    await ensureFeaturedDesigns(client, design.category_slug, 1);
    await normalizePositions(client, design.category_slug);
    await cleanUnusedUpload(client, design.image_url);
    res.json({ deleted: true });
  }));

  app.put('/api/admin/design-order', adminOnly, csrfOnly, route(async (req, res) => {
    const category = requireText(req.body?.category, 'Category', 40);
    const ids = req.body?.designIds;
    if (!validCategory(category) || !Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
      throw createError(400, 'Provide a category and its ordered design IDs.');
    }
    const current = await select(client, 'designs', 'id', query => query.eq('category_slug', category));
    const currentIds = current.map(row => row.id);
    if (ids.length !== currentIds.length || new Set(ids).size !== ids.length || ids.some(id => !currentIds.includes(id))) {
      throw createError(400, 'The order must include every design in this category exactly once.');
    }
    for (const [position, id] of ids.entries()) fail(await client.from('designs').update({ position }).eq('id', id));
    res.json({ designs: await getDesigns(client, category) });
  }));

  app.put('/api/admin/featured', adminOnly, csrfOnly, route(async (req, res) => {
    const category = requireText(req.body?.category, 'Category', 40);
    const ids = req.body?.designIds;
    if (!validCategory(category) || !Array.isArray(ids) || ids.length < 1 || ids.length > 4 ||
        ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      throw createError(400, 'Select between one and four different designs for this homepage section.');
    }
    const designs = await select(client, 'designs', 'id', query => query.eq('category_slug', category).in('id', ids));
    if (designs.length !== ids.length) throw createError(400, 'All selected designs must belong to the selected category.');
    fail(await client.from('featured_designs').delete().eq('category_slug', category));
    fail(await client.from('featured_designs').insert(ids.map((design_id, position) => ({
      category_slug: category, design_id, position
    }))));
    res.json({ featured: ids });
  }));

  app.get('/api/admin/content', adminOnly, route(async (req, res) => res.json({
    content: await getContent(client), categories: await getCategories(client), customSections: await getCustomSections(client)
  })));

  app.put('/api/admin/content', adminOnly, csrfOnly, route(async (req, res) => {
    const content = req.body?.content;
    const categorySettings = req.body?.categories;
    const customSettings = req.body?.customSections;
    const currentContent = await getContent(client);
    if (!content || typeof content !== 'object' || Array.isArray(content) ||
        !Array.isArray(categorySettings) || categorySettings.length !== CATEGORY_DEFINITIONS.length) {
      throw createError(400, 'Provide homepage, about, contact, and all four section settings.');
    }
    const updatedContent = {
      heroTitle: requireText(content.heroTitle, 'Homepage headline', 120),
      heroLead: requireText(content.heroLead, 'Homepage introduction', 500),
      aboutName: requireText(content.aboutName, 'About name', 120),
      aboutSummary: requireText(content.aboutSummary, 'About summary', 500),
      aboutText: requireText(content.aboutText, 'About description', 2000),
      contactPhone: requireText(content.contactPhone, 'Contact phone', 80),
      contactEmail: requireText(content.contactEmail, 'Contact email', 200),
      contactInstagram: requireText(content.contactInstagram, 'Instagram handle', 100)
    };
    const seen = new Set();
    const updatedCategories = categorySettings.map(item => {
      if (!item || !validCategory(item.slug) || seen.has(item.slug)) {
        throw createError(400, 'Section settings must include each of the four categories exactly once.');
      }
      seen.add(item.slug);
      return {
        slug: item.slug, title: requireText(item.title, 'Section title', 80),
        marqueeText: requireText(item.marqueeText ?? currentContent[MARQUEE_SETTING_BY_SLUG[item.slug]], 'Moving marquee text', 80),
        description: requireText(item.description, 'Section description', 500), visible: Boolean(item.visible)
      };
    });
    if (seen.size !== CATEGORY_DEFINITIONS.length) {
      throw createError(400, 'Section settings must include each of the four categories exactly once.');
    }
    for (const category of updatedCategories) {
      updatedContent[MARQUEE_SETTING_BY_SLUG[category.slug]] = category.marqueeText;
    }
    let updatedSections;
    if (customSettings !== undefined) {
      if (!Array.isArray(customSettings) || customSettings.length > 50) throw createError(400, 'Provide up to 50 custom homepage sections.');
      const sectionIds = new Set();
      updatedSections = customSettings.map((item, position) => {
        if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || sectionIds.has(item.id)) {
          throw createError(400, 'Custom homepage section IDs must be unique valid identifiers.');
        }
        sectionIds.add(item.id);
        return {
          id: item.id, title: requireText(item.title, 'Custom section title', 80),
          description: requireText(item.description, 'Custom section description', 1000),
          visible: Boolean(item.visible), position
        };
      });
    }
    fail(await client.from('site_settings').upsert(Object.entries(updatedContent).map(([key, value]) => ({ key, value })),
      { onConflict: 'key' }));
    for (const category of updatedCategories) {
      fail(await client.from('categories').update({
        title: category.title, description: category.description, visible: category.visible
      }).eq('slug', category.slug));
    }
    if (updatedSections) {
      fail(await client.from('custom_home_sections').delete().neq('id', ''));
      if (updatedSections.length) fail(await client.from('custom_home_sections').insert(updatedSections));
    }
    res.json({
      content: await getContent(client), categories: await getCategories(client), customSections: await getCustomSections(client)
    });
  }));

  app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'admin.html')));
  app.get('/about', (req, res) => res.sendFile(path.join(ROOT, 'about.html')));
  app.get('/contact', (req, res) => res.sendFile(path.join(ROOT, 'contact.html')));
  app.get('/certificates', (req, res) => res.sendFile(path.join(ROOT, 'certificates.html')));
  app.get('/:slug', (req, res, next) => {
    if (!validCategory(req.params.slug)) return next();
    res.sendFile(path.join(ROOT, 'category.html'));
  });
  app.use(['/server.js', '/package.json', '/package-lock.json'], (req, res) => res.sendStatus(404));
  if (config.uploadDirectory) {
    app.use('/uploads', (req, res, next) => {
      if (path.extname(req.path).toLowerCase() === '.svg') res.setHeader('Content-Security-Policy', 'sandbox');
      if (req.query.download === '1') res.attachment(path.basename(req.path));
      next();
    }, express.static(config.uploadDirectory, { dotfiles: 'deny' }));
  }
  app.use(express.static(ROOT, { dotfiles: 'deny', index: 'index.html' }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE'
        ? 'Images must be 15 MB or smaller.' : 'The image upload could not be accepted.' });
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500 && storageFallback && req.path.startsWith('/api/')) {
      console.error('Cloud storage request failed; serving the read-only portfolio fallback:', error);
      return storageFallback(req, res, next);
    }
    if (status >= 500) console.error(error);
    res.status(status).json({ error: status >= 500
      ? 'The request could not be completed. Check the server logs.' : error.message });
  });
  return app;
}

function createVercelFallbackApp({ storageUnavailable = false } = {}) {
  const app = express();
  const designs = buildLegacyDesigns().map(design => designForApi(design));
  const content = { ...DEFAULT_CONTENT };
  const categories = CATEGORY_DEFINITIONS.map(category => ({
    ...category,
    visible: true,
    marqueeText: content[MARQUEE_SETTING_BY_SLUG[category.slug]],
    designs: designs.filter(design => design.category === category.slug).slice(0, 4)
  }));
  const storageConfiguration = {
    storageConfigured: false,
    storageUnavailable,
    missingConfiguration: [
      ...(!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) ? ['SUPABASE_URL'] : []),
      ...(!process.env.SUPABASE_SERVICE_ROLE_KEY ? ['SUPABASE_SERVICE_ROLE_KEY'] : [])
    ]
  };
  app.disable('x-powered-by');
  app.get('/api/site-logo', (req, res) => {
    res.set('Cache-Control', 'no-store').redirect(302, DEFAULT_CONTENT.headerLogoUrl);
  });
  app.get('/api/portfolio', (req, res) => res.json({
    categories, content, customSections: [], ...storageConfiguration
  }));
  app.get('/api/tools', (req, res) => res.json({ tools: [] }));
  app.get('/api/certificates', (req, res) => res.json({ certificates: [] }));
  app.get('/api/categories/:slug/designs', (req, res) => {
    const category = categories.find(item => item.slug === req.params.slug);
    if (!category) return res.status(404).json({ error: 'Design category not found.' });
    res.json({
      category: { ...category, designs: undefined },
      designs: designs.filter(design => design.category === category.slug), sections: []
    });
  });
  app.get('/api/admin/session', (req, res) => res.json({
    authenticated: false, requiresSetup: false, ...storageConfiguration
  }));
  app.use('/api/admin', (req, res) => res.status(503).json({
    error: storageUnavailable
      ? 'Admin editing is temporarily unavailable because persistent storage could not be reached. Check the deployment configuration and server logs.'
      : `Admin editing is unavailable until persistent storage is configured (${storageConfiguration.missingConfiguration.join(', ')}).`,
    ...storageConfiguration
  }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'admin.html')));
  app.get('/about', (req, res) => res.sendFile(path.join(ROOT, 'about.html')));
  app.get('/contact', (req, res) => res.sendFile(path.join(ROOT, 'contact.html')));
  app.get('/certificates', (req, res) => res.sendFile(path.join(ROOT, 'certificates.html')));
  app.get('/:slug', (req, res, next) => {
    if (!validCategory(req.params.slug)) return next();
    res.sendFile(path.join(ROOT, 'category.html'));
  });
  app.use(['/server.js', '/package.json', '/package-lock.json'], (req, res) => res.sendStatus(404));
  app.use(express.static(ROOT, { dotfiles: 'deny', index: 'index.html' }));
  return app;
}

if (require.main === module) {
  let app;
  let config;
  try {
    config = verifyConfig({});
    app = createApp({ database: config.database, client: config.client, sessionSecret: config.sessionSecret, bootstrapToken: config.setupToken });
    const port = Number(process.env.PORT || 8000);
    const host = process.env.HOST || '127.0.0.1';
    app.locals.ready.then(async () => {
      const credential = await one(app.locals.databaseClient, 'admin_credentials', query => query.eq('key', 'admin'));
      app.listen(port, host, () => {
        console.log(`Ravu.FX portfolio is available on ${host}:${port}`);
        console.log('Admin dashboard: /admin');
        if (!credential) console.log(`One-time admin setup token: ${config.setupToken}`);
      });
    }).catch(error => {
      console.error(`Portfolio initialization failed: ${error.message}`);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(`Portfolio configuration error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  CATEGORY_DEFINITIONS,
  createApp,
  createVercelFallbackApp,
  cleanUnusedUpload,
  createRetryingFetch,
  getDatabase,
  initialize,
  seedLegacyDesigns,
  storeAsset,
  STORAGE_BUCKET
};
