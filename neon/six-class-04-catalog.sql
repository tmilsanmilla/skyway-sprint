-- User-requested six-class catalog. Additive account-preserving migration.
begin;
set local lock_timeout='3s';

do $six$ declare d text;begin
 select pg_get_constraintdef(oid)into d from pg_constraint where conrelid='public.extraction_catalog'::regclass and conname='extraction_catalog_character_class_check';
 if d='CHECK ((((item_type = ''character''::text) AND (character_class = ANY (ARRAY[''runner''::text, ''medic''::text, ''tank''::text, ''trickster''::text, ''misc''::text]))) OR ((item_type <> ''character''::text) AND (character_class IS NULL))))' then alter table public.extraction_catalog drop constraint extraction_catalog_character_class_check;
 elsif d is not null then raise exception 'Unexpected existing extraction_catalog.extraction_catalog_character_class_check';end if;
end $six$;

do $six$ declare d text;begin
 select pg_get_constraintdef(oid)into d from pg_constraint where conrelid='public.player_loadouts'::regclass and conname='player_loadouts_class_key_check';
 if d='CHECK ((class_key = ANY (ARRAY[''runner''::text, ''medic''::text, ''tank''::text, ''trickster''::text, ''misc''::text])))' then alter table public.player_loadouts drop constraint player_loadouts_class_key_check;
 elsif d is not null then raise exception 'Unexpected existing player_loadouts.player_loadouts_class_key_check';end if;
end $six$;

do $six$ declare d text;begin
 select pg_get_constraintdef(oid)into d from pg_constraint where conrelid='public.player_loadouts'::regclass and conname='player_loadouts_character_key_check';
 if d='CHECK ((character_key = ANY (ARRAY[''medic_beacon''::text, ''medic_bloom''::text, ''medic_halo''::text, ''medic_lifeline''::text, ''medic_mender''::text, ''medic_mercy''::text, ''medic_oracle''::text, ''medic_patch''::text, ''medic_pulse''::text, ''medic_remedy''::text, ''medic_reserve''::text, ''medic_revive''::text, ''medic_salve''::text, ''medic_seraph''::text, ''medic_sprout''::text, ''medic_suture''::text, ''medic_tonic''::text, ''medic_vial''::text, ''misc_broker''::text, ''misc_catalyst''::text, ''misc_harvester''::text, ''misc_lantern''::text, ''misc_mimic''::text, ''misc_muse''::text, ''misc_nomad''::text, ''misc_prospector''::text, ''misc_scribe''::text, ''misc_tinker''::text, ''misc_weaver''::text, ''runner_ace''::text, ''runner_blitz''::text, ''runner_comet''::text, ''runner_courier''::text, ''runner_dash''::text, ''runner_drift''::text, ''runner_flare''::text, ''runner_fortune''::text, ''runner_horizon''::text, ''runner_orbit''::text, ''runner_pacer''::text, ''runner_ranger''::text, ''runner_relay''::text, ''runner_scout''::text, ''runner_spark''::text, ''runner_stride''::text, ''runner_tempo''::text, ''runner_vault''::text, ''runner_vector''::text, ''runner_velocity''::text, ''runner_zenith''::text, ''tank_anchor''::text, ''tank_atlas''::text, ''tank_bastion''::text, ''tank_brace''::text, ''tank_bulwark''::text, ''tank_citadel''::text, ''tank_colossus''::text, ''tank_drag''::text, ''tank_glacier''::text, ''tank_guard''::text, ''tank_hammer''::text, ''tank_ironclad''::text, ''tank_plow''::text, ''tank_rampart''::text, ''tank_reactor''::text, ''tank_sentinel''::text, ''tank_warden''::text, ''trickster_clockwork''::text, ''trickster_echo''::text, ''trickster_flicker''::text, ''trickster_gambit''::text, ''trickster_hex''::text, ''trickster_jester''::text, ''trickster_mirage''::text, ''trickster_phantom''::text, ''trickster_pickpocket''::text, ''trickster_rogue''::text, ''trickster_smoke''::text, ''trickster_switch''::text, ''trickster_wildcard''::text])))' then alter table public.player_loadouts drop constraint player_loadouts_character_key_check;
 elsif d is not null then raise exception 'Unexpected existing player_loadouts.player_loadouts_character_key_check';end if;
end $six$;

do $six$ declare d text;begin
 select pg_get_constraintdef(oid)into d from pg_constraint where conrelid='public.multiplayer_players'::regclass and conname='multiplayer_players_character_class_check';
 if d='CHECK ((character_class = ANY (ARRAY[''runner''::text, ''medic''::text, ''tank''::text, ''trickster''::text, ''misc''::text])))' then alter table public.multiplayer_players drop constraint multiplayer_players_character_class_check;
 elsif d is not null then raise exception 'Unexpected existing multiplayer_players.multiplayer_players_character_class_check';end if;
end $six$;

do $six$ declare d text;begin
 select pg_get_constraintdef(oid)into d from pg_constraint where conrelid='public.multiplayer_players'::regclass and conname='multiplayer_players_hearts_check';
 if d='CHECK (((hearts >= (0)::numeric) AND (hearts <= (20)::numeric)))' then alter table public.multiplayer_players drop constraint multiplayer_players_hearts_check;
 elsif d is not null then raise exception 'Unexpected existing multiplayer_players.multiplayer_players_hearts_check';end if;
end $six$;

do $six$ declare d text;begin
 select pg_get_constraintdef(oid)into d from pg_constraint where conrelid='public.multiplayer_players'::regclass and conname='multiplayer_players_max_hearts_check';
 if d='CHECK (((max_hearts >= (1)::numeric) AND (max_hearts <= (20)::numeric)))' then alter table public.multiplayer_players drop constraint multiplayer_players_max_hearts_check;
 elsif d is not null then raise exception 'Unexpected existing multiplayer_players.multiplayer_players_max_hearts_check';end if;
end $six$;

-- PostgreSQL pins UPDATE OF triggers to their column types. The whole change is
-- atomic under the table lock; each exact trigger and function is retained.
do $health_type$ declare expected jsonb:=$trigger_pins$[{"name":"enforce_1v1_mirage_invulnerability","definition":"CREATE TRIGGER enforce_1v1_mirage_invulnerability BEFORE UPDATE OF hearts, status, eliminated_at, death_order ON public.multiplayer_players FOR EACH ROW EXECUTE FUNCTION app_private.enforce_1v1_mirage_invulnerability()","enabled":"O","functionBody":"7b1177201d74a2f1b3aff40e6eea7df8"},{"name":"track_1v1_hidden_state","definition":"CREATE TRIGGER track_1v1_hidden_state BEFORE UPDATE OF hearts, wave ON public.multiplayer_players FOR EACH ROW EXECUTE FUNCTION app_private.track_1v1_hidden_state()","enabled":"O","functionBody":"52af6b5bcea7f64483d63e3a6c089bf1"},{"name":"zz_hardcore_duel_health_19","definition":"CREATE TRIGGER zz_hardcore_duel_health_19 BEFORE INSERT OR UPDATE OF hearts, max_hearts, character_key ON public.multiplayer_players FOR EACH ROW EXECUTE FUNCTION app_private.hardcore_duel_health_19()","enabled":"O","functionBody":"19ed5a060c89c56e91b27bc140bf6dbc"}]$trigger_pins$::jsonb;actual jsonb;t jsonb;begin
 lock table public.multiplayer_players in access exclusive mode;
 if exists(select 1 from pg_attribute where attrelid='public.multiplayer_players'::regclass and attname in('hearts','max_hearts')and atttypmod<>-1)then
  select pinned into actual from (select jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled::text,'functionBody',md5(p.prosrc))order by t.tgname) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.multiplayer_players'::regclass and not t.tgisinternal and exists(select 1 from pg_attribute a where a.attrelid=t.tgrelid and a.attname in('hearts','max_hearts')and a.attnum=any(t.tgattr)))snapshot(pinned);
  if actual is distinct from expected then raise exception 'Health column trigger/source drift';end if;
  for t in select value from jsonb_array_elements(expected)loop execute format('drop trigger %I on public.multiplayer_players',t->>'name');end loop;
  alter table public.multiplayer_players alter column hearts type numeric,alter column max_hearts type numeric;
  for t in select value from jsonb_array_elements(expected)loop execute t->>'definition';end loop;
  select pinned into actual from (select jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled::text,'functionBody',md5(p.prosrc))order by t.tgname) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.multiplayer_players'::regclass and not t.tgisinternal and exists(select 1 from pg_attribute a where a.attrelid=t.tgrelid and a.attname in('hearts','max_hearts')and a.attnum=any(t.tgattr)))snapshot(pinned);
  if actual is distinct from expected then raise exception 'Health column trigger preservation mismatch';end if;
 end if;
end $health_type$;

