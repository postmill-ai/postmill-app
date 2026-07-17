export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { AfterActivate } from '@gitroom/frontend/components/auth/after.activate';
export const metadata: Metadata = {
  title: `Postmill - Activate your account`,
  description: '',
};
export default async function Auth() {
  return <AfterActivate />;
}
