const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { createVercelFallbackApp } = require('./server');

const server = createVercelFallbackApp().listen(0, '127.0.0.1');
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('read-only Vercel fallback serves all original portfolio categories, images, and marquees', async () => {
  const response = await fetch(`${baseUrl}/api/portfolio`);
  assert.equal(response.status, 200);
  const portfolio = await response.json();
  assert.equal(portfolio.storageConfigured, false);
  assert.deepEqual(portfolio.categories.map(category => category.marqueeText), [
    'LOGOPHOLIO', 'PACKAGING', 'BRANDING', 'TYPOPHOLIO'
  ]);
  for (const category of portfolio.categories) {
    assert.equal(category.designs.length, 4, `${category.slug} should have four featured designs`);
    for (const design of category.designs) {
      const localImage = path.join(__dirname, decodeURIComponent(design.image));
      assert.ok(fs.existsSync(localImage), `${design.image} should exist`);
    }
  }
});

test('read-only fallback serves category archives and explains disabled admin editing', async () => {
  const archive = await fetch(`${baseUrl}/api/categories/product-design/designs`);
  assert.equal(archive.status, 200);
  const result = await archive.json();
  assert.equal(result.category.slug, 'product-design');
  assert.ok(result.designs.length >= 4);

  const session = await fetch(`${baseUrl}/api/admin/session`);
  assert.equal(session.status, 200);
  assert.equal((await session.json()).storageConfigured, false);

  const adminRequest = await fetch(`${baseUrl}/api/admin/content`);
  assert.equal(adminRequest.status, 503);
  assert.match((await adminRequest.json()).error, /persistent storage is configured/);

  const dashboard = await fetch(`${baseUrl}/admin`);
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /PERSISTENT STORAGE REQUIRED/);
});
