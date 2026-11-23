/** Redirects saved chat links to the conversation panel on Campaigns. */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { z } from "zod";

type Props = { searchParams: Promise<{ chat?: string | string[] }> };

async function RedirectToConversation({ searchParams }: Props) {
  const { chat } = await searchParams;
  const selected = chat === "new" ? chat : z.uuid().safeParse(chat).data;
  return redirect(selected ? "/dashboard?chat=" + selected : "/dashboard");
}

export default function Page(props: Props) {
  return <Suspense><RedirectToConversation {...props} /></Suspense>;
}
