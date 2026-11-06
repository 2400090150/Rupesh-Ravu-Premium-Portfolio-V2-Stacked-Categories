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

The dashboard supports design uploads (PNG, JPEG, or WebP, up to 15 MB), names, descriptions, editing, image replacement, deletion, ordering, and one to four selected homepage designs in each category. Homepage selections and design ordering are published when their Save buttons are clicked. Admins can create, rename, delete, and order database-backed subsections in each category, assign designs to subsections, and upload up to 20 images at a time into a subsection. Category archive pages display designs grouped under their saved subsection titles; designs without a subsection remain visible in the category archive. Logo designs have an independent display background color, including a custom HEX value; this does not change the stored image.

The same dashboard manages certificates as PDF, PNG, or JPG uploads (up to 25 MB) or secure HTTPS links, including descriptions, replacement, deletion, ordering, and the public archive at `/certificates`. Uploaded certificates can be downloaded; linked certificates open their external page. Tool and software logos can be uploaded as PNG, JPEG, WebP, or self-contained SVG (up to 15 MB), edited, ordered, and shown or hidden on the homepage. Uploaded files and management records are stored in the persistent uploads directory and SQLite database.

Homepage copy, the four fixed category headings/descriptions/visibility, About content, phone, email, and Instagram handle are editable from the dashboard. Admins can also add, edit, reorder, show/hide, and remove up to 50 additional homepage content sections; these do not add or change design categories.

## Persistent storage and deployment

By default, the SQLite database is stored at `.data/portfolio.sqlite` and uploaded images are stored in `uploads/`. Back up both locations. Set `PORTFOLIO_DATA_DIR`, `PORTFOLIO_DB_PATH`, or `PORTFOLIO_UPLOAD_DIR` to use other paths.

Deploy this application to a Node.js host with a persistent writable filesystem or mounted volume. Static-only hosts and ephemeral serverless filesystems do not preserve SQLite data or uploaded images across restarts/redeploys. For production, terminate HTTPS at the host, set `NODE_ENV=production`, and provide an `ADMIN_SESSION_SECRET` with at least 32 bytes so admin cookies remain secure and stable. Keep the one-time setup token private and choose a strong admin password.

### Deploy to Vercel

The Vercel configuration serves this folder's static site and routes API requests to an Express function. Vercel's function filesystem is temporary, so configure Supabase before deploying to keep Admin edits and uploads persistent:

1. Create a Supabase project and run [`supabase/schema.sql`](./supabase/schema.sql) in its SQL Editor. The schema includes persistent category subsections and the optional design-to-subsection relationship.
2. In Vercel, import the GitHub repository and set its **Root Directory** to `rupesh-v2`.
3. Add these environment variables to the Vercel project for every deployment environment:
   - `SUPABASE_URL`: the Supabase project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: the project's service-role key. Keep it private; never use it in browser code.
   - `ADMIN_SESSION_SECRET`: a private random value of at least 32 bytes.
   - `ADMIN_SETUP_TOKEN`: a private one-time setup token.
4. Before deploying, migrate existing Admin data and uploaded files from your local app. In PowerShell, set `$env:SUPABASE_URL` and `$env:SUPABASE_SERVICE_ROLE_KEY` to your private project values, then run `npm run migrate:supabase`.
5. Deploy, then open `/admin` and complete the one-time setup with the configured `ADMIN_SETUP_TOKEN` only if no admin account was migrated.

The `portfolio-assets` Supabase Storage bucket is created by the schema script and is public so portfolio images can load. Upload and metadata changes are stored in Supabase and survive function restarts and redeployments. The migration command copies existing portfolio records, Admin settings, credentials, and referenced uploads.

Until Supabase credentials are configured, Vercel serves the original artwork and category marquees in read-only fallback mode. If configured storage cannot initialize, the public portfolio also falls back to this read-only mode instead of returning API errors; the admin page explains that storage is unavailable. Admin editing and uploaded files require a working Supabase schema, connection, and configuration.

## Validate

Run `npm test` for the API, authentication, category, feature-selection, content-management, design/logo background, certificate, tool logo, upload, ordering, replacement, download, and deletion checks.
