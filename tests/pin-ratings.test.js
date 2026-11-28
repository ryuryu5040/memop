import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  canRatePin,
  chunkIds,
  mergePinUpdate,
  saveMyRating,
  formatRatingAverage,
  formatRatingSummary,
  getRatingAverage,
  isPinRatingUnavailableError,
  isRatingEnabled,
  isValidRating,
  ratingFromStar,
} from "../src/lib/pinRatings.js";

// ---- 計算（画面側） ----

test("平均は合計÷件数を小数第2位で四捨五入する", () => {
  assert.equal(getRatingAverage({ rating_sum: 19, rating_count: 4 }), 4.8, "4.75 → 4.8");
  assert.equal(getRatingAverage({ rating_sum: "13.0", rating_count: 3 }), 4.3, "API から文字で届いても計算できる");
  assert.equal(getRatingAverage({ rating_sum: 0, rating_count: 0 }), null, "未評価");
  assert.equal(getRatingAverage({}), null, "列がない（SQL 未適用）");
});

test("表示用の文字にする", () => {
  assert.equal(formatRatingAverage({ rating_sum: 8, rating_count: 2 }), "4.0");
  assert.equal(formatRatingAverage({ rating_sum: 0, rating_count: 0 }), null);
  assert.equal(formatRatingSummary({ rating_sum: 14.5, rating_count: 3 }), "⭐4.8（3件）");
  assert.equal(formatRatingSummary({ rating_sum: 0, rating_count: 0 }), "未評価");
});

test("星の左半分は0.5，右半分は1として点数にする", () => {
  assert.equal(ratingFromStar(5, true), 4.5);
  assert.equal(ratingFromStar(1, true), 0.5);
  assert.equal(ratingFromStar(3, false), 3);
});

test("保存できる点数か", () => {
  for (const good of [0.5, 2.5, 5]) assert.equal(isValidRating(good), true, `${good}`);
  for (const bad of [0, 0.3, 5.5, NaN, null]) assert.equal(isValidRating(bad), false, `${bad}`);
});

test("評価機能がオンのマップの，ボタンではないピンだけ評価できる", () => {
  assert.equal(isRatingEnabled({ rating_enabled: true }), true);
  assert.equal(isRatingEnabled({}), false);
  assert.equal(canRatePin({ rating_enabled: true }, { kind: "pin" }), true);
  assert.equal(canRatePin({ rating_enabled: true }, { kind: "button" }), false);
  assert.equal(canRatePin({ rating_enabled: false }, { kind: "pin" }), false);
});

test("SQL 未適用のエラーかどうかを見分ける", () => {
  assert.equal(isPinRatingUnavailableError({ code: "42P01", message: 'relation "public.pin_ratings" does not exist' }), true);
  assert.equal(isPinRatingUnavailableError({ code: "PGRST204", message: "Could not find the 'rating_enabled' column of 'maps'" }), true);
  assert.equal(isPinRatingUnavailableError({ code: "PGRST205", message: "Could not find the table 'public.pin_ratings'" }), true);
  assert.equal(isPinRatingUnavailableError({ code: "42501", message: "new row violates row-level security policy" }), false);
  assert.equal(isPinRatingUnavailableError(null), false);
});

test("ピンの id を，URL が長くなりすぎないよう100件ずつに分ける", () => {
  const ids = Array.from({ length: 250 }, (_, index) => `id-${index}`);
  const chunks = chunkIds(ids, 100);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [100, 100, 50]);
  assert.deepEqual(chunks.flat(), ids);
  assert.deepEqual(chunkIds([], 100), []);
});

test("リアルタイムの更新で届かなかった列（長いメモなど）は，手元の値を残す", () => {
  const current = { id: "p1", title: "前", content: "長いメモ", rating_sum: 4.5, rating_count: 1 };
  const incoming = { id: "p1", title: "前", rating_sum: 8, rating_count: 2 };
  assert.deepEqual(mergePinUpdate(current, incoming), { id: "p1", title: "前", content: "長いメモ", rating_sum: 8, rating_count: 2 });
  assert.deepEqual(mergePinUpdate(null, incoming), incoming);
});

/** supabase.from("pin_ratings") の代わり．呼ばれた操作を記録し，用意した結果を順に返す */
function fakeRatingsClient(results) {
  const calls = [];
  const client = {
    from(table) {
      const call = { table, ops: [] };
      calls.push(call);
      const builder = {
        insert: (row) => { call.ops.push(["insert", row]); return builder; },
        update: (row) => { call.ops.push(["update", row]); return builder; },
        delete: () => { call.ops.push(["delete"]); return builder; },
        eq: (column, value) => { call.ops.push(["eq", column, value]); return builder; },
        select: () => { call.ops.push(["select"]); return Promise.resolve(results.shift()); },
      };
      return builder;
    },
  };
  return { client, calls, kinds: () => calls.map((call) => call.ops[0][0]) };
}

