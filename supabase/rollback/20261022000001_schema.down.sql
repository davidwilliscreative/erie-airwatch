-- Destroys ALL Erie AirWatch data. Take a backup first (see docs/operations.md).
drop schema if exists airwatch cascade;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'airwatch_worker') then
    drop owned by airwatch_worker;
    drop role airwatch_worker;
  end if;
end $$;
