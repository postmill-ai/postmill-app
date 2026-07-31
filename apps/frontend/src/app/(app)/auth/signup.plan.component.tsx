'use client';

import { useSearchParams } from 'next/navigation';
import { FC, useEffect } from 'react';
import { PlanInterface } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/pricing';

const SIGNUP_PLAN_KEY = 'signup_plan';

export type SignupPeriod = 'MONTHLY' | 'YEARLY';

export const parseSignupPlan = (
  plan: string | null | undefined
): PlanInterface['current'] | null => {
  const upper = plan?.toUpperCase();
  return upper === 'STARTER' ||
    upper === 'PRO' ||
    upper === 'TEAM' ||
    upper === 'AGENCY'
    ? upper
    : null;
};

export const parseSignupPeriod = (
  period: string | null | undefined
): SignupPeriod | null => {
  const upper = period?.toUpperCase();
  return upper === 'MONTHLY' || upper === 'YEARLY' ? upper : null;
};

const SignupPlanComponent: FC = () => {
  const params = useSearchParams();
  const plan = params.get('plan');
  const period = params.get('period');
  useEffect(() => {
    const validPlan = parseSignupPlan(plan);
    const validPeriod = parseSignupPeriod(period);
    if (!validPlan && !validPeriod) {
      return;
    }
    // Merge with what's already stored — visiting /auth?plan=X and later
    // /auth?period=Y must not drop the first value.
    localStorage.setItem(
      SIGNUP_PLAN_KEY,
      JSON.stringify({
        ...readSignupPlan(),
        ...(validPlan ? { plan: validPlan } : {}),
        ...(validPeriod ? { period: validPeriod } : {}),
      })
    );
  }, [plan, period]);
  return null;
};

export type StoredSignupPlan = {
  plan?: PlanInterface['current'];
  period?: SignupPeriod;
};

// Pure read — safe to call from a useState initializer (idempotent under
// StrictMode double-invoke). Pair with clearSignupPlan() after consuming.
export const readSignupPlan = (): StoredSignupPlan => {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const data = localStorage.getItem(SIGNUP_PLAN_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

export const clearSignupPlan = () => {
  localStorage.removeItem(SIGNUP_PLAN_KEY);
};

export default SignupPlanComponent;
