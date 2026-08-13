import { Metadata } from 'next';
import { MediaQueue } from '@postmill-ai/frontend/components/media-tools/media-queue';

export const metadata: Metadata = {
  title: 'Render Queue',
  description: '',
};

export default function MediaQueuePage() {
  return <MediaQueue />;
}
