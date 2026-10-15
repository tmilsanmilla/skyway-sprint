-- Photon QOL 01: isolated catalog and minimal own-account collection storage.
begin;
alter table public.player_photon_fury add column if not exists selected_weapon_key text not null default 'lightsaber',
 add column if not exists selected_theme_key text not null default 'default',add column if not exists skin_choices jsonb not null default '{}',
 add column if not exists box_nonce uuid not null default gen_random_uuid(),add column if not exists last_box_nonce uuid,
 add column if not exists last_box_result jsonb;
create table if not exists app_private.photon_unlocks(
 user_id uuid not null references public.player_photon_fury(user_id) on delete cascade,item_key text not null,
 kind text not null check(kind in('character','skin','theme','weapon')),unlocked_at timestamptz not null default clock_timestamp(),
 primary key(user_id,item_key));
alter table app_private.photon_unlocks enable row level security;
revoke all on app_private.photon_unlocks from public,anon,anonymous,authenticated;
create or replace function app_private.photon_character_rules(p_key text)
returns table(character_key text,max_hp numeric,durability integer,guard_seconds numeric,cooldown_seconds numeric,
 bonus_point_seconds integer,heal_amount numeric,heal_cooldown_seconds numeric) language sql immutable set search_path='' as $$
 select * from(values
('photon_magician',4.,7,0.4,1,45,0.,0.),
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
$$;
create or replace function app_private.photon_weapon_rules(p_key text)
returns table(weapon_key text,display_name text,photon_price integer,gem_price integer) language sql immutable set search_path='' as $$
 select * from(values
('lightsaber','Lightsaber',0,0),
('photon_blaster','Photon Blaster',13000,390),
('ninjablade','Ninjablade',8000,240),
('magnetite_sword','Magnetite Sword',5000,150),
('concentrated_laser','Concentrated Laser',6000,180),
('jolt_shockwave','Jolt Shockwave',9000,270)
 )w where p_key is null or w.column1=p_key;
$$;
create or replace function app_private.photon_qol_catalog()
returns table(item_key text,display_name text,kind text,character_key text,rarity text)
language sql immutable set search_path='' as $$
 with characters(key,name)as(values
('photon_magician','Magician'),
('photon_tick','Tick'),
('photon_trumpet','Trumpet'),
('photon_saxophone','Saxophone'),
('photon_wizard','Wizard'),
('photon_nuclear','Nuclear'),
('photon_burner','Burner'),
('photon_bull','Bull'),
('photon_bluff','Bluff'),
('photon_magnet','Magnet'),
('photon_bear','Bear'),
('photon_wrench','Wrench'),
('photon_bell','Bell'),
('photon_static','Static'),
('photon_oyster','Oyster'),
('photon_spade','Spade')
 ),skin_names(key,intermediate,pro,divine)as(values
('photon_magician','Arcane Apprentice','Holo Illusionist','Astral Sovereign'),
('photon_tick','Quartz Clockwork','Chrono Pilot','Eternal Hour'),
('photon_trumpet','Brass Cadet','Solar Fanfare','Golden Anthem'),
('photon_saxophone','Copper Session','Midnight Solo','Celestial Jazz'),
('photon_wizard','Rune Walker','Portal Adept','Cosmic Archmage'),
('photon_nuclear','Isotope Suit','Fusion Reactor','Stellar Detonation'),
('photon_burner','Ember Suit','Plasma Inferno','Phoenix Corona'),
('photon_bull','Iron Horn','Titan Charger','Nebula Minotaur'),
('photon_bluff','Decoy Suit','Mirror Operator','Quantum Mirage'),
('photon_magnet','Polar Coat','Flux Commander','Gravity Sovereign'),
('photon_bear','Alloy Cub','Ursine Sentinel','Aurora Guardian'),
('photon_wrench','Chrome Mechanic','Circuit Architect','Divine Machine'),
('photon_bell','Silver Chime','Resonance Halo','Empyrean Peal'),
('photon_static','Ion Spark','Storm Conductor','Thunder Ascendant'),
('photon_oyster','Pearl Shell','Iridescent Reef','Galactic Pearl'),
('photon_spade','Carbon Suit','Obsidian Dealer','Astral Ace'))
 select key,name,'character',key,null::text from characters
 union all select key||'_'||tier,case tier when 'intermediate' then intermediate when 'pro' then pro else divine end,'skin',key,tier from skin_names cross join
 (values('intermediate'),('pro'),('divine'))s(tier)
 union all select key,name,'theme',null,rarity from(values
('photon_theme_cobalt','Cobalt Circuit','common'),
('photon_theme_hangar','Orbital Hangar','common'),
('photon_theme_terminal','Neon Terminal','common'),
('photon_theme_reactor','Reactor Core','uncommon'),
('photon_theme_polar','Polar Array','uncommon'),
('photon_theme_sunset','Solar Dock','uncommon'),
('photon_theme_abyss','Abyssal Relay','rare'),
('photon_theme_quartz','Quantum Quartz','rare'),
('photon_theme_mars','Martian Outpost','rare'),
('photon_theme_storm','Tesla Storm','epic'),
('photon_theme_void','Void Cathedral','epic'),
('photon_theme_garden','Bio-Neon Garden','epic'),
('photon_theme_nova','Supernova Station','legendary'),
('photon_theme_chrono','Chronosphere','legendary'),
('photon_theme_prism','Prism Citadel','legendary'),
('photon_theme_singularity','Singularity','mythic'),
('photon_theme_celestial','Celestial Engine','mythic')
 )t(key,name,rarity)
 union all select 'photon_weapon_'||weapon_key,display_name,'weapon',null,null from app_private.photon_weapon_rules(null);
$$;
create or replace function app_private.owns_photon_character(p_user_id uuid,p_character_key text)
returns boolean language sql stable set search_path='' as $$
 select p_user_id is not null and p_character_key is not null and exists(select 1 from app_private.photon_character_rules(p_character_key))
 and (p_character_key in('photon_magician','photon_wizard','photon_bluff','photon_bell') or
 exists(select 1 from app_private.photon_unlocks where user_id=p_user_id and item_key=p_character_key and kind='character') or
 exists(select 1 from public.player_unlocks where user_id=p_user_id and item_key=p_character_key and item_type='character'));
$$;
create or replace function app_private.photon_weapon_compatible(w text,c text)
returns boolean language sql immutable set search_path='' as $$
 select not(w in('photon_blaster','magnetite_sword','concentrated_laser') and c in('photon_bear','photon_magnet'));
$$;
revoke all on function app_private.photon_character_rules(text),app_private.photon_weapon_rules(text),
 app_private.photon_qol_catalog(),app_private.owns_photon_character(uuid,text),app_private.photon_weapon_compatible(text,text)
 from public,anon,anonymous,authenticated;
commit;
