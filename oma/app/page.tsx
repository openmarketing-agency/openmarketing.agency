import { redirect } from "next/navigation";

// The app entry redirects immediately and has no page shell to prefetch.
export const instant = false;

export default function HomePage() {
  redirect("/dashboard");
}
