-- Issue #38: 空の Supabase プロジェクト用の初期化SQL。
-- 2026-11-26 の本番DBのアプリ構造を元に作成。投稿・ユーザー・画像は含まない。
-- 既存DBへの適用や、適用済みの docs/sql・過去マイグレーションの再実行には使わない。
BEGIN;
SET LOCAL search_path = public, extensions;
SET LOCAL check_function_bodies = false;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  ) OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'map-images') THEN
    RAISE EXCEPTION '初期化は空のプロジェクトだけに実行できます。接続先を確認してください。';
  END IF;
END;
$guard$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 自動RLSのイベントトリガー関数は、クライアントから直接実行させない。
-- 所有者によるDDLイベントからの実行には影響しない。
DO $rls_helper$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END;
$rls_helper$;

-- テーブルとRLS。自動付与の設定に依存せず、初めは全クライアントのアクセスを閉じる。

CREATE TABLE private.map_share_settings (singleton boolean NOT NULL DEFAULT true,
  enforced boolean NOT NULL DEFAULT false);
ALTER TABLE "private"."map_share_settings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "private"."map_share_settings" FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.map_share_tokens (map_id uuid NOT NULL,
  token uuid NOT NULL DEFAULT gen_random_uuid());
ALTER TABLE "private"."map_share_tokens" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "private"."map_share_tokens" FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE private.map_share_users (map_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token uuid NOT NULL);
ALTER TABLE "private"."map_share_users" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "private"."map_share_users" FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.folder_favorites (user_id uuid NOT NULL,
  folder_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now());
ALTER TABLE "public"."folder_favorites" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."folder_favorites" FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.folders (id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  parent_folder_id uuid,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now());
ALTER TABLE "public"."folders" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."folders" FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.map_administrators (user_id uuid NOT NULL);
ALTER TABLE "public"."map_administrators" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."map_administrators" FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.map_favorites (user_id uuid NOT NULL,
  map_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now());
ALTER TABLE "public"."map_favorites" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."map_favorites" FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.maps (id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT ''::text,
  image_url text NOT NULL,
  user_id uuid NOT NULL,
  folder_id uuid,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  visibility text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now());
ALTER TABLE "public"."maps" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."maps" FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.pin_comments (id uuid NOT NULL DEFAULT gen_random_uuid(),
  pin_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  creator_username text,
  created_at timestamp with time zone NOT NULL DEFAULT now());
ALTER TABLE "public"."pin_comments" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."pin_comments" FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.pins (id uuid NOT NULL DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  title text NOT NULL,
  content text NOT NULL DEFAULT ''::text,
  pin_type text NOT NULL DEFAULT 'memo'::text,
  kind text NOT NULL DEFAULT 'pin'::text,
  link_map_id uuid,
  user_id uuid NOT NULL,
  creator_username text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  tabelog_url text);
ALTER TABLE "public"."pins" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."pins" FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.saved_folders (user_id uuid NOT NULL,
  folder_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now());
ALTER TABLE "public"."saved_folders" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."saved_folders" FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.saved_maps (user_id uuid NOT NULL,
  map_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now());
ALTER TABLE "public"."saved_maps" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."saved_maps" FROM PUBLIC, anon, authenticated, service_role;

-- 主キー・外部キー・チェック制約。

ALTER TABLE private.map_share_settings ADD CONSTRAINT map_share_settings_pkey PRIMARY KEY (singleton);

ALTER TABLE private.map_share_settings ADD CONSTRAINT map_share_settings_singleton_check CHECK (singleton);

ALTER TABLE private.map_share_tokens ADD CONSTRAINT map_share_tokens_pkey PRIMARY KEY (map_id);

ALTER TABLE private.map_share_tokens ADD CONSTRAINT map_share_tokens_token_key UNIQUE (token);

ALTER TABLE private.map_share_users ADD CONSTRAINT map_share_users_pkey PRIMARY KEY (map_id, user_id);

ALTER TABLE public.folder_favorites ADD CONSTRAINT folder_favorites_pkey PRIMARY KEY (user_id, folder_id);

ALTER TABLE public.folders ADD CONSTRAINT folders_check CHECK (parent_folder_id IS DISTINCT FROM id);

ALTER TABLE public.folders ADD CONSTRAINT folders_name_check CHECK (length(TRIM(BOTH FROM name)) > 0);

ALTER TABLE public.folders ADD CONSTRAINT folders_pkey PRIMARY KEY (id);

ALTER TABLE public.map_administrators ADD CONSTRAINT map_administrators_pkey PRIMARY KEY (user_id);

ALTER TABLE public.map_favorites ADD CONSTRAINT map_favorites_pkey PRIMARY KEY (user_id, map_id);