do $six$ begin if not exists(select 1 from pg_constraint where conrelid='public.extraction_catalog'::regclass and conname='six_class_catalog_class')then alter table public.extraction_catalog add constraint six_class_catalog_class check((item_type='character'and character_class in('runner','medic','tank','trickster','misc','chaotic'))or(item_type<>'character'and character_class is null));end if;end $six$;

do $six$ begin if not exists(select 1 from pg_constraint where conrelid='public.player_loadouts'::regclass and conname='six_class_loadout_class')then alter table public.player_loadouts add constraint six_class_loadout_class check(class_key in('runner','medic','tank','trickster','misc','chaotic'));end if;end $six$;

do $six$ begin if not exists(select 1 from pg_constraint where conrelid='public.player_loadouts'::regclass and conname='six_class_loadout_character')then alter table public.player_loadouts add constraint six_class_loadout_character check(character_key in('chaotic_bowler','chaotic_cloak','chaotic_conic','chaotic_figment','chaotic_glide','chaotic_hyperlink','chaotic_imagination','chaotic_particle','chaotic_polisher','chaotic_polyglot','chaotic_prism','chaotic_prodigy','chaotic_rhythm','chaotic_snake','chaotic_spring','medic_balm','medic_beacon','medic_bishop','medic_bloom','medic_elixir','medic_gauze','medic_halo','medic_kitty','medic_lifeline','medic_mender','medic_mercy','medic_nurse','medic_oracle','medic_patch','medic_pulse','medic_remedy','medic_reserve','medic_revive','medic_sage','medic_salve','medic_seraph','medic_sprout','medic_suture','medic_tonic','medic_vial','misc_broker','misc_carat','misc_catalyst','misc_challenger','misc_coil','misc_engineer','misc_harvester','misc_lantern','misc_mimic','misc_muncher','misc_muse','misc_nomad','misc_prospector','misc_scribe','misc_surveyor','misc_timekeeper','misc_tinker','misc_trunk','misc_um','misc_weaver','runner_ace','runner_blitz','runner_cartographer','runner_cipher','runner_comet','runner_courier','runner_dash','runner_drift','runner_flare','runner_fortune','runner_frontline','runner_horizon','runner_melonhead','runner_orbit','runner_outpost','runner_pacer','runner_ranger','runner_relay','runner_rind','runner_rocket','runner_scout','runner_spark','runner_sprint','runner_streaker','runner_stride','runner_tempo','runner_transfer','runner_vault','runner_vector','runner_velocity','runner_zenith','tank_anchor','tank_arch','tank_atlas','tank_barrier','tank_bastion','tank_brace','tank_bulwark','tank_citadel','tank_colossus','tank_drag','tank_general','tank_glacier','tank_guard','tank_hammer','tank_ironclad','tank_juggernaut','tank_knight','tank_plow','tank_rampart','tank_reactor','tank_recruit','tank_screw','tank_sentinel','tank_warden','tank_warrior','trickster_burglar','trickster_clockwork','trickster_echo','trickster_eclipse','trickster_flicker','trickster_gambit','trickster_gasser','trickster_handflipper','trickster_hex','trickster_jester','trickster_mirage','trickster_paradox','trickster_phantom','trickster_pickpocket','trickster_pterodactyl','trickster_rogue','trickster_smoke','trickster_switch','trickster_wildcard'));end if;end $six$;

do $six$ begin if not exists(select 1 from pg_constraint where conrelid='public.multiplayer_players'::regclass and conname='six_class_player_class')then alter table public.multiplayer_players add constraint six_class_player_class check(character_class in('runner','medic','tank','trickster','misc','chaotic'));end if;end $six$;

do $six$ begin if not exists(select 1 from pg_constraint where conrelid='public.multiplayer_players'::regclass and conname='six_class_player_health')then alter table public.multiplayer_players add constraint six_class_player_health check(hearts>=0 and hearts<>'NaN'::numeric and hearts<>'Infinity'::numeric);end if;end $six$;

do $six$ begin if not exists(select 1 from pg_constraint where conrelid='public.multiplayer_players'::regclass and conname='six_class_player_max_health')then alter table public.multiplayer_players add constraint six_class_player_max_health check(max_hearts>=.5 and max_hearts<>'NaN'::numeric);end if;end $six$;

create table if not exists app_private.six_class_catalog(
 item_key text primary key,display_name text not null,character_class text not null,rarity text not null,
 starter boolean not null,starting_hp numeric not null check(starting_hp>0),max_hp numeric not null check(max_hp>=starting_hp),description text not null);
comment on table app_private.six_class_catalog is 'skyway-six-class-catalog-v1';
alter table app_private.six_class_catalog enable row level security;
revoke all on app_private.six_class_catalog from public,anon,anonymous,authenticated;


