type TranslateFn = (key: string, fallback: string, vars?: Record<string, unknown>) => string;

// Pattern C helper — single source of truth in the shared module; re-exported
// here so dashboard/hooks/*.ts can keep importing it from '../dashboard.utils'.
export {
  createFetchError,
  type FetchError,
} from '@gitroom/frontend/components/settings/shared/fetch-error';

export function greetingForUser(name: string, hour: number, t: TranslateFn) {
  if (hour < 5) return t('greeting_working_late', 'Working late, {{name}}?', { name });
  if (hour < 12) return t('greeting_good_morning', 'Good morning, {{name}}', { name });
  if (hour < 17) return t('greeting_good_afternoon', 'Good afternoon, {{name}}', { name });
  if (hour < 22) return t('greeting_good_evening', 'Good evening, {{name}}', { name });
  return t('greeting_good_night', 'Good night, {{name}}', { name });
}
