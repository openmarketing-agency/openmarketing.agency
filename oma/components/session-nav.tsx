import Link from "next/link";

import { logoutAction } from "@/app/actions/auth";
import { getSessionUser } from "@/lib/dal";

/**
 * Server Component: reads the session for the header. `getSessionUser` never
 * redirects, so public pages keep working when nobody is signed in.
 */
export async function SessionNav() {
  const user = await getSessionUser();

  if (!user) {
    return (
      <>
        <Link href="/login" className="opacity-70 transition hover:opacity-100">
          Sign in
        </Link>
        <Link
          href="/register"
          className="rounded-md border border-black/15 px-3 py-1.5 transition hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/10"
        >
          Create account
        </Link>
      </>
    );
  }

  return (
    <>
      <span className="hidden max-w-[16rem] truncate opacity-70 sm:inline" title={user.email}>
        {user.email}
      </span>
      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-md border border-black/15 px-3 py-1.5 transition hover:bg-black/5 dark:border-white/25 dark:hover:bg-white/10"
        >
          Sign out
        </button>
      </form>
    </>
  );
}
