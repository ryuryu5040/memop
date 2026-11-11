import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import ErrorMessage from "../components/ErrorMessage.jsx";
import Loading from "../components/Loading.jsx";

const PAGE_SIZE = 50;
const buttonClass = "rounded-md border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40";

export default function AdminUsers({ currentUserId, isAdmin, roleChecked, refreshRole }) {
  const [page, setPage] = useState(0);
  const [listVersion, setListVersion] = useState(0);
  const [result, setResult] = useState(null);
  const [savingUserId, setSavingUserId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    // URL を直接開いても、管理者だと確認できるまで一覧を要求しない。
    // 一覧を返してよいかの最終判断は Supabase 側でも行う。
    if (!isAdmin) return;

    const controller = new AbortController();
    async function loadUsers() {
      // 表示件数より1件多く取得し、次のページがあるかを確認する。
      const { data, error } = await supabase
        .rpc("admin_list_users", {
          page_offset: page * PAGE_SIZE,
          page_limit: PAGE_SIZE + 1,
        })
        .abortSignal(controller.signal);

      if (controller.signal.aborted) return;
      if (error?.code === "42501") refreshRole();
      setResult({ page, listVersion, data, error });
    }

    loadUsers();
    // ページ移動やログアウトで不要になった一覧の取得を取り消す。
    return () => controller.abort();
  }, [isAdmin, page, listVersion, refreshRole]);

  function reloadUsers() {
    setListVersion((version) => version + 1);
  }

  async function changeAdminRole(user) {
    const makeAdmin = !user.is_admin;
    const action = makeAdmin ? "付与" : "解除";
    const account = user.email || user.user_id;
    if (!window.confirm(`${account} の管理者権限を${action}しますか？`)) return;

    setFeedback(null);
    setSavingUserId(user.user_id);
    // 変更先と変更後の状態を指定する。操作した人は Supabase がログイン情報から確認する。
    const { error } = await supabase.rpc("admin_set_map_admin", {
      target_user_id: user.user_id,
      make_admin: makeAdmin,
    });

    if (error?.code === "23514" && error.message === "last_map_admin") {
      setFeedback({ error: "最後の管理者の権限は解除できません。" });
    } else if (error) {
      setFeedback({ error: "権限変更の結果を確認できませんでした。最新の一覧を確認してください。" });
    } else {
      setFeedback({ message: `${account} の管理者権限を${action}しました。` });
    }

    // 通信エラーでも保存済みの場合があるので、一覧は Supabase から読み直す。
    reloadUsers();
    if (user.user_id === currentUserId || error?.code === "42501") refreshRole();
    setSavingUserId(null);
  }

  if (!roleChecked) return <Loading />;
  if (!isAdmin) return <ErrorMessage message="管理者権限が必要です。" />;

  const loading = result?.page !== page || result.listVersion !== listVersion;
  const users = result?.data?.slice(0, PAGE_SIZE) ?? [];
  const hasNextPage = (result?.data?.length ?? 0) > PAGE_SIZE;
  const saving = savingUserId !== null;

  return (
    <section className="h-full overflow-y-auto bg-rose-50">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="mb-4 text-xl font-bold text-slate-800">ユーザー管理</h1>
        {feedback?.error && <ErrorMessage message={feedback.error} />}
        {feedback?.message && (
          <p role="status" className="mb-4 rounded-md bg-white px-4 py-3 text-sm text-slate-700">
            {feedback.message}
          </p>
        )}
        {loading ? (
          <Loading />
        ) : result.error ? (
          <>
            <ErrorMessage message="ユーザー一覧を取得できませんでした。" />
            <button type="button" className={buttonClass} onClick={reloadUsers}>再読み込み</button>
          </>
        ) : users.length === 0 ? (
          <p className="text-sm text-slate-600">このページにユーザーはいません。</p>
        ) : (
          <ul className="divide-y divide-rose-100 rounded-lg border border-rose-100 bg-white">
            {users.map((user) => {
              const actionLabel = user.is_admin ? "管理者を解除" : "管理者にする";
              return (
                <li key={user.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                    <p className="break-all font-medium text-slate-800">
                      {user.github_username || "GitHub ユーザー名なし"}
                      {user.user_id === currentUserId && <span className="ml-2 text-xs text-slate-500">自分</span>}
                    </p>
                    <p className="break-all text-sm text-slate-600">{user.email || "メールアドレス未登録"}</p>
                    <p className="break-all text-xs text-slate-500">{user.user_id}</p>
                  </div>
                  <span className="text-sm text-slate-600">{user.is_admin ? "管理者" : "一般ユーザー"}</span>
                  <button
                    type="button"
                    className={buttonClass}
                    aria-label={`${user.email || user.user_id} を${user.is_admin ? "一般ユーザーにする" : "管理者にする"}`}
                    disabled={saving}
                    onClick={() => changeAdminRole(user)}
                  >
                    {savingUserId === user.user_id ? "保存中…" : actionLabel}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {(page > 0 || hasNextPage) && (
          <nav aria-label="ユーザー一覧のページ" className="mt-4 flex items-center gap-3">
            <button
              type="button"
              className={buttonClass}
              disabled={page === 0 || saving}
              onClick={() => setPage((previous) => previous - 1)}
            >
              前へ
            </button>
            <span className="text-sm text-slate-600">{page + 1} ページ</span>
            <button
              type="button"
              className={buttonClass}
              disabled={loading || !hasNextPage || saving}
              onClick={() => setPage((previous) => previous + 1)}
            >
              次へ
            </button>
          </nav>
        )}
      </div>
    </section>
  );
}
