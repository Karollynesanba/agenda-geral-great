-- =========================================================
-- Agenda Great — banco de dados no Supabase
-- Cole tudo no Supabase > SQL Editor > New query e clique em "Run".
-- =========================================================

create extension if not exists unaccent with schema extensions;

create table if not exists public.bookings (
  id           uuid primary key default gen_random_uuid(),
  day          date not null,
  start_time   time not null,
  end_time     time not null,
  name         text not null check (length(trim(name)) > 0),
  sector       text not null check (sector in ('operacional', 'comercial', 'organico')),
  topic        text,
  participants text[] not null default '{}',
  created_at   timestamptz not null default now(),

  check (end_time > start_time),
  constraint bookings_horario_check check (start_time >= '09:00' and end_time <= '23:59'),
  check (extract(isodow from day) between 1 and 6),      -- segunda a sábado

  -- Regra principal: duas reuniões nunca podem ocupar o mesmo horário no mesmo dia.
  constraint sem_conflito_de_horario
    exclude using gist (tsrange(day + start_time, day + end_time, '[)') with &&)
);

-- Segurança: qualquer pessoa com o link vê e agenda; ninguém edita ou apaga direto.
alter table public.bookings enable row level security;

drop policy if exists "ver reservas" on public.bookings;
create policy "ver reservas" on public.bookings for select to anon, authenticated using (true);

drop policy if exists "criar reservas" on public.bookings;
create policy "criar reservas" on public.bookings for insert to anon, authenticated with check (true);

-- Cancelar: só se o nome digitado for de quem marcou ou de um participante
-- (sem diferença de maiúsculas, acentos ou espaços extras).
create or replace function public.agenda_norm(t text)
returns text language sql immutable as $$
  select regexp_replace(lower(trim(extensions.unaccent(coalesce(t, '')))), '\s+', ' ', 'g')
$$;

create or replace function public.cancel_booking(p_id uuid, p_name text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  apagou int;
begin
  delete from public.bookings b
  where b.id = p_id
    and (
      agenda_norm(b.name) = agenda_norm(p_name)
      or exists (select 1 from unnest(b.participants) p where agenda_norm(p) = agenda_norm(p_name))
    );
  get diagnostics apagou = row_count;
  return apagou > 0;
end;
$$;

grant execute on function public.cancel_booking(uuid, text) to anon, authenticated;

-- Atualização ao vivo na tela de todo mundo
alter publication supabase_realtime add table public.bookings;
