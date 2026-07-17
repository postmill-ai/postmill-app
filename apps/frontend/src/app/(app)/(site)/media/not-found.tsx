import { RouteNotFound } from '@gitroom/frontend/components/errors/route-not-found';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';

export default async function MediaNotFound() {
  const t = await getT();
  return (
    <RouteNotFound
      title={t('media_tool_not_found_title', 'Tool not found')}
      description={t(
        'media_tool_not_found_description',
        "This media tool doesn't exist or isn't enabled for your organization."
      )}
      homeHref="/media"
      homeLabel={t('back_to_media_tools', 'Back to media tools')}
    />
  );
}