ALTER TABLE public.maps ADD CONSTRAINT maps_pkey PRIMARY KEY (id);

ALTER TABLE public.maps ADD CONSTRAINT maps_title_check CHECK (length(TRIM(BOTH FROM title)) > 0);

ALTER TABLE public.maps ADD CONSTRAINT maps_visibility_check CHECK (visibility = ANY (ARRAY['public'::text, 'unlisted'::text, 'private'::text]));

ALTER TABLE public.maps ADD CONSTRAINT maps_visibility_matches_legacy CHECK (is_public = (visibility <> 'private'::text));

ALTER TABLE public.pin_comments ADD CONSTRAINT pin_comments_content_check CHECK (length(TRIM(BOTH FROM content)) > 0);

ALTER TABLE public.pin_comments ADD CONSTRAINT pin_comments_pkey PRIMARY KEY (id);

ALTER TABLE public.pins ADD CONSTRAINT pins_kind_check CHECK (kind = ANY (ARRAY['pin'::text, 'button'::text]));

ALTER TABLE public.pins ADD CONSTRAINT pins_pkey PRIMARY KEY (id);

ALTER TABLE public.pins ADD CONSTRAINT pins_tabelog_url_check CHECK (tabelog_url IS NULL OR char_length(tabelog_url) <= 500 AND tabelog_url ~* '^https://([a-z0-9-]+\.)*tabelog\.com/\S*$'::text);

ALTER TABLE public.saved_folders ADD CONSTRAINT saved_folders_pkey PRIMARY KEY (user_id, folder_id);

ALTER TABLE public.saved_maps ADD CONSTRAINT saved_maps_pkey PRIMARY KEY (user_id, map_id);

ALTER TABLE private.map_share_tokens ADD CONSTRAINT map_share_tokens_map_id_fkey FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE;

ALTER TABLE private.map_share_users ADD CONSTRAINT map_share_users_map_id_fkey FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE;

ALTER TABLE private.map_share_users ADD CONSTRAINT map_share_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.folder_favorites ADD CONSTRAINT folder_favorites_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE;

ALTER TABLE public.folder_favorites ADD CONSTRAINT folder_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.folders ADD CONSTRAINT folders_parent_folder_id_fkey FOREIGN KEY (parent_folder_id) REFERENCES folders(id) ON DELETE SET NULL;

ALTER TABLE public.folders ADD CONSTRAINT folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE public.map_administrators ADD CONSTRAINT map_administrators_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.map_favorites ADD CONSTRAINT map_favorites_map_id_fkey FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE;

ALTER TABLE public.map_favorites ADD CONSTRAINT map_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.maps ADD CONSTRAINT maps_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL;

ALTER TABLE public.maps ADD CONSTRAINT maps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE public.pin_comments ADD CONSTRAINT pin_comments_pin_id_fkey FOREIGN KEY (pin_id) REFERENCES pins(id) ON DELETE CASCADE;

ALTER TABLE public.pin_comments ADD CONSTRAINT pin_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE public.pins ADD CONSTRAINT pins_link_map_id_fkey FOREIGN KEY (link_map_id) REFERENCES maps(id) ON DELETE SET NULL;

ALTER TABLE public.pins ADD CONSTRAINT pins_map_id_fkey FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE;

ALTER TABLE public.pins ADD CONSTRAINT pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE public.saved_folders ADD CONSTRAINT saved_folders_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE;

ALTER TABLE public.saved_folders ADD CONSTRAINT saved_folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.saved_maps ADD CONSTRAINT saved_maps_map_id_fkey FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE;

ALTER TABLE public.saved_maps ADD CONSTRAINT saved_maps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 関数。依存するテーブルは作成済み。前方参照は最後の検証で確認する。

