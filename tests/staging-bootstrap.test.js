import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("空DBの初期化SQLが完走し、公開・共有・管理者の権限を適用する", async () => {
  const db = new PGlite();
  try {
    // Supabaseが提供する領域だけを代用し、アプリ構造は初期化SQLそのものから作る。
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
    const source = await readFile(new URL("../docs/sql/initialize-staging.sql", import.meta.url), "utf8");
    // RealtimeのpublicationはSupabase上で検証する。PGliteにはレプリケーションがない。
    const bootstrap = source.replace(/-- BEGIN REALTIME[\s\S]*?-- END REALTIME/, "");
    await db.exec(bootstrap);
    const count = async (sql) => Number((await db.query(sql)).rows[0].count);
    assert.equal(await count("SELECT count(*) FROM pg_tables WHERE schemaname IN ('public', 'private')"), 12);
    assert.equal(await count("SELECT count(*) FROM pg_tables WHERE schemaname IN ('public', 'private') AND NOT rowsecurity"), 0);
    assert.equal(await count("SELECT count(*) FROM pg_policies WHERE schemaname IN ('public', 'private', 'storage')"), 33);
    assert.equal((await db.query("SELECT enforced FROM private.map_share_settings")).rows[0].enforced, true);
    assert.equal((await db.query("SELECT has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE') AS allowed")).rows[0].allowed, false);
    assert.equal((await db.query("SELECT has_function_privilege('authenticated', 'public.rls_auto_enable()', 'EXECUTE') AS allowed")).rows[0].allowed, false);
    assert.equal((await db.query("SELECT has_table_privilege('anon', 'public.maps', 'TRUNCATE') AS allowed")).rows[0].allowed, false);
    const bucket = (await db.query("SELECT * FROM storage.buckets")).rows[0];
    assert.equal(bucket.public, false);
    assert.equal(Number(bucket.file_size_limit), 10485760);

    const owner = "00000000-0000-4000-8000-000000000001";
    const visitor = "00000000-0000-4000-8000-000000000002";
    const admin = "00000000-0000-4000-8000-000000000003";
    const publicMap = "10000000-0000-4000-8000-000000000001";
    const unlistedMap = "10000000-0000-4000-8000-000000000002";
    const privateMap = "10000000-0000-4000-8000-000000000003";
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES
        ('${owner}', 'owner@example.invalid'),
        ('${visitor}', 'visitor@example.invalid'),
        ('${admin}', 'admin@example.invalid');
      INSERT INTO public.map_administrators VALUES ('${admin}');
      INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES
        ('map-images', 'public.png', '${owner}'),
        ('map-images', 'unlisted.png', '${owner}'),
        ('map-images', 'private.png', '${owner}');
      INSERT INTO public.maps (id, title, image_url, user_id, visibility) VALUES
        ('${publicMap}', 'public', 'https://example.invalid/storage/v1/object/public/map-images/public.png', '${owner}', 'public'),
        ('${unlistedMap}', 'unlisted', 'https://example.invalid/storage/v1/object/public/map-images/unlisted.png', '${owner}', 'unlisted'),
        ('${privateMap}', 'private', 'https://example.invalid/storage/v1/object/public/map-images/private.png', '${owner}', 'private');
    `);
    const token = (await db.query("SELECT token FROM private.map_share_tokens WHERE map_id = $1", [unlistedMap])).rows[0].token;
    await db.exec("SET ROLE anon");
    assert.equal(await count("SELECT count(*) FROM public.maps"), 1);
    assert.equal(await count("SELECT count(*) FROM storage.objects"), 1);
    await assert.rejects(db.query("SELECT * FROM private.map_share_tokens"), /permission denied/);
    await assert.rejects(db.query("SELECT public.admin_list_users(0, 50)"), /permission denied/);
    await db.query("SELECT set_config('request.headers', $1, false)", [JSON.stringify({
      "x-map-share-id": unlistedMap, "x-map-share-token": token,
    })]);
    assert.equal(await count("SELECT count(*) FROM public.maps"), 2);
    assert.equal(await count("SELECT count(*) FROM storage.objects"), 2);

    await db.exec("RESET ROLE; SET ROLE authenticated");
    await db.query("SELECT set_config('request.headers', '{}', false)");
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [visitor]);
    assert.equal(await count("SELECT count(*) FROM public.maps"), 1);
    await assert.rejects(db.query("SELECT * FROM public.admin_list_users(0, 50)"), /map_admin_required/);
    await assert.rejects(db.query(
      "INSERT INTO public.pins (map_id, x, y, title, user_id) VALUES ($1, 0.5, 0.5, 'blocked', $2)",
      [privateMap, visitor],
    ), /row-level security/);
    assert.equal((await db.query("SELECT public.accept_map_share_link($1, $2) AS accepted", [unlistedMap, token])).rows[0].accepted, true);
    assert.equal(await count("SELECT count(*) FROM public.maps"), 2);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner]);
    assert.equal(await count("SELECT count(*) FROM public.maps"), 3);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [admin]);
    assert.equal(await count("SELECT count(*) FROM public.maps"), 3);
    assert.equal((await db.query("SELECT * FROM public.admin_list_users(0, 50)")).rows.length, 3);

    await db.exec("RESET ROLE");
    await assert.rejects(db.exec(bootstrap), /空のプロジェクト/);
    await db.exec("ROLLBACK");
    assert.equal(await count("SELECT count(*) FROM public.maps"), 3);
  } finally {
    await db.close();
  }
});

