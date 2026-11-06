begin;

create table if not exists public.internal_sections (
  id text primary key,
  category_slug text not null references public.categories(slug) on delete cascade,
  title text not null,
  position integer not null
);

alter table public.designs
  add column if not exists section_id text
  references public.internal_sections(id) on delete set null;

create index if not exists internal_sections_category_position_idx
  on public.internal_sections(category_slug, position, id);

create index if not exists designs_category_position_idx
  on public.designs(category_slug, position, created_at, id);

notify pgrst, 'reload schema';

commit;
