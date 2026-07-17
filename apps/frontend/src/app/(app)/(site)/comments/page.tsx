import { redirect } from 'next/navigation';

// Legacy URL: the comment inbox is now "Replies" at `/replies`. Keep this as a
// backward-compatible redirect (preserving any query string) for bookmarks.
export default async function CommentsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === 'string') params.set(key, value);
  }
  const qs = params.toString();
  redirect(qs ? `/replies?${qs}` : '/replies');
}
