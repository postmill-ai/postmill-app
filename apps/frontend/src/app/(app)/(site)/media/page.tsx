import { Metadata } from 'next';
import { MediaIndex } from '@postmill-ai/frontend/components/media-tools/media-index';

export const metadata: Metadata = {
  title: 'Media Tools',
  description: '',
};

export default function MediaPage() {
  return <MediaIndex />;
}
