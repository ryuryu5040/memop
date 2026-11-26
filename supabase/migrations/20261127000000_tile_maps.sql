-- 画像のマップに加えて、実際の地図（国土地理院の地図）をもとにした「地図」のマップを作れるようにする。
-- Supabase の SQL Editor で全体を実行する。既存のマップ・ピンはすべて画像のマップとして、これまでどおり使える。
--
-- マップの種類（maps.map_type）
--   image … アップロードした画像のマップ。image_url が必須。ピンの位置は画像に対する割合（pins.x, pins.y）。
--   tile  … 地図のマップ。画像は持たず、最初に表示する場所（center_lat, center_lng）と拡大率（zoom）が必須。
--           ピンの位置は緯度経度（pins.lat, pins.lng）。
--
-- 画面側の定義は src/lib/tileMaps.js。値の範囲を変えるときは両方をそろえる。
-- check 制約は結果が null（不明）のときも通してしまうので、各条件で is not null を明示している。
begin;

-- 1. マップの種類と、地図のマップの最初の表示位置
alter table public.maps add column if not exists map_type text not null default 'image';
alter table public.maps add column if not exists center_lat double precision;
alter table public.maps add column if not exists center_lng double precision;
alter table public.maps add column if not exists zoom smallint;
-- 地図のマップは画像を持たないので、image_url を空にできるようにする（画像のマップでは下の制約で必須のまま）。
alter table public.maps alter column image_url drop not null;

alter table public.maps drop constraint if exists maps_map_type_check;
alter table public.maps add constraint maps_map_type_check check (
  (
    map_type = 'image'
    and image_url is not null
    and center_lat is null and center_lng is null and zoom is null
  )
  or (
    map_type = 'tile'
    and image_url is null
    and center_lat is not null and center_lat between -85 and 85
    and center_lng is not null and center_lng between -180 and 180
    and zoom is not null and zoom between 5 and 18
  )
);

-- マップの種類はあとから変えられない（ピンの位置の形式が合わなくなるため）。
create or replace function public.prevent_map_type_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.map_type is distinct from old.map_type then
    raise exception 'The map type cannot be changed' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_map_type_change() from public, anon, authenticated;

drop trigger if exists maps_prevent_type_change on public.maps;
create trigger maps_prevent_type_change before update of map_type on public.maps
  for each row execute function public.prevent_map_type_change();

-- 2. ピンの位置。画像のマップのピンはこれまでどおり x, y、地図のマップのピンは lat, lng を使う。
alter table public.pins add column if not exists lat double precision;
alter table public.pins add column if not exists lng double precision;
alter table public.pins alter column x drop not null;
alter table public.pins alter column y drop not null;

alter table public.pins drop constraint if exists pins_position_check;
alter table public.pins add constraint pins_position_check check (
  (
    x is not null and y is not null
    and lat is null and lng is null
  )
  or (
    x is null and y is null
    and lat is not null and lat between -85 and 85
    and lng is not null and lng between -180 and 180
  )
);

-- ピンの位置の形式が、置くマップの種類と合っているかを確かめる。
-- 閲覧権限（RLS）に左右されずにマップの種類を読めるよう、所有者の権限で動かす。
create or replace function public.check_pin_position_matches_map()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_type text;
begin
  select map_type into target_type from public.maps where id = new.map_id;
  if target_type is null then
    -- マップが無い場合は、外部キーなど既存のルールに任せる
    return new;
  end if;
  if (target_type = 'tile') <> (new.lat is not null) then
    raise exception 'The pin position does not match the map type'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.check_pin_position_matches_map() from public, anon, authenticated;

drop trigger if exists pins_check_position_matches_map on public.pins;
create trigger pins_check_position_matches_map
  before insert or update of map_id, x, y, lat, lng on public.pins
  for each row execute function public.check_pin_position_matches_map();

-- 3. 権限は表全体に付いているので、新しい列もこれまでの行単位のルール（RLS）のまま読み書きできる。
--    Supabase の API に新しい列を読み込ませる。
notify pgrst, 'reload schema';
commit;
