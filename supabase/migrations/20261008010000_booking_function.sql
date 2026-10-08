create or replace function public.crear_cita(
  p_customer_name varchar,
  p_phone varchar,
  p_date date,
  p_time time without time zone,
  p_service_id bigint,
  p_barber_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_duration integer;
  v_appointment_id bigint;
begin
  if extract(isodow from p_date) = 7
    or p_time < time '09:00'
    or p_time >= time '19:00'
    or extract(minute from p_time)::integer not in (0, 30)
  then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('barber:' || p_barber_id::text || ':' || p_date::text, 0)
  );

  select s.duracion_minutos
    into v_duration
    from public.servicios as s
    join public.barberos as b on b.id = p_barber_id and b.activo
   where s.id = p_service_id and s.activo;

  if v_duration is null then
    raise exception 'SERVICE_OR_BARBER_UNAVAILABLE' using errcode = 'P0001';
  end if;

  if p_time + make_interval(mins => v_duration) > time '19:00' then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end if;

  if exists (
    select 1
      from public.citas as c
      join public.servicios as s on s.id = c.servicio_id
     where c.barbero_id = p_barber_id
       and c.fecha = p_date
       and c.estado in ('confirmada', 'pendiente')
       and c.hora < p_time + make_interval(mins => v_duration)
       and p_time < c.hora + make_interval(mins => s.duracion_minutos)
  ) then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end if;

  insert into public.citas (
    cliente_id,
    barbero_id,
    servicio_id,
    fecha,
    hora,
    estado,
    notas_cliente
  )
  values (
    null,
    p_barber_id,
    p_service_id,
    p_date,
    p_time,
    'confirmada',
    'Cliente: ' || p_customer_name || E'\nTeléfono: ' || p_phone
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

revoke all on function public.crear_cita(varchar, varchar, date, time without time zone, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.crear_cita(varchar, varchar, date, time without time zone, bigint, uuid)
  to service_role;
