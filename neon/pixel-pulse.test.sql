-- Run inside a transaction with the two migrations, and ALWAYS roll back.
do $test$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();native uuid;created uuid;p jsonb;r jsonb;name text:='px_'||substr(replace(gen_random_uuid()::text,'-',''),1,16);
 email text;h text:=repeat('a',64);failed boolean;keys integer;g bigint;
begin
 email:=name||'@example.invalid';
 perform app_private.pixel_attempt_begin(repeat('b',64),repeat('c',64),repeat('v',43),repeat('n',43),'create',null);
 r:=app_private.pixel_attempt_take(repeat('b',64),repeat('c',64));
 if r->>'intent'<>'create' then raise exception 'Attempt mismatch';end if;
 failed:=false;begin perform app_private.pixel_attempt_take(repeat('b',64),repeat('c',64));exception when others then failed:=true;end;
 if not failed then raise exception 'Attempt replay was accepted';end if;
 p:=app_private.pixel_bind_account(a,name,email,false,null,h,'create');created:=(p->>'user_id')::uuid;
 if created is null or created=a or p->>'username'<>name or(p->>'email_verified')::boolean then raise exception 'New identity or verification mismatch';end if;
 select count(*) into keys from public.player_unlocks where user_id=created and item_type='character';
 if keys<>4 then raise exception 'New account must have exactly four starters, got %',keys;end if;
 if exists(select 1 from public.admin_users where user_id=created) then raise exception 'New SSO account received an admin role';end if;
 perform app_private.pixel_session_revoke(h);
 if app_private.pixel_session_get(h) is not null then raise exception 'Session survived sign-out';end if;
 p:=app_private.pixel_bind_account(a,name,email,false,null,repeat('d',64),'sign-in');
 if (p->>'user_id')::uuid<>created then raise exception 'Repeat SSO created another game account';end if;
 failed:=false;begin update public.player_profiles set username=name||'x' where user_id=created;exception when others then failed:=true;end;
 if not failed then raise exception 'Shared username changed independently';end if;
 insert into neon_auth."user"(name,email,"emailVerified") values(name||'n',name||'n@example.invalid',true) returning id into native;
 update public.player_stats set total_gems=37,high_score=12345 where user_id=native;
 failed:=false;begin perform app_private.pixel_bind_account(b,name||'n',name||'n@example.invalid',true,null,repeat('e',64),'create');exception when others then failed:=true;end;
 if not failed then raise exception 'Email-only account linking was accepted';end if;
 p:=app_private.pixel_bind_account(b,name||'n',name||'n@example.invalid',true,native,repeat('e',64),'link');
 if (p->>'user_id')::uuid<>native then raise exception 'Existing game account UUID changed';end if;
 select total_gems into g from public.player_stats where user_id=native;
 if g<>37 or(select high_score from public.player_stats where user_id=native)<>12345 then raise exception 'Existing stats changed during linking';end if;
 failed:=false;begin perform app_private.pixel_bind_account(a,name,email,false,native,repeat('f',64),'link');exception when others then failed:=true;end;
 if not failed then raise exception 'Central identity linked to two game accounts';end if;
 if has_function_privilege('authenticated','app_private.pixel_bind_account(uuid,text,text,boolean,uuid,text,text)','execute')
  or has_function_privilege('anon','public.get_my_pixel_identity()','execute')
  or has_table_privilege('authenticated','app_private.pixel_sessions','select') then raise exception 'Private identity access leaked';end if;
end $test$;
select 'Pixel identity, proof linking, retries, starters, currencies and access controls passed' as verification;