insert into app_private.six_class_catalog values
('runner_ace','Ace','runner','common',true,3,'3'::numeric,'Earn 14% more score. Hardcore’s 2× mode multiplier becomes 2.28× after Ace’s bonus; movement speed does not multiply score.'),
('runner_dash','Dash','runner','common',false,3,'3'::numeric,'Moves 6% faster and earns 6% more running score. Press E to burst forward with a brief shield.'),
('runner_stride','Stride','runner','common',false,3,'3'::numeric,'Every fourth lane change locks movement for a 0.05-second windup followed by a 0.3-second dodge shield. You cannot change lanes during either part.'),
('runner_sprint','Sprint','runner','common',false,3,'3'::numeric,'W jumps two lanes left and E jumps two lanes right, ignoring obstacles in the crossed lane. Shared 10-second cooldown; the destination must exist.'),
('runner_courier','Courier','runner','uncommon',false,3,'3'::numeric,'Earns 25% more running score for 4 seconds after collecting a gem, Melon, or 1v1 coin.'),
('runner_outpost','Outpost','runner','uncommon',false,3,'3'::numeric,'Composite waves, including wave 1, give 15% less score. Prime-numbered waves give 30% more score. Earn 25% more run XP.'),
('runner_transfer','Transfer','runner','uncommon',false,3,'3'::numeric,'Move 90% faster and earn 20% more score. The movement increase does not add a second score multiplier.'),
('runner_rocket','Rocket','runner','uncommon',false,3,'3'::numeric,'Earn 10% less score on waves 1–14. Starting at wave 15, permanently move 60% faster and earn 95% more score.'),
('runner_frontline','Frontline','runner','rare',false,3,'3'::numeric,'Dodge an obstacle after it reaches the final 20% of the track in your lane to earn one point. Each point permanently adds 0.2% score for this run.'),
('tank_reactor','Reactor','runner','rare',false,3,'3'::numeric,'At 2 HP or more: score−10%, speed−10%. At 1.5 HP: both+5%. At 1 HP: score+20%, speed+15%. At 0.5 HP: score+35%, speed+25%. Health conditions use nearest-half-heart display rules.'),
('medic_halo','Halo','runner','rare',false,3,'3'::numeric,'Earn 25% more score at full HP, but 15% less score at 0.5 HP. Other health levels have normal score.'),
('runner_cipher','Cipher','runner','rare',false,1.5,'1.5'::numeric,'Start with 1.5 HP, maximum 1.5 HP. Wave-end healing is 0.5 HP. Earn 75% more score and move 10% slower.'),
('runner_rind','Rind','runner','epic',false,3,'3'::numeric,'Every melon collected permanently adds 0.3% score. Barrels deal 1 HP rather than 0.5 HP.'),
('runner_orbit','Orbit','runner','epic',false,3,'3'::numeric,'Move outward from an edge to wrap to the opposite edge. Six-second cooldown. Collect melons from your own or either adjacent lane.'),
('runner_vector','Vector','runner','epic',false,3,'3'::numeric,'Earn 25% more score in either outside lane. There is no free first-hit block.'),
('trickster_switch','Switch','runner','epic',false,3,'3'::numeric,'Each lane change permanently adds 0.1% score. From 100 changes onward, each change grants a shield after 0.1 seconds, lasting 0.4 seconds divided by current wave speed. After 57 changes, earn floor((changes−55)/3) bonus XP at run end.'),
('runner_melonhead','Melonhead','runner','legendary',false,3,'3'::numeric,'Consecutive melons award 1×,2×,3× and so on of normal melon score. Snowflake freeze lasts 3.5 seconds.'),
('runner_blitz','Blitz','runner','legendary',false,3,'3'::numeric,'Each wave adds 5% movement speed and 4% score, linearly: wave 6 gives+30% speed and+24% score. No Volt Cleave.'),
('runner_velocity','Velocity','runner','legendary',false,3,'3'::numeric,'Build Velocity by moving successfully. Each 1% Velocity grants 1% speed and 2% score, capped at+100% speed/+200% score. Upbeat music begins at 50%; a rainbow appears at 100%. Hits reset Velocity.'),
('runner_cartographer','Cartographer','runner','legendary',false,3,'3'::numeric,'In 1 v 1, choose a replacement legal map once; both players reselect except you remain Cartographer. Two Cartographers cancel map replacement and use Classic without the 11% score bonus. In Endless, every even wave gives 25 seconds to draw a state outline; shape accuracy gives 0–30% score for the next wave, independent of drawing size.'),
('runner_zenith','Zenith','runner','mythic',false,3,'3'::numeric,'Gain 2% score per wave. At waves 5/7/9/11/13 gain normal Dash, Horizon+Glacier,9-second Orbit wrap, Reactor, then Stride. Starting wave 15 awards 15,000 score during a 10-second Time Stop without healing.'),
('runner_streaker','Streaker','runner','mythic',false,3,'3'::numeric,'Wave speed rises 35% per wave instead of 20%; every flawless wave permanently adds 5% score. E once per even wave adds 14×flawless-waves³ score in Endless,9× in 1 v 1. Snowflake contact breaks a flawless wave. A successful burst also gives a brief visible trail, not extra defense.'),
('medic_patch','Patch','medic','common',true,3.5,'4'::numeric,'Start at 3.5 HP, maximum 4 HP. Heal 1.5 HP after each wave. At 0.5 HP, earn 15% less score.'),
('medic_bloom','Bloom','medic','common',false,3,'4.5'::numeric,'Start at 3 HP, maximum 4.5 HP. The first physical gem collected each wave heals 0.5 HP.'),
('medic_remedy','Remedy','medic','common',false,3,'3.5'::numeric,'Start at 3 HP, maximum 3.5 HP. The first snowflake collected each wave heals 1 HP.'),
('medic_reserve','Reserve','medic','common',false,3,'3'::numeric,'At a full-HP wave end, store one 0.5-HP dose. Press E to drink it when below your normal 3-HP maximum. Only one dose is stored.'),
('medic_salve','Salve','medic','uncommon',false,3,'3'::numeric,'At 1 HP or 0.5 HP, wave-end recovery heals 2 HP. This can happen twice per run; afterward, wave ends give no ordinary healing.'),
('medic_bishop','Bishop','medic','uncommon',false,3,'3'::numeric,'Start/max 3 HP. The first vortex each wave heals 1 HP on Volcano/Meadow. On Skyway, each non-damaging current push has a 70% chance to heal 0.5 HP. On other maps, E heals to full once per run.'),
('medic_sprout','Sprout','medic','uncommon',false,3,'3'::numeric,'Seed one entire obstacle type until the wave ends. You cannot plant another seed during that wave. Seeding barrels consumes the use but does not neutralize them.'),
('medic_nurse','Nurse','medic','uncommon',false,3,'4'::numeric,'Patch-style healing with 3 startingHP. Orbit wrap has a 9-second cooldown; each wrap has a 25% chance to cost 0.5 HP.'),
('medic_tonic','Tonic','medic','rare',false,3,'3'::numeric,'Start 3 HP/max 4 HP. Each physical gem gives 4 ingredient points and each melon gives 3. Keys 1/2/3 brew+1/+2/+3 HP potions for 12/20/25 points. Brewing takes 15 seconds; only one brewing or stored potion is allowed. E drinks it.'),
('medic_gauze','Gauze','medic','rare',false,3.5,'3.5'::numeric,'Start/max 3.5 HP with Patch-style recovery. The first snowflake each wave is harmless; later ones freeze normally. Vortexes have no effect.'),
('medic_mender','Mender','medic','rare',false,3,'3'::numeric,'Each flawless wave earns a stored potion. E consumes one for 1 HP at a cost of 500 score, clamped to zero. Potions have no storage cap.'),
('medic_balm','Balm','medic','rare',false,4,'8'::numeric,'Start 4 HP/max 8 HP and heal 2 HP per wave. Normal lane changes are disabled; Rescue Hook moves you at most twice per wave. Barrels deal 1 HP.'),
('medic_kitty','Kitty','medic','epic',false,2,'5'::numeric,'Patch-style healing with 2 startingHP/max 5 HP. Each lane change has a 3% chance to deal 0.5 HP damage.'),
('medic_pulse','Pulse','medic','epic',false,3,'3'::numeric,'One revive per run. Complete a 20-second key challenge; two wrong keys or 10 or fewer correct ends the run. Correct 11–15/16–20/21–30/31–40/41–54/55+ revives at 0.5/1/1.5/2/2.5/3 HP. Revived score is 10% lower.'),
('medic_suture','Suture','medic','epic',false,3,'5'::numeric,'Start 3 HP/max 5 HP. Heal to full after every third wave; all other completed waves heal 0.5 HP.'),
('medic_sage','Sage','medic','epic',false,3,'3'::numeric,'Start/max 3 HP. Hazards are 81%ordinary,9%obviously harmless,1%disguised harmless,9%ordinary disguised as harmless. Harmless hits heal 0.5 HP and give one herb; consecutive melons give increasing herbs. E with at least 15 herbs brews a stone for 20 seconds, consuming all herbs; E too early without enough herbs is fatal. Drink it for 0.5 HP and 15 seconds of Luck (+5 percentage points each to gems/melons and honest holograms);25-second brew cooldown follows.'),
('medic_lifeline','Lifeline','medic','legendary',false,3,'3'::numeric,'Once per run, a lethal hit revives you at full HP. For the rest of that run, the hazard type that defeated you deals half damage. No Rescue Hook.'),
('tank_atlas','Atlas','medic','legendary',false,3,'7'::numeric,'Start 3 HP/max 7 HP and heal 1.5 HP per wave. Sky Crush begins with a 10-second delay, shortened by 1 second after each damaging obstacle hit, down to 1 second.'),
('medic_revive','Phoenix','medic','legendary',false,3,'3'::numeric,'Once per run, survive a lethal hit at 0.5 HP and enter flight: speed +50%, score +75%. Logs and spikes award 100 score without damage. All healing is disabled during flight; the next lethal hit ends the run.'),
('medic_elixir','Elixir','medic','legendary',false,2.5,'4'::numeric,'Start 2.5 HP/max 4 HP. E heals to full once per run. From 0.1 to 2.1 seconds after each lane change, an obstacle hit has a 60% chance to be ignored; changing lanes restarts that window.'),
('medic_oracle','Oracle','medic','mythic',false,3,'3'::numeric,'Complete prophecies to gain their listed rewards and 1%run XP per successful prophecy. A single failed prophecy ends the run immediately.'),
('runner_pacer','Pacer','medic','mythic',false,3,'3'::numeric,'Each melon heals 0.5 HP. At the baton window, choose an owned non-Runner/non-Healer of Legendary rarity or below; it starts at 0.5 HP. The opening burst lasts 10 seconds, with 3×speed and 5×score independently.'),
('tank_bulwark','Bulwark','tank','common',true,4,'4'::numeric,'Take 25% less damage from every source. No additional first-heavy-hit reduction.'),
('runner_vault','Vault','tank','common',false,4,'4'::numeric,'Vault over the first log or spike each wave, then gain +80% speed and +90% score for one second. The first damaging hazard contact each wave grants a 0.8-second shield.'),
('tank_guard','Guard','tank','common',false,4,'4'::numeric,'Take 35% less damage from every source. Earned mastery controls appear only while Guard’s mastery is enabled.'),
('tank_recruit','Recruit','tank','common',false,4,'4'::numeric,'Take 10% less damage. E activates Steel Spear: barrels move 60% slower for 10 seconds, with a 45-second cooldown.'),
('tank_ironclad','Ironclad','tank','uncommon',false,4,'4'::numeric,'Logs deal no damage and vortexes have no effect. Other damage is 30% higher.'),
('tank_brace','Brace','tank','uncommon',false,4,'4'::numeric,'Spikes deal no damage; other damage is 25% higher. The third melon collected in the same wave is fatal.'),
('tank_barrier','Barrier','tank','uncommon',false,4,'4'::numeric,'Barrels deal no damage; all other damage is 30% higher.'),
('tank_warden','Warden','tank','uncommon',false,4,'4'::numeric,'Can reach 4 HP, takes 25% less damage, and can click or tap spikes to deactivate them.'),
('medic_mercy','Mercy','tank','rare',false,4,'4'::numeric,'Ignore the first two obstacle hits on waves 1–3, then the first one each wave. Ignored hits deal no damage.'),
('tank_screw','Screw','tank','rare',false,4,'4'::numeric,'Move 10% slower, take 30% less damage, and add 0.1 seconds to every lane-change delay, including snowflake delays.'),
('tank_anchor','Anchor','tank','rare',false,4,'4'::numeric,'Press E to lock lane movement and take 75% less damage for 5 seconds.'),
('tank_arch','Arch','tank','rare',false,5,'5'::numeric,'Start/max 5 HP. Rocks deal 1.5 HP rather than 2 HP.'),
('tank_bastion','Bastion','tank','epic',false,4,'4'::numeric,'Each second in one lane adds 10% damage reduction, reaching full immunity after 10 seconds. Lane changes reset it. Score−5%.'),
('tank_knight','Knight','tank','epic',false,2,'Infinity'::numeric,'Start 2 HP with no maximum HP cap. HP is displayed as a number rounded to the nearest half-heart.'),
('medic_beacon','Beacon','tank','epic',false,3,'6'::numeric,'Start 3 HP/max 6 HP. While lit, every item moves 15% slower, spikes deal 0.5 HP and all healing is disabled; your lane lights up. After three completed/partial beacon waves, restore 4 HP, regain healing and lose the beacon. Unlit vortexes heal 0.5 HP on Volcano/Meadow.'),
('tank_rampart','Rampart','tank','epic',false,7,'7'::numeric,'Start/max 7 HP. Wave ends heal 0.5 HP. Titan Maul makes cars deal 0.5 HP.'),
('tank_warrior','Warrior','tank','legendary',false,4,'4'::numeric,'E uses Volt Cleave every 6 seconds and can destroy rocks. Each gem adds wave³×gem-streak² score.'),
('tank_sentinel','Sentinel','tank','legendary',false,4,'4'::numeric,'At each wave, analyze the hazard that dealt the most damage. Ties are selected uniformly. Ignore the first hit from that hazard, then take 75% less damage from it. E slows barrels by 75% for 15 seconds, once per wave.'),
('tank_citadel','Citadel','tank','legendary',false,4,'4'::numeric,'Ignore the first 1–3 obstacles each wave, with more opening blocks earned through consecutive flawless waves. Maximum 4 HP.'),
('tank_juggernaut','Juggernaut','tank','legendary',false,3,'3'::numeric,'Start 3 HP. Each melon raises maximumHP by 0.5, up to 14, without healing. Streak Enders replace 5+2×bonus-max-HP percent of pickups (max 27%) and 5% of ordinary hazards. Touching one resets maxHP to 2, clamps currentHP and removes 1,000 score (minimum 0). Score+5%.'),
('trickster_phantom','Phantom','tank','mythic',false,3,'3'::numeric,'Night waves are multiples of 3 and Bloodmoons multiples of 5. Bloodmoon healing is 1 HP. On every 15 th-wave Crimson Eclipse, all hazards including snowflakes act as harmless melons. Each melon permanently adds 0.2% score.'),
('tank_general','General','tank','mythic',false,6,'6'::numeric,'Start/max 6 HP. Initially take 10% less damage. Adapt separately to barrel/log/spike/rock:10 hits gives 40% reduction,20 gives 70%,40 gives 90%. Initial protection ends at the first adaptation. When three types reach 40 hits, sacrifice one to 20% reduction; the other two remain 90% for the rest of the run.'),
('trickster_rogue','Rogue','trickster','common',true,2,'2'::numeric,'Graze hazards to build a shield;11 grazes fills it. Store at most 12 grazes.'),
('trickster_smoke','Smoke','trickster','common',false,2,'2'::numeric,'Press E every 12 seconds to teleport to a currently safe lane.'),
('tank_plow','Plow','trickster','common',false,2,'2'::numeric,'After surviving a hit, remove one random hazard. In 1 v 1, send touched snowflakes to the opponent unless both players are Plow.'),
('trickster_pickpocket','Pickpocket','trickster','common',false,2,'2'::numeric,'In 1 v 1, automatically transfer up to 300 score from your opponent after each wave, clamped to their available score. Two Pickpockets cancel the effect. No Endless effect.'),
('runner_drift','Drift','trickster','uncommon',false,2,'2'::numeric,'Each consecutive lane change adds 9% speed and 10% score, capped at+270%/+300% after 30 changes. A hit resets the stack.'),
('trickster_burglar','Burglar','trickster','uncommon',false,2,'2'::numeric,'In 1 v 1, gain floor(10% of the opponent’s newly earned wave attack points) after each wave; two Burglars cancel. In Endless, gem streak rewards are 1,3,5,7… with 5% less score.'),
('trickster_clockwork','Clockwork','trickster','uncommon',false,2,'2'::numeric,'Start with items 20% faster. Each active second subtracts 0.2 percentage points, down to 60% normal speed after 5 minutes.'),
('trickster_gasser','Gasser','trickster','uncommon',false,3.5,'3.5'::numeric,'Start 3.5 HP. E toggles double obstacle damage,20% more speed and double score. Toggle freely; inactive play uses normal values.'),
('runner_tempo','Tempo','trickster','rare',false,2,'2'::numeric,'After every wave, press E 4 seconds after GO without a timer.3.8–4.2 s gives+25%speed/+50%score;3.5–4.5 s gives+10%/+20%;3.1–4.9 s is normal;2.6–5.4 s gives−10%/−20% and clears gem streak. Outside that range or timeout gives−25%/−50%, clears streak, and gems deal 0.5 HP without rewarding gems for the next wave.'),
('medic_vial','Vial','trickster','rare',false,2,'2'::numeric,'Swap for 15 seconds with an 80-second cooldown. Earliest use is 10 seconds in 1 v 1 or 20 seconds in Endless. Opponents receive no swap warning; two Vials cannot activate it.'),
('runner_spark','Spark','trickster','rare',false,2,'2'::numeric,'Each physical gem collected adds a permanent +0.5% score multiplier for this run. The bonus resets when the run ends.'),
('runner_flare','Flare','trickster','rare',false,2,'2'::numeric,'Flare lasts 10 seconds and always has a 30-second cooldown; burns do not shorten it.'),
('trickster_flicker','Flicker','trickster','epic',false,2,'2'::numeric,'Once per wave, press E to turn the closest hazard in each other lane into a gem or melon. Your lane is untouched; no attack coins are created. In 1v1, the opponent’s screen also flickers.'),
('tank_colossus','Colossus','chaotic','epic',false,3,'9'::numeric,'Start 3 HP/max 9 HP. A flawless wave heals 1.5 HP; a hit wave gives no healing. Rock damage is 2 HP through 4.5 HP,1.5 at 5–7 HP,1 at 7.5–8.5 HP,0.5 at 9 HP. Speed+5%, score+5%.'),
('runner_relay','Relay','trickster','epic',false,2,'2'::numeric,'Each flawless wave before your one revival earns a bonus, capped at 10. On death, revive at 0.5×floor(bonus/2)HP if positive. After revival, flawless waves give one gem instead. Speed+15%, normal score.'),
('trickster_pterodactyl','Pterodactyl','trickster','epic',false,2,'2'::numeric,'Once per 1 v 1 wave, warn the opponent for 3 seconds with an orange track. They must duck with B before the strike or die; changing lanes does not avoid it.'),
('trickster_mirage','Mirage','trickster','legendary',false,2,'2'::numeric,'E teleports the opponent to a different random lane every 20 seconds in 1 v 1. In Endless it teleports you every 10 seconds. Destinations need not be safe. +/− expands/collapses the opponent-lane view.'),
('trickster_hex','Hex','trickster','legendary',false,2,'2'::numeric,'After each 40-second wave, collect up to 12 damned in a 20-second,8-lane Void.70 damnation unlocks two one-hit souls for 25 damnation. Damage reduction is 0.2% per damnation up to 20%. At 100, beat 25 correct ASDF inputs in 20 seconds (two errors lose), then click 15 moving targets in 10 seconds to become a 3-max-HP god; each death lowers maxHP and revives. God E retreats 3 seconds then grants 10 seconds invincibility once per wave. R clears one hazard with a 35-second chakram. Above 100 damnation adds 0.2%score per excess point.'),
('trickster_paradox','Paradox','trickster','legendary',false,2,'2'::numeric,'A shadow follows your lane changes exactly 3 seconds late. Shadow hazard contact has 45% chance to heal 0.5 HP; shadow gem/melon contact has 40% chance to cost 0.5 HP, gives no pickup reward and resets gem streak.'),
('trickster_handflipper','Handflipper','trickster','legendary',false,2,'2'::numeric,'E resets every current item to the top of its track, with a 15-second cooldown. In 1 v 1, R gives the opponent 7 seconds of 10% reversed turns, with a 25-second cooldown.'),
('trickster_eclipse','Eclipse','trickster','mythic',false,2,'2'::numeric,'Randomly ordered eclipses occur at waves 4,8,12,16, then the Solar Eclipse at 20; none follow. Azure starts at 1 HP and alternates 5 seconds invincible/2 seconds normal. Amber boosts score while hazards accelerate; Verdant changes hazards into healing pickups; Violet mirrors lane controls with visible indicators. Solar combines short, visible phases without deleting account resources.'),
('trickster_echo','Echo','trickster','mythic',false,2,'2'::numeric,'Complete DreamerI(wave 5),Uplift(5 wave-end healing),Hope(10 damage),DreamerII(wave 15),Understanding(20 physical gems),Idea(25 melons),then The Knowing(0.5 HP back to full). The first six grant a shard; class quests also choose two non-mythic borrowed passives. Knowing sets 7 HP. Each lost shard reduces maxHP by 1 and adds 30%score, capped 175% atzero shards. Atzero in 1 v 1 Unlimited, reflect hits for 10 seconds then send a row of hazards before fading; two Echoes and Endless instead continue at 1 HP.'),
('runner_scout','Scout','misc','common',false,3,'3'::numeric,'E makes the next snowflake heal 0.5 HP, with a 30-second cooldown. Snowflake freeze lasts 1.5 seconds.'),
('misc_tinker','Tinker','misc','common',false,3,'3'::numeric,'Tap each spike at most once for inspiration. At two inspiration, press E to destroy the nearest non-rock hazard in your lane and spend those two points. Spikes move 25% slower.'),
('misc_timekeeper','Timekeeper','misc','common',false,3,'3'::numeric,'Gems, melons and attack coins move 15% slower; hazards move 5% slower. Each obstacle hit adds 1%run-end XP.'),
('tank_drag','Drag','misc','common',false,3,'3'::numeric,'Barrels and logs move 20% slower. Once per wave, E sets a chain in your lane; press E again to return to that lane safely.'),
('misc_broker','Broker','misc','uncommon',false,3,'3'::numeric,'Gems, attack coins and melon score enter three separate funds. After each wave, each fund changes independently by 1–50%, with a 60% chance to rise. Cash out during play or on death; every payout is rounded down to whole units.'),
('runner_horizon','Horizon','misc','uncommon',false,3,'3'::numeric,'Preview the next wave’s hazards before it starts and see the opponent’s purchases in 1v1. Normal 3 HP.'),
('runner_ranger','Ranger','misc','uncommon',false,3,'3'::numeric,'E zips to an on-screen pickup every 20 seconds. Collect pickups from adjacent lanes, and melons give double score.'),
('misc_lantern','Lantern','misc','uncommon',false,3,'3'::numeric,'E pauses the game and all hazards. Select the hazards to stop, then RESUME; selected hazards remain stopped for 2 seconds while the others move normally.'),
('tank_glacier','Glacier','misc','rare',false,3,'3'::numeric,'Snowflakes cannot freeze your movement. Normal 3 HP and score.'),
('misc_engineer','Engineer','misc','rare',false,3,'3'::numeric,'Each gem gives wave×gem-streak stardust; every lane change adds 25 score.'),
('misc_um','Um','misc','rare',false,3,'3'::numeric,'Tap barrels/logs to turn them into visually identical ash. Alternate collected ash types; repeating one is fatal. Each ash gives floor(370+70×wave^1.7)score. E with fewer than 20 ashes is fatal; otherwise consume all ashes, neutralize one current hazard and award 5,000 score plus one gem.'),
('misc_trunk','Trunk','misc','rare',false,3,'3'::numeric,'Collect nearby melons from your lane and the immediately adjacent lanes when grazing; attraction does not wrap at the edge.'),
('misc_catalyst','Catalyst','misc','epic',false,3,'3'::numeric,'Pickup speed by lane distance 0–1/2/3/4+ is+50%/+10%/−30%/−50%. All non-pickup speed at distance 0/1/2/3/4+ is−20%/−15%/−3%/+9%/+15%. Flux Field has a 25-second cooldown.'),
('misc_muncher','Muncher','misc','epic',false,3,'3'::numeric,'Lunch is the middle 5 seconds of each wave. Melons award 3.5×score during Lunch.'),
('misc_challenger','Challenger','misc','epic',false,3,'3'::numeric,'In 1 v 1, earn double attack coins but half melon score. In Endless, owning Sprint grants one second life as Sprint at 1 maxHP,50% extra speed and no healing. Without Sprint, gain 14%score instead.'),
('misc_carat','Carat','misc','epic',false,3,'3'::numeric,'Each physical gem earns one carbon atom. Spend two atoms for 15 seconds of Pterodactyl time; time stacks, granting 2.2×speed/2.5×score and 30% log deflection. Pressurize once per wave for five atoms.'),
('misc_prospector','Prospector','misc','legendary',false,3,'3'::numeric,'Danger warnings last 4 seconds. Gem streak rewards are 1,3,5,7… In 1 v 1 each physical gem has 15% chance to double a random opponent hazard’s speed without warning, unless both players are Prospector.'),
('misc_weaver','Weaver','misc','legendary',false,3,'3'::numeric,'With Courier owned, use Rescue Hook once per wave and revive once as Courier at 0.5 maxHP,2×speed, normal score and no healing or hook. Without Courier, gain 14%score instead.'),
('misc_harvester','Harvester','misc','legendary',false,3,'3'::numeric,'Collect gems, melons and attack coins in separate counters. Ten of a type unlocks its E action; fifty upgrades that action. The ability panel shows each available action and its cooldown.'),
('runner_fortune','Fortune','misc','mythic',false,3,'4'::numeric,'Gem-streak/3 percent, rounded to 0.1%, replaces hazards with gems (cap 15%). Consecutive flawless waves add melon replacements (cap 10%); both add to 25% maximum. In 1 v 1, consecutive attack coins replace up to 20% of opponent coins with hazards. Show only your pickup rates. Start 3 HP/max 4 HP and heal 0.5 HP per wave.'),
('misc_coil','Coil','misc','mythic',false,3,'3'::numeric,'Endless waves last 15 seconds. Your 1 v 1 waves last 40 seconds; two Coils use the ordinary shared 40-second wave clock.'),
('chaotic_particle','Particle','chaotic','common',true,3,'3'::numeric,'Earn double run XP with 15% less score. Included Chaotic starter.'),
('chaotic_cloak','Cloak','chaotic','common',false,3,'3'::numeric,'You are invisible for each wave’s first 15 seconds. Once per 1 v 1 wave, outside its first/last 5 seconds, the opponent must dismiss a visible pop-up with L or tap/click before turning. Hits have 5% chance to dodge into a safe lane.'),
('chaotic_polisher','Polisher','chaotic','common',false,3.5,'3.5'::numeric,'Five percent of hazards are pressurized and look like gems, while retaining hazard movement and damage. Start/max 3.5 HP.'),
('chaotic_spring','Spring','chaotic','common',false,3,'3'::numeric,'Gain one energy per active second; a hit removes 15%, rounded down. Endless energy adds 0.6%score each without a cap. In 1 v 1, nausea falls from 20% by 0.1% per energy tozero at 200;15% of opponent attack coins are secretly yours and stun the collector for 0.7 seconds.'),
('chaotic_glide','Glide','chaotic','uncommon',false,3,'3'::numeric,'Even waves give 35% more score; odd waves give 20% less. Award floor(active-seconds/70) bonus gems at run end; paused/intermission time does not count.'),
('chaotic_figment','Figment','chaotic','uncommon',false,3,'3'::numeric,'F/G turn left/right; Down/Up turn left/right. Normal A/D and Left/Right do not move; on-screen turn buttons reverse. After a hit, gain 0.15 seconds of invincibility after a 0.05-second delay.'),
('chaotic_hyperlink','Hyperlink','chaotic','uncommon',false,3,'3'::numeric,'Wave hits 0/1/2/3/4/5/6–7/8–9/10+ earn 10/8/7/6/5/4/3/2/1 links; gems add one. Spend 10 for 5 seconds flight (+90%speed/+160%score),15 in 1 v 1 to convert an opponent pickup into a hazard,20 to convert one own hazard into 40%melon/35%coin/25%gem.'),
('trickster_jester','Jester','misc','uncommon',false,3,'3'::numeric,'Roll each wave:40%Positive (40%less damage,0.5 wave healing),40%Neutral (uniform nonzero integer−10…35 gives that%score and 3×that%speed; opponent gets 500 score),20%Negative (barrels 1 HP/logs 2 HP,one Rescue Hook; opponent gets 1,000 score).'),
('trickster_gambit','Gambit','chaotic','rare',false,2,'2'::numeric,'Start/max 2 HP. On your first death, roll six 8-sided dice with up to three selective rerolls. A Pair or less gives no revival; higher hands revive at 0.5–2 HP with the shown z bonus plus dice sum. Revival forbids all healing and occurs only once. TwoPair/Triplet/FullHouse/Straight/FourKind-or-ThreePair/Straighter/FullerHouse/TwoTriplet/FiveKind/SixKind use z−45/−30/−15/−5/5/15/30/40/55/75.'),
('chaotic_snake','Snake','chaotic','rare',false,3,'3'::numeric,'At run start, become a randomly selected owned character that is legal for the chosen map.'),
('tank_hammer','Hammer','chaotic','rare',false,3,'3'::numeric,'E clears one nearest hazard in each neighboring lane every 15 seconds; on an edge it also clears your current lane. Rocks may be removed. Score+5%, speed−5%.'),
('chaotic_imagination','Imagination','chaotic','rare',false,4,'4'::numeric,'Start/max 4 HP and score+20%. Each completed wave appends two colors to a memory sequence. After 5 seconds, enter the entire sequence with 1–6 within 10 seconds. Any wrong key or timeout ends the run.'),
('chaotic_rhythm','Rhythm','chaotic','epic',false,3,'3'::numeric,'Consecutive lane changes 0.8–1.2 seconds apart build Rhythm. Each stack adds 3%speed and score. Early movement or more than 1.2 seconds without a change resets it.'),
('chaotic_bowler','Bowler','chaotic','epic',false,3,'3'::numeric,'After each wave, throw three bowling balls; each has 4 seconds to aim with the pointer. Reset pins after a strike and continue with remaining balls. Each pin knocked down permanently adds 0.1%score, at most 30 pins per frame.'),
('medic_seraph','Seraph','chaotic','epic',false,3,'4'::numeric,'Start at 3 HP, maximum 4 HP. Evade by teleporting to a safe lane, starting at 100% chance and losing five percentage points per successful teleport. At 0% remaining chance, Divine Recovery heals 2 HP at each wave end.'),
('chaotic_prodigy','Prodigy','chaotic','legendary',false,3,'3'::numeric,'After each wave, answer within 10 seconds: add two distinct uniformly drawn numbers 21–97 that are not multiples of 5. Correct answers multiply future score by 1.08; wrong/timeout by 0.95. Only digit input is accepted, with 2 seconds of feedback.'),
('chaotic_polyglot','Polyglot','chaotic','legendary',false,3,'3'::numeric,'After each wave, listen to a 30–45 second language clip, then choose French, Spanish, Japanese, Mandarin Chinese, German, Russian, Italian or Portuguese within 10 seconds. Correct gives 5,000 score; wrong costs 0.5 HP. In 1 v 1 both hear it; opponent correct gives 3,000 score, wrong costs 1 HP.'),
('chaotic_conic','Conic','chaotic','legendary',false,3,'3'::numeric,'Each wave draws a different one of ten shapes, with its displayed effect. E in 1 v 1 locks the opponent’s other controls until they identify it with 0–9; wrong answers lock guesses for 1 second. Endless gives 3,500 score per correct wave-end answer. Shape order: ellipse,circle,parabola,hyperbola,spiral,infinity,flat tire,lemon,potato,chip.'),
('misc_mimic','Mimic','chaotic','legendary',false,3,'3'::numeric,'In 1 v 1, copy the opponent, including Mythics, only if you own that character; otherwise score+6%/speed−6%. In Endless choose either+18%score off the edges or−5%hazard speed/+35%XP.'),
('trickster_wildcard','Wildcard','chaotic','mythic',false,3,'3'::numeric,'After each wave, choose among the top 3 Euchre cards with 11–24 remaining, top 2 with 5–10, or automatically draw with 1–4. Unchosen cards shuffle back. Five-second choice limit; running out of cards or timing out is fatal. Each card’s score, pickup, delayed attack and red-Ace draw effects are shown before selection.'),
('misc_muse','Muse','chaotic','mythic',false,3,'3'::numeric,'Begin as any non-Chaotic Legendary. On each death choose an Epic,Rare,Uncommon,then Common from a class not previously used. All five lives earn 5%less score; no class may repeat.'),
('misc_surveyor','Surveyor','misc','legendary',false,3,'3'::numeric,'E marks your current lane every 20 seconds. Collecting a gem or melon there gives 150 score and one Survey point; each point permanently adds 0.1%score up to 20%. Base score+5%, normal 3 HP.'),
('chaotic_prism','Prism','chaotic','epic',false,3,'3'::numeric,'Cycle Red, Green and Blue after waves. Red gives+20%score/+15%speed. Green heals 0.5 HP but gives−10%score. Blue gives 20%less damage but−10%speed. Current color is visible. Start 3 HP/max 4 HP.')
on conflict(item_key)do update set display_name=excluded.display_name,character_class=excluded.character_class,rarity=excluded.rarity,starter=excluded.starter,starting_hp=excluded.starting_hp,max_hp=excluded.max_hp,description=excluded.description;

