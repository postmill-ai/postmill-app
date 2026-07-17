'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { KebabMenu } from '@gitroom/frontend/components/ui/kebab-menu';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import clsx from 'clsx';
import {
  CampaignEntitySlug,
  ResolvedCampaignItem,
} from '@gitroom/frontend/components/campaigns/campaign-types';
import {
  useOrgEntities,
  OrgEntityOption,
} from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';

const ENTITY_LABELS: Record<CampaignEntitySlug, { key: string; fallback: string }> = {
  post: { key: 'entity_posts', fallback: 'Posts' },
  channel: { key: 'entity_channels', fallback: 'Channels' },
  vpn: { key: 'entity_vpn', fallback: 'VPN' },
  llm: { key: 'entity_llm', fallback: 'AI Providers' },
  brand: { key: 'entity_brands', fallback: 'Brands' },
  storage: { key: 'entity_storage', fallback: 'Storage' },
  file: { key: 'entity_files', fallback: 'Files' },
  set: { key: 'entity_post_templates', fallback: 'Post Templates' },
  signature: { key: 'entity_signatures', fallback: 'Signatures' },
};

const entityLabel = (slug: CampaignEntitySlug, t: (key: string, fallback: string) => string) => {
  const { key, fallback } = ENTITY_LABELS[slug];
  return t(key, fallback);
};

// 'channel', 'file', and 'set' are intentionally omitted — the dedicated Channels,
// Files, and Post Templates sections own displaying and adding those, so this panel
// covers the rest.
const ENTITY_ORDER: CampaignEntitySlug[] = [
  'brand',
  'signature',
  'vpn',
  'llm',
  'storage',
];

export const PanelItem: FC<{
  item: ResolvedCampaignItem;
  onRemove: (entityType: CampaignEntitySlug, entityId: string) => void;
  busy: boolean;
  onOpen?: () => void;
  t: (key: string, fallback: string) => string;
}> = ({ item, onRemove, busy, onOpen, t }) => {
  const iconSrc = item.icon || undefined;
  const inner = (
    <>
      {iconSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconSrc} alt="" className="w-[24px] h-[24px] rounded-[4px] object-cover shrink-0" />
      ) : (
        <div className="w-[24px] h-[24px] rounded-[4px] bg-btnPrimary/10 text-btnPrimary flex items-center justify-center text-[10px] font-medium shrink-0">
          {(item.name || '?').charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex flex-col min-w-0 text-left">
        <span className="text-[13px] text-textColor truncate">{item.name}</span>
        {item.subtitle && (
          <span className="text-[11px] text-newTableText truncate">{item.subtitle}</span>
        )}
      </div>
    </>
  );
  return (
    <div className="flex items-center justify-between gap-[8px] px-[12px] py-[8px] rounded-[8px] bg-newBgColorInner border border-newTableBorder hover:border-newTableText/30 transition-colors">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex items-center gap-[8px] min-w-0 flex-1 hover:text-btnPrimary transition-colors"
        >
          {inner}
        </button>
      ) : (
        <div className="flex items-center gap-[8px] min-w-0">{inner}</div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => onRemove(item.entityType as CampaignEntitySlug, item.id)}
        className="text-[12px] text-newTableText hover:text-dangerText shrink-0 px-[6px] py-[2px] rounded-[4px] hover:bg-red-500/10 transition-colors disabled:opacity-40"
        aria-label={t('remove', 'Remove')}
      >
        ×
      </button>
    </div>
  );
};

