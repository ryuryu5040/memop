import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseAddressSearchResults } from "../src/lib/addressSearch.js";
import {
  getMapInitialView,
  isSamePinPosition,
  pinPositionValues,
  thumbnailTiles,
} from "../src/lib/tileMaps.js";

// 本番と同じ構造の空 DB（ステージングの初期化 SQL）に，今回の SQL を当てて確かめる．
const db = new PGlite();
const sql = (path) => readFile(new URL(path, import.meta.url), "utf8");
const owner = "00000000-0000-4000-8000-000000000001";
const imageMap = "10000000-0000-4000-8000-000000000001";
const tileMap = "10000000-0000-4000-8000-000000000002";

before(async () => {
  // Supabase が用意する領域だけを代用する（tests/staging-bootstrap.test.js と同じ）．
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE SCHEMA extensions;
    CREATE FUNCTION public.rls_auto_enable() RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz DEFAULT now());
    CREATE TABLE auth.identities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users,
      provider text, identity_data jsonb, created_at timestamptz DEFAULT now()
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY, name text NOT NULL, public boolean,
      file_size_limit bigint, allowed_mime_types text[]
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets,
      name text, owner_id text
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated;
    GRANT SELECT, INSERT ON storage.objects TO anon, authenticated;
  `);
  const bootstrap = (await sql("../docs/sql/initialize-staging.sql"))
    .replace(/-- BEGIN REALTIME[\s\S]*?-- END REALTIME/, "");
  await db.exec(bootstrap);
  await db.query("insert into auth.users(id) values ($1)", [owner]);
  // 今回の SQL を当てる前からある画像のマップとピン
  await db.query(
    "insert into public.maps(id, title, image_url, user_id, visibility) values ($1, '既存の画像マップ', 'old.png', $2, 'public')",
    [imageMap, owner],
  );
  await db.query("insert into public.pins(map_id, x, y, title, user_id) values ($1, 0.5, 0.5, '既存のピン', $2)", [imageMap, owner]);

  await db.exec(await sql("../supabase/migrations/20261127000000_tile_maps.sql"));
});
after(() => db.close());

async function rejects(query, params) {
  try {
    await db.query(query, params);
    return false;
  } catch (error) {
    if (error.code === "23514") return true; // 制約違反
    throw error;
  }
}

const insertMap = "insert into public.maps(id, title, image_url, user_id, visibility, map_type, center_lat, center_lng, zoom) values (coalesce($1, gen_random_uuid()), 'マップ', $2, $3, 'public', $4, $5, $6, $7)";
const insertPin = "insert into public.pins(map_id, x, y, lat, lng, title, user_id) values ($1, $2, $3, $4, $5, 'ピン', $6)";

test("既存のマップとピンは，画像のマップとしてそのまま残る", async () => {
  const { rows } = await db.query("select map_type, image_url from public.maps where id = $1", [imageMap]);
  assert.deepEqual(rows[0], { map_type: "image", image_url: "old.png" });
  const pin = (await db.query("select x, y, lat, lng from public.pins where map_id = $1", [imageMap])).rows[0];
  assert.deepEqual(pin, { x: 0.5, y: 0.5, lat: null, lng: null });
});

test("種類を指定しないマップは，これまでどおり画像のマップとして作れる", async () => {
  await db.query("insert into public.maps(title, image_url, user_id, visibility) values ('新しい画像マップ', 'new.png', $1, 'public')", [owner]);
});

test("地図のマップは，画像なし・最初の表示位置ありで作れる", async () => {
  await db.query(insertMap, [tileMap, null, owner, "tile", 35.68, 139.76, 15]);
});

test("マップの種類と合わない項目の組み合わせは保存できない", async () => {
  assert.equal(await rejects(insertMap, [null, "x.png", owner, "tile", 35.68, 139.76, 15]), true, "地図のマップに画像");
  assert.equal(await rejects(insertMap, [null, null, owner, "tile", null, 139.76, 15]), true, "中心の緯度なし");
  assert.equal(await rejects(insertMap, [null, null, owner, "tile", 35.68, 139.76, 19]), true, "拡大率が範囲外");
  assert.equal(await rejects(insertMap, [null, null, owner, "tile", 90, 139.76, 15]), true, "緯度が範囲外");
  assert.equal(await rejects(insertMap, [null, null, owner, "image", null, null, null]), true, "画像のマップに画像なし");
  assert.equal(await rejects(insertMap, [null, "y.png", owner, "image", 35.68, 139.76, 15]), true, "画像のマップに中心位置");
  assert.equal(await rejects(insertMap, [null, null, owner, "other", 35.68, 139.76, 15]), true, "一覧にない種類");
});

test("マップの種類はあとから変えられない", async () => {
  assert.equal(
    await rejects("update public.maps set map_type = 'tile', image_url = null, center_lat = 35, center_lng = 139, zoom = 10 where id = $1", [imageMap]),
    true,
  );
});

test("ピンの位置は，マップの種類に合った形式だけ保存できる", async () => {
  await db.query(insertPin, [tileMap, null, null, 35.681, 139.767, owner]);
  await db.query(insertPin, [imageMap, 0.2, 0.3, null, null, owner]);

  assert.equal(await rejects(insertPin, [tileMap, 0.2, 0.3, null, null, owner]), true, "地図のマップに割合の位置");
  assert.equal(await rejects(insertPin, [imageMap, null, null, 35.681, 139.767, owner]), true, "画像のマップに緯度経度");
  assert.equal(await rejects(insertPin, [tileMap, 0.2, 0.3, 35.681, 139.767, owner]), true, "両方の形式");
  assert.equal(await rejects(insertPin, [tileMap, null, null, null, null, owner]), true, "位置なし");
  assert.equal(await rejects(insertPin, [tileMap, null, null, 35.681, null, owner]), true, "経度なし");
});

test("ピンの保存用の値は，マップの種類に合わせて片方の組だけになる", () => {
  assert.deepEqual(pinPositionValues({ map_type: "tile" }, { lat: 35, lng: 139 }), { lat: 35, lng: 139, x: null, y: null });
  // 画像マップでは lat / lng を送らない（SQL の適用前でも保存できるように）
  assert.deepEqual(pinPositionValues({ map_type: "image" }, { x: 0.1, y: 0.2 }), { x: 0.1, y: 0.2 });
  // map_type が無い（移行前の）マップは画像として扱う
  assert.deepEqual(pinPositionValues({}, { x: 0.1, y: 0.2 }), { x: 0.1, y: 0.2 });
  assert.equal(isSamePinPosition({ lat: 1, lng: 2 }, { lat: 1, lng: 2 }), true);
  assert.equal(isSamePinPosition({ x: 0.1, y: 0.2 }, { x: 0.1, y: 0.3 }), false);
});

test("最初の表示位置が壊れていたら，決まった場所を使う", () => {
  assert.deepEqual(getMapInitialView({ center_lat: 34.7, center_lng: 135.5, zoom: 12 }), { lat: 34.7, lng: 135.5, zoom: 12 });
  assert.equal(getMapInitialView({ center_lat: null, center_lng: 135.5, zoom: 12 }).zoom, 15);
});

test("サムネイルのタイルは，中心の位置が枠の中心に来るように並ぶ", () => {
  // 拡大率1の世界は 2×2 枚．緯度0・経度0 は世界の真ん中（4枚の角が集まる点）
  const tiles = thumbnailTiles({ lat: 0, lng: 0, zoom: 1 }, 100, 100);
  assert.deepEqual(tiles.map((tile) => [tile.left, tile.top]), [[-256, -256], [0, -256], [-256, 0], [0, 0]]);
  assert.match(tiles[0].url, /\/std\/1\/0\/0\.png$/);
  // 東京駅あたり．どのタイルも枠（中心から ±200 × ±120）に重なっている
  for (const tile of thumbnailTiles({ lat: 35.681, lng: 139.767, zoom: 15 })) {
    assert.ok(tile.left < 200 && tile.left + 256 > -200, tile.key);
    assert.ok(tile.top < 120 && tile.top + 256 > -120, tile.key);
  }
});

test("住所検索の結果から，名前と緯度経度を取り出す（座標は経度・緯度の順で届く）", () => {
  const results = parseAddressSearchResults([
    { geometry: { coordinates: [139.79, 35.66] }, properties: { title: "東京都江東区豊洲" } },
    { geometry: { coordinates: [] }, properties: { title: "座標なし" } },
  ]);
  assert.deepEqual(results, [{ title: "東京都江東区豊洲", lat: 35.66, lng: 139.79 }]);
  assert.deepEqual(parseAddressSearchResults(null), []);
});