CREATE OR REPLACE FUNCTION private.create_map_share_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into private.map_share_tokens (map_id) values (new.id) on conflict do nothing;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION private.create_map_share_token() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_map_share(target_map_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  -- 本番切替前でも、新しいアプリからのリクエストには新しい閲覧条件を適用する。
  if not (select enforced from private.map_share_settings where singleton)
     and headers ->> 'x-map-share-scope' is distinct from '1' then
    return true;
  end if;

  return exists (
    select 1 from private.map_share_tokens as share
    where share.map_id = target_map_id and (
      (headers ->> 'x-map-share-id' = share.map_id::text
       and headers ->> 'x-map-share-token' = share.token::text)
      or exists (
        select 1 from private.map_share_users as recipient
        where recipient.map_id = share.map_id and recipient.token = share.token
          and recipient.user_id = (select auth.uid())
      )
    )
  );
exception when invalid_text_representation then
  -- 壊れたヘッダーを送られた場合は、共有リンクによる閲覧を許可しない。
  return false;
end;
$function$;
REVOKE ALL ON FUNCTION private.has_map_share(target_map_id uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.map_share_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select auth.uid() is not null and public.is_map_admin(); $function$;
REVOKE ALL ON FUNCTION private.map_share_is_admin() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.sync_map_visibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    new.visibility := coalesce(new.visibility, case when new.is_public then 'unlisted' else 'private' end);
  elsif new.visibility is not distinct from old.visibility and new.is_public is distinct from old.is_public then
    new.visibility := case when new.is_public then 'unlisted' else 'private' end;
  end if;
  new.is_public := new.visibility <> 'private';
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if tg_op = 'UPDATE' and new.visibility is distinct from old.visibility then
    -- 公開中の保存や過去の共有記録を、新たな限定公開の権限にはしない。
    delete from private.map_share_users where map_id = new.id;
    update private.map_share_tokens set token = gen_random_uuid() where map_id = new.id;
  end if;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION private.sync_map_visibility() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.accept_map_share_link(target_map_id uuid, share_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  recipient_id uuid := auth.uid();
begin
  if recipient_id is null then
    raise exception 'sign_in_required' using errcode = '42501';
  end if;
  -- マップ行をロックし、共有受信と公開範囲の変更が同時に起きても古い権限を残さない。
  perform 1 from public.maps as map where map.id = target_map_id and map.visibility = 'unlisted' for share;
  if not found or not exists (
    select 1 from private.map_share_tokens where map_id = target_map_id and token = share_token
  ) then return false; end if;
  insert into private.map_share_users (map_id, user_id, token)
    values (target_map_id, recipient_id, share_token)
    on conflict (map_id, user_id) do update set token = excluded.token;
  return true;
end;
$function$;
REVOKE ALL ON FUNCTION public.accept_map_share_link(target_map_id uuid, share_token uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_delete_pin_comment(target_comment_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  comment_id public.pin_comments.id%type;
begin
  -- 投稿者向けの既存の削除ルールとは別に、ここでは管理者の操作だけを許可する。
  if public.is_map_admin() is distinct from true then
    raise exception 'map_admin_required' using errcode = '42501';
  end if;

  -- アプリからはIDを文字列で受け取り、削除時はテーブルのIDと同じ型で比較する。
  comment_id := target_comment_id;
  delete from public.pin_comments as comment
  where comment.id = comment_id;

  -- 別の人が先に削除していた場合は false を返し、画面で一覧を更新する。
  return found;
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_delete_pin_comment(target_comment_id text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_usernames(target_user_ids uuid[])
 RETURNS TABLE(user_id uuid, github_username text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- 認証テーブルにある情報を取得する前に、操作した人が管理者か確認する。
  if auth.uid() is null or public.is_map_admin() is distinct from true then
    raise exception 'map_admin_required' using errcode = '42501';
  end if;
  if target_user_ids is null or cardinality(target_user_ids) > 51 then
    raise exception 'invalid_user_ids' using errcode = '22023';
  end if;

  return query
    select account.id, (
      select coalesce(
        nullif(btrim(github.identity_data ->> 'preferred_username'), ''),
        nullif(btrim(github.identity_data ->> 'user_name'), '')
      )
      from auth.identities as github
      where github.user_id = account.id and github.provider = 'github'
      order by github.created_at desc nulls last, github.id
      limit 1
    )
    from auth.users as account
    where account.id = any(target_user_ids);
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_get_usernames(target_user_ids uuid[]) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_folders(page_offset integer, page_limit integer)
 RETURNS TABLE(id uuid, name text, user_id uuid, parent_folder_id uuid, parent_name text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or public.is_map_admin() is distinct from true then
    raise exception 'map_admin_required' using errcode = '42501';
  end if;
  if page_offset is null or page_offset < 0
     or page_limit is null or page_limit not between 1 and 51 then
    raise exception 'invalid_folder_page' using errcode = '22023';
  end if;

  return query
    select folder.id, folder.name::text, folder.user_id, folder.parent_folder_id, parent.name::text
    from public.folders as folder
    left join public.folders as parent on parent.id = folder.parent_folder_id
    order by folder.created_at desc nulls last, folder.id
    limit page_limit offset page_offset;
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_folders(page_offset integer, page_limit integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_pin_comments(page_offset integer, page_limit integer)
 RETURNS TABLE(comment_id text, content text, user_id text, creator_username text, created_at timestamp with time zone, pin_id text, pin_title text, map_id text, map_title text, is_public boolean, visibility text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
  if public.is_map_admin() is distinct from true then
    raise exception 'map_admin_required' using errcode = '42501';
  end if;
  if page_offset is null or page_offset < 0 or page_limit is null or page_limit not between 1 and 51 then
    raise exception 'invalid_comment_list_page' using errcode = '22023';
  end if;
  return query
    select comment.id::text, comment.content::text, comment.user_id::text,
      comment.creator_username::text, comment.created_at, pin.id::text, pin.title::text,
      map.id::text, map.title::text, map.is_public, map.visibility
    from public.pin_comments as comment
    join public.pins as pin on pin.id = comment.pin_id
    join public.maps as map on map.id = pin.map_id
    order by comment.created_at desc nulls last, comment.id desc
    limit page_limit offset page_offset;
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_pin_comments(page_offset integer, page_limit integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_users(page_offset integer, page_limit integer)
 RETURNS TABLE(user_id uuid, email text, is_admin boolean, github_username text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- アカウントの識別情報を返す前に、ログイン中の人が管理者か確認する。
  if public.is_map_admin() is distinct from true then
    raise exception 'map_admin_required' using errcode = '42501';
  end if;

  -- 画面の50件と次ページ確認用の1件までに制限する。
  if page_offset is null or page_offset < 0
     or page_limit is null or page_limit not between 1 and 51 then
    raise exception 'invalid_user_list_page' using errcode = '22023';
  end if;

  return query
    select account.id, account.email::text,
           exists (
             select 1 from public.map_administrators as admin
             where admin.user_id = account.id
           ),
           -- Supabase が GitHub 連携時に保存したログイン名を返す。
           (
             select coalesce(
               nullif(btrim(github.identity_data ->> 'preferred_username'), ''),
               nullif(btrim(github.identity_data ->> 'user_name'), '')
             )
             from auth.identities as github
             where github.user_id = account.id and github.provider = 'github'
             order by github.created_at desc nulls last, github.id
             limit 1
           )
    from auth.users as account
    order by account.created_at desc nulls last, account.id
    limit page_limit offset page_offset;
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_users(page_offset integer, page_limit integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_users_at_user(target_user_id uuid, page_size integer)
 RETURNS TABLE(page_number integer, user_id uuid, email text, is_admin boolean, github_username text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_page integer;
begin
  -- ページの検索とメールアドレスを含む一覧の取得は管理者に限定する。
  if auth.uid() is null or public.is_map_admin() is distinct from true then
    raise exception 'map_admin_required' using errcode = '42501';
  end if;

  if page_size is null or page_size not between 1 and 50 then
    raise exception 'invalid_user_list_page' using errcode = '22023';
  end if;

  -- admin_list_users と同じ順序で、標準の一覧上のページを求める。
  select ((ordered_accounts.row_index - 1) / page_size)::integer
  into target_page
  from (
    select account.id,
           row_number() over (order by account.created_at desc nulls last, account.id) as row_index
    from auth.users as account
  ) as ordered_accounts
  where ordered_accounts.id = target_user_id;

  -- 投稿者のアカウントがなくなっている場合は空の結果を返す。
  if target_page is null then
    return;
  end if;

  -- 該当ページの取得は既存の関数に任せ、次のページの確認用に1件追加する。
  return query
    select target_page, users.*
    from public.admin_list_users(target_page * page_size, page_size + 1) as users;
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_list_users_at_user(target_user_id uuid, page_size integer) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_map_admin(target_user_id uuid, make_admin boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- 操作した人はログイン情報で判定し、ブラウザから受け取るIDは変更先だけにする。
  if public.is_map_admin() is distinct from true then
    raise exception 'map_admin_required' using errcode = '42501';
  end if;

  if target_user_id is null or make_admin is null then
    raise exception 'invalid_map_admin_change' using errcode = '22023';
  end if;

  -- 付与・解除を1件ずつ処理する。同時に複数の解除が来ても最後の管理者を残す。
  lock table public.map_administrators in share row exclusive mode;

  -- ロックを待っている間に、操作した人の権限が解除された可能性がある。
  if public.is_map_admin() is distinct from true then
    raise exception 'map_admin_required' using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users as account where account.id = target_user_id) then
    raise exception 'map_admin_target_not_found' using errcode = 'P0002';
  end if;

  if make_admin then
    -- 同じ付与が再送されても、管理者の行は重複して登録しない。
    insert into public.map_administrators (user_id)
    select target_user_id
    where not exists (
      select 1 from public.map_administrators as admin
      where admin.user_id = target_user_id
    );
  else
    if not exists (
      select 1
      from public.map_administrators as admin
      join auth.users as account on account.id = admin.user_id
      where admin.user_id <> target_user_id
    ) then
      raise exception 'last_map_admin' using errcode = '23514';
    end if;

    delete from public.map_administrators as admin
    where admin.user_id = target_user_id;
  end if;
end;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_map_admin(target_user_id uuid, make_admin boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_map_image_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  image_object text := public.map_image_object_name(new.image_url);
begin
  if tg_op = 'UPDATE' and new.image_url is not distinct from old.image_url then
    return new;
  end if;

  if image_object is not null and not exists (
    select 1
    from storage.objects
    where bucket_id = 'map-images'
      and name = image_object
      and owner_id = new.user_id::text
  ) then
    raise exception 'The map image must belong to the map author'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;
REVOKE ALL ON FUNCTION public.check_map_image_owner() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_folder(target_folder_id uuid, expected_parent_folder_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  editor_id uuid := auth.uid();
  target_folder public.folders%rowtype;
begin
  if editor_id is null then
    raise exception 'sign_in_required' using errcode = '42501';
  end if;

  -- 削除と同時に中身が追加・移動されても、移動漏れや連鎖削除が起きないようにする。
  -- ロックはこの処理が終わると解除される。
  lock table public.folders, public.maps in share row exclusive mode;

  select * into target_folder from public.folders where id = target_folder_id;
  if not found then
    return false;
  end if;

  -- 持ち主なしのフォルダは、既存の仕様に合わせてログイン済みユーザーに許可する。
  if target_folder.user_id is not null and target_folder.user_id <> editor_id
     and public.is_map_admin() is distinct from true then
    raise exception 'folder_management_required' using errcode = '42501';
  end if;
  -- 確認後に移動先が変わっていたら、移動先をもう一度確認してもらう。
  if target_folder.parent_folder_id is distinct from expected_parent_folder_id then
    raise exception 'folder_parent_changed' using errcode = '40001';
  end if;

  -- 既存データの親子関係に循環がある場合は、中身を移す前に停止する。
  if exists (
    with recursive ancestors as (
      select folder.id, folder.parent_folder_id
      from public.folders as folder where folder.id = target_folder.parent_folder_id
      union
      select parent.id, parent.parent_folder_id
      from public.folders as parent join ancestors on parent.id = ancestors.parent_folder_id
    )
    select 1 from ancestors where id = target_folder.id
  ) then
    raise exception 'invalid_folder_hierarchy' using errcode = '23514';
  end if;

  update public.maps set folder_id = target_folder.parent_folder_id
    where folder_id = target_folder.id;
  update public.folders set parent_folder_id = target_folder.parent_folder_id
    where parent_folder_id = target_folder.id;

  -- このフォルダに付いた保存・お気に入りの記録も削除する。
  delete from public.saved_folders where folder_id = target_folder.id;
  delete from public.folder_favorites where folder_id = target_folder.id;
  delete from public.folders where id = target_folder.id;
  return true;
end;
$function$;
REVOKE ALL ON FUNCTION public.delete_folder(target_folder_id uuid, expected_parent_folder_id uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.edit_pin_comment(target_comment_id text, expected_content text, new_content text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  editor_id uuid := auth.uid();
  editor_is_admin boolean;
  comment_id public.pin_comments.id%type;
  trimmed_content text;
  saved_content text;
begin
  if editor_id is null then
    raise exception 'sign_in_required' using errcode = '42501';
  end if;
  editor_is_admin := public.is_map_admin() is true;

  -- 改行・タブ・全角空白を含め、空白だけの本文は保存しない。
  trimmed_content := regexp_replace(new_content, '^[[:space:]　]+|[[:space:]　]+$', '', 'g');
  if trimmed_content is null or trimmed_content = '' then
    raise exception 'empty_comment' using errcode = '22023';
  end if;

  comment_id := target_comment_id;
  -- 編集中に他の人が本文を更新していた場合は、その変更を上書きしない。
  -- 本文だけを更新するので、投稿者・投稿先・投稿日時はそのまま残る。
  update public.pin_comments as comment
  set content = trimmed_content
  where comment.id = comment_id
    and (editor_is_admin or comment.user_id = editor_id)
    and comment.content is not distinct from expected_content
  returning comment.content into saved_content;

  return saved_content;
end;
$function$;
REVOKE ALL ON FUNCTION public.edit_pin_comment(target_comment_id text, expected_content text, new_content text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_map_share_token(target_map_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.maps as map where map.id = target_map_id and map.visibility = 'unlisted'
      and (map.user_id = auth.uid() or public.is_map_admin()
        or exists (
          select 1 from private.map_share_users recipient
          join private.map_share_tokens share on share.map_id = recipient.map_id and share.token = recipient.token
          where recipient.map_id = map.id and recipient.user_id = auth.uid()
        ))
  ) then
    raise exception 'map_share_required' using errcode = '42501';
  end if;
  return (select token from private.map_share_tokens where map_id = target_map_id);
end;
$function$;
REVOKE ALL ON FUNCTION public.get_map_share_token(target_map_id uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_map_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.map_administrators
    where user_id = (select auth.uid())
  );
$function$;
REVOKE ALL ON FUNCTION public.is_map_admin() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.map_image_object_name(image_url text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
  select substring(
    image_url from '^https?://[^/?#]+/storage/v1/object/public/map-images/([A-Za-z0-9_./-]+)(?:[?#].*)?$'
  );
$function$;
REVOKE ALL ON FUNCTION public.map_image_object_name(image_url text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_content_author_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  raise exception 'Content author cannot be changed' using errcode = '23514';
end;
$function$;
REVOKE ALL ON FUNCTION public.reject_content_author_change() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rename_folder(target_folder_id uuid, expected_name text, new_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  editor_id uuid := auth.uid();
  trimmed_name text;
  updated_folder public.folders%rowtype;
begin
  if editor_id is null then
    raise exception 'sign_in_required' using errcode = '42501';
  end if;
  trimmed_name := regexp_replace(new_name, '^[[:space:]　]+|[[:space:]　]+$', '', 'g');
  if trimmed_name is null or trimmed_name = '' or char_length(trimmed_name) > 100 then
    raise exception 'invalid_folder_name' using errcode = '22023';
  end if;

  -- 編集中に他の人が名前を変更していたら、先の変更を上書きしない。
  update public.folders as folder
  set name = trimmed_name
  where folder.id = target_folder_id
    and (folder.user_id = editor_id or public.is_map_admin())
    and folder.name is not distinct from expected_name
  returning folder.* into updated_folder;

  if not found then
    return null;
  end if;
  return to_jsonb(updated_folder);
end;
$function$;
REVOKE ALL ON FUNCTION public.rename_folder(target_folder_id uuid, expected_name text, new_name text) FROM PUBLIC, anon, authenticated, service_role;

-- インデックス。式インデックスが参照する関数の作成後に適用。

CREATE INDEX map_share_users_user_id_idx ON private.map_share_users USING btree (user_id);

CREATE INDEX folder_favorites_folder_id_idx ON public.folder_favorites USING btree (folder_id);

CREATE INDEX folders_parent_idx ON public.folders USING btree (parent_folder_id);

CREATE INDEX folders_user_idx ON public.folders USING btree (user_id);

CREATE INDEX map_favorites_map_id_idx ON public.map_favorites USING btree (map_id);

CREATE INDEX maps_folder_idx ON public.maps USING btree (folder_id);

CREATE UNIQUE INDEX maps_image_object_name_unique ON public.maps USING btree (map_image_object_name(image_url));

CREATE INDEX maps_public_created_at_idx ON public.maps USING btree (created_at DESC, id) WHERE (visibility = 'public'::text);

CREATE INDEX maps_user_idx ON public.maps USING btree (user_id);

CREATE INDEX comments_pin_idx ON public.pin_comments USING btree (pin_id);

CREATE INDEX pins_link_idx ON public.pins USING btree (link_map_id);

CREATE INDEX pins_map_idx ON public.pins USING btree (map_id);

CREATE INDEX saved_folders_folder_id_idx ON public.saved_folders USING btree (folder_id);

CREATE INDEX saved_maps_map_id_idx ON public.saved_maps USING btree (map_id);

-- トリガー。

CREATE TRIGGER maps_check_image_owner BEFORE INSERT OR UPDATE OF image_url ON maps FOR EACH ROW EXECUTE FUNCTION check_map_image_owner();

CREATE TRIGGER maps_create_share_token AFTER INSERT ON maps FOR EACH ROW EXECUTE FUNCTION private.create_map_share_token();

CREATE TRIGGER maps_preserve_author BEFORE UPDATE OF user_id ON maps FOR EACH ROW WHEN (old.user_id IS DISTINCT FROM new.user_id) EXECUTE FUNCTION reject_content_author_change();

CREATE TRIGGER maps_sync_visibility BEFORE INSERT OR UPDATE ON maps FOR EACH ROW EXECUTE FUNCTION private.sync_map_visibility();

CREATE TRIGGER pins_preserve_author BEFORE UPDATE OF user_id, creator_username ON pins FOR EACH ROW WHEN (old.user_id IS DISTINCT FROM new.user_id OR old.creator_username IS DISTINCT FROM new.creator_username) EXECUTE FUNCTION reject_content_author_change();

-- 閲覧・投稿・編集のポリシー。private テーブルは直接アクセスを許可しない。

CREATE POLICY "folder_favorites_delete" ON "public"."folder_favorites" AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "folder_favorites_insert" ON "public"."folder_favorites" AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM folders t
  WHERE (t.id = folder_favorites.folder_id)))));

CREATE POLICY "folder_favorites_read" ON "public"."folder_favorites" AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "folders_delete" ON "public"."folders" AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "folders_insert" ON "public"."folders" AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "folders_read" ON "public"."folders" AS PERMISSIVE FOR SELECT TO "anon", "authenticated"
  USING (true);

CREATE POLICY "folders_update" ON "public"."folders" AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)))
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "map_favorites_delete" ON "public"."map_favorites" AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "map_favorites_insert" ON "public"."map_favorites" AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM maps t
  WHERE (t.id = map_favorites.map_id)))));

CREATE POLICY "map_favorites_read" ON "public"."map_favorites" AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "maps_admin_read" ON "public"."maps" AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (( SELECT is_map_admin() AS is_map_admin));

CREATE POLICY "maps_delete" ON "public"."maps" AS PERMISSIVE FOR DELETE TO "authenticated"
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_map_admin() AS is_map_admin)));

CREATE POLICY "maps_insert" ON "public"."maps" AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "maps_read" ON "public"."maps" AS PERMISSIVE FOR SELECT TO "anon", "authenticated"
  USING ((is_public OR (user_id = ( SELECT auth.uid() AS uid))));

CREATE POLICY "maps_share_scope" ON "public"."maps" AS RESTRICTIVE FOR SELECT TO "anon", "authenticated"
  USING (((visibility = 'public'::text) OR (user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT private.map_share_is_admin() AS map_share_is_admin) OR ((visibility = 'unlisted'::text) AND private.has_map_share(id))));

CREATE POLICY "maps_update" ON "public"."maps" AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_map_admin() AS is_map_admin)))
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_map_admin() AS is_map_admin)));

CREATE POLICY "Map admins can read pin comments" ON "public"."pin_comments" AS PERMISSIVE FOR SELECT TO "authenticated"
  USING (( SELECT is_map_admin() AS is_map_admin));

CREATE POLICY "comments_delete" ON "public"."pin_comments" AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "comments_insert" ON "public"."pin_comments" AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM pins p
  WHERE (p.id = pin_comments.pin_id)))));

