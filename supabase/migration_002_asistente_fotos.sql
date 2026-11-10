-- =====================================================================
--  StockFácil · Migración 002: fotos, medidas, pesos, asistente IA
--  Ejecutar UNA vez en Supabase > SQL Editor (después de schema.sql)
-- =====================================================================

-- 1) Ficha completa del producto (lista para publicar en tiendas online)
alter table public.products
  add column if not exists description text,
  add column if not exists brand       text,
  add column if not exists barcode     text,
  add column if not exists image_url   text,
  add column if not exists weight_kg   numeric(10,3) check (weight_kg >= 0),
  add column if not exists length_cm   numeric(10,2) check (length_cm >= 0),
  add column if not exists width_cm    numeric(10,2) check (width_cm >= 0),
  add column if not exists height_cm   numeric(10,2) check (height_cm >= 0),
  add column if not exists attributes  jsonb not null default '{}'::jsonb;  -- talle, color, material...

-- 2) Los movimientos pueden venir también del asistente
alter table public.movements drop constraint if exists movements_source_check;
alter table public.movements
  add constraint movements_source_check check (source in ('web','telegram','asistente'));

-- 3) Clave para integrar con webs de venta (catálogo por API)
alter table public.businesses
  add column if not exists api_key text unique default replace(gen_random_uuid()::text, '-', '');
update public.businesses set api_key = replace(gen_random_uuid()::text, '-', '') where api_key is null;

create or replace function public.regenerate_api_key(p_business uuid)
returns text language plpgsql security definer set search_path = public as $$
declare k text;
begin
  if not public.owns_business(p_business) then raise exception 'Sin acceso'; end if;
  k := replace(gen_random_uuid()::text, '-', '');
  update public.businesses set api_key = k where id = p_business;
  return k;
end $$;
grant execute on function public.regenerate_api_key(uuid) to authenticated;

-- 4) Fotos: bucket público "product-images", carpeta = id del negocio
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "product_images_insert" on storage.objects;
drop policy if exists "product_images_update" on storage.objects;
drop policy if exists "product_images_delete" on storage.objects;

create policy "product_images_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images'
              and public.owns_business(((storage.foldername(name))[1])::uuid));
create policy "product_images_update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images'
         and public.owns_business(((storage.foldername(name))[1])::uuid));
create policy "product_images_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images'
         and public.owns_business(((storage.foldername(name))[1])::uuid));
