export const dynamic = 'force-dynamic';
import { Forgot } from '@gitroom/frontend/components/auth/forgot';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: `Postmill Forgot Password`,
  description: '',
};
export default async function Auth() {
  return <Forgot />;
}
