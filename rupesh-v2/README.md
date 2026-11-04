# Ravu.FX portfolio

The portfolio is a Node.js application backed by SQLite. Its four fixed design categories are Logo Designs, Product Design, Marketing & Branding, and Typography. Original portfolio records and assets are imported into the database on first startup; the original assets remain in `assets/`.

## Run locally

1. Install Node.js 22.13 or newer.
2. From this directory, run `npm install`.
3. Run `npm start`.
4. Open `http://127.0.0.1:8000`. Open the admin dashboard at `http://127.0.0.1:8000/admin`.
5. On first startup, copy the one-time setup token from the server terminal into the dashboard, enter your admin email, and set a password of at least 12 characters.

Sign in at `/admin` using the admin email and password. The initial account is configured with the email you provide during first-time setup.

The server listens on `127.0.0.1` by default. To expose it on a server interface, set `HOST=0.0.0.0` and `PORT` as appropriate.

## Design management

The dashboard supports design uploads (PNG, JPEG, or WebP, up to 15 MB), names, descriptions, editing, image replacement, deletion, ordering, and one to four selected homepage designs in each category. Homepage selections save automatically when their checkboxes change. Logo designs have an independent display background color, including a custom HEX value; this does not change the stored image. Category pages contain every design in that category.

The same dashboard manages certificates as PDF, PNG, or JPG uploads (up to 25 MB) or secure HTTPS links, including descriptions, replacement, deletion, ordering, and the public archive at `/certificates`. Uploaded certificates can be downloaded; linked certificates open their external page. Tool and software logos can be uploaded as PNG, JPEG, WebP, or self-contained SVG (up to 15 MB), edited, ordered, and shown or hidden on the homepage. Uploaded files and management records are stored in the persistent uploads directory and SQLite database.

Homepage copy, the four fixed category headings/descriptions/visibility, About content, phone, email, and Instagram handle are editable from the dashboard. Admins can also add, edit, reorder, show/hide, and remove up to 50 additional homepage content sections; these do not add or change design categories.

## Persistent storage and deployment

By default, the SQLite database is stored at `.data/portfolio.sqlite` and uploaded images are stored in `uploads/`. Back up both locations. Set `PORTFOLIO_DATA_DIR`, `PORTFOLIO_DB_PATH`, or `PORTFOLIO_UPLOAD_DIR` to use other paths.

Deploy this application to a Node.js host with a persistent writable filesystem or mounted volume. Static-only hosts and ephemeral serverless filesystems do not preserve SQLite data or uploaded images across restarts/redeploys. For production, terminate HTTPS at the host, set `NODE_ENV=production`, and provide an `ADMIN_SESSION_SECRET` with at least 32 bytes so admin cookies remain secure and stable. Keep the one-time setup token private and choose a strong admin password.

## Validate

Run `npm test` for the API, authentication, category, feature-selection, content-management, design/logo background, certificate, tool logo, upload, ordering, replacement, download, and deletion checks.
