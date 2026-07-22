-- Indexes for per-organization, per-provider spend aggregations used by BudgetService
CREATE INDEX "AISpendLog_organizationId_provider_createdAt_idx" ON "AISpendLog"("organizationId", "provider", "createdAt");
CREATE INDEX "AISpendLog_organizationId_provider_scope_createdAt_idx" ON "AISpendLog"("organizationId", "provider", "scope", "createdAt");