export const AddItemsModal: FC<{
  campaignId: string;
  existingItems: Record<string, ResolvedCampaignItem[]>;
  onDone: () => void;
  // Restrict the entity-type picker (e.g. the Files section passes ['file']).
  types?: CampaignEntitySlug[];
  defaultType?: CampaignEntitySlug;
}> = ({ campaignId, existingItems, onDone, types = ENTITY_ORDER, defaultType }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [selectedType, setSelectedType] = useState<CampaignEntitySlug>(
    defaultType ?? types[0]
  );
  const [query, setQuery] = useState('');
  const [taggingId, setTaggingId] = useState<string | null>(null);
  const { data: entities, isLoading, error } = useOrgEntities(selectedType);

  const existingIds = useMemo(() => {
    return new Set((existingItems[selectedType] || []).map((i) => i.id));
  }, [existingItems, selectedType]);

  const filtered = useMemo(() => {
    const list = entities || [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.subtitle || '').toLowerCase().includes(q)
    );
  }, [entities, query]);

  const tag = useCallback(
    async (entity: OrgEntityOption) => {
      if (taggingId) return;
      setTaggingId(entity.id);
      try {
        const r = await fetch(`/campaigns/${campaignId}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityType: selectedType, entityId: entity.id }),
        });
        if (!r.ok) throw new Error();
        toaster.show(t('item_tagged', 'Item tagged'), 'success');
        onDone();
      } catch {
        toaster.show(t('failed_to_tag_item', 'Failed to tag item'), 'warning');
      } finally {
        setTaggingId(null);
      }
    },
    [campaignId, fetch, onDone, selectedType, taggingId, t, toaster]
  );

  return (
    <div className="flex flex-col gap-[16px] p-[16px] min-w-[420px] max-w-[90vw]">
      {types.length > 1 && (
        <div className="flex flex-col gap-[4px]">
          <label className="text-[12px] text-newTableText">{t('entity_type', 'Entity type')}</label>
          <select
            value={selectedType}
            onChange={(e) => {
              setSelectedType(e.target.value as CampaignEntitySlug);
              setQuery('');
            }}
            className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] text-textColor outline-none"
          >
            {types.map((slug) => (
              <option key={slug} value={slug}>
                {entityLabel(slug, t)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-[4px]">
        <label className="text-[12px] text-newTableText">{t('search', 'Search')}</label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search_entities', 'Search…')}
          className="px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] text-textColor placeholder-newTableText outline-none"
        />
      </div>

      <div className="flex flex-col gap-[6px] max-h-[300px] overflow-y-auto">
        {isLoading && (
          <div className="text-center py-[24px] text-[13px] text-newTableText">
            {t('loading', 'Loading')}
          </div>
        )}
        {error && (
          <div className="text-center py-[24px] text-[13px] text-dangerText">
            {t('failed_to_load_entities', 'Failed to load entities')}
          </div>
        )}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="text-center py-[24px] text-[13px] text-newTableText">
            {t('no_entities', 'No entities found')}
          </div>
        )}
        {filtered.map((entity) => {
          const alreadyTagged = existingIds.has(entity.id);
          return (
            <button
              key={entity.id}
              type="button"
              disabled={alreadyTagged || taggingId === entity.id}
              onClick={() => tag(entity)}
              className="flex items-center gap-[8px] w-full text-left px-[12px] py-[8px] rounded-[8px] bg-newBgColorInner border border-newTableBorder hover:border-newTableText/30 transition-colors disabled:opacity-50"
            >
              {entity.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={entity.icon} alt="" className="w-[24px] h-[24px] rounded-[4px] object-cover shrink-0" />
              ) : (
                <div className="w-[24px] h-[24px] rounded-[4px] bg-btnPrimary/10 text-btnPrimary flex items-center justify-center text-[10px] font-medium shrink-0">
                  {entity.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[13px] text-textColor truncate">{entity.name}</span>
                {entity.subtitle && (
                  <span className="text-[11px] text-newTableText truncate">{entity.subtitle}</span>
                )}
              </div>
              {alreadyTagged ? (
                <span className="text-[11px] text-newTableText shrink-0">{t('tagged', 'Tagged')}</span>
              ) : taggingId === entity.id ? (
                <span className="text-[11px] text-newTableText shrink-0">{t('saving', 'Saving…')}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const TaggedItemsPanels: FC<{
  campaignId: string;
  items: Record<string, ResolvedCampaignItem[]>;
  onMutate: () => void;
}> = ({ campaignId, items, onMutate }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const user = useUser();
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<CampaignEntitySlug | null>(null);

  // Brands: members who can read brands jump to the brand's settings page;
  // everyone else gets a read-only info modal (they'd 403 the /brands fetch).
  const canReadBrands = hasPermission('brands', 'read');
  const openBrand = useCallback(
    (item: ResolvedCampaignItem) => {
      if (canReadBrands) {
        router.push(`/settings/ai/brands/${item.id}`);
        return;
      }
      modal.openModal({
        title: t('brand', 'Brand'),
        withCloseButton: true,
        // size + height together center the modal; keep it responsive on mobile.
        size: '420px',
        maxSize: 'calc(100vw - 24px)',
        height: 'auto',
        children: (
          <div className="flex flex-col gap-[14px] p-[4px] text-textColor">
            <div className="flex items-center gap-[12px]">
              <div className="w-[40px] h-[40px] rounded-[8px] bg-btnPrimary/10 text-btnPrimary flex items-center justify-center text-[16px] font-semibold shrink-0">
                {(item.name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[15px] font-semibold truncate">{item.name}</span>
                {item.subtitle && (
                  <span className="text-[12px] text-newTableText truncate">{item.subtitle}</span>
                )}
              </div>
            </div>
            <p className="text-[13px] text-newTableText">
              {t(
                'brand_info_no_access',
                'You don’t have access to manage brand settings. Ask an admin for access to Settings → AI → Brands.'
              )}
            </p>
          </div>
        ),
      });
    },
    [canReadBrands, modal, router, t]
  );

  // Signatures: no dedicated RBAC resource — the Settings → Content → Signatures
  // tab is tier-gated (non-FREE), so eligible members jump there; everyone else
  // gets a read-only info modal with the signature's content preview.
  const canManageSignatures = user?.tier?.current !== 'STARTER';
  const openSignature = useCallback(
    (item: ResolvedCampaignItem) => {
      if (canManageSignatures) {
        router.push('/settings/content/signatures');
        return;
      }
      modal.openModal({
        title: t('signature', 'Signature'),
        withCloseButton: true,
        size: '460px',
        maxSize: 'calc(100vw - 24px)',
        height: 'auto',
        children: (
          <div className="flex flex-col gap-[14px] p-[4px] text-textColor">
            <div className="text-[15px] font-semibold break-words">{item.name}</div>
            {item.subtitle ? (
              <div className="text-[13px] text-newTableText whitespace-pre-wrap break-words max-h-[240px] overflow-y-auto rounded-[8px] border border-newTableBorder bg-newBgColorInner p-[12px]">
                {item.subtitle}
              </div>
            ) : (
              <div className="text-[13px] text-newTableText">{t('no_content', 'no content')}</div>
            )}
            <p className="text-[13px] text-newTableText">
              {t(
                'signature_info_no_access',
                'You don’t have access to manage signatures. Ask an admin for access to Settings → Content → Signatures.'
              )}
            </p>
          </div>
        ),
      });
    },
    [canManageSignatures, modal, router, t]
  );

  // Only entity types that actually have tagged items become tabs.
  const availableTypes = useMemo(
    () => ENTITY_ORDER.filter((slug) => (items[slug] || []).length > 0),
    [items]
  );
  const active =
    activeType && availableTypes.includes(activeType)
      ? activeType
      : availableTypes[0] ?? null;

  // On mobile only the first 3 type-tabs show inline; the rest fold into a kebab.
  const primaryTypes = availableTypes.slice(0, 3);
  const overflowTypes = availableTypes.slice(3);
  const overflowActive = !!active && overflowTypes.includes(active);

  const renderSubTab = (slug: CampaignEntitySlug, extra = '') => (
    <button
      key={slug}
      type="button"
      onClick={() => setActiveType(slug)}
      aria-current={active === slug ? 'page' : undefined}
      className={clsx(
        'px-[14px] py-[8px] text-[13px] font-[500] whitespace-nowrap border-b-2 -mb-[1px] transition-colors',
        extra,
        active === slug
          ? 'border-btnPrimary text-textColor'
          : 'border-transparent text-newTableText hover:text-textColor'
      )}
    >
      {entityLabel(slug, t)}
      <span className="ms-[6px] text-[11px] text-newTableText">
        {(items[slug] || []).length}
      </span>
    </button>
  );

  const remove = useCallback(
    async (entityType: CampaignEntitySlug, entityId: string) => {
      if (removingKey) return;
      setRemovingKey(`${entityType}:${entityId}`);
      try {
        const r = await fetch(`/campaigns/${campaignId}/items/${entityType}/${entityId}`, {
          method: 'DELETE',
        });
        if (!r.ok) throw new Error();
        toaster.show(t('item_untagged', 'Item removed'), 'success');
        onMutate();
      } catch {
        toaster.show(t('failed_to_untag_item', 'Failed to remove item'), 'warning');
      } finally {
        setRemovingKey(null);
      }
    },
    [campaignId, fetch, onMutate, removingKey, t, toaster]
  );

  const openAddModal = useCallback(() => {
    modal.openModal({
      title: t('add_items_to_campaign', 'Add items to campaign'),
      withCloseButton: true,
      children: (
        <AddItemsModal
          campaignId={campaignId}
          existingItems={items}
          onDone={() => {
            modal.closeAll();
            onMutate();
          }}
        />
      ),
    });
  }, [campaignId, items, modal, onMutate, t]);

  return (
    <div className="p-[16px] border border-newTableBorder rounded-[12px] bg-newBgColor">
      <div className="flex items-center justify-between mb-[12px]">
        <h3 className="text-[16px] font-semibold text-textColor">{t('tagged_items', 'Tagged Items')}</h3>
        <Button onClick={openAddModal} className="!h-[32px] !px-[12px] text-[13px]">
          {t('add_items', 'Add items')}
        </Button>
      </div>

      {availableTypes.length === 0 ? (
        <div className="text-[13px] text-newTableText text-center py-[24px]">
          {t('no_tagged_items', 'No items tagged yet. Click Add items to tag channels, brands, files, posts, and more.')}
        </div>
      ) : (
        <div className="flex flex-col gap-[12px]">
          {/* One tab per set of tagged items. On mobile only the first 3 show
              inline; the rest fold into a kebab (matching the dashboard's top
              tab pattern). The kebab lives OUTSIDE the scrolling track so its
              menu isn't clipped. */}
          <div className="flex items-stretch border-b border-newTableBorder">
            <div className="flex-1 overflow-x-auto overflow-y-hidden">
              <div className="flex items-center gap-[2px] min-w-max">
                {primaryTypes.map((slug) => renderSubTab(slug))}
                {overflowTypes.map((slug) => renderSubTab(slug, 'hidden lg:block'))}
              </div>
            </div>
            {overflowTypes.length > 0 && (
              <div className="lg:hidden flex items-center shrink-0 ps-[8px]">
                <KebabMenu
                  ariaLabel={t('more_item_types', 'More item types')}
                  active={overflowActive}
                  align="right"
                  items={overflowTypes.map((slug) => ({
                    label: (
                      <span className={clsx(active === slug && 'text-btnPrimary')}>
                        {entityLabel(slug, t)} ({(items[slug] || []).length})
                      </span>
                    ),
                    onClick: () => setActiveType(slug),
                  }))}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-[8px]">
            {(active ? items[active] || [] : []).map((item) => (
              <PanelItem
                key={item.id}
                t={t}
                item={item}
                onRemove={remove}
                busy={removingKey === `${item.entityType}:${item.id}`}
                onOpen={
                  active === 'brand'
                    ? () => openBrand(item)
                    : active === 'signature'
                    ? () => openSignature(item)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
