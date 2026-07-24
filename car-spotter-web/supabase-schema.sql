-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run

create table if not exists cars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  make text,
  model text,
  year text,
  body_style text,
  color text,
  rarity_tier text,
  value numeric,
  fun_fact text,
  photo_url text,
  spotted_photo_url text,
  vin text,
  verified boolean default false,
  spotted_at timestamptz default now()
);

alter table cars enable row level security;

create policy "Users can view their own cars"
  on cars for select
  using (auth.uid() = user_id);

create policy "Users can insert their own cars"
  on cars for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own cars"
  on cars for delete
  using (auth.uid() = user_id);