insert into public.extraction_catalog(item_key,display_name,item_type,rarity,character_class,extractable,active,weapon_name,weapon_score_bonus,passive_ability,weapon_effect)
 select item_key,display_name,'character',case when starter then 'default'else rarity end,character_class,not starter,true,display_name||' ability',0,description,'See character description.'from app_private.six_class_catalog
 on conflict(item_key)do update set display_name=excluded.display_name,rarity=excluded.rarity,character_class=excluded.character_class,extractable=excluded.extractable,active=true,passive_ability=excluded.passive_ability;
-- Retire only selection/market availability; preserve all ownership and history.
update public.extraction_catalog set active=false,extractable=false where item_key in('misc_nomad','misc_scribe','runner_comet')and item_type='character';
update app_private.one_v_one_map_rules set allowed_character_classes=array_append(allowed_character_classes,'chaotic')where map_key in('classic','pitch','factory','meadow')and not('chaotic'=any(allowed_character_classes));
create or replace function app_private.owns_six_class_character(u uuid,k text)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from app_private.six_class_catalog c where c.item_key=k and(c.starter or exists(select 1 from public.player_unlocks p where p.user_id=u and p.item_key=k and p.item_type='character')))
$$;
revoke all on function app_private.owns_six_class_character(uuid,text)from public,anon,anonymous,authenticated;


