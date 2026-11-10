-- =====================================================================
--  StockFácil · Esquema de base de datos (Supabase / PostgreSQL)
--  Ejecutar COMPLETO una sola vez en: Supabase > SQL Editor > New query
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Negocio del emprendedor (1 usuario = 1 o más negocios)
create table public.businesses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  currency    text not null default 'ARS',
  created_at  timestamptz not null default now()
);
create index businesses_owner_idx on public.businesses(owner_id);

-- Productos. El stock NO se edita a mano: lo mueven los triggers de movements.
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  sku         text,
  category    text,
  unit_cost   numeric(14,2) not null default 0 check (unit_cost >= 0),  -- costo promedio ponderado
  sale_price  numeric(14,2) not null default 0 check (sale_price >= 0),
  stock       numeric(14,3) not null default 0 check (stock >= 0),
  min_stock   numeric(14,3) not null default 0 check (min_stock >= 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index products_business_idx on public.products(business_id);
create unique index products_business_name_uq
  on public.products(business_id, lower(name)) where active;

-- Movimientos: única fuente de verdad para stock y caja
--   compra  -> entra stock, sale dinero (inversión)
--   venta   -> sale stock, entra dinero
--   ajuste  -> corrige stock (+/-), sin dinero
--   gasto   -> sale dinero (alquiler, envíos, publicidad...)
--   ingreso -> entra dinero (aporte, otros ingresos)
create type public.movement_type as enum ('compra','venta','ajuste','gasto','ingreso');

create table public.movements (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id  uuid references public.products(id) on delete restrict,
  type        public.movement_type not null,
  quantity    numeric(14,3) not null default 0,
  unit_price  numeric(14,2) not null default 0,  -- precio de venta o costo de compra
  unit_cost   numeric(14,2) not null default 0,  -- costo al momento (para calcular ganancia)
  total       numeric(14,2) not null default 0,  -- dinero que entra/sale
  note        text,
  source      text not null default 'web' check (source in ('web','telegram')),
  created_by  text,                               -- user id web o chat id de Telegram
  created_at  timestamptz not null default now(),
  constraint movements_product_required
    check (type in ('gasto','ingreso') or product_id is not null)
);
create index movements_business_date_idx on public.movements(business_id, created_at desc);
create index movements_product_idx on public.movements(product_id);

-- Chats de Telegram vinculados a un negocio
create table public.telegram_links (
  chat_id     bigint primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  username    text,
  first_name  text,
  created_at  timestamptz not null default now()
);
create index telegram_links_business_idx on public.telegram_links(business_id);

-- Códigos temporales para vincular Telegram desde la web
create table public.link_codes (
  code        text primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '15 minutes',
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. TRIGGERS DE NEGOCIO
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger products_touch
  before update on public.products
  for each row execute function public.touch_updated_at();

-- Al insertar un movimiento: valida, completa precios/totales y actualiza stock
create or replace function public.movements_before_insert()
returns trigger language plpgsql as $$
declare
  p public.products%rowtype;
begin
  if new.type in ('gasto','ingreso') then
    new.product_id := null;
    new.quantity   := 0;
    new.unit_price := 0;
    new.unit_cost  := 0;
    if new.total is null or new.total <= 0 then
      raise exception 'El monto debe ser mayor a 0';
    end if;
    return new;
  end if;

  select * into p from public.products
   where id = new.product_id and business_id = new.business_id
   for update;
  if not found then
    raise exception 'Producto inexistente';
  end if;

  if new.type = 'compra' then
    if new.quantity <= 0 then raise exception 'La cantidad debe ser mayor a 0'; end if;
    if coalesce(new.unit_price, 0) <= 0 then new.unit_price := p.unit_cost; end if;
    new.unit_cost := new.unit_price;
    new.total     := round(new.quantity * new.unit_price, 2);
    update public.products
       set unit_cost = case
             when p.stock > 0 and new.unit_price > 0
               then round((p.stock * p.unit_cost + new.quantity * new.unit_price) / (p.stock + new.quantity), 2)
             when new.unit_price > 0 then new.unit_price
             else p.unit_cost end,
           stock = p.stock + new.quantity
     where id = p.id;

  elsif new.type = 'venta' then
    if new.quantity <= 0 then raise exception 'La cantidad debe ser mayor a 0'; end if;
    if p.stock < new.quantity then
      raise exception 'Stock insuficiente de "%": hay % disponibles', p.name, trim_scale(p.stock);
    end if;
    if coalesce(new.unit_price, 0) <= 0 then new.unit_price := p.sale_price; end if;
    new.unit_cost := p.unit_cost;
    new.total     := round(new.quantity * new.unit_price, 2);
    update public.products set stock = p.stock - new.quantity where id = p.id;

  elsif new.type = 'ajuste' then
    if new.quantity = 0 then raise exception 'El ajuste no puede ser 0'; end if;
    if p.stock + new.quantity < 0 then
      raise exception 'El ajuste deja el stock de "%" en negativo (hay %)', p.name, trim_scale(p.stock);
    end if;
    new.unit_price := 0;
    new.unit_cost  := p.unit_cost;
    new.total      := 0;
    update public.products set stock = p.stock + new.quantity where id = p.id;
  end if;

  return new;
end $$;

create trigger movements_bi
  before insert on public.movements
  for each row execute function public.movements_before_insert();

-- Al borrar un movimiento (deshacer): revierte el stock
create or replace function public.movements_after_delete()
returns trigger language plpgsql as $$
declare
  delta numeric;
  cur   numeric;
begin
  if old.product_id is null or old.type in ('gasto','ingreso') then
    return old;
  end if;
  delta := case old.type
             when 'compra' then -old.quantity
             when 'venta'  then  old.quantity
             when 'ajuste' then -old.quantity
           end;
  select stock into cur from public.products where id = old.product_id for update;
  if cur + delta < 0 then
    raise exception 'No se puede deshacer: el stock quedaría negativo (hay %)', trim_scale(cur);
  end if;
  update public.products set stock = cur + delta where id = old.product_id;
  return old;
end $$;

create trigger movements_ad
  after delete on public.movements
  for each row execute function public.movements_after_delete();

-- Los movimientos no se editan: se borran y se cargan de nuevo
create or replace function public.movements_no_update()
returns trigger language plpgsql as $$
begin
  raise exception 'Los movimientos no se pueden editar. Eliminá y volvé a cargar.';
end $$;

create trigger movements_bu
  before update on public.movements
  for each row execute function public.movements_no_update();

-- ---------------------------------------------------------------------
-- 3. SEGURIDAD (Row Level Security)
-- ---------------------------------------------------------------------
create or replace function public.owns_business(bid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.businesses where id = bid and owner_id = auth.uid());
$$;

alter table public.businesses     enable row level security;
alter table public.products       enable row level security;
alter table public.movements      enable row level security;
alter table public.telegram_links enable row level security;
alter table public.link_codes     enable row level security;

create policy "businesses_owner" on public.businesses
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "products_owner" on public.products
  for all using (public.owns_business(business_id)) with check (public.owns_business(business_id));

create policy "movements_select" on public.movements
  for select using (public.owns_business(business_id));
create policy "movements_insert" on public.movements
  for insert with check (public.owns_business(business_id));
create policy "movements_delete" on public.movements
  for delete using (public.owns_business(business_id));

create policy "tg_links_select" on public.telegram_links
  for select using (public.owns_business(business_id));
create policy "tg_links_delete" on public.telegram_links
  for delete using (public.owns_business(business_id));

create policy "link_codes_owner" on public.link_codes
  for all using (public.owns_business(business_id)) with check (public.owns_business(business_id));

-- ---------------------------------------------------------------------
-- 4. DASHBOARD
-- ---------------------------------------------------------------------
create or replace function public.get_dashboard(
  p_business uuid,
  p_from     timestamptz default date_trunc('month', now()),
  p_to       timestamptz default now(),
  p_tz       text        default 'America/Argentina/Buenos_Aires'
) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  k jsonb; serie jsonb; top jsonb; bajo jsonb; st jsonb; hist jsonb;
  ventas numeric; costo numeric; compras numeric; gastos numeric; ingresos numeric;
begin
  -- Usuarios web sólo ven su negocio. El bot (service role) no tiene auth.uid().
  if auth.uid() is not null and not public.owns_business(p_business) then
    raise exception 'Sin acceso a este negocio';
  end if;

  select coalesce(sum(total) filter (where type = 'venta'), 0),
         coalesce(sum(quantity * unit_cost) filter (where type = 'venta'), 0),
         coalesce(sum(total) filter (where type = 'compra'), 0),
         coalesce(sum(total) filter (where type = 'gasto'), 0),
         coalesce(sum(total) filter (where type = 'ingreso'), 0),
         jsonb_build_object(
           'cantidad_ventas',   count(*) filter (where type = 'venta'),
           'unidades_vendidas', coalesce(sum(quantity) filter (where type = 'venta'), 0))
    into ventas, costo, compras, gastos, ingresos, k
    from public.movements
   where business_id = p_business and created_at >= p_from and created_at < p_to;

  k := k || jsonb_build_object(
    'ventas',          ventas,
    'costo_ventas',    round(costo, 2),
    'ganancia_bruta',  round(ventas - costo, 2),
    'margen',          case when ventas > 0 then round((ventas - costo) / ventas * 100, 1) else 0 end,
    'compras',         compras,
    'gastos',          gastos,
    'otros_ingresos',  ingresos,
    'ganancia_neta',   round(ventas - costo + ingresos - gastos, 2),
    'entradas',        ventas + ingresos,
    'salidas',         compras + gastos,
    'balance_caja',    ventas + ingresos - compras - gastos,
    'ticket_promedio', case when (k->>'cantidad_ventas')::int > 0
                            then round(ventas / (k->>'cantidad_ventas')::int, 2) else 0 end
  );

  -- Serie diaria
  select coalesce(jsonb_agg(jsonb_build_object(
           'fecha',    d::date,
           'ventas',   coalesce(x.ventas, 0),
           'ganancia', coalesce(x.ganancia, 0),
           'entradas', coalesce(x.entradas, 0),
           'salidas',  coalesce(x.salidas, 0)) order by d), '[]'::jsonb)
    into serie
    from generate_series((p_from at time zone p_tz)::date,
                         ((p_to - interval '1 second') at time zone p_tz)::date,
                         interval '1 day') d
    left join (
      select (created_at at time zone p_tz)::date as dia,
             sum(total) filter (where type = 'venta') as ventas,
             round(sum(total - quantity * unit_cost) filter (where type = 'venta'), 2) as ganancia,
             sum(total) filter (where type in ('venta','ingreso')) as entradas,
             sum(total) filter (where type in ('compra','gasto')) as salidas
        from public.movements
       where business_id = p_business and created_at >= p_from and created_at < p_to
       group by 1
    ) x on x.dia = d::date;

  -- Productos más vendidos
  select coalesce(jsonb_agg(to_jsonb(t) order by t.ventas desc), '[]'::jsonb) into top
    from (
      select p.id, p.name as nombre,
             sum(m.quantity) as unidades,
             sum(m.total) as ventas,
             round(sum(m.total - m.quantity * m.unit_cost), 2) as ganancia
        from public.movements m
        join public.products p on p.id = m.product_id
       where m.business_id = p_business and m.type = 'venta'
         and m.created_at >= p_from and m.created_at < p_to
       group by p.id, p.name
       order by sum(m.total) desc
       limit 5
    ) t;

  -- Stock bajo
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'nombre', name, 'stock', stock, 'min_stock', min_stock) order by stock), '[]'::jsonb)
    into bajo
    from public.products
   where business_id = p_business and active and stock <= min_stock;

  -- Capital en stock (hoy)
  select jsonb_build_object(
           'productos',   count(*),
           'unidades',    coalesce(sum(stock), 0),
           'valor_costo', round(coalesce(sum(stock * unit_cost), 0), 2),
           'valor_venta', round(coalesce(sum(stock * sale_price), 0), 2),
           'ganancia_potencial', round(coalesce(sum(stock * (sale_price - unit_cost)), 0), 2))
    into st
    from public.products
   where business_id = p_business and active;

  -- Histórico total
  select jsonb_build_object(
           'invertido_total', coalesce(sum(total) filter (where type = 'compra'), 0),
           'ventas_total',    coalesce(sum(total) filter (where type = 'venta'), 0),
           'gastos_total',    coalesce(sum(total) filter (where type = 'gasto'), 0),
           'ganancia_total',  round(
               coalesce(sum(total - quantity * unit_cost) filter (where type = 'venta'), 0)
             + coalesce(sum(total) filter (where type = 'ingreso'), 0)
             - coalesce(sum(total) filter (where type = 'gasto'), 0), 2))
    into hist
    from public.movements
   where business_id = p_business;

  return jsonb_build_object(
    'desde', p_from, 'hasta', p_to,
    'kpis', k, 'serie', serie, 'top', top,
    'bajo_stock', bajo, 'stock', st, 'historico', hist);
end $$;

-- Atajo por período (lo usa el bot): hoy | semana | mes | anio
create or replace function public.get_dashboard_period(
  p_business uuid,
  p_period   text default 'mes',
  p_tz       text default 'America/Argentina/Buenos_Aires'
) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  local_now timestamp := now() at time zone p_tz;
  f timestamptz;
begin
  f := case lower(p_period)
         when 'hoy'    then date_trunc('day',   local_now) at time zone p_tz
         when 'semana' then date_trunc('week',  local_now) at time zone p_tz
         when 'anio'   then date_trunc('year',  local_now) at time zone p_tz
         when 'año'    then date_trunc('year',  local_now) at time zone p_tz
         else               date_trunc('month', local_now) at time zone p_tz
       end;
  return public.get_dashboard(p_business, f, now() + interval '1 second', p_tz);
end $$;

grant execute on function public.get_dashboard(uuid, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.get_dashboard_period(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. REALTIME: el dashboard se actualiza solo cuando cargás desde Telegram
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.movements;
  end if;
end $$;
