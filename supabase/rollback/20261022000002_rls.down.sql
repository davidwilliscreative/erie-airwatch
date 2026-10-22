do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'airwatch' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
  for r in select tablename from pg_tables where schemaname = 'airwatch' loop
    execute format('alter table airwatch.%I disable row level security', r.tablename);
  end loop;
end $$;
revoke all on all tables in schema airwatch from authenticated;
revoke usage on schema airwatch from authenticated;
drop function if exists airwatch.is_admin(), airwatch.is_reviewer(), airwatch.current_role_name();
