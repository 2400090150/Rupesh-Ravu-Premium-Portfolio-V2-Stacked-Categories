const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ravu-portfolio-test-'));
process.env.PORTFOLIO_DATA_DIR = path.join(tempDir, 'data');
process.env.PORTFOLIO_UPLOAD_DIR = path.join(tempDir, 'uploads');

const {
  CATEGORY_DEFINITIONS, createApp, createRetryingFetch, createVercelFallbackApp, getDatabase
} = require('./server');
const bootstrapToken = 'test-only-initial-setup-token';
let server;
let app;
let baseUrl;
let adminCookie;
let csrfToken;

before(async () => {
  app = createApp({ bootstrapToken });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  getDatabase().close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function requestJson(route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (adminCookie) headers.set('cookie', adminCookie);
  if (csrfToken && options.method && options.method !== 'GET') headers.set('x-csrf-token', csrfToken);
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

test('portfolio categories, admin CRUD, featured selections, and persistent uploads', async t => {
  await t.test('preserves the existing work and exposes exactly four category sections', async () => {
    const { response, data } = await requestJson('/api/portfolio');
    assert.equal(response.status, 200);
    const defaultLogo = await fetch(`${baseUrl}/api/site-logo`, { redirect: 'manual' });
    assert.equal(defaultLogo.status, 302);
    assert.equal(defaultLogo.headers.get('location'), '/assets/ravu-fx-logo.png?v=4');
    assert.deepEqual(data.categories.map(category => category.slug), CATEGORY_DEFINITIONS.map(category => category.slug));
    for (const category of data.categories) {
      assert.equal(category.designs.length, 4, `${category.slug} should have exactly four featured designs`);
      const archive = await requestJson(`/api/categories/${category.slug}/designs`);
      assert.equal(archive.response.status, 200);
      assert.ok(archive.data.designs.length >= 4);
    }
    const restartedApps = [
      createApp({ database: getDatabase(), sessionSecret: 'test-restart-session-secret-with-at-least-32-bytes' }),
      createApp({ database: getDatabase(), sessionSecret: 'test-restart-session-secret-with-at-least-32-bytes' })
    ];
    await Promise.all(restartedApps.map(app => app.locals.ready));
    const restartedPortfolio = await requestJson('/api/portfolio');
    assert.equal(restartedPortfolio.response.status, 200);
    for (const category of restartedPortfolio.data.categories) {
      assert.deepEqual(category.designs.map(design => design.id),
        data.categories.find(original => original.slug === category.slug).designs.map(design => design.id),
        `${category.slug} featured work should survive concurrent startup`);
    }
    const logoArchive = await fetch(`${baseUrl}/logo-designs`);
    assert.equal(logoArchive.status, 200);
    assert.match(await logoArchive.text(), /categoryGallery/);
    assert.equal((await requestJson('/server.js')).response.status, 404);
    assert.equal((await requestJson('/api/categories/not-a-category/designs')).response.status, 404);
  });

  test('retries transient read-only Supabase network failures without retrying writes', async () => {
    let readAttempts = 0;
    const retryRead = createRetryingFetch(async () => {
      readAttempts++;
      if (readAttempts < 3) throw new TypeError('fetch failed');
      return new Response('ok');
    }, async () => {});
    const response = await retryRead('https://database.example.test/read');
    assert.equal(response.status, 200);
    assert.equal(readAttempts, 3);

    let writeAttempts = 0;
    const retryWrite = createRetryingFetch(async () => {
      writeAttempts++;
      throw new TypeError('fetch failed');
    }, async () => {});
    await assert.rejects(retryWrite('https://database.example.test/write', { method: 'POST', body: '{}' }), /fetch failed/);
    assert.equal(writeAttempts, 1);
  });

  test('retries transient Supabase server responses on reads but not writes', async () => {
    let readAttempts = 0;
    const retryRead = createRetryingFetch(async () => {
      readAttempts++;
      return new Response(readAttempts < 3 ? 'temporary outage' : 'ok', {
        status: readAttempts < 3 ? 503 : 200
      });
    }, async () => {});
    const response = await retryRead('https://database.example.test/read');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
    assert.equal(readAttempts, 3);

    let writeAttempts = 0;
    const retryWrite = createRetryingFetch(async () => {
      writeAttempts++;
      return new Response('temporary outage', { status: 503 });
    }, async () => {});
    const writeResponse = await retryWrite('https://database.example.test/write', {
      method: 'POST', body: '{}'
    });
    assert.equal(writeResponse.status, 503);
    assert.equal(writeAttempts, 1);
  });

  test('recovers from a transient storage error during application initialization', async () => {
    const databaseClient = app.locals.databaseClient;
    let categoryReadAttempts = 0;
    const retryingClient = {
      storage: databaseClient.storage,
      from(table) {
        if (table === 'categories' && categoryReadAttempts++ === 0) {
          return {
            select: async () => ({ data: null, error: { message: 'fetch failed' } })
          };
        }
        return databaseClient.from(table);
      }
    };
    const retryingApp = createApp({
      client: retryingClient,
      sessionSecret: 'test-retry-session-secret-with-at-least-32-bytes'
    });
    await retryingApp.locals.ready;
    assert.equal(categoryReadAttempts, 3);
    assert.equal(retryingApp.locals.storageError, null);
  });

  test('migrates the default product category title without replacing admin customizations', async t => {
    const databaseClient = app.locals.databaseClient;
    const renamed = await databaseClient.from('categories').update({ title: 'PRODUCT DESIGN' })
      .eq('slug', 'product-design');
    assert.equal(renamed.error, null);
    const migratingApp = createApp({
      database: getDatabase(),
      sessionSecret: 'test-title-migration-session-secret-32-bytes'
    });
    await migratingApp.locals.ready;
    const migratingServer = migratingApp.listen(0, '127.0.0.1');
    t.after(async () => new Promise(resolve => migratingServer.close(resolve)));
    await new Promise((resolve, reject) => {
      migratingServer.once('listening', resolve);
      migratingServer.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${migratingServer.address().port}`;
    let response = await fetch(`${baseUrl}/api/categories/product-design/designs`);
    assert.equal((await response.json()).category.title, 'FOOD & BAVERAGE');

    await databaseClient.from('categories').update({ title: 'Custom product title' })
      .eq('slug', 'product-design');
    const customizedApp = createApp({
      database: getDatabase(),
      sessionSecret: 'test-custom-title-session-secret-32-bytes'
    });
    await customizedApp.locals.ready;
    const customizedServer = customizedApp.listen(0, '127.0.0.1');
    t.after(async () => new Promise(resolve => customizedServer.close(resolve)));
    await new Promise((resolve, reject) => {
      customizedServer.once('listening', resolve);
      customizedServer.once('error', reject);
    });
    response = await fetch(`http://127.0.0.1:${customizedServer.address().port}/api/categories/product-design/designs`);
    assert.equal((await response.json()).category.title, 'Custom product title');
  });

  test('retries failed storage initialization on later requests', async t => {
    const databaseClient = app.locals.databaseClient;
    let categoryReadAttempts = 0;
    const recoveringClient = {
      storage: databaseClient.storage,
      from(table) {
        if (table === 'categories' && categoryReadAttempts++ < 3) {
          const result = { data: null, error: { message: 'fetch failed' } };
          const query = { then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
          return { select: () => query };
        }
        return databaseClient.from(table);
      }
    };
    const recoveringApp = createApp({
      client: recoveringClient,
      sessionSecret: 'test-later-retry-secret-with-at-least-32-bytes'
    });
    await recoveringApp.locals.ready;
    assert.ok(recoveringApp.locals.storageError);

    const recoveringServer = recoveringApp.listen(0, '127.0.0.1');
    t.after(async () => new Promise(resolve => recoveringServer.close(resolve)));
    await new Promise((resolve, reject) => {
      recoveringServer.once('listening', resolve);
      recoveringServer.once('error', reject);
    });
    const response = await fetch(`http://127.0.0.1:${recoveringServer.address().port}/api/admin/session`);
    const session = await response.json();
    assert.equal(response.status, 200);
    assert.equal(session.storageConfigured, true);
    assert.equal(recoveringApp.locals.storageError, null);
    assert.equal(categoryReadAttempts, 5);
  });

  test('serves the read-only portfolio when cloud storage initialization fails', async t => {
    const result = { data: null, error: { message: 'Cloud storage is unavailable.' } };
    const query = {
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      eq: () => query,
      maybeSingle: async () => result
    };
    const unavailableClient = {
      from: () => ({ select: () => query })
    };
    const unavailableApp = createApp({
      client: unavailableClient,
      sessionSecret: 'test-session-secret-with-at-least-32-bytes',
      bootstrapToken
    });
    const unavailableServer = unavailableApp.listen(0, '127.0.0.1');
    t.after(async () => new Promise(resolve => unavailableServer.close(resolve)));
    await new Promise((resolve, reject) => {
      unavailableServer.once('listening', resolve);
      unavailableServer.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${unavailableServer.address().port}`;

    const portfolioResponse = await fetch(`${baseUrl}/api/portfolio`);
    assert.equal(portfolioResponse.status, 200);
    const portfolio = await portfolioResponse.json();
    assert.equal(portfolio.storageConfigured, false);
    assert.equal(portfolio.categories.length, 4);
    assert.equal(portfolio.categories.find(category => category.slug === 'product-design').title, 'FOOD & BAVERAGE');

    const sessionResponse = await fetch(`${baseUrl}/api/admin/session`);
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    assert.equal(session.storageUnavailable, true);

    const adminResponse = await fetch(`${baseUrl}/api/admin/content`);
    assert.equal(adminResponse.status, 503);
    assert.match((await adminResponse.json()).error, /persistent storage could not be reached/);
  });

  test('serves the read-only portfolio when a cloud-backed API request fails', async t => {
    const unavailableApp = createApp({
      database: getDatabase(),
      storageFallback: createVercelFallbackApp({ storageUnavailable: true })
    });
    await unavailableApp.locals.ready;
    const databaseClient = unavailableApp.locals.databaseClient;
    const originalFrom = databaseClient.from.bind(databaseClient);
    databaseClient.from = table => {
      if (table === 'site_settings' || table === 'admin_credentials') {
        const result = { data: null, error: { message: 'Cloud storage is unavailable.' } };
        const query = {
          then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
          eq: () => query,
          maybeSingle: async () => result
        };
        return {
          select: () => query
        };
      }
      return originalFrom(table);
    };
    const unavailableServer = unavailableApp.listen(0, '127.0.0.1');
    t.after(async () => new Promise(resolve => unavailableServer.close(resolve)));
    await new Promise((resolve, reject) => {
      unavailableServer.once('listening', resolve);
      unavailableServer.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${unavailableServer.address().port}`;

    const portfolioResponse = await fetch(`${baseUrl}/api/portfolio`);
    assert.equal(portfolioResponse.status, 200);
    assert.equal((await portfolioResponse.json()).storageConfigured, false);

    const adminSessionResponse = await fetch(`${baseUrl}/api/admin/session`);
    assert.equal(adminSessionResponse.status, 200);
    assert.equal((await adminSessionResponse.json()).storageUnavailable, true);
  });

  await t.test('requires the one-time setup token and protects admin endpoints', async () => {
    const session = await requestJson('/api/admin/session');
    assert.equal(session.data.storageConfigured, true);
    assert.equal(session.data.requiresSetup, true);
    const malformedCookie = await requestJson('/api/admin/session', {
      headers: { cookie: 'ravu_admin=%' }
    });
    assert.equal(malformedCookie.response.status, 200);
    assert.equal(malformedCookie.data.authenticated, false);
    assert.equal((await requestJson('/api/admin/designs?category=logo-designs')).response.status, 401);
    const rejected = await requestJson('/api/admin/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-token', email: 'ravu.fx@gmail.com', password: 'a-strong-password-123' })
    });
    assert.equal(rejected.response.status, 401);
    const setupResponse = await fetch(`${baseUrl}/api/admin/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: bootstrapToken, email: 'RAVU.FX@gmail.com', password: 'a-strong-password-123' })
    });
    assert.equal(setupResponse.status, 200);
    adminCookie = setupResponse.headers.get('set-cookie').split(';')[0];
    csrfToken = (await setupResponse.json()).csrfToken;
    assert.ok(adminCookie);
    assert.ok(csrfToken);
    const authenticatedSession = await requestJson('/api/admin/session');
    assert.equal(authenticatedSession.data.authenticated, true);
    assert.equal(authenticatedSession.data.storageConfigured, true);
    const invalidEmail = await requestJson('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'other@example.com', password: 'a-strong-password-123' })
    });
    assert.equal(invalidEmail.response.status, 401);
    const validLogin = await requestJson('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'RAVU.FX@gmail.com', password: 'a-strong-password-123' })
    });
    assert.equal(validLogin.response.status, 200);
  });

  await t.test('lets admins replace the shared header logo', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r3sAAAAASUVORK5CYII=',
      'base64'
    );
    const unauthorized = await fetch(`${baseUrl}/api/admin/site-logo`, { method: 'PUT' });
    assert.equal(unauthorized.status, 401);

    const uploadLogo = async () => {
      const body = new FormData();
      body.set('image', new Blob([png], { type: 'image/png' }), 'site-logo.png');
      return requestJson('/api/admin/site-logo', { method: 'PUT', body });
    };

    const first = await uploadLogo();
    assert.equal(first.response.status, 200, first.data.error);
    assert.match(first.data.logoUrl, /^\/uploads\/[a-f0-9-]+\.png$/);
    const logoRedirect = await fetch(`${baseUrl}/api/site-logo`, { redirect: 'manual' });
    assert.equal(logoRedirect.status, 302);
    assert.equal(logoRedirect.headers.get('location'), first.data.logoUrl);
    assert.equal((await requestJson(first.data.logoUrl)).response.status, 200);

    const replacement = await uploadLogo();
    assert.equal(replacement.response.status, 200, replacement.data.error);
    assert.notEqual(replacement.data.logoUrl, first.data.logoUrl);
    assert.equal((await requestJson(first.data.logoUrl)).response.status, 404);
    assert.equal((await requestJson(replacement.data.logoUrl)).response.status, 200);
  });

  await t.test('supports one to four homepage designs and supports ordering', async () => {
    const initial = await requestJson('/api/admin/designs?category=marketing-branding');
    const existing = initial.data.designs.map(design => design.id);
    const single = await requestJson('/api/admin/featured', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'marketing-branding', designIds: existing.slice(0, 1) })
    });
    assert.equal(single.response.status, 200, single.data.error);
    const homepageWithSingle = await requestJson('/api/portfolio');
    const marketingWithSingle = homepageWithSingle.data.categories.find(category => category.slug === 'marketing-branding');
    assert.deepEqual(marketingWithSingle.designs.map(design => design.id), existing.slice(0, 1));

    const none = await requestJson('/api/admin/featured', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'marketing-branding', designIds: [] })
    });
    assert.equal(none.response.status, 400);
    const tooMany = await requestJson('/api/admin/featured', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'marketing-branding', designIds: [...existing.slice(0, 4), 'not-a-design'] })
    });
    assert.equal(tooMany.response.status, 400);
    const restored = await requestJson('/api/admin/featured', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'marketing-branding', designIds: existing.slice(0, 4) })
    });
    assert.equal(restored.response.status, 200, restored.data.error);

    const reversed = [...existing].reverse();
    const reordered = await requestJson('/api/admin/design-order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'marketing-branding', designIds: reversed })
    });
    assert.equal(reordered.response.status, 200);
    assert.deepEqual(reordered.data.designs.map(design => design.id), reversed);
  });

  await t.test('manages category subsections, batch uploads, design assignments, ordering, and deletion', async () => {
    for (const category of CATEGORY_DEFINITIONS) {
      const page = await fetch(`${baseUrl}/${category.slug}`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /id="categorySections"/);
    }

    const firstSection = await requestJson('/api/admin/sections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'typography', title: 'Editorial studies' })
    });
    assert.equal(firstSection.response.status, 201, firstSection.data.error);
    const secondSection = await requestJson('/api/admin/sections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'typography', title: 'Poster lettering' })
    });
    assert.equal(secondSection.response.status, 201, secondSection.data.error);

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r3sAAAAASUVORK5CYII=',
      'base64'
    );
    const uploads = new FormData();
    uploads.append('images', new Blob([png], { type: 'image/png' }), 'First Artwork.png');
    uploads.append('images', new Blob([png], { type: 'image/png' }), 'Second Artwork.png');
    const batch = await requestJson(`/api/admin/sections/${firstSection.data.section.id}/designs`, {
      method: 'POST', body: uploads
    });
    assert.equal(batch.response.status, 201, batch.data.error);
    assert.deepEqual(batch.data.designs.map(design => design.title), ['First Artwork', 'Second Artwork']);
    assert.ok(batch.data.designs.every(design => design.sectionId === firstSection.data.section.id));

    const categoryPage = await requestJson('/api/categories/typography/designs');
    assert.equal(categoryPage.response.status, 200);
    assert.equal(categoryPage.data.sections[0].title, 'Editorial studies');
    assert.deepEqual(categoryPage.data.sections[0].designs.map(design => design.id),
      batch.data.designs.map(design => design.id));

    const existing = (await requestJson('/api/admin/designs?category=typography')).data.designs
      .find(design => !design.sectionId);
    const assignment = await requestJson(`/api/admin/designs/${existing.id}/section`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sectionId: secondSection.data.section.id })
    });
    assert.equal(assignment.response.status, 200, assignment.data.error);
    assert.equal(assignment.data.design.sectionId, secondSection.data.section.id);

    const rename = await requestJson(`/api/admin/sections/${firstSection.data.section.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Type experiments' })
    });
    assert.equal(rename.response.status, 200, rename.data.error);
    const order = await requestJson('/api/admin/section-order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category: 'typography',
        ids: [secondSection.data.section.id, firstSection.data.section.id]
      })
    });
    assert.equal(order.response.status, 200, order.data.error);
    assert.deepEqual(order.data.sections.map(section => section.title), ['Poster lettering', 'Type experiments']);

    const otherCategorySection = await requestJson('/api/admin/sections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'product-design', title: 'Packaging' })
    });
    assert.equal(otherCategorySection.response.status, 201, otherCategorySection.data.error);
    const wrongCategory = await requestJson(`/api/admin/designs/${existing.id}/section`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sectionId: otherCategorySection.data.section.id })
    });
    assert.equal(wrongCategory.response.status, 400);

    const removeSection = await requestJson(`/api/admin/sections/${firstSection.data.section.id}`, {
      method: 'DELETE'
    });
    assert.equal(removeSection.response.status, 200, removeSection.data.error);
    const afterDelete = await requestJson('/api/categories/typography/designs');
    assert.ok(batch.data.designs.every(design =>
      afterDelete.data.designs.find(item => item.id === design.id).sectionId === null));
    assert.equal((await requestJson(batch.data.designs[0].image)).response.status, 200);
  });

  await t.test('uploads, edits, replaces, features, and deletes a design', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r3sAAAAASUVORK5CYII=',
      'base64'
    );
    const upload = new FormData();
    upload.set('category', 'marketing-branding');
    upload.set('title', 'Managed API Upload');
    upload.set('description', 'A design created through the admin upload workflow.');
    upload.set('image', new Blob([png], { type: 'image/png' }), 'managed.png');
    const created = await requestJson('/api/admin/designs', { method: 'POST', body: upload });
    assert.equal(created.response.status, 201, created.data.error);
    const id = created.data.design.id;
    const firstImage = created.data.design.image_url;
    assert.match(firstImage, /^\/uploads\/[a-f0-9-]+\.png$/);
    assert.equal((await requestJson(firstImage)).response.status, 200);

    const update = new FormData();
    update.set('category', 'marketing-branding');
    update.set('title', 'Managed API Upload Updated');
    update.set('description', 'Updated description, with a replacement image.');
    update.set('image', new Blob([png], { type: 'image/png' }), 'replacement.png');
    const edited = await requestJson(`/api/admin/designs/${id}`, { method: 'PUT', body: update });
    assert.equal(edited.response.status, 200, edited.data.error);
    assert.equal(edited.data.design.title, 'Managed API Upload Updated');
    assert.notEqual(edited.data.design.image_url, firstImage);
    assert.equal((await requestJson(firstImage)).response.status, 404);

    const categoryDesigns = (await requestJson('/api/admin/designs?category=marketing-branding')).data.designs;
    const featuredIds = [id, ...categoryDesigns.filter(design => design.id !== id).slice(0, 3).map(design => design.id)];
    const selection = await requestJson('/api/admin/featured', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'marketing-branding', designIds: featuredIds })
    });
    assert.equal(selection.response.status, 200);
    const homepage = await requestJson('/api/portfolio');
    const marketing = homepage.data.categories.find(category => category.slug === 'marketing-branding');
    assert.deepEqual(marketing.designs.map(design => design.id), featuredIds);
    assert.equal(marketing.designs.length, 4);

    const deleted = await requestJson(`/api/admin/designs/${id}`, { method: 'DELETE' });
    assert.equal(deleted.response.status, 200);
    assert.equal((await requestJson(edited.data.design.image_url)).response.status, 404);
    const afterDelete = await requestJson('/api/portfolio');
    assert.equal(afterDelete.data.categories.find(category => category.slug === 'marketing-branding').designs.length, 3);
    assert.ok(!(await requestJson('/api/categories/marketing-branding/designs')).data.designs.some(design => design.id === id));
  });

  await t.test('updates editable homepage and contact content', async () => {
    const current = await requestJson('/api/admin/content');
    const content = {
      ...current.data.content,
      heroLead: 'Updated portfolio introduction.',
      aboutSummary: 'Updated About summary.',
      contactEmail: 'hello@example.com'
    };
    const categories = current.data.categories.map(category => ({
      slug: category.slug,
      title: category.title,
      description: category.description,
      marqueeText: category.marqueeText,
      visible: category.visible
    }));
    categories[0].title = 'LOGO DESIGNS / SELECTED';
    categories[0].marqueeText = 'LOGOPHOLIO CUSTOM';
    categories[2].marqueeText = 'BRANDING CUSTOM';
    const customSections = [
      {
        id: 'custom-intro',
        title: 'A new homepage section',
        description: 'Admin-created content appears after the design archive.',
        visible: true
      },
      {
        id: 'custom-hidden',
        title: 'Hidden homepage section',
        description: 'This section is saved but not published.',
        visible: false
      }
    ];
    const update = await requestJson('/api/admin/content', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, categories, customSections })
    });
    assert.equal(update.response.status, 200, update.data.error);
    const publicContent = await requestJson('/api/portfolio');
    assert.equal(publicContent.data.content.heroLead, content.heroLead);
    assert.equal(publicContent.data.content.contactEmail, content.contactEmail);
    assert.equal(publicContent.data.categories[0].title, categories[0].title);
    assert.equal(publicContent.data.categories[0].marqueeText, categories[0].marqueeText);
    assert.equal(publicContent.data.categories[2].marqueeText, categories[2].marqueeText);
    assert.equal(publicContent.data.categories.length, 4);
    assert.deepEqual(publicContent.data.customSections.map(section => section.id), ['custom-intro']);
    const adminContent = await requestJson('/api/admin/content');
    assert.deepEqual(adminContent.data.customSections.map(section => section.id), ['custom-intro', 'custom-hidden']);
    assert.equal(adminContent.data.customSections[1].visible, false);

    const duplicateCustomSection = await requestJson('/api/admin/content', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content,
        categories,
        customSections: [
          { ...customSections[0] },
          { ...customSections[1], id: customSections[0].id }
        ]
      })
    });
    assert.equal(duplicateCustomSection.response.status, 400);
    assert.deepEqual((await requestJson('/api/portfolio')).data.customSections.map(section => section.id), ['custom-intro']);
  });

  await t.test('stores and publishes an independent background for each logo', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r3sAAAAASUVORK5CYII=',
      'base64'
    );
    const upload = new FormData();
    upload.set('category', 'logo-designs');
    upload.set('title', 'Background Test Logo');
    upload.set('description', 'Backgrounds are display-only.');
    upload.set('displayBackgroundColor', '#12ab34');
    upload.set('image', new Blob([png], { type: 'image/png' }), 'logo.png');
    const created = await requestJson('/api/admin/designs', { method: 'POST', body: upload });
    assert.equal(created.response.status, 201, created.data.error);
    const logo = created.data.design;
    assert.equal(logo.display_background_color, '#12ab34');
    const originalImage = logo.image_url;

    const update = new FormData();
    update.set('category', 'logo-designs');
    update.set('title', logo.title);
    update.set('description', logo.description);
    update.set('displayBackgroundColor', '#abcdef');
    const edited = await requestJson(`/api/admin/designs/${logo.id}`, { method: 'PUT', body: update });
    assert.equal(edited.response.status, 200, edited.data.error);
    assert.equal(edited.data.design.display_background_color, '#abcdef');
    assert.equal(edited.data.design.image_url, originalImage);
    const adminDesigns = await requestJson('/api/admin/designs?category=logo-designs');
    assert.equal(adminDesigns.data.designs.find(design => design.id === logo.id).displayBackgroundColor, '#abcdef');

    const logoDesigns = adminDesigns.data.designs;
    const featuredIds = [logo.id, ...logoDesigns.filter(design => design.id !== logo.id).slice(0, 3).map(design => design.id)];
    const selection = await requestJson('/api/admin/featured', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'logo-designs', designIds: featuredIds })
    });
    assert.equal(selection.response.status, 200, selection.data.error);
    const homepage = await requestJson('/api/portfolio');
    assert.equal(homepage.data.categories[0].designs[0].displayBackgroundColor, '#abcdef');
    const archive = await requestJson('/api/categories/logo-designs/designs');
    assert.equal(archive.data.designs.find(design => design.id === logo.id).displayBackgroundColor, '#abcdef');

    const invalid = new FormData();
    invalid.set('category', 'logo-designs');
    invalid.set('title', 'Invalid background');
    invalid.set('description', 'Invalid colors must be rejected.');
    invalid.set('displayBackgroundColor', 'not-a-color');
    invalid.set('image', new Blob([png], { type: 'image/png' }), 'invalid.png');
    assert.equal((await requestJson('/api/admin/designs', { method: 'POST', body: invalid })).response.status, 400);
    assert.equal((await requestJson(`/api/admin/designs/${logo.id}`, { method: 'DELETE' })).response.status, 200);
    assert.equal((await requestJson(originalImage)).response.status, 404);
  });

  await t.test('manages certificate uploads, replacement, public downloads, and ordering', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r3sAAAAASUVORK5CYII=',
      'base64'
    );
    const firstUpload = new FormData();
    firstUpload.set('title', 'Portfolio Certificate');
    firstUpload.set('description', 'A PDF certificate.');
    firstUpload.set('file', new Blob([pdf], { type: 'application/pdf' }), 'certificate.pdf');
    const first = await requestJson('/api/admin/certificates', { method: 'POST', body: firstUpload });
    assert.equal(first.response.status, 201, first.data.error);
    const secondUpload = new FormData();
    secondUpload.set('title', 'Workshop Certificate');
    secondUpload.set('description', 'An image certificate.');
    secondUpload.set('file', new Blob([png], { type: 'image/png' }), 'workshop.png');
    const second = await requestJson('/api/admin/certificates', { method: 'POST', body: secondUpload });
    assert.equal(second.response.status, 201, second.data.error);
    const linkedUpload = new FormData();
    linkedUpload.set('title', 'Online Certificate');
    linkedUpload.set('description', 'A certificate hosted externally.');
    linkedUpload.set('certificateUrl', 'https://certificates.example.org/portfolio');
    const linked = await requestJson('/api/admin/certificates', { method: 'POST', body: linkedUpload });
    assert.equal(linked.response.status, 201, linked.data.error);
    assert.equal(linked.data.certificate.fileType, 'link');
    assert.equal(linked.data.certificate.file, 'https://certificates.example.org/portfolio');

    for (const unsafeUrl of [
      'http://certificates.example.org/portfolio',
      'javascript:alert(1)',
      'https://user:password@certificates.example.org/portfolio'
    ]) {
      const invalidUpload = new FormData();
      invalidUpload.set('title', 'Unsafe Link');
      invalidUpload.set('certificateUrl', unsafeUrl);
      assert.equal((await requestJson('/api/admin/certificates', { method: 'POST', body: invalidUpload })).response.status, 400);
    }

    const linkedUpdate = new FormData();
    linkedUpdate.set('title', 'Online Certificate Updated');
    linkedUpdate.set('description', 'Updated external certificate link.');
    linkedUpdate.set('certificateUrl', 'https://certificates.example.org/updated');
    const updatedLink = await requestJson(`/api/admin/certificates/${linked.data.certificate.id}`, {
      method: 'PUT', body: linkedUpdate
    });
    assert.equal(updatedLink.response.status, 200, updatedLink.data.error);
    assert.equal(updatedLink.data.certificate.fileType, 'link');
    assert.equal(updatedLink.data.certificate.file, 'https://certificates.example.org/updated');

    const publicList = await requestJson('/api/certificates');
    assert.equal(publicList.response.status, 200);
    assert.deepEqual(publicList.data.certificates.map(certificate => certificate.id), [
      first.data.certificate.id, second.data.certificate.id, linked.data.certificate.id
    ]);
    assert.equal(publicList.data.certificates[2].fileType, 'link');
    assert.equal(publicList.data.certificates[2].file, 'https://certificates.example.org/updated');
    const pdfResponse = await fetch(`${baseUrl}${first.data.certificate.file}?download=1`);
    assert.equal(pdfResponse.status, 200);
    assert.match(pdfResponse.headers.get('content-disposition'), /attachment/);
    assert.ok((await pdfResponse.text()).startsWith('%PDF-1.4'));

    const replacement = new FormData();
    replacement.set('title', 'Portfolio Certificate Updated');
    replacement.set('description', 'Updated certificate details.');
    replacement.set('file', new Blob([png], { type: 'image/png' }), 'certificate-replacement.png');
    const updated = await requestJson(`/api/admin/certificates/${first.data.certificate.id}`, {
      method: 'PUT', body: replacement
    });
    assert.equal(updated.response.status, 200, updated.data.error);
    assert.equal(updated.data.certificate.fileType, 'png');
    assert.equal(updated.data.certificate.title, 'Portfolio Certificate Updated');
    assert.equal((await requestJson(first.data.certificate.file)).response.status, 404);

    const reorderedIds = [second.data.certificate.id, first.data.certificate.id, linked.data.certificate.id];
    const reordered = await requestJson('/api/admin/certificate-order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: reorderedIds })
    });
    assert.equal(reordered.response.status, 200, reordered.data.error);
    assert.deepEqual(reordered.data.certificates.map(certificate => certificate.id), reorderedIds);
    assert.equal((await requestJson('/api/admin/certificate-order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [reorderedIds[0]] })
    })).response.status, 400);

    assert.equal((await requestJson(`/api/admin/certificates/${second.data.certificate.id}`, { method: 'DELETE' })).response.status, 200);
    assert.equal((await requestJson(`/api/admin/certificates/${first.data.certificate.id}`, { method: 'DELETE' })).response.status, 200);
    assert.equal((await requestJson(`/api/admin/certificates/${linked.data.certificate.id}`, { method: 'DELETE' })).response.status, 200);
    assert.equal((await requestJson(updated.data.certificate.file)).response.status, 404);
  });

  await t.test('manages image and SVG tool logos, homepage visibility, and ordering', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r3sAAAAASUVORK5CYII=',
      'base64'
    );
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>';
    const firstUpload = new FormData();
    firstUpload.set('name', 'Vector Tool');
    firstUpload.set('category', 'Design');
    firstUpload.set('visible', 'true');
    firstUpload.set('image', new Blob([svg], { type: 'image/svg+xml' }), 'vector.svg');
    const first = await requestJson('/api/admin/tools', { method: 'POST', body: firstUpload });
    assert.equal(first.response.status, 201, first.data.error);
    assert.equal(first.data.tool.visible, 1);
    const svgResponse = await fetch(`${baseUrl}${first.data.tool.image}`);
    assert.equal(svgResponse.status, 200);
    assert.match(svgResponse.headers.get('content-security-policy'), /sandbox/);

    const secondUpload = new FormData();
    secondUpload.set('name', 'Hidden Tool');
    secondUpload.set('category', 'Development');
    secondUpload.set('visible', 'false');
    secondUpload.set('image', new Blob([png], { type: 'image/png' }), 'hidden.png');
    const second = await requestJson('/api/admin/tools', { method: 'POST', body: secondUpload });
    assert.equal(second.response.status, 201, second.data.error);
    assert.deepEqual((await requestJson('/api/tools')).data.tools.map(tool => tool.name), ['Vector Tool']);

    const show = new FormData();
    show.set('name', 'Vector Tool');
    show.set('category', 'Design');
    show.set('visible', 'false');
    const hidden = await requestJson(`/api/admin/tools/${first.data.tool.id}`, { method: 'PUT', body: show });
    assert.equal(hidden.response.status, 200, hidden.data.error);
    assert.equal((await requestJson('/api/tools')).data.tools.length, 0);

    const replace = new FormData();
    replace.set('name', 'Vector Tool Updated');
    replace.set('category', 'Design');
    replace.set('visible', 'true');
    replace.set('image', new Blob([png], { type: 'image/png' }), 'vector-replacement.png');
    const updated = await requestJson(`/api/admin/tools/${first.data.tool.id}`, { method: 'PUT', body: replace });
    assert.equal(updated.response.status, 200, updated.data.error);
    assert.equal((await requestJson(first.data.tool.image)).response.status, 404);
    assert.equal((await requestJson('/api/tools')).data.tools[0].name, 'Vector Tool Updated');

    const orderedIds = [second.data.tool.id, first.data.tool.id];
    const reordered = await requestJson('/api/admin/tool-order', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: orderedIds })
    });
    assert.equal(reordered.response.status, 200, reordered.data.error);
    assert.deepEqual(reordered.data.tools.map(tool => tool.id), orderedIds);

    const invalidUpload = new FormData();
    invalidUpload.set('name', 'Unsafe Tool');
    invalidUpload.set('image', new Blob(['<svg><script>alert(1)</script></svg>'], { type: 'image/svg+xml' }), 'unsafe.svg');
    assert.equal((await requestJson('/api/admin/tools', { method: 'POST', body: invalidUpload })).response.status, 415);

    assert.equal((await requestJson(`/api/admin/tools/${second.data.tool.id}`, { method: 'DELETE' })).response.status, 200);
    assert.equal((await requestJson(`/api/admin/tools/${first.data.tool.id}`, { method: 'DELETE' })).response.status, 200);
    assert.equal((await requestJson(updated.data.tool.image)).response.status, 404);
  });

  await t.test('requires CSRF protection for sign-out and clears the admin session', async () => {
    const rejected = await fetch(`${baseUrl}/api/admin/logout`, {
      method: 'POST',
      headers: { cookie: adminCookie }
    });
    assert.equal(rejected.status, 403);
    const logout = await requestJson('/api/admin/logout', { method: 'POST' });
    assert.equal(logout.response.status, 200);
    assert.equal(logout.data.authenticated, false);
    adminCookie = null;
    csrfToken = '';
    assert.equal((await requestJson('/api/admin/session')).data.authenticated, false);
  });
});
