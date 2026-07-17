const getContextValue = (requestContext: any, key: string) => {
  if (!requestContext) return undefined;
  if (typeof requestContext.get === 'function') {
    return requestContext.get(key);
  }
  return requestContext[key];
};

export const resolveOrgIdFromModelContext = (context: any): string | undefined => {
  const directOrgId = context?.orgId || context?.organizationId || context?.resourceId;
  if (typeof directOrgId === 'string' && directOrgId) {
    return directOrgId;
  }

  const organization = getContextValue(context?.requestContext, 'organization');
  if (!organization) return undefined;

  if (typeof organization === 'string') {
    try {
      const parsed = JSON.parse(organization);
      return typeof parsed?.id === 'string' ? parsed.id : undefined;
    } catch {
      return organization;
    }
  }

  return typeof organization?.id === 'string' ? organization.id : undefined;
};