CREATE POLICY "comments_read" ON "public"."pin_comments" AS PERMISSIVE FOR SELECT TO "anon", "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM pins p
  WHERE (p.id = pin_comments.pin_id))));

CREATE POLICY "pins_delete" ON "public"."pins" AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_map_admin() AS is_map_admin)) AND (EXISTS ( SELECT 1
   FROM maps
  WHERE (maps.id = pins.map_id)))));

CREATE POLICY "pins_insert" ON "public"."pins" AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM maps
  WHERE (maps.id = pins.map_id)))));

CREATE POLICY "pins_read" ON "public"."pins" AS PERMISSIVE FOR SELECT TO "anon", "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM maps
  WHERE (maps.id = pins.map_id))));

CREATE POLICY "pins_update" ON "public"."pins" AS PERMISSIVE FOR UPDATE TO "authenticated"
  USING ((((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_map_admin() AS is_map_admin)) AND (EXISTS ( SELECT 1
   FROM maps
  WHERE (maps.id = pins.map_id)))))
  WITH CHECK ((((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT is_map_admin() AS is_map_admin)) AND (EXISTS ( SELECT 1
   FROM maps
  WHERE (maps.id = pins.map_id)))));

CREATE POLICY "saved_folders_delete" ON "public"."saved_folders" AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "saved_folders_insert" ON "public"."saved_folders" AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM folders t
  WHERE (t.id = saved_folders.folder_id)))));

