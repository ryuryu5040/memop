-- 画像のマップで「住所からピンを置く」を使えるようにする（#25）。
-- Supabase の SQL Editor で全体を実行する。先に 20261127000000_tile_maps.sql（maps.map_type）を実行しておくこと。
-- 既存のマップはすべて「無効」のままなので、見た目も操作もこれまでと変わらない。
--
-- maps.address_pin_enabled … 住所からピンを置く機能を使うか。初期値は無効。
-- maps.address_landmarks   … 目印（画像上の点と実際の位置の対応）の配列。
--                            [{ "x": 0〜1, "y": 0〜1, "lat": 緯度, "lng": 経度, "label": "豊洲駅" }, ...]
--                            x, y は pins.x, pins.y と同じく、画像に対する割合。
--
-- 目印の登録・変更と有効・無効の切り替えは maps の更新なので、
-- これまでの行単位のルール（RLS の maps_update）により、マップの作成者と管理者だけができる。
-- 目印はピンを追加する人の画面で位置を計算するのに使うので、マップを見られる人は読める。
--
-- 画面側の定義は src/lib/addressPins.js。値の範囲を変えるときは両方をそろえる。
begin;

alter table public.maps add column if not exists address_pin_enabled boolean not null default false;
alter table public.maps add column if not exists address_landmarks jsonb not null default '[]'::jsonb;

-- 目印の配列の中身が正しい形か。
-- case を使っているのは、形が違う値（文字など）を数値に変換しようとしてエラーになるのを防ぐため
-- （and で並べただけでは、どの順に調べるかが決まっていない）。
create or replace function public.is_valid_address_landmarks(landmarks jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(landmarks) is distinct from 'array' then false
    when jsonb_array_length(landmarks) > 10 then false
    else not exists (
      select 1
      from jsonb_array_elements(landmarks) as item
      where not coalesce(
        case
          when jsonb_typeof(item) is distinct from 'object' then false
          when jsonb_typeof(item -> 'x') is distinct from 'number'
            or jsonb_typeof(item -> 'y') is distinct from 'number'
            or jsonb_typeof(item -> 'lat') is distinct from 'number'
            or jsonb_typeof(item -> 'lng') is distinct from 'number' then false
          when item ? 'label' and jsonb_typeof(item -> 'label') is distinct from 'string' then false
          else (item ->> 'x')::double precision between 0 and 1
            and (item ->> 'y')::double precision between 0 and 1
            and (item ->> 'lat')::double precision between -85 and 85
            and (item ->> 'lng')::double precision between -180 and 180
            and char_length(coalesce(item ->> 'label', '')) <= 40
        end,
        false
      )
    )
  end;
$$;
revoke all on function public.is_valid_address_landmarks(jsonb) from public, anon, authenticated;
-- 下の check 制約は、マップを作る・更新する人の権限でこの関数を呼ぶので、ログインした人には実行を許す。
-- （値の形を調べるだけで、表を読んだり書いたりはしない）
grant execute on function public.is_valid_address_landmarks(jsonb) to authenticated;

-- 有効にできるのは画像のマップだけで、目印が2か所以上あるとき。
-- 目印の並び方（近すぎないか、一直線でないか）は画面側で調べて理由を表示する。
alter table public.maps drop constraint if exists maps_address_pin_check;
alter table public.maps add constraint maps_address_pin_check check (
  case
    when not public.is_valid_address_landmarks(address_landmarks) then false
    else address_pin_enabled = false
      or (map_type = 'image' and jsonb_array_length(address_landmarks) >= 2)
  end
);

-- Supabase の API に新しい列を読み込ませる。
notify pgrst, 'reload schema';
commit;
