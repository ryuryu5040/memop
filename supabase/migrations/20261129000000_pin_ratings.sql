-- ピンを 0.5〜5.0（0.5 刻み）の星で評価できるようにする（#47）。マップごとにオン・オフを選べる。
-- Supabase の SQL Editor で全体を実行する。
-- 先に 20261126000000_pin_categories.sql・20261127000000_tile_maps.sql・20261128000000_address_pins.sql を実行しておくこと。
-- 練習用DB（memop-staging）→ 本番DB（memop）の順に適用する。実行前でもアプリは動く（評価の設定と表示が出ないだけ）。
--
-- 「誰が何点を付けたか」は本人以外に見せない。
--   pin_ratings（1人1ピン1つの評価）は、本人の行しか読めない。
--   ほかの人に見せるのは平均と件数だけで、それは pins.rating_sum・pins.rating_count として持つ。
--   この2列はトリガーで自動的に数え直し、ピンの投稿者でも直接は書き換えられない。
--   平均は画面側で rating_sum ÷ rating_count を計算する（src/lib/pinRatings.js）。
-- pin_ratings は Realtime の publication に入れない（入れると、ほかの人の評価が配信で見えてしまうため）。
--   ほかの人が評価を変えると pins の2列が更新されるので、これまでのピンのリアルタイム反映で平均が届く。
begin;

-- 1. マップごとのオン・オフ。変えられるのは、これまでの maps_update の RLS どおり作成者と管理者だけ。
alter table public.maps add column if not exists rating_enabled boolean not null default false;

-- 2. ピンごとの評価の合計と件数（平均を出すため）。既存のピンは 0 件から始まる。
alter table public.pins add column if not exists rating_sum numeric not null default 0;
alter table public.pins add column if not exists rating_count integer not null default 0;

-- 3. 評価そのもの。主キーで 1人1ピン1つにする。ピンや利用者が消えたら評価も消える。
create table if not exists public.pin_ratings (
  pin_id uuid not null references public.pins(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating numeric(2, 1) not null
    check (rating between 0.5 and 5.0 and rating * 2 = trunc(rating * 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pin_id, user_id)
);
alter table public.pin_ratings enable row level security;

-- 未ログインの人には何も許さない。ログインした人も、下の RLS で本人の分だけになる。
revoke all on table public.pin_ratings from public, anon, authenticated;
grant select, insert, update, delete on table public.pin_ratings to authenticated;

-- 評価できるピンか：そのピンが見えて（pins の RLS が効く）、マップの評価機能がオンで、マップ移動のボタンではない。
drop policy if exists pin_ratings_read on public.pin_ratings;
create policy pin_ratings_read on public.pin_ratings for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists pin_ratings_insert on public.pin_ratings;
create policy pin_ratings_insert on public.pin_ratings for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.pins as pin
      join public.maps as map on map.id = pin.map_id
      where pin.id = pin_ratings.pin_id and map.rating_enabled and pin.kind <> 'button'
    )
  );

drop policy if exists pin_ratings_update on public.pin_ratings;
create policy pin_ratings_update on public.pin_ratings for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.pins as pin
      join public.maps as map on map.id = pin.map_id
      where pin.id = pin_ratings.pin_id and map.rating_enabled and pin.kind <> 'button'
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.pins as pin
      join public.maps as map on map.id = pin.map_id
      where pin.id = pin_ratings.pin_id and map.rating_enabled and pin.kind <> 'button'
    )
  );

-- オフの間は取り消しもできない（画面に評価を出さないため）。データは残る。
drop policy if exists pin_ratings_delete on public.pin_ratings;
create policy pin_ratings_delete on public.pin_ratings for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.pins as pin
      join public.maps as map on map.id = pin.map_id
      where pin.id = pin_ratings.pin_id and map.rating_enabled and pin.kind <> 'button'
    )
  );

-- 4. 評価を変えたら、更新日時を新しくする。
create or replace function private.touch_pin_rating()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;
revoke all on function private.touch_pin_rating() from public, anon, authenticated;
drop trigger if exists pin_ratings_touch on public.pin_ratings;
create trigger pin_ratings_touch before update on public.pin_ratings
  for each row execute function private.touch_pin_rating();

-- 5. 評価が変わったら、そのピンの合計と件数を数え直す。
--    本人の評価しか読めない人の操作から呼ばれるので、DB 所有者の権限（security definer）で全員分を数える。
create or replace function private.refresh_pin_rating(target_pin_id uuid)
returns void language sql security definer set search_path = ''
as $function$
  update public.pins
  set rating_sum = coalesce((select sum(rating) from public.pin_ratings where pin_id = target_pin_id), 0),
      rating_count = (select count(*) from public.pin_ratings where pin_id = target_pin_id)
  where id = target_pin_id;
$function$;
revoke all on function private.refresh_pin_rating(uuid) from public, anon, authenticated;

create or replace function private.recount_pin_rating()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    perform private.refresh_pin_rating(old.pin_id);
    return null;
  end if;
  perform private.refresh_pin_rating(new.pin_id);
  if tg_op = 'UPDATE' and new.pin_id is distinct from old.pin_id then
    perform private.refresh_pin_rating(old.pin_id);
  end if;
  return null;
end;
$function$;
revoke all on function private.recount_pin_rating() from public, anon, authenticated;
drop trigger if exists pin_ratings_recount on public.pin_ratings;
create trigger pin_ratings_recount after insert or update or delete on public.pin_ratings
  for each row execute function private.recount_pin_rating();

-- 6. 合計と件数を、数え直し以外で書き換えさせない。
--    新しいピンは必ず 0 件から始める。直接の更新（トリガーの外からの update）では、元の値に戻す。
--    数え直しは pin_ratings のトリガーの中から呼ばれるので、pg_trigger_depth() が 1 より大きくなる。
create or replace function private.protect_pin_rating_totals()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.rating_sum := 0;
    new.rating_count := 0;
  elsif pg_trigger_depth() = 1 then
    new.rating_sum := old.rating_sum;
    new.rating_count := old.rating_count;
  end if;
  return new;
end;
$function$;
revoke all on function private.protect_pin_rating_totals() from public, anon, authenticated;
drop trigger if exists pins_protect_rating_totals on public.pins;
create trigger pins_protect_rating_totals before insert or update on public.pins
  for each row execute function private.protect_pin_rating_totals();

-- 7. 既存の列と同じように読めるようにする（どのピン・マップを読めるかは、これまでの RLS がそのまま効く）。
grant select (rating_sum, rating_count) on table public.pins to anon, authenticated;
grant select (rating_enabled) on table public.maps to anon, authenticated;
grant update (rating_enabled) on table public.maps to authenticated;

-- 8. Supabase の API に新しい列と表を読み込ませる。
notify pgrst, 'reload schema';
commit;