test("評価の保存は，まず変更を試し，まだ無ければ追加する（手元の情報が古くても失敗しない）", async () => {
  const already = fakeRatingsClient([{ data: [{ pin_id: "p1" }], error: null }]);
  assert.deepEqual(await saveMyRating(already.client, { pinId: "p1", userId: "u1", rating: 4 }), { ok: true, error: null });
  assert.deepEqual(already.kinds(), ["update"]);

  const first = fakeRatingsClient([{ data: [], error: null }, { data: [{ pin_id: "p1" }], error: null }]);
  assert.equal((await saveMyRating(first.client, { pinId: "p1", userId: "u1", rating: 4 })).ok, true);
  assert.deepEqual(first.kinds(), ["update", "insert"]);
});

test("ほぼ同時に別の画面で評価が付いても（主キーの重複），変更でやり直す", async () => {
  const race = fakeRatingsClient([
    { data: [], error: null },
    { data: null, error: { code: "23505", message: "duplicate key" } },
    { data: [{ pin_id: "p1" }], error: null },
  ]);
  assert.equal((await saveMyRating(race.client, { pinId: "p1", userId: "u1", rating: 4 })).ok, true);
  assert.deepEqual(race.kinds(), ["update", "insert", "update"]);
});

test("取り消しは削除する．保存できなかったときは ok: false を返す", async () => {
  const cancel = fakeRatingsClient([{ data: [{ pin_id: "p1" }], error: null }]);
  assert.equal((await saveMyRating(cancel.client, { pinId: "p1", userId: "u1", rating: null })).ok, true);
  assert.deepEqual(cancel.kinds(), ["delete"]);

  const blocked = fakeRatingsClient([{ data: [], error: null }, { data: null, error: { code: "42501", message: "new row violates row-level security policy" } }]);
  const result = await saveMyRating(blocked.client, { pinId: "p1", userId: "u1", rating: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "42501");
});

// ---- DB ----

// 本番と同じ構造の空 DB（ステージングの初期化 SQL）に，これまでのマイグレーションと今回の SQL を当てて確かめる．
const db = new PGlite();
const sql = (path) => readFile(new URL(path, import.meta.url), "utf8");
const owner = "00000000-0000-4000-8000-000000000001";
const raterA = "00000000-0000-4000-8000-000000000002";
const raterB = "00000000-0000-4000-8000-000000000003";
const ratedMap = "10000000-0000-4000-8000-000000000001";
const offMap = "10000000-0000-4000-8000-000000000002";
const privateMap = "10000000-0000-4000-8000-000000000003";
const pin = "20000000-0000-4000-8000-000000000001";
const buttonPin = "20000000-0000-4000-8000-000000000002";
const offPin = "20000000-0000-4000-8000-000000000003";
const privatePin = "20000000-0000-4000-8000-000000000004";

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
  await db.query("insert into auth.users(id) values ($1), ($2), ($3)", [owner, raterA, raterB]);
  await db.exec(await sql("../supabase/migrations/20261127000000_tile_maps.sql"));
  await db.exec(await sql("../supabase/migrations/20261128000000_address_pins.sql"));

  // 今回の SQL を当てる前からあるマップとピン
  for (const [id, title, visibility] of [[ratedMap, "グルメ", "public"], [offMap, "館内図", "public"], [privateMap, "自分用", "private"]]) {
    await db.query(
      "insert into public.maps(id, title, image_url, user_id, visibility) values ($1, $2, $3, $4, $5)",
      [id, title, `${title}.png`, owner, visibility],
    );
  }
  for (const [id, mapId, kind] of [[pin, ratedMap, "pin"], [buttonPin, ratedMap, "button"], [offPin, offMap, "pin"], [privatePin, privateMap, "pin"]]) {
    await db.query(
      "insert into public.pins(id, map_id, x, y, title, kind, user_id) values ($1, $2, 0.5, 0.5, 'ピン', $3, $4)",
      [id, mapId, kind, owner],
    );
  }

  await db.exec(await sql("../supabase/migrations/20261129000000_pin_ratings.sql"));
  await db.query("update public.maps set rating_enabled = true where id in ($1, $2)", [ratedMap, privateMap]);
});
after(() => db.close());

/** ログインした人（userId が null なら未ログイン）として SQL を実行する（RLS を通す） */
async function asUser(userId, query, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? "authenticated" : "anon"}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    return tx.query(query, params);
  });
}

async function errorCode(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error.code;
  }
}

const rate = (userId, pinId, rating) =>
  asUser(userId, "insert into public.pin_ratings(pin_id, user_id, rating) values ($1, $2, $3)", [pinId, userId, rating]);
const totals = async (pinId) => {
  const { rows } = await db.query("select rating_sum, rating_count from public.pins where id = $1", [pinId]);
  return { sum: Number(rows[0].rating_sum), count: Number(rows[0].rating_count) };
};

test("既存のマップは評価機能がオフで，既存のピンの合計・件数は 0", async () => {
  const { rows } = await db.query("select rating_enabled from public.maps where id = $1", [offMap]);
  assert.equal(rows[0].rating_enabled, false);
  assert.deepEqual(await totals(offPin), { sum: 0, count: 0 });
});

