'use client';
import { Button } from '@gitroom/react/form/button';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { FC, useCallback } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
export const SeparatePost: FC<{
  posts: string[];
  len: number;
  merge: (posts: string[]) => void;
  changeLoading: (loading: boolean) => void;
}> = (props) => {
  const { len, posts } = props;
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();

  const notReversible = useCallback(async () => {
    if (
      await deleteDialog(
        t(
          'separate_posts_confirm',
          'Are you sure you want to separate all posts? This action is not reversible.'
        ),
        t('yes', 'Yes')
      )
    ) {
      props.changeLoading(true);
      // try/finally: a non-JSON / failed response used to throw before
      // `changeLoading(false)`, wedging the composer in a stuck loading state.
      try {
        const merge = props.posts.join('\n');
        const res = await fetch('/posts/separate-posts', {
          method: 'POST',
          body: JSON.stringify({
            content: merge,
            len: props.len,
          }),
        });
        if (!res.ok) {
          throw new Error('separate_posts_failed');
        }
        const { posts } = await res.json();
        props.merge(posts);
      } catch {
        toaster.show(
          t('separate_posts_failed', 'Failed to separate posts'),
          'warning'
        );
      } finally {
        props.changeLoading(false);
      }
    }
  }, [len, posts, fetch, t, toaster]);

  return (
    <Button className="!h-[30px] !text-sm !bg-red-800" onClick={notReversible}>
      {t('separate_post', 'Separate post to multiple posts')}
    </Button>
  );
};