CREATE POLICY "saved_folders_read" ON "public"."saved_folders" AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "saved_maps_delete" ON "public"."saved_maps" AS PERMISSIVE FOR DELETE TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "saved_maps_insert" ON "public"."saved_maps" AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM maps t
  WHERE (t.id = saved_maps.map_id)))));

CREATE POLICY "saved_maps_read" ON "public"."saved_maps" AS PERMISSIVE FOR SELECT TO "authenticated"
  USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "map_images_allow_read" ON "storage"."objects" AS PERMISSIVE FOR SELECT TO "anon", "authenticated"
  USING ((bucket_id = 'map-images'::text));

CREATE POLICY "map_images_require_visible_map" ON "storage"."objects" AS RESTRICTIVE FOR SELECT TO "anon", "authenticated"
  USING (((bucket_id IS DISTINCT FROM 'map-images'::text) OR (EXISTS ( SELECT 1
   FROM maps
  WHERE (map_image_object_name(maps.image_url) = objects.name)))));

CREATE POLICY "memop_image_insert" ON "storage"."objects" AS PERMISSIVE FOR INSERT TO "authenticated"
  WITH CHECK (((bucket_id = 'map-images'::text) AND (owner_id = (( SELECT auth.uid() AS uid))::text)));

-- APIアクセス。RLSで許可される操作だけを明示的に付与する。

