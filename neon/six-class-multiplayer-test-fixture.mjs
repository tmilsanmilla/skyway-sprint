import fs from "node:fs";
import {sixClassFixture}from "./six-class-test-fixture.mjs";
export async function sixClassMultiplayerFixture(){
 const db=await sixClassFixture(),artifacts=process.env.SKYWAY_TEST_ARTIFACTS;
 const read=name=>fs.readFileSync(`${artifacts}/${name}.sql`,"utf8");
 await db.exec(`create table if not exists public.multiplayer_point_events(match_id uuid,user_id uuid,pickup_id text,source text,points_awarded numeric(16,4),created_at timestamptz default now(),primary key(match_id,user_id,pickup_id));
 create function app_private.photon_user()returns uuid language plpgsql as $$declare u uuid:=auth.uid();begin if u is null then raise exception 'Sign in required';end if;return u;end$$;
 create function app_private.mark_1v1_eliminated(mid uuid,u uuid,t timestamptz)returns void language sql as $$update public.multiplayer_players set eliminated_at=t,death_order=1 where match_id=mid and user_id=u$$;
 create function app_private.finalize_1v1_after_second_death(uuid,timestamptz)returns boolean language sql as $$select false$$;
 create function app_private.settle_ruins_completed_pumpkins(uuid)returns void language sql as $$select$$;
 create function app_private.armory_purchase_counts(uuid,uuid,integer)returns jsonb language sql as $$select '{}'::jsonb$$;
 create function app_private.get_1v1_state_qol_base(mid uuid)returns jsonb language sql as $$select jsonb_build_object('match',to_jsonb(m),'self',to_jsonb(p))from public.multiplayer_matches m join public.multiplayer_players p on p.match_id=m.id and p.user_id=auth.uid()where m.id=mid$$;
 create table public.player_progression_1v1_activity(match_id uuid,user_id uuid,verified_wave integer,active_seconds bigint,primary key(match_id,user_id));
 create function app_private.settle_grove_wave(uuid,integer,timestamptz)returns boolean language sql as $$select false$$;
 `);
 for(const name of ['app_private.update_1v1_state_unadjusted','public.get_1v1_state','public.update_1v1_state'])await db.exec(read(name));
 const sql=fs.readFileSync(new URL('./six-class-05-multiplayer.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
return db;
}
