create table if not exists public.categories (
  slug text primary key,
  title text not null,
  description text not null,
  visible boolean not null default true,
  sort_order integer not null
);

create table if not exists public.internal_sections (
  id text primary key,
  category_slug text not null references public.categories(slug) on delete cascade,
  title text not null,
  position integer not null
);

create table if not exists public.designs (
  id text primary key,
  category_slug text not null references public.categories(slug),
  title text not null,
  description text not null,
  image_url text not null,
  position integer not null,
  created_at text not null,
  display_background_color text not null default '#ffffff',
  section_id text references public.internal_sections(id) on delete set null
);

alter table public.designs
  add column if not exists section_id text references public.internal_sections(id) on delete set null;

create index if not exists designs_category_position_idx
  on public.designs(category_slug, position, created_at, id);

create index if not exists internal_sections_category_position_idx
  on public.internal_sections(category_slug, position, id);

create table if not exists public.featured_designs (
  category_slug text not null references public.categories(slug) on delete cascade,
  design_id text not null unique references public.designs(id) on delete cascade,
  position integer not null,
  primary key (category_slug, position)
);

create table if not exists public.site_settings (
  key text primary key,
  value text not null
);

create table if not exists public.admin_credentials (
  key text primary key,
  salt text not null,
  password_hash text not null,
  email text not null default 'ravu.fx@gmail.com'
);

create table if not exists public.certificates (
  id text primary key,
  title text not null,
  description text not null,
  file_url text not null,
  file_type text not null,
  position integer not null,
  created_at text not null
);

create table if not exists public.tools (
  id text primary key,
  name text not null,
  category text not null default '',
  image_url text not null,
  visible boolean not null default true,
  position integer not null,
  created_at text not null
);

create table if not exists public.custom_home_sections (
  id text primary key,
  title text not null,
  description text not null,
  visible boolean not null default true,
  position integer not null
);

insert into storage.buckets (id, name, public)
values ('portfolio-assets', 'portfolio-assets', true)
on conflict (id) do update set public = excluded.public;