GRANT DELETE, INSERT, SELECT ON TABLE "public"."folder_favorites" TO "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."folders" TO "authenticated";

GRANT SELECT ON TABLE "public"."folders" TO "anon";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."map_favorites" TO "authenticated";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."maps" TO "authenticated";

GRANT SELECT ON TABLE "public"."maps" TO "anon";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."pin_comments" TO "authenticated";

GRANT SELECT ON TABLE "public"."pin_comments" TO "anon";

GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."pins" TO "authenticated";

GRANT SELECT ON TABLE "public"."pins" TO "anon";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."saved_folders" TO "authenticated";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."saved_maps" TO "authenticated";

GRANT ALL ON TABLE "public"."folder_favorites" TO service_role;

GRANT ALL ON TABLE "public"."folders" TO service_role;

GRANT ALL ON TABLE "public"."map_administrators" TO service_role;

GRANT ALL ON TABLE "public"."map_favorites" TO service_role;

GRANT ALL ON TABLE "public"."maps" TO service_role;

GRANT ALL ON TABLE "public"."pin_comments" TO service_role;

GRANT ALL ON TABLE "public"."pins" TO service_role;

GRANT ALL ON TABLE "public"."saved_folders" TO service_role;

GRANT ALL ON TABLE "public"."saved_maps" TO service_role;

