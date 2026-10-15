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
    or p_sector is null or p_sector not in ('operacional', 'comercial', 'organico')
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
