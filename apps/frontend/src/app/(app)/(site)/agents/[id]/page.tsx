import { Metadata } from 'next';
import { Agent } from '@postmill-ai/frontend/components/agents/agent';
import { AgentChat } from '@postmill-ai/frontend/components/agents/agent.chat';
export const metadata: Metadata = {
  title: 'Postmill - Agent',
  description: '',
};
export default async function Page() {
  return (
    <AgentChat />
  );
}
