export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { Activate } from '@postmill-ai/frontend/components/auth/activate';
export const metadata: Metadata = {
  title: `Postmill - Activate your account`,
  description: '',
};
export default async function Auth() {
  return <Activate />;
}
