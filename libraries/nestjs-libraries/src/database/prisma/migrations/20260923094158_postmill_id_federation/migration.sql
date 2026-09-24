-- CreateTable: "Postmill ID" first-party federation — instance RS256 signing identity
-- (single row; privateKeyEnc is an EncryptionService v2: AES-GCM blob) and per-user
-- consent grants bound to the consent-context org. Additive; no existing rows touched.
CREATE TABLE "InstanceIdentity" (
    "id" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "publicJwk" JSONB NOT NULL,
    "privateKeyEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),

    CONSTRAINT "InstanceIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FederationGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorizationCode" TEXT,
    "codeChallenge" TEXT,
    "codeChallengeMethod" TEXT,
    "nonce" TEXT,
    "scope" TEXT,
    "redirectUri" TEXT NOT NULL,
    "accessToken" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "tokenExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FederationGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstanceIdentity_kid_key" ON "InstanceIdentity"("kid");

-- CreateIndex
CREATE UNIQUE INDEX "FederationGrant_userId_organizationId_key" ON "FederationGrant"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "FederationGrant_authorizationCode_idx" ON "FederationGrant"("authorizationCode");

-- CreateIndex
CREATE INDEX "FederationGrant_accessToken_idx" ON "FederationGrant"("accessToken");

-- CreateIndex
CREATE INDEX "FederationGrant_userId_idx" ON "FederationGrant"("userId");

-- CreateIndex
CREATE INDEX "FederationGrant_organizationId_idx" ON "FederationGrant"("organizationId");

-- CreateIndex
CREATE INDEX "FederationGrant_revokedAt_idx" ON "FederationGrant"("revokedAt");

-- AddForeignKey
ALTER TABLE "FederationGrant" ADD CONSTRAINT "FederationGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FederationGrant" ADD CONSTRAINT "FederationGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