do $six$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='app_private.character_selection_snapshot(uuid,text,text)'::regprocedure;if h not in('4f979b42de317b01c1e41e662157a17c','4c797bc10629174c4e11b5542d473eb6')then raise exception 'Source drift: app_private.character_selection_snapshot(uuid,text,text)';end if;end $six$;
CREATE OR REPLACE FUNCTION app_private.character_selection_snapshot(p_user_id uuid, p_map_key text, p_character_key text)
 RETURNS TABLE(character_key text, character_class text, max_hearts numeric, starting_hearts numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text;
  v_class text;
  v_test_mode boolean:=app_private.is_admin_test_user(p_user_id);
  v_allowed text[];
  v_forced text;
  v_base_max numeric;
  v_base_start numeric;
  v_multiplier numeric;
  v_bonus numeric;
begin
  select catalog.item_key,catalog.character_class into v_key,v_class from public.extraction_catalog catalog where catalog.item_key=p_character_key and catalog.item_type='character' and catalog.active;
  v_key:=coalesce(v_key,'runner_ace');
  v_class:=coalesce(v_class,'runner');

  select rules.allowed_character_classes,rules.forced_character_key,
         coalesce((rules.gameplay_rules->>'hp_multiplier')::numeric,1),
         coalesce((rules.gameplay_rules->>'hp_bonus')::numeric,0)
  into v_allowed,v_forced,v_multiplier,v_bonus
  from app_private.one_v_one_map_rules rules
  where rules.map_key=p_map_key;

  if not v_test_mode then
    if v_forced is not null then
      v_key:=v_forced;
      v_class:='runner';
    elsif not (v_class=any(v_allowed)) then
      v_key:='runner_ace';
      v_class:='runner';
    end if;
  end if;

  select c.max_hp,c.starting_hp into v_base_max,v_base_start from app_private.six_class_catalog c where c.item_key=v_key;
  if v_base_max is null then raise exception 'Character health is unavailable';end if;

  return query select v_key,v_class,
    (v_base_max*v_multiplier+v_bonus)::numeric,
    (v_base_start*v_multiplier+v_bonus)::numeric;
end;
$function$
;

do $six$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='app_private.character_snapshot_before_terminal(uuid,text)'::regprocedure;if h not in('03144586053e92ebb4e8975e269f0f09','876ed07f8b4fbbd410516590e9460651')then raise exception 'Source drift: app_private.character_snapshot_before_terminal(uuid,text)';end if;end $six$;
CREATE OR REPLACE FUNCTION app_private.character_snapshot_before_terminal(p_user_id uuid, p_map_key text)
 RETURNS TABLE(character_key text, character_class text, max_hearts numeric, starting_hearts numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text;
  v_class text;
  v_test_mode boolean:=app_private.is_admin_test_user(p_user_id);
  v_allowed text[];
  v_forced text;
  v_base_max numeric;
  v_base_start numeric;
  v_multiplier numeric;
  v_bonus numeric;
begin
  select loadout.character_key,catalog.character_class
  into v_key,v_class
  from public.player_loadouts loadout
  join public.extraction_catalog catalog
    on catalog.item_key=loadout.character_key
   and catalog.item_type='character' and catalog.active
  left join public.player_unlocks unlock
    on unlock.user_id=loadout.user_id
   and unlock.item_key=loadout.character_key
   and unlock.item_type='character'
  where loadout.user_id=p_user_id
    and (unlock.item_key is not null or v_test_mode);
  v_key:=coalesce(v_key,'runner_ace');
  v_class:=coalesce(v_class,'runner');

  select rules.allowed_character_classes,rules.forced_character_key,
         coalesce((rules.gameplay_rules->>'hp_multiplier')::numeric,1),
         coalesce((rules.gameplay_rules->>'hp_bonus')::numeric,0)
  into v_allowed,v_forced,v_multiplier,v_bonus
  from app_private.one_v_one_map_rules rules
  where rules.map_key=p_map_key;

  if not v_test_mode then
    if v_forced is not null then
      v_key:=v_forced;
      v_class:='runner';
    elsif not (v_class=any(v_allowed)) then
      v_key:='runner_ace';
      v_class:='runner';
    end if;
  end if;

  select c.max_hp,c.starting_hp into v_base_max,v_base_start from app_private.six_class_catalog c where c.item_key=v_key;
  if v_base_max is null then raise exception 'Character health is unavailable';end if;

  return query select v_key,v_class,
    (v_base_max*v_multiplier+v_bonus)::numeric,
    (v_base_start*v_multiplier+v_bonus)::numeric;
end;
$function$
;

do $six$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='public.set_loadout(text,text)'::regprocedure;if h not in('9365e74e499b439ca363d3974e5de80f','6875a086eb874d847f00a4da9ca0b59b')then raise exception 'Source drift: public.set_loadout(text,text)';end if;end $six$;
CREATE OR REPLACE FUNCTION public.set_loadout(p_slot text, p_item text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid:=auth.uid();
  v_slot text:=lower(trim(p_slot));
  v_item text:=lower(trim(coalesce(p_item,'')));
  v_required_class text;
  v_current_class text;
  v_current_character text;
  v_next_character text;
  v_test_mode boolean:=false;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_slot not in('class','character','player','obstacle','environment') then
    raise exception 'Invalid loadout slot';
  end if;
  v_test_mode:=app_private.is_admin_test_user(v_uid);

  if v_slot in('player','obstacle','environment')
     and v_item in('','default','none') then
    insert into public.player_loadouts(user_id)
    values(v_uid) on conflict(user_id) do nothing;
    update public.player_loadouts
    set player_cosmetic=case when v_slot='player' then null else player_cosmetic end,
        obstacle_cosmetic=case when v_slot='obstacle' then null else obstacle_cosmetic end,
        environment_cosmetic=case when v_slot='environment' then null else environment_cosmetic end,
        updated_at=now()
    where user_id=v_uid;
    return;
  end if;
  if v_item='' then raise exception 'Invalid loadout item'; end if;

  insert into public.player_loadouts(user_id)
  values(v_uid) on conflict(user_id) do nothing;
  select class_key,character_key into v_current_class,v_current_character
  from public.player_loadouts where user_id=v_uid for update;

  if v_slot='class' then
    if v_item not in('runner','medic','tank','trickster','misc','chaotic') then
      raise exception 'Invalid class';
    end if;
    if not v_test_mode
       and v_item not in('runner','medic','tank','trickster','chaotic')
       and not exists(
         select 1 from public.player_unlocks
         where user_id=v_uid and item_type='class' and item_key=v_item
       )
       and not exists(
         select 1 from public.player_unlocks unlock
         join public.extraction_catalog catalog
           on catalog.item_key=unlock.item_key
          and catalog.item_type='character'
          and catalog.character_class=v_item
         where unlock.user_id=v_uid and unlock.item_type='character'
       ) then raise exception 'Class is not unlocked'; end if;

    if v_current_class=v_item and exists(
      select 1 from public.extraction_catalog catalog
      left join public.player_unlocks unlock
        on unlock.user_id=v_uid and unlock.item_key=catalog.item_key
       and unlock.item_type='character'
      where catalog.item_key=v_current_character
        and catalog.item_type='character' and catalog.active
        and catalog.character_class=v_item
        and (app_private.owns_six_class_character(v_uid,catalog.item_key)or v_test_mode)
    ) then
      v_next_character:=v_current_character;
    elsif v_test_mode then
      select catalog.item_key into v_next_character
      from public.extraction_catalog catalog
      where catalog.item_type='character' and catalog.active
        and catalog.character_class=v_item
      order by catalog.extractable,catalog.item_key limit 1;
    else
      select unlock.item_key into v_next_character
      from public.player_unlocks unlock
      join public.extraction_catalog catalog
        on catalog.item_key=unlock.item_key
       and catalog.item_type='character'
       and catalog.character_class=v_item
      where unlock.user_id=v_uid and unlock.item_type='character'
      order by unlock.unlocked_at,unlock.item_key limit 1;
    end if;
    if v_next_character is null then select c.item_key into v_next_character from app_private.six_class_catalog c where c.character_class=v_item and c.starter;end if;
    if v_next_character is null then
      raise exception 'No available character exists for this class';
    end if;
    update public.player_loadouts
    set class_key=v_item,character_key=v_next_character,updated_at=now()
    where user_id=v_uid;
    return;
  end if;

  if v_slot='character' then
    select character_class into v_required_class
    from public.extraction_catalog
    where item_key=v_item and item_type='character' and active;
    if v_required_class is null then raise exception 'Invalid character'; end if;
    if not v_test_mode and not app_private.owns_six_class_character(v_uid,v_item) then raise exception 'Character is not unlocked'; end if;
    update public.player_loadouts
    set class_key=v_required_class,character_key=v_item,updated_at=now()
    where user_id=v_uid;
    return;
  end if;

  if not exists(
    select 1 from public.player_unlocks
    where user_id=v_uid and item_key=v_item and item_type=v_slot
  ) then raise exception 'Item is not unlocked for this slot'; end if;
  update public.player_loadouts
  set player_cosmetic=case when v_slot='player' then v_item else player_cosmetic end,
      obstacle_cosmetic=case when v_slot='obstacle' then v_item else obstacle_cosmetic end,
      environment_cosmetic=case when v_slot='environment' then v_item else environment_cosmetic end,
      updated_at=now()
  where user_id=v_uid;
end;
end
$function$
;

do $six$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='public.choose_1v1_character(uuid,text)'::regprocedure;if h not in('7584224f502f02fd110869e351d5e505','b99e10392fda090f23f122ea9d0c95df')then raise exception 'Source drift: public.choose_1v1_character(uuid,text)';end if;end $six$;
CREATE OR REPLACE FUNCTION public.choose_1v1_character(p_match_id uuid, p_character_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();m public.multiplayer_matches;s app_private.match_setup_19;c public.extraction_catalog;h record;r app_private.one_v_one_map_rules;begin
 if u is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception 'Match not found';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into s from app_private.match_setup_19 where match_id=p_match_id;
 if m.status<>'countdown' or s.phase is distinct from 'character' or clock_timestamp()>=s.deadline then raise exception 'Character selection has ended';end if;
 if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned';end if;
 select * into c from public.extraction_catalog where item_key=p_character_key and item_type='character' and active;
 select * into r from app_private.one_v_one_map_rules where map_key=m.map_key;
 if c.item_key is null or not app_private.owns_six_class_character(u,c.item_key) then raise exception 'You do not own this character';end if;
 if r.forced_character_key is not null or not(c.character_class=any(r.allowed_character_classes)) then raise exception 'Character is not allowed on this map';end if;
 if not app_private.duel_character_allowed_23(m.mode,c.item_key) then raise exception 'Character is not allowed in this duel mode';end if;
 -- QOL Ruins ownership restrictions
if m.map_key='ruins' and (c.rarity='mythic' or exists(select 1 from app_private.ruins_character_bans where match_id=p_match_id and character_key=c.item_key)) then raise exception 'Character is banned on Ruins for this match';end if;
select * into h from app_private.character_selection_snapshot(u,m.map_key,c.item_key);
 update public.multiplayer_players set character_key=h.character_key,character_class=h.character_class,max_hearts=h.max_hearts,hearts=h.starting_hearts,character_confirmed=true,last_seen_at=clock_timestamp() where match_id=p_match_id and user_id=u;
 return public.get_1v1_state(p_match_id);
end;
end
$function$
;

do $six$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='app_private.unlimited_1v1_requirements(uuid)'::regprocedure;if h not in('ac1252150d6525acd923ffc82c2de66f','6bd4db7a8dc57756581f8ef4f49ea629')then raise exception 'Source drift: app_private.unlimited_1v1_requirements(uuid)';end if;end $six$;
CREATE OR REPLACE FUNCTION app_private.unlimited_1v1_requirements(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with owned as(select distinct c.item_key,c.rarity from public.extraction_catalog c left join public.player_unlocks u on u.item_key=c.item_key and u.user_id=p_user_id
  where (u.user_id is not null or c.item_key in('runner_ace','medic_patch','tank_bulwark','trickster_rogue','chaotic_particle')) and c.active and c.item_type='character' and c.character_class in('runner','medic','tank','trickster','misc','chaotic') and c.item_key not like 'photon_%'),
 counts as(select count(*) filter(where rarity in('default','common','uncommon','rare','epic')) low,
  count(*) filter(where rarity='legendary') legendary,count(*) filter(where rarity='mythic') mythic from owned),
 status as(select coalesce((select level from public.player_stats where user_id=p_user_id),0) level,
  exists(select 1 from app_private.ranked_requalification where user_id=p_user_id and qualified) ranked,
  exists(select 1 from public.player_photon_fury where user_id=p_user_id and unlocked_at is not null) photon)
 select jsonb_build_object('low_tier_owned',least(low,96),'low_tier_required',96,'legendary_owned',least(legendary,21),
  'legendary_required',21,'mythic_owned',least(mythic,5),'mythic_required',5,'modes_complete',ranked and photon,
  'level_complete',level>=45,'unlocked',low>=96 and legendary>=21 and mythic>=5 and ranked and photon and level>=45) from counts cross join status;
$function$
;

do $six$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='app_private.photon_character_rules(text)'::regprocedure;if h not in('f70be4aa7f58d65299f59801f0682ea0','272b0940ca9e72611ffc973bd38ead3b')then raise exception 'Source drift: app_private.photon_character_rules(text)';end if;end $six$;
CREATE OR REPLACE FUNCTION app_private.photon_character_rules(p_key text)
 RETURNS TABLE(character_key text, max_hp numeric, durability integer, guard_seconds numeric, cooldown_seconds numeric, bonus_point_seconds integer, heal_amount numeric, heal_cooldown_seconds numeric)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select * from(values
('photon_magician',4.,7,0.4,1,40,0.,0.),
('photon_tick',4,7,0.5,0.8,null,0,0),
('photon_trumpet',5,12,0.4,0.8,null,0,0),
('photon_saxophone',4,7,0.4,1.2,null,0.5,25),
('photon_wizard',4,7,0.4,1,null,0,0),
('photon_nuclear',4,7,0.4,1,null,0,0),
('photon_burner',4,7,0.3,2,null,0,0),
('photon_bull',4,7,0.4,2,null,0,0),
('photon_bluff',5,7,0.3,1,null,0,0),
('photon_magnet',4,7,0.4,1,null,0,0),
('photon_bear',4,7,0.4,1,null,0,0),
('photon_wrench',4,7,0.9,2,null,0,0),
('photon_bell',3,7,0.4,1,null,0,0),
('photon_static',4,7,0.4,1,null,0,0),
('photon_oyster',4,7,0.4,1,null,0,0),
('photon_spade',4,7,0.4,1.4,null,0,0)
 )c where p_key is null or c.column1=p_key;
$function$
;

-- SIX_CLASS_RNG_PATCH
do $six$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='public.join_1v1_queue(text)'::regprocedure;if h not in('0d05b1b965ae186dc5c2e5cd4070e828','fa0771c68cb4e07f9b3f00eb803f76d6')then raise exception 'Source drift: public.join_1v1_queue(text)';end if;end $six$;
CREATE OR REPLACE FUNCTION public.join_1v1_queue(p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();k text:=lower(trim(p_mode));name text;other uuid;other_name text;mid uuid;m public.multiplayer_matches;
pool text[];candidates text[];map text:='classic';v_rarity text;classes text[];r float8;ck text;class text;slot integer;uid uuid;
begin
if u is null then raise exception 'Sign in required';end if;
if k is null or k not in('casual','ranked','unlimited','rng','hardcore_duel','quicksand','mundane') then raise exception 'Unknown duel mode';end if;
if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned';end if;
perform pg_advisory_xact_lock(917240115);
select mm.* into m from public.multiplayer_matches mm join public.multiplayer_players p on p.match_id=mm.id
where p.user_id=u and mm.status in('countdown','playing','intermission') order by mm.created_at desc limit 1;
if m.id is not null then return jsonb_build_object('match_id',m.id,'status',m.status,'mode',m.mode,'map_key',m.map_key,
'opponent_username',(select username from public.multiplayer_players where match_id=m.id and user_id<>u limit 1));end if;
-- Map Refresh Casual level 5.
-- Update 2.3 queue mode rules.
if not app_private.duel_mode_allowed_23(u,k) then raise exception 'Complete the unlock requirements for this duel mode';end if;
if k in('rng','hardcore_duel','quicksand','mundane') and k<>app_private.rotating_mode_19(now()) then raise exception 'Choose today''s active New York mode';end if;
if k='ranked' and (not exists(select 1 from app_private.ranked_requalification where user_id=u and qualified) or
app_private.has_active_ban(u,'leaderboard',null)) then raise exception 'Ranked requires level 25, its unlock, and no score ban';end if;
select username into name from public.player_profiles where user_id=u;
if name is null then raise exception 'Choose a username before entering 1v1';end if;
delete from public.multiplayer_queue where queued_at<now()-interval '2 minutes';
select q.user_id,p.username into other,other_name from public.multiplayer_queue q join public.player_profiles p on p.user_id=q.user_id join public.player_stats st on st.user_id=q.user_id
where q.user_id<>u and q.mode=k and not app_private.has_active_ban(q.user_id,'account',null)
and app_private.duel_mode_allowed_23(q.user_id,k)
and (k<>'ranked' or (exists(select 1 from app_private.ranked_requalification where user_id=q.user_id and qualified) and not app_private.has_active_ban(q.user_id,'leaderboard',null)))
and not exists(select 1 from public.multiplayer_players mp join public.multiplayer_matches mm on mm.id=mp.match_id where mp.user_id=q.user_id and mm.status in('countdown','playing','intermission'))
order by q.queued_at limit 1 for update of q skip locked;
if other is null then
insert into public.multiplayer_queue values(u,now(),k) on conflict(user_id) do update set queued_at=excluded.queued_at,mode=excluded.mode;
return jsonb_build_object('match_id',null,'status','waiting','mode',k);
end if;
-- QOL Map Refresh pool: Unknown is incomplete and unavailable.
pool:=case when k='hardcore_duel' then array['classic','ruins','desert','skyway','pitch','factory','meadow'] else array['classic','ruins','desert','skyway','pitch','volcano','factory','grove','meadow','terminal'] end;
select array_agg(key) into candidates from (select key from unnest(pool) key order by random() limit 4) x;
if k='rng' then
r:=random();map:=case when r<.4 then 'classic' when r<.7 then 'factory' when r<.9 then 'pitch' else 'meadow' end;
r:=random();v_rarity:=case when r<.15 then 'uncommon' when r<.5 then 'rare' when r<.85 then 'epic' else 'legendary' end;
candidates:=array[map];
select array_agg(key) into classes from (select key from unnest(array['runner','medic','tank','trickster','misc','chaotic']) key order by random()) x;
end if;
if k='quicksand' then map:='classic';candidates:=array[map];
elsif k='mundane' then r:=random();map:=case when r<.55 then 'classic' when r<.80 then 'factory' when r<.90 then 'meadow' else 'pitch' end;candidates:=array[map];end if;
insert into public.multiplayer_matches(host_user_id,guest_user_id,mode,map_key,map_candidates,map_selection_method,character_selection_ends_at)
values(other,u,k,map,candidates,case when k='rng' then 'rng' when k in('quicksand','mundane') then 'fixed' else 'bans' end,null) returning id into mid;
for slot in 1..2 loop
uid:=case when slot=1 then other else u end;ck:='runner_ace';class:='runner';
if k='rng' then
class:=classes[slot];select item_key into ck from public.extraction_catalog where active and item_type='character' and character_class=class and rarity=v_rarity order by random() limit 1;
if ck is null then raise exception 'Missing RNG % % character pool',v_rarity,class;end if;
end if;
insert into public.multiplayer_players(match_id,user_id,slot,username,character_key,character_class,max_hearts,hearts,lane_index)
values(mid,uid,slot,case when slot=1 then other_name else name end,ck,class,3,3,2);
end loop;
insert into app_private.match_setup_19 values(mid,case when k in('rng','quicksand','mundane') then 'announce' else 'ban' end,clock_timestamp()+case when k in('rng','quicksand','mundane') then interval '4 seconds' else interval '10 seconds' end,v_rarity);
if k in('rng','quicksand','mundane') then perform app_private.setup_19_health(mid);end if;
delete from public.multiplayer_queue where user_id in(u,other);
return jsonb_build_object('match_id',mid,'status','countdown','mode',k,'map_key',map,'opponent_username',other_name);
end;
end
$function$
;
notify pgrst,'reload schema';
commit;
