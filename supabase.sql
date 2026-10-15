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
  sector       text not null constraint bookings_sector_check check (sector in ('operacional', 'comercial', 'organico', 'administrativo')),
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

-- Execute uma vez no SQL Editor do projeto que já usa a agenda.
-- Adiciona edição sem apagar ou recriar as reservas existentes.
create or replace function public.edit_booking(
  p_id uuid,
  p_actor text,
  p_day date,
  p_start time,
  p_end time,
  p_name text,
  p_sector text,
  p_topic text,
  p_participants text[]
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  original public.bookings%rowtype;
  local_now timestamp := current_timestamp at time zone 'America/Sao_Paulo';
begin
  -- Trava a reserva enquanto valida e salva a alteração.
  select * into original from public.bookings where id = p_id for update;
  if not found then return 'missing'; end if;

  if nullif(trim(p_actor), '') is null or not (
    public.agenda_norm(original.name) = public.agenda_norm(p_actor)
    or exists (select 1 from unnest(original.participants) participant
      where public.agenda_norm(participant) = public.agenda_norm(p_actor))
  ) then return 'denied'; end if;

  if original.day + original.end_time <= local_now then return 'ended'; end if;

  if p_day is null or p_start is null or p_end is null
    or p_start < time '09:00' or p_end > time '23:59' or p_end <= p_start
    or extract(isodow from p_day) not between 1 and 6
    or extract(minute from p_start) not in (0, 30) or extract(second from p_start) <> 0
    or (p_end <> time '23:59' and (extract(minute from p_end) not in (0, 30) or extract(second from p_end) <> 0))
    or nullif(trim(p_name), '') is null or length(trim(p_name)) > 60
    or p_sector is null
    or length(coalesce(p_topic, '')) > 80
    or (least(p_day + p_start + interval '30 minutes', p_day + time '23:59') <= local_now
      and (p_day <> original.day or p_start <> original.start_time))
  then return 'invalid'; end if;

  update public.bookings set
    day = p_day, start_time = p_start, end_time = p_end,
    name = trim(p_name), sector = p_sector,
    topic = nullif(trim(p_topic), ''), participants = coalesce(p_participants, '{}'::text[])
  where id = p_id;
  return 'ok';
exception
  -- Em conflito, o UPDATE é desfeito e a reserva original permanece salva.
  when exclusion_violation then return 'taken';
  when check_violation then return 'invalid';
end;
$$;

revoke all on function public.edit_booking(uuid, text, date, time, time, text, text, text, text[]) from public;
grant execute on function public.edit_booking(uuid, text, date, time, time, text, text, text, text[]) to anon, authenticated;
