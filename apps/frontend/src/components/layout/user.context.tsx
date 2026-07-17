'use client';

import { createContext, FC, ReactNode, useContext } from 'react';
import { User } from '@prisma/client';
import {
  pricing,
  PlanInterface,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

/** Profile fields returned by GET /user/self (UserProfile split, v3.8.10). */
export interface UserSelfProfile {
  name: string | null;
  lastName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  timezone: string | null;
  pictureId: string | null;
  picture: { id: string; path: string } | null;
}

export const UserContext = createContext<
  | undefined
  | (User & {
      orgId: string;
      tier: PlanInterface;
      /** The member's AppRole reference for the current org (v3.8.10 RBAC). */
      role: string;
      totalChannels: number;
      isLifetime?: boolean;
      impersonate: boolean;
      allowTrial: boolean;
      isTrailing: boolean;
      streakSince: string | null;
      setupCompleted?: boolean;
      profile: UserSelfProfile | null;
    })
>(undefined);
export const ContextWrapper: FC<{
  user: User & {
    orgId: string;
    tier: 'STARTER' | 'PRO' | 'TEAM' | 'AGENCY';
    role: string;
    totalChannels: number;
    setupCompleted?: boolean;
    profile: UserSelfProfile | null;
  };
  children: ReactNode;
}> = ({ user, children }) => {
  const values = user
    ? {
        ...user,
        tier: pricing[user.tier],
      }
    : ({} as any);
  return <UserContext.Provider value={values}>{children}</UserContext.Provider>;
};
export const useUser = () => useContext(UserContext);
