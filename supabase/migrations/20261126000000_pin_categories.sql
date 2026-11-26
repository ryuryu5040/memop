-- ピンにカテゴリ（何の場所か）とサブカテゴリを任意で付ける。
-- Supabase の SQL Editor で全体を実行する。実行前でもアプリは動く。
-- カテゴリを「なし」にしたピンはこれまでどおり保存でき、カテゴリを選んで保存したときだけ案内が出る。
--
-- 保存できる値は src/lib/pinCategories.js の一覧と同じにする。
-- 一覧を変えたら、下の check 制約も同じように書き換える（npm test でずれていないか確認できる）。
begin;

-- 1. どちらも任意なので null を許す。既存のピンは null（カテゴリなし）のまま変わらない。
alter table public.pins add column if not exists category text;
alter table public.pins add column if not exists subcategory text;

-- 2. 決められたカテゴリと、そのカテゴリに属するサブカテゴリの組み合わせだけを受け付ける。
--    サブカテゴリだけを入れることはできない。
--    check 制約は結果が null（不明）のときも通してしまうので、各条件で is not null を明示し、
--    結果が必ず true か false になるようにしている。
alter table public.pins drop constraint if exists pins_category_check;
alter table public.pins add constraint pins_category_check check (
  (category is null and subcategory is null)
  or (
    category is not null
    and subcategory is null
    and category in ('food', 'shopping', 'nature', 'sightseeing', 'stay', 'transport', 'life')
  )
  or (
    category is not null
    and subcategory is not null
    and (category || ':' || subcategory) in (
    'food:japanese', 'food:sushi_seafood', 'food:soba_udon', 'food:ramen',
    'food:yakiniku_steak', 'food:western', 'food:chinese', 'food:asian_ethnic',
    'food:curry', 'food:izakaya_bar', 'food:cafe', 'food:sweets_bakery', 'food:fast_food',
    'shopping:grocery', 'shopping:goods_interior', 'shopping:fashion',
    'shopping:books_stationery', 'shopping:souvenir', 'shopping:drugstore',
    'nature:park', 'nature:mountain_hiking', 'nature:waterside',
    'nature:flowers_foliage', 'nature:scenery',
    'sightseeing:landmark', 'sightseeing:shrine_temple', 'sightseeing:museum',
    'sightseeing:amusement', 'sightseeing:movie_live',
    'stay:hotel_ryokan',
    'transport:station_bus_stop', 'transport:parking',
    'life:hospital', 'life:city_office', 'life:bank_post', 'life:toilet', 'life:other'
    )
  )
);

-- 3. 既存の列と同じように読み書きできるようにする。
--    誰がどのピンを読み書きできるかは、これまでの pins の行単位のルール（RLS）がそのまま効く。
grant select (category, subcategory) on table public.pins to anon, authenticated;
grant insert (category, subcategory), update (category, subcategory) on table public.pins to authenticated;

-- 4. Supabase の API に新しい列を読み込ませる。
notify pgrst, 'reload schema';
commit;