-- RPCの実行権限。本番で許可されたロールだけに付与する。

GRANT EXECUTE ON FUNCTION private.has_map_share(target_map_id uuid) TO "anon";

GRANT EXECUTE ON FUNCTION private.has_map_share(target_map_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION private.map_share_is_admin() TO "anon";

GRANT EXECUTE ON FUNCTION private.map_share_is_admin() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.accept_map_share_link(target_map_id uuid, share_token uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.accept_map_share_link(target_map_id uuid, share_token uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION public.admin_delete_pin_comment(target_comment_id text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.admin_delete_pin_comment(target_comment_id text) TO "service_role";

GRANT EXECUTE ON FUNCTION public.admin_get_usernames(target_user_ids uuid[]) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.admin_get_usernames(target_user_ids uuid[]) TO "service_role";

GRANT EXECUTE ON FUNCTION public.admin_list_folders(page_offset integer, page_limit integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.admin_list_folders(page_offset integer, page_limit integer) TO "service_role";

GRANT EXECUTE ON FUNCTION public.admin_list_pin_comments(page_offset integer, page_limit integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.admin_list_pin_comments(page_offset integer, page_limit integer) TO "service_role";

GRANT EXECUTE ON FUNCTION public.admin_list_users(page_offset integer, page_limit integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.admin_list_users(page_offset integer, page_limit integer) TO "service_role";

GRANT EXECUTE ON FUNCTION public.admin_list_users_at_user(target_user_id uuid, page_size integer) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.admin_list_users_at_user(target_user_id uuid, page_size integer) TO "service_role";

GRANT EXECUTE ON FUNCTION public.admin_set_map_admin(target_user_id uuid, make_admin boolean) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.admin_set_map_admin(target_user_id uuid, make_admin boolean) TO "service_role";

GRANT EXECUTE ON FUNCTION public.check_map_image_owner() TO "service_role";

GRANT EXECUTE ON FUNCTION public.delete_folder(target_folder_id uuid, expected_parent_folder_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.delete_folder(target_folder_id uuid, expected_parent_folder_id uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION public.edit_pin_comment(target_comment_id text, expected_content text, new_content text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.edit_pin_comment(target_comment_id text, expected_content text, new_content text) TO "service_role";

GRANT EXECUTE ON FUNCTION public.get_map_share_token(target_map_id uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.get_map_share_token(target_map_id uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION public.is_map_admin() TO "authenticated";

GRANT EXECUTE ON FUNCTION public.is_map_admin() TO "service_role";

GRANT EXECUTE ON FUNCTION public.map_image_object_name(image_url text) TO "anon";

GRANT EXECUTE ON FUNCTION public.map_image_object_name(image_url text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.map_image_object_name(image_url text) TO "service_role";

GRANT EXECUTE ON FUNCTION public.reject_content_author_change() TO "service_role";

GRANT EXECUTE ON FUNCTION public.rename_folder(target_folder_id uuid, expected_name text, new_name text) TO "authenticated";

GRANT EXECUTE ON FUNCTION public.rename_folder(target_folder_id uuid, expected_name text, new_name text) TO "service_role";

-- 設定データのみ。共有制限は初めから有効にする。
INSERT INTO private.map_share_settings (singleton, enforced) VALUES (true, true);

-- 画像本体や本番のStorageオブジェクトはコピーしない。
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('map-images', 'map-images', false, 10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

-- BEGIN REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE public.pins, public.pin_comments;
-- END REALTIME

NOTIFY pgrst, 'reload schema';
COMMIT;

