import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  fitLandmarkTransform,
  getAddressPinSetup,
  getMapLandmarks,
  parseLatLng,
  placeOnImage,
} from "../src/lib/addressPins.js";

// ---- 計算（画面側） ----

// 北が上の架空のマップ．画像の左上が (lat 35.66, lng 139.78)，右下が (lat 35.64, lng 139.80)．
const corner = { x: 0, y: 0, lat: 35.66, lng: 139.78 };
const opposite = { x: 1, y: 1, lat: 35.64, lng: 139.80 };
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} ≠ ${expected}`);

test("目印2か所で，縦横の縮尺と位置を合わせて画像上の位置を計算する", () => {
  const transform = fitLandmarkTransform([corner, opposite]);
  assert.equal(transform.ok, true);
  assert.equal(transform.method, "axis");
  const middle = placeOnImage(transform, { lat: 35.65, lng: 139.79 });
  close(middle.x, 0.5, "x");
  close(middle.y, 0.5, "y");
  assert.equal(middle.inside, true);
  // 緯度が上がる（北へ行く）ほど，画像では上（y が小さい）になる
  close(placeOnImage(transform, { lat: 35.655, lng: 139.785 }).y, 0.25, "北寄り");
});

test("目印3か所以上で，回転した画像にも合わせられる", () => {
  // 画像を90度回した（右が北の）マップ：x は緯度で，y は経度で決まる
  // （小数の誤差で 1.0000000000001 のように 0〜1 をはみ出さないよう丸める）
  const round = (value) => Math.round(value * 1e6) / 1e6;
  const rotated = (lat, lng) => ({ x: round((lat - 35.64) / 0.02), y: round((lng - 139.78) / 0.02), lat, lng });
  const landmarks = [rotated(35.64, 139.78), rotated(35.66, 139.78), rotated(35.64, 139.80)];
  const transform = fitLandmarkTransform(landmarks);
  assert.equal(transform.method, "affine");
  const point = placeOnImage(transform, { lat: 35.655, lng: 139.785 });
  close(point.x, 0.75, "x");
  close(point.y, 0.25, "y");
});

test("目印が足りない・近すぎる・一直線のときは理由を返す", () => {
  assert.match(fitLandmarkTransform([corner]).reason, /あと1か所/);
  assert.match(fitLandmarkTransform([]).reason, /あと2か所/);
  // 南北にしか離れていない（同じ経度）
  const sameLng = fitLandmarkTransform([corner, { x: 0.5, y: 1, lat: 35.64, lng: 139.78 }]);
  assert.equal(sameLng.ok, false);
  assert.match(sameLng.reason, /東西にも南北にも/);
  // ほとんど同じ場所
  assert.equal(fitLandmarkTransform([corner, { ...corner, x: 0.5, y: 0.5, lat: 35.66001 }]).ok, false);
});

test("3か所以上でも一直線に並ぶときは，北が上とみなして計算する", () => {
  const transform = fitLandmarkTransform([corner, { x: 0.5, y: 0.5, lat: 35.65, lng: 139.79 }, opposite]);
  assert.equal(transform.method, "axis");
  close(placeOnImage(transform, { lat: 35.645, lng: 139.785 }).x, 0.25, "x");
});

test("画像の外になる住所は inside: false になる", () => {
  const transform = fitLandmarkTransform([corner, opposite]);
  assert.equal(placeOnImage(transform, { lat: 35.70, lng: 139.79 }).inside, false);
});

test("無効のマップや壊れた目印では使えない", () => {
  assert.equal(getAddressPinSetup({ address_pin_enabled: false, address_landmarks: [corner, opposite] }).ok, false);
  assert.equal(getAddressPinSetup({ address_pin_enabled: true, address_landmarks: [corner, opposite] }).ok, true);
  assert.deepEqual(getMapLandmarks({ address_landmarks: [corner, { x: 2, y: 0, lat: 0, lng: 0 }, "壊れた値"] }), [corner]);
  // 列が無い（SQL の適用前の）マップ
  assert.deepEqual(getMapLandmarks({}), []);
});

test("緯度経度の文字を読む（Google マップからコピーした形など）", () => {
  assert.deepEqual(parseLatLng("35.6547, 139.7959"), { lat: 35.6547, lng: 139.7959 });
  assert.deepEqual(parseLatLng(" 35.6547，139.7959 "), { lat: 35.6547, lng: 139.7959 });
  assert.deepEqual(parseLatLng("35.6547 139.7959"), { lat: 35.6547, lng: 139.7959 });
  assert.equal(parseLatLng("東京都江東区豊洲6丁目"), null);
  assert.equal(parseLatLng("135.1, 139.7"), null, "緯度が範囲外");
});

// ---- データベース ----

const db = new PGlite();
const sql = (path) => readFile(new URL(path, import.meta.url), "utf8");
const owner = "00000000-0000-4000-8000-000000000001";
const admin = "00000000-0000-4000-8000-000000000002";
const visitor = "00000000-0000-4000-8000-000000000003";
const imageMap = "10000000-0000-4000-8000-000000000001";
const tileMap = "10000000-0000-4000-8000-000000000002";
const landmarksJson = JSON.stringify([corner, { ...opposite, label: "豊洲駅" }]);

before(async () => {
  // Supabase が用意する領域だけを代用する（tests/tile-maps.test.js と同じ）．
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
  await db.query("insert into auth.users(id) values ($1), ($2), ($3)", [owner, admin, visitor]);
  await db.query("insert into public.map_administrators(user_id) values ($1)", [admin]);
  await db.exec(await sql("../supabase/migrations/20261127000000_tile_maps.sql"));
  // 今回の SQL を当てる前からある画像のマップ
  await db.query(
    "insert into public.maps(id, title, image_url, user_id, visibility) values ($1, '既存の画像マップ', 'old.png', $2, 'public')",
    [imageMap, owner],
  );
  await db.query(
    "insert into public.maps(id, title, user_id, visibility, map_type, center_lat, center_lng, zoom) values ($1, '地図のマップ', $2, 'public', 'tile', 35.65, 139.79, 15)",
    [tileMap, owner],
  );
  await db.exec(await sql("../supabase/migrations/20261128000000_address_pins.sql"));
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

/** ログインした人として更新を試し，更新できた行数を返す（RLS を通す） */
async function updateAs(userId, query, params) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await tx.query(query, params);
    return result.affectedRows;
  });
}

const setLandmarks = "update public.maps set address_landmarks = $2::jsonb, address_pin_enabled = $3 where id = $1";

test("既存のマップは，住所からピンを置く機能が無効・目印なしのまま残る", async () => {
  const { rows } = await db.query("select address_pin_enabled, address_landmarks from public.maps where id = $1", [imageMap]);
  assert.deepEqual(rows[0], { address_pin_enabled: false, address_landmarks: [] });
});

test("有効にするには，画像のマップで目印が2か所以上必要", async () => {
  assert.equal(await rejects(setLandmarks, [imageMap, JSON.stringify([corner]), true]), true, "目印1か所");
  assert.equal(await rejects(setLandmarks, [tileMap, landmarksJson, true]), true, "地図のマップ");
  // 目印1か所でも，無効のまま保存しておくことはできる（登録の途中）
  await db.query(setLandmarks, [imageMap, JSON.stringify([corner]), false]);
  await db.query(setLandmarks, [imageMap, landmarksJson, true]);
});

test("形の正しくない目印は保存できない", async () => {
  const invalid = [
    ["配列でない", { x: 0, y: 0, lat: 35, lng: 139 }],
    ["x が範囲外", [{ ...corner, x: 1.5 }]],
    ["緯度が数値でない", [{ ...corner, lat: "35.66" }]],
    ["経度なし", [{ x: 0, y: 0, lat: 35.66 }]],
    ["名前が長すぎる", [{ ...corner, label: "あ".repeat(41) }]],
    ["名前が文字でない", [{ ...corner, label: 1 }]],
    ["11か所以上", Array.from({ length: 11 }, () => corner)],
  ];
  for (const [message, value] of invalid) {
    assert.equal(await rejects(setLandmarks, [imageMap, JSON.stringify(value), false]), true, message);
  }
});

test("目印の登録・変更と有効・無効は，作成者と管理者だけができる", async () => {
  assert.equal(await updateAs(visitor, setLandmarks, [imageMap, "[]", false]), 0, "ほかの人");
  assert.equal(await updateAs(owner, setLandmarks, [imageMap, landmarksJson, false]), 1, "作成者");
  assert.equal(await updateAs(admin, setLandmarks, [imageMap, landmarksJson, true]), 1, "管理者");
  const { rows } = await db.query("select address_pin_enabled from public.maps where id = $1", [imageMap]);
  assert.equal(rows[0].address_pin_enabled, true);
});
