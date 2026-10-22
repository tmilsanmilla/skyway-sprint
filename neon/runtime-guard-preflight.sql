-- READ ONLY. Function/schema metadata only: no account rows, tokens or keys.
select jsonb_build_object(
 'readOnly',true,'captured_at',clock_timestamp(),'project','odd-unit-44587143',
 'branch',current_setting('neon.branch_id',true),'database',current_database(),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object(
   'signature',p.oid::regprocedure::text,'schema',n.nspname,'name',p.proname,
   'definition',pg_get_functiondef(p.oid),'source',p.prosrc,'language',l.lanname,
   'security_definer',p.prosecdef,'config',p.proconfig,'volatility',p.provolatile,
   'strict',p.proisstrict,'returns_set',p.proretset,'return_type',pg_get_function_result(p.oid),
   'acl',p.proacl::text,'owner',pg_get_userbyid(p.proowner),
   'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
   'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
   'anonymous',has_function_privilege('anonymous',p.oid,'EXECUTE'),
   'server_api',has_function_privilege('skyway_server_api',p.oid,'EXECUTE')) order by n.nspname,p.oid::regprocedure::text),'[]'::jsonb)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
   where n.nspname in('public','app_private') and p.prokind='f'),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
   'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT') or has_any_column_privilege('authenticated',c.oid,'SELECT'),
   'authenticated_insert',has_table_privilege('authenticated',c.oid,'INSERT') or has_any_column_privilege('authenticated',c.oid,'INSERT'),
   'authenticated_update',has_table_privilege('authenticated',c.oid,'UPDATE') or has_any_column_privilege('authenticated',c.oid,'UPDATE'),
   'authenticated_delete',has_table_privilege('authenticated',c.oid,'DELETE'),
   'authenticated_truncate',has_table_privilege('authenticated',c.oid,'TRUNCATE'),
   'column_acls',(select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text) order by a.attnum),'[]'::jsonb)
     from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)) order by n.nspname,c.relname),'[]'::jsonb)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in('public','app_private') and c.relkind in('r','p')),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname),'[]'::jsonb)
   from pg_policies p where schemaname in('public','app_private')),
 'columns',(select coalesce(jsonb_agg(jsonb_build_object('table_schema',table_schema,'table_name',table_name,
   'column_name',column_name,'udt_name',udt_name,'is_nullable',is_nullable,'column_default',column_default)
   order by table_schema,table_name,ordinal_position),'[]'::jsonb)
   from information_schema.columns where (table_schema='app_private' and table_name in('pixel_links','pixel_sessions'))
    or(table_schema='neon_auth' and table_name in('user','account','session'))),
 'managed_tables',(select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
   'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'acl',c.relacl::text,
   'server_select',has_table_privilege('skyway_server_api',c.oid,'SELECT'),
   'server_insert',has_table_privilege('skyway_server_api',c.oid,'INSERT'),
   'server_update',has_table_privilege('skyway_server_api',c.oid,'UPDATE'),
   'server_delete',has_table_privilege('skyway_server_api',c.oid,'DELETE')) order by c.relname),'[]'::jsonb)
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='neon_auth' and c.relname in('user','account','session') and c.relkind='r'),
 'role_boundary',(select jsonb_build_object('superuser',r.rolsuper,'bypass_rls',r.rolbypassrls,
   'public_create',has_schema_privilege(r.oid,'public','CREATE'),
   'private_usage',has_schema_privilege(r.oid,'app_private','USAGE'),
   'private_create',has_schema_privilege(r.oid,'app_private','CREATE')) from pg_roles r where rolname='authenticated'),
 'auth_helpers',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
   'language',l.lanname,'extension',e.extname,'owner',pg_get_userbyid(p.proowner)) order by p.proname),'[]'::jsonb)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
   left join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'
   left join pg_extension e on e.oid=d.refobjid where n.nspname='auth' and p.proname in('uid','jwt','session'))
) as runtime_guard_metadata;