test("0.5 刻みの 0.5〜5.0 だけ保存できる", async () => {
  for (const bad of [0, 0.3, 5.5]) {
    assert.equal(await errorCode(rate(raterB, pin, bad)), "23514", `${bad} は保存できない`);
  }
});

test("評価の追加・変更・取り消しで，ピンの合計と件数が変わる", async () => {
  await rate(raterA, pin, 4.5);
  await rate(raterB, pin, 4.0);
  assert.deepEqual(await totals(pin), { sum: 8.5, count: 2 });

  await asUser(raterB, "update public.pin_ratings set rating = 5.0 where pin_id = $1 and user_id = $2", [pin, raterB]);
  assert.deepEqual(await totals(pin), { sum: 9.5, count: 2 });

  await asUser(raterB, "delete from public.pin_ratings where pin_id = $1 and user_id = $2", [pin, raterB]);
  assert.deepEqual(await totals(pin), { sum: 4.5, count: 1 });
});

test("1人が1つのピンに付けられる評価は1つだけ", async () => {
  assert.equal(await errorCode(rate(raterA, pin, 3.0)), "23505");
});

test("自分の評価しか読めず，未ログインでは評価の表を読めない", async () => {
  const own = await asUser(raterA, "select rating from public.pin_ratings");
  assert.deepEqual(own.rows.map((row) => Number(row.rating)), [4.5]);
  const other = await asUser(raterB, "select rating from public.pin_ratings where user_id = $1", [raterA]);
  assert.equal(other.rows.length, 0);
  assert.equal(await errorCode(asUser(null, "select rating from public.pin_ratings")), "42501");
});

test("未ログインでも，見られるピンの合計と件数は読める", async () => {
  const { rows } = await asUser(null, "select rating_sum, rating_count from public.pins where id = $1", [pin]);
  assert.deepEqual({ sum: Number(rows[0].rating_sum), count: Number(rows[0].rating_count) }, { sum: 4.5, count: 1 });
});

test("ほかの人の分は付けられず，未ログインでは評価できない", async () => {
  const forOther = asUser(raterB, "insert into public.pin_ratings(pin_id, user_id, rating) values ($1, $2, 3.0)", [pin, raterA]);
  assert.equal(await errorCode(forOther), "42501");
  assert.equal(await errorCode(asUser(null, "insert into public.pin_ratings(pin_id, user_id, rating) values ($1, $2, 3.0)", [pin, raterA])), "42501");
});

test("オフのマップ・ボタンのピン・見られないマップには評価できない", async () => {
  assert.equal(await errorCode(rate(raterB, offPin, 3.0)), "42501", "オフのマップ");
  assert.equal(await errorCode(rate(raterB, buttonPin, 3.0)), "42501", "ボタンのピン");
  assert.equal(await errorCode(rate(raterB, privatePin, 3.0)), "42501", "他人の非公開マップ");
});

test("ピンの投稿者でも，合計と件数を直接書き換えられない", async () => {
  await asUser(owner, "update public.pins set rating_sum = 99, rating_count = 9, title = '名前を変更' where id = $1", [pin]);
  assert.deepEqual(await totals(pin), { sum: 4.5, count: 1 });
  const { rows } = await db.query("select title from public.pins where id = $1", [pin]);
  assert.equal(rows[0].title, "名前を変更", "ほかの列の変更はそのまま通る");
});

test("新しいピンは，合計と件数を指定しても 0 から始まる", async () => {
  const { rows } = await asUser(owner,
    "insert into public.pins(map_id, x, y, title, user_id, rating_sum, rating_count) values ($1, 0.2, 0.2, '新しいピン', $2, 50, 10) returning rating_sum, rating_count",
    [ratedMap, owner]);
  assert.deepEqual({ sum: Number(rows[0].rating_sum), count: Number(rows[0].rating_count) }, { sum: 0, count: 0 });
});

test("オフにしても評価は残り，オフの間は変更・取り消しができない", async () => {
  await db.query("update public.maps set rating_enabled = false where id = $1", [ratedMap]);
  const updated = await asUser(raterA, "update public.pin_ratings set rating = 1.0 where pin_id = $1 and user_id = $2", [pin, raterA]);
  assert.equal(updated.affectedRows, 0);
  const deleted = await asUser(raterA, "delete from public.pin_ratings where pin_id = $1 and user_id = $2", [pin, raterA]);
  assert.equal(deleted.affectedRows, 0);
  assert.deepEqual(await totals(pin), { sum: 4.5, count: 1 });
  await db.query("update public.maps set rating_enabled = true where id = $1", [ratedMap]);
});

test("評価機能のオン・オフを変えられるのは作成者だけ（一般の利用者は変えられない）", async () => {
  const result = await asUser(raterA, "update public.maps set rating_enabled = false where id = $1", [ratedMap]);
  assert.equal(result.affectedRows, 0);
});
