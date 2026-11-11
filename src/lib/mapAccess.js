import { useEffect, useState } from "react";
import { supabase } from "./supabase.js";

export function canManageContent(record, userId, isAdmin) {
  return Boolean(record && userId && (isAdmin || record.user_id === userId));
}

export function useMapAccess() {
  const [session, setSession] = useState(undefined);
  const [role, setRole] = useState(null);
  const currentUser = session?.user ?? null;
  const userId = currentUser?.id;
  const currentRole = role?.userId === userId ? role : null;

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setRole((previous) => previous?.userId === nextSession?.user?.id ? previous : null);
      },
    );
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;

    let controller;
    async function checkRole() {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      const { data, error } = await supabase
        .rpc("is_map_admin")
        .abortSignal(signal);

      if (signal.aborted) return;
      if (error) console.error("管理者権限の確認に失敗", error);
      setRole({ userId, isAdmin: !error && data === true });
    }

    checkRole();
    window.addEventListener("focus", checkRole);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", checkRole);
    };
  }, [userId]);

  return {
    currentUser,
    authChecked: session !== undefined,
    roleChecked: session !== undefined && (!userId || currentRole !== null),
    isAdmin: Boolean(userId && currentRole?.isAdmin),
  };
}
