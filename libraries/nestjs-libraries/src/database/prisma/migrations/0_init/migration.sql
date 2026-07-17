-- CreateEnum
CREATE TYPE "StorageProviderType" AS ENUM ('LOCAL', 'S3', 'CLOUDFLARE_R2', 'BACKBLAZE_B2', 'IDRIVE_E2', 'WASABI', 'DIGITALOCEAN_SPACES', 'HETZNER', 'STORJ', 'SCALEWAY', 'VULTR', 'LINODE', 'S3_COMPATIBLE');

-- CreateEnum
CREATE TYPE "State" AS ENUM ('QUEUE', 'PUBLISHED', 'ERROR', 'DRAFT');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('STANDARD', 'PRO', 'TEAM', 'ULTIMATE');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('LOCAL', 'GITHUB', 'GOOGLE', 'FARCASTER', 'WALLET', 'GENERIC');

-- CreateEnum
CREATE TYPE "CreationMethod" AS ENUM ('UNKNOWN', 'WEB', 'MCP', 'API', 'AUTOPOST', 'CLI');

-- CreateEnum
CREATE TYPE "ShortLinkPreference" AS ENUM ('ASK', 'YES', 'NO');

-- CreateEnum
CREATE TYPE "AnnouncementColor" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "CampaignEntityType" AS ENUM ('POST', 'INTEGRATION', 'ORG_VPN_CONFIG', 'AI_ORG_PROVIDER_CONFIG', 'AI_BRAND_PROFILE', 'STORAGE_PROVIDER_CONFIG', 'FILE', 'SETS', 'SIGNATURES');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "apiKey" TEXT,
    "paymentId" TEXT,
    "streakSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "allowTrial" BOOLEAN NOT NULL DEFAULT false,
    "isTrailing" BOOLEAN NOT NULL DEFAULT false,
    "shortlink" "ShortLinkPreference" NOT NULL DEFAULT 'ASK',
    "localStorageQuotaBytes" BIGINT NOT NULL DEFAULT 5368709120,
    "activeContentPackIdentifier" TEXT,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagsPosts" (
    "postId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagsPosts_pkey" PRIMARY KEY ("postId","tagId")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "providerName" "Provider" NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "providerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastReadNotifications" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviteId" TEXT,
    "activated" BOOLEAN NOT NULL DEFAULT true,
    "lastOnline" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "agent" TEXT,
    "tosAcceptedAt" TIMESTAMP(3),
    "tosVersion" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsedCodes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsedCodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOrganization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "roleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originalName" TEXT,
    "path" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'image',
    "thumbnail" TEXT,
    "alt" TEXT,
    "thumbnailTimestamp" INTEGER,
    "folderId" TEXT,
    "tags" TEXT,
    "description" TEXT,
    "metadata" JSONB,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'ai_images',

    CONSTRAINT "Credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionTier" "SubscriptionTier" NOT NULL,
    "identifier" TEXT,
    "cancelAt" TIMESTAMP(3),
    "period" TEXT NOT NULL DEFAULT 'MONTHLY',
    "totalChannels" INTEGER NOT NULL,
    "isLifetime" BOOLEAN NOT NULL DEFAULT false,
    "gracePeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "picture" TEXT,
    "providerIdentifier" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "tokenExpiration" TIMESTAMP(3),
    "refreshToken" TEXT,
    "profile" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),
    "inBetweenSteps" BOOLEAN NOT NULL DEFAULT false,
    "refreshNeeded" BOOLEAN NOT NULL DEFAULT false,
    "postingTimes" TEXT NOT NULL DEFAULT '[{"time":120}, {"time":400}, {"time":700}]',
    "customInstanceDetails" TEXT,
    "customerId" TEXT,
    "rootInternalId" TEXT,
    "additionalSettings" TEXT DEFAULT '[]',
    "providerConfigId" TEXT,
    "providerVersion" TEXT NOT NULL DEFAULT 'v1',

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostAnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostAnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderConfiguration" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "redirectUri" TEXT,
    "scopes" TEXT,
    "additionalConfig" TEXT,
    "setupInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signatures" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT,
    "content" TEXT NOT NULL,
    "autoAdd" BOOLEAN NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "pictureId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comments" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "state" "State" NOT NULL DEFAULT 'QUEUE',
    "publishDate" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "delay" INTEGER NOT NULL DEFAULT 0,
    "group" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "parentPostId" TEXT,
    "releaseId" TEXT,
    "releaseURL" TEXT,
    "settings" TEXT,
    "image" TEXT,
    "creationMethod" "CreationMethod" NOT NULL DEFAULT 'UNKNOWN',
    "intervalInDays" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "lastViews" DOUBLE PRECISION,
    "lastLikes" DOUBLE PRECISION,
    "lastComments" DOUBLE PRECISION,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "campaignId" TEXT,
    "approvalStatus" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "brandId" TEXT,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "platformCommentId" TEXT NOT NULL,
    "parentPlatformCommentId" TEXT,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorUsername" TEXT,
    "authorPicture" TEXT,
    "content" TEXT NOT NULL,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "likedByMe" BOOLEAN NOT NULL DEFAULT false,
    "isOwn" BOOLEAN NOT NULL DEFAULT false,
    "platformCreatedAt" TIMESTAMP(3) NOT NULL,
    "raw" TEXT,
    "status" TEXT DEFAULT 'needs_reply',
    "assigneeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SocialComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostCommentRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "lastReadCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostCommentRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'general',
    "title" TEXT,
    "content" TEXT NOT NULL,
    "link" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "masters" JSONB NOT NULL DEFAULT '{"email":true,"push":true,"inApp":true}',
    "categories" JSONB NOT NULL DEFAULT '{"post_published":{"email":true,"push":false,"inApp":true},"post_failed":{"email":true,"push":true,"inApp":true},"channels":{"email":true,"push":true,"inApp":true},"comments":{"email":true,"push":false,"inApp":true},"budget":{"email":true,"push":false,"inApp":true},"media":{"email":false,"push":false,"inApp":true},"announcements":{"email":true,"push":false,"inApp":true},"streak":{"email":true,"push":false,"inApp":true}}',
    "digestFrequency" TEXT NOT NULL DEFAULT 'instant',

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDigestQueue" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "html" TEXT,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDigestQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "deviceName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plugs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plugFunction" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "activated" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Plugs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExisingPlugData" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "methodName" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ExisingPlugData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PopularPosts" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PopularPosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhooks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "onSlot" BOOLEAN NOT NULL,
    "syncLast" BOOLEAN NOT NULL,
    "url" TEXT NOT NULL,
    "lastUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "addPicture" BOOLEAN NOT NULL,
    "generateContent" BOOLEAN NOT NULL,
    "integrations" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Errors" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "postId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "Errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mentions" (
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "image" TEXT NOT NULL,

    CONSTRAINT "Mentions_pkey" PRIMARY KEY ("name","username","platform","image")
);

-- CreateTable
CREATE TABLE "FileFolder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT,
    "color" TEXT,
    "storageProviderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageProviderConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "StorageProviderType" NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "name" TEXT NOT NULL,
    "credentials" TEXT,
    "region" TEXT,
    "bucket" TEXT,
    "endpoint" TEXT,
    "publicUrl" TEXT,
    "mounted" BOOLEAN NOT NULL DEFAULT false,
    "quotaBytes" BIGINT,
    "lastHealthCheck" TIMESTAMP(3),
    "lastHealthError" TEXT,
    "defaultFolderId" TEXT,
    "accountFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgProviderConfiguration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "additionalConfig" TEXT,
    "redirectUri" TEXT,
    "scopes" TEXT,
    "setupNotes" TEXT,
    "vpnSelection" TEXT,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgProviderConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "entityName" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastra_ai_spans" (
    "traceId" TEXT NOT NULL,
    "spanId" TEXT NOT NULL,
    "parentSpanId" TEXT,
    "name" TEXT NOT NULL,
    "scope" JSONB,
    "spanType" TEXT NOT NULL,
    "attributes" JSONB,
    "metadata" JSONB,
    "links" JSONB,
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "startedAt" TIMESTAMP(6) NOT NULL,
    "endedAt" TIMESTAMP(6),
    "createdAt" TIMESTAMP(6) NOT NULL,
    "updatedAt" TIMESTAMP(6),
    "isEvent" BOOLEAN NOT NULL,
    "startedAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "endedAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "createdAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "mastra_evals" (
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "agent_name" TEXT NOT NULL,
    "metric_name" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "test_info" JSONB,
    "global_run_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL,
    "createdAt" TIMESTAMP(6),
    "created_atZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "createdAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "mastra_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL,
    "resourceId" TEXT,
    "createdAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mastra_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastra_resources" (
    "id" TEXT NOT NULL,
    "workingMemory" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) NOT NULL,
    "updatedAt" TIMESTAMP(6) NOT NULL,
    "createdAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mastra_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastra_scorers" (
    "id" TEXT NOT NULL,
    "scorerId" TEXT NOT NULL,
    "traceId" TEXT,
    "runId" TEXT NOT NULL,
    "scorer" JSONB NOT NULL,
    "preprocessStepResult" JSONB,
    "extractStepResult" JSONB,
    "analyzeStepResult" JSONB,
    "score" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "preprocessPrompt" TEXT,
    "extractPrompt" TEXT,
    "generateScorePrompt" TEXT,
    "generateReasonPrompt" TEXT,
    "analyzePrompt" TEXT,
    "reasonPrompt" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "additionalContext" JSONB,
    "runtimeContext" JSONB,
    "entityType" TEXT,
    "entity" JSONB,
    "entityId" TEXT,
    "source" TEXT NOT NULL,
    "resourceId" TEXT,
    "threadId" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL,
    "updatedAt" TIMESTAMP(6) NOT NULL,
    "createdAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "spanId" TEXT,

    CONSTRAINT "mastra_scorers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastra_threads" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(6) NOT NULL,
    "updatedAt" TIMESTAMP(6) NOT NULL,
    "createdAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mastra_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastra_traces" (
    "id" TEXT NOT NULL,
    "parentSpanId" TEXT,
    "name" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "kind" INTEGER NOT NULL,
    "attributes" JSONB,
    "status" JSONB,
    "events" JSONB,
    "links" JSONB,
    "other" TEXT,
    "startTime" BIGINT NOT NULL,
    "endTime" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL,
    "createdAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mastra_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mastra_workflow_snapshot" (
    "workflow_name" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "resourceId" TEXT,
    "snapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL,
    "updatedAt" TIMESTAMP(6) NOT NULL,
    "createdAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAtZ" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OAuthApp" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pictureId" TEXT,
    "redirectUrl" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthApp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAuthorization" (
    "id" TEXT NOT NULL,
    "oauthAppId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accessToken" TEXT,
    "authorizationCode" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "redirectUri" TEXT,
    "codeChallenge" TEXT,
    "codeChallengeMethod" TEXT,
    "scope" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "refreshToken" TEXT,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIProviderConfig" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "credentials" TEXT,
    "defaultModel" TEXT,
    "reasoningModel" TEXT,
    "extraConfig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AISystemSettings" (
    "id" TEXT NOT NULL,
    "activeProvider" TEXT,
    "activeModel" TEXT,
    "scopeModels" TEXT,
    "fallbackProvider" TEXT,
    "fallbackImageProvider" TEXT,
    "guardrailSettings" TEXT,
    "budgetSettings" TEXT,
    "rateLimitSettings" TEXT,
    "observability" TEXT,
    "mcpSettings" TEXT,
    "ragSettings" TEXT,
    "cacheSettings" TEXT,
    "routingSettings" TEXT,
    "secretSettings" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AISystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AISpendLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AISpendLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIOrgProviderConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "credentials" TEXT,
    "defaultModel" TEXT,
    "reasoningModel" TEXT,
    "extraConfig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIOrgProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgShortLinkConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "credentials" TEXT,
    "customDomain" TEXT,
    "name" TEXT,
    "accountFingerprint" TEXT,
    "extraConfig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgShortLinkConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerVersion" TEXT NOT NULL DEFAULT 'v1',
    "shortUrl" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "providerLinkId" TEXT,
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortLinkSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shortLinkId" TEXT NOT NULL,
    "clicks" DOUBLE PRECISION NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortLinkSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppRole" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppRolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "AppRolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "lastName" TEXT,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "pictureId" TEXT,
    "timezone" TEXT,
    "sendSuccessEmails" BOOLEAN NOT NULL DEFAULT true,
    "sendFailureEmails" BOOLEAN NOT NULL DEFAULT true,
    "sendStreakEmails" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "previousTokenHash" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthProviderConfig" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "authUrl" TEXT,
    "tokenUrl" TEXT,
    "userInfoUrl" TEXT,
    "scopes" TEXT DEFAULT 'openid profile email',
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaProviderConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "credentials" TEXT,
    "storageProviderId" TEXT,
    "storageRootFolderId" TEXT,
    "accountFingerprint" TEXT,
    "extraConfig" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgVpnConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "name" TEXT,
    "credentials" TEXT,
    "regions" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgVpnConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPackConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "credentials" TEXT,
    "extraConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPackConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIBrandProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "instructions" TEXT,
    "language" TEXT,
    "platformInstructions" JSONB DEFAULT '{}',
    "languageProfiles" JSONB DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT,
    "logoFileIds" JSONB DEFAULT '[]',
    "palette" JSONB DEFAULT '[]',
    "fontFamilies" JSONB DEFAULT '[]',
    "customFonts" JSONB DEFAULT '[]',
    "introFileId" TEXT,
    "outroFileId" TEXT,
    "enforcement" JSONB DEFAULT '{}',
    "assets" JSONB DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIBrandProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIPromptTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "globalKey" TEXT,
    "key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIPromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AISettingsAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AISettingsAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIMediaJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "artifactUrl" TEXT,
    "provenance" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditType" TEXT,
    "error" TEXT,
    "folderId" TEXT,
    "model" TEXT,
    "version" TEXT NOT NULL DEFAULT 'v1',
    "inputJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIMediaJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIPromptLibraryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIPromptLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIContentIndex" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT NOT NULL,
    "chunk" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIContentIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "color" "AnnouncementColor" NOT NULL DEFAULT 'INFO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MultipartUpload" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fileName" TEXT,
    "fileHash" TEXT,
    "expectedMime" TEXT,
    "totalSize" INTEGER,
    "partCount" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'created',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MultipartUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchedAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "displayName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "WatchedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchedAccountMetric" (
    "id" TEXT NOT NULL,
    "watchedAccountId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchedAccountMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "goals" JSONB,
    "shareToken" TEXT,
    "shareEnabled" BOOLEAN NOT NULL DEFAULT false,
    "utmEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignItem" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" "CampaignEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Design" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "width" INTEGER NOT NULL DEFAULT 1080,
    "height" INTEGER NOT NULL DEFAULT 1080,
    "previewDataUrl" TEXT,
    "previewFileId" TEXT,
    "createdById" TEXT NOT NULL,
    "campaignId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "thumbnailFileId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "replyTo" TEXT,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "organizationId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationLedger" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,
    "note" TEXT,

    CONSTRAINT "MigrationLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InngestFunctionRun" (
    "id" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InngestFunctionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_IntegrationToWebhooks" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_IntegrationToWebhooks_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "Organization_apiKey_idx" ON "Organization"("apiKey");

-- CreateIndex
CREATE INDEX "Organization_streakSince_idx" ON "Organization"("streakSince");

-- CreateIndex
CREATE INDEX "Organization_paymentId_idx" ON "Organization"("paymentId");

-- CreateIndex
CREATE INDEX "Tags_orgId_idx" ON "Tags"("orgId");

-- CreateIndex
CREATE INDEX "Tags_deletedAt_idx" ON "Tags"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TagsPosts_postId_tagId_key" ON "TagsPosts"("postId", "tagId");

-- CreateIndex
CREATE INDEX "User_lastReadNotifications_idx" ON "User"("lastReadNotifications");

-- CreateIndex
CREATE INDEX "User_inviteId_idx" ON "User"("inviteId");

-- CreateIndex
CREATE INDEX "User_lastOnline_idx" ON "User"("lastOnline");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_providerName_key" ON "User"("email", "providerName");

-- CreateIndex
CREATE INDEX "UsedCodes_code_idx" ON "UsedCodes"("code");

-- CreateIndex
CREATE INDEX "UserOrganization_disabled_idx" ON "UserOrganization"("disabled");

-- CreateIndex
CREATE INDEX "UserOrganization_roleId_idx" ON "UserOrganization"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserOrganization_userId_organizationId_key" ON "UserOrganization"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "File_name_idx" ON "File"("name");

-- CreateIndex
CREATE INDEX "File_organizationId_idx" ON "File"("organizationId");

-- CreateIndex
CREATE INDEX "File_type_idx" ON "File"("type");

-- CreateIndex
CREATE INDEX "File_folderId_idx" ON "File"("folderId");

-- CreateIndex
CREATE INDEX "Credits_organizationId_idx" ON "Credits"("organizationId");

-- CreateIndex
CREATE INDEX "Credits_createdAt_idx" ON "Credits"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE INDEX "Subscription_organizationId_idx" ON "Subscription"("organizationId");

-- CreateIndex
CREATE INDEX "Subscription_deletedAt_idx" ON "Subscription"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_orgId_name_deletedAt_key" ON "Customer"("orgId", "name", "deletedAt");

-- CreateIndex
CREATE INDEX "Integration_rootInternalId_idx" ON "Integration"("rootInternalId");

-- CreateIndex
CREATE INDEX "Integration_organizationId_idx" ON "Integration"("organizationId");

-- CreateIndex
CREATE INDEX "Integration_providerIdentifier_idx" ON "Integration"("providerIdentifier");

-- CreateIndex
CREATE INDEX "Integration_updatedAt_idx" ON "Integration"("updatedAt");

-- CreateIndex
CREATE INDEX "Integration_createdAt_idx" ON "Integration"("createdAt");

-- CreateIndex
CREATE INDEX "Integration_deletedAt_idx" ON "Integration"("deletedAt");

-- CreateIndex
CREATE INDEX "Integration_customerId_idx" ON "Integration"("customerId");

-- CreateIndex
CREATE INDEX "Integration_inBetweenSteps_idx" ON "Integration"("inBetweenSteps");

-- CreateIndex
CREATE INDEX "Integration_refreshNeeded_idx" ON "Integration"("refreshNeeded");

-- CreateIndex
CREATE INDEX "Integration_disabled_idx" ON "Integration"("disabled");

-- CreateIndex
CREATE INDEX "Integration_providerConfigId_idx" ON "Integration"("providerConfigId");

-- CreateIndex
CREATE INDEX "Integration_organizationId_providerIdentifier_disabled_idx" ON "Integration"("organizationId", "providerIdentifier", "disabled");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_organizationId_internalId_key" ON "Integration"("organizationId", "internalId");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_organizationId_integrationId_date_idx" ON "AnalyticsSnapshot"("organizationId", "integrationId", "date");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_organizationId_metric_date_idx" ON "AnalyticsSnapshot"("organizationId", "metric", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSnapshot_integrationId_metric_date_key" ON "AnalyticsSnapshot"("integrationId", "metric", "date");

-- CreateIndex
CREATE INDEX "PostAnalyticsSnapshot_organizationId_postId_date_idx" ON "PostAnalyticsSnapshot"("organizationId", "postId", "date");

-- CreateIndex
CREATE INDEX "PostAnalyticsSnapshot_integrationId_date_idx" ON "PostAnalyticsSnapshot"("integrationId", "date");

-- CreateIndex
CREATE INDEX "PostAnalyticsSnapshot_organizationId_integrationId_date_idx" ON "PostAnalyticsSnapshot"("organizationId", "integrationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PostAnalyticsSnapshot_postId_metric_date_key" ON "PostAnalyticsSnapshot"("postId", "metric", "date");

-- CreateIndex
CREATE INDEX "ProviderConfiguration_enabled_idx" ON "ProviderConfiguration"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConfiguration_identifier_version_key" ON "ProviderConfiguration"("identifier", "version");

-- CreateIndex
CREATE INDEX "Signatures_createdAt_idx" ON "Signatures"("createdAt");

-- CreateIndex
CREATE INDEX "Signatures_organizationId_idx" ON "Signatures"("organizationId");

-- CreateIndex
CREATE INDEX "Signatures_deletedAt_idx" ON "Signatures"("deletedAt");

-- CreateIndex
CREATE INDEX "Comments_createdAt_idx" ON "Comments"("createdAt");

-- CreateIndex
CREATE INDEX "Comments_organizationId_idx" ON "Comments"("organizationId");

-- CreateIndex
CREATE INDEX "Comments_userId_idx" ON "Comments"("userId");

-- CreateIndex
CREATE INDEX "Comments_postId_idx" ON "Comments"("postId");

-- CreateIndex
CREATE INDEX "Comments_deletedAt_idx" ON "Comments"("deletedAt");

-- CreateIndex
CREATE INDEX "Post_group_idx" ON "Post"("group");

-- CreateIndex
CREATE INDEX "Post_deletedAt_idx" ON "Post"("deletedAt");

-- CreateIndex
CREATE INDEX "Post_publishDate_idx" ON "Post"("publishDate");

-- CreateIndex
CREATE INDEX "Post_state_idx" ON "Post"("state");

-- CreateIndex
CREATE INDEX "Post_organizationId_idx" ON "Post"("organizationId");

-- CreateIndex
CREATE INDEX "Post_parentPostId_idx" ON "Post"("parentPostId");

-- CreateIndex
CREATE INDEX "Post_intervalInDays_idx" ON "Post"("intervalInDays");

-- CreateIndex
CREATE INDEX "Post_creationMethod_idx" ON "Post"("creationMethod");

-- CreateIndex
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");

-- CreateIndex
CREATE INDEX "Post_updatedAt_idx" ON "Post"("updatedAt");

-- CreateIndex
CREATE INDEX "Post_releaseURL_idx" ON "Post"("releaseURL");

-- CreateIndex
CREATE INDEX "Post_integrationId_idx" ON "Post"("integrationId");

-- CreateIndex
CREATE INDEX "Post_commentCount_idx" ON "Post"("commentCount");

-- CreateIndex
CREATE INDEX "Post_organizationId_state_publishDate_idx" ON "Post"("organizationId", "state", "publishDate");

-- CreateIndex
CREATE INDEX "SocialComment_postId_idx" ON "SocialComment"("postId");

-- CreateIndex
CREATE INDEX "SocialComment_organizationId_postId_idx" ON "SocialComment"("organizationId", "postId");

-- CreateIndex
CREATE INDEX "SocialComment_parentPlatformCommentId_idx" ON "SocialComment"("parentPlatformCommentId");

-- CreateIndex
CREATE INDEX "SocialComment_platformCreatedAt_idx" ON "SocialComment"("platformCreatedAt");

-- CreateIndex
CREATE INDEX "SocialComment_deletedAt_idx" ON "SocialComment"("deletedAt");

-- CreateIndex
CREATE INDEX "SocialComment_postId_deletedAt_isOwn_platformCreatedAt_idx" ON "SocialComment"("postId", "deletedAt", "isOwn", "platformCreatedAt");

-- CreateIndex
CREATE INDEX "SocialComment_status_idx" ON "SocialComment"("status");

-- CreateIndex
CREATE INDEX "SocialComment_assigneeId_idx" ON "SocialComment"("assigneeId");

-- CreateIndex
CREATE INDEX "SocialComment_organizationId_platformCreatedAt_idx" ON "SocialComment"("organizationId", "platformCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialComment_integrationId_platformCommentId_key" ON "SocialComment"("integrationId", "platformCommentId");

-- CreateIndex
CREATE INDEX "PostCommentRead_postId_idx" ON "PostCommentRead"("postId");

-- CreateIndex
CREATE INDEX "PostCommentRead_userId_idx" ON "PostCommentRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PostCommentRead_userId_postId_key" ON "PostCommentRead"("userId", "postId");

-- CreateIndex
CREATE INDEX "Notifications_organizationId_createdAt_idx" ON "Notifications"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Notifications_organizationId_type_idx" ON "Notifications"("organizationId", "type");

-- CreateIndex
CREATE INDEX "Notifications_deletedAt_idx" ON "Notifications"("deletedAt");

-- CreateIndex
CREATE INDEX "NotificationRead_userId_readAt_idx" ON "NotificationRead"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRead_notificationId_userId_key" ON "NotificationRead"("notificationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "NotificationDigestQueue_userId_createdAt_idx" ON "NotificationDigestQueue"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDigestQueue_organizationId_createdAt_idx" ON "NotificationDigestQueue"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_userId_active_idx" ON "PushToken"("userId", "active");

-- CreateIndex
CREATE INDEX "Plugs_organizationId_idx" ON "Plugs"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Plugs_plugFunction_integrationId_key" ON "Plugs"("plugFunction", "integrationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExisingPlugData_integrationId_methodName_value_key" ON "ExisingPlugData"("integrationId", "methodName", "value");

-- CreateIndex
CREATE INDEX "Webhooks_organizationId_idx" ON "Webhooks"("organizationId");

-- CreateIndex
CREATE INDEX "Webhooks_deletedAt_idx" ON "Webhooks"("deletedAt");

-- CreateIndex
CREATE INDEX "AutoPost_deletedAt_idx" ON "AutoPost"("deletedAt");

-- CreateIndex
CREATE INDEX "Sets_organizationId_idx" ON "Sets"("organizationId");

-- CreateIndex
CREATE INDEX "Errors_organizationId_idx" ON "Errors"("organizationId");

-- CreateIndex
CREATE INDEX "Errors_createdAt_idx" ON "Errors"("createdAt");

-- CreateIndex
CREATE INDEX "Mentions_createdAt_idx" ON "Mentions"("createdAt");

-- CreateIndex
CREATE INDEX "FileFolder_organizationId_idx" ON "FileFolder"("organizationId");

-- CreateIndex
CREATE INDEX "FileFolder_parentId_idx" ON "FileFolder"("parentId");

-- CreateIndex
CREATE INDEX "StorageProviderConfig_organizationId_idx" ON "StorageProviderConfig"("organizationId");

-- CreateIndex
CREATE INDEX "StorageProviderConfig_organizationId_mounted_idx" ON "StorageProviderConfig"("organizationId", "mounted");

-- CreateIndex
CREATE INDEX "StorageProviderConfig_organizationId_type_version_idx" ON "StorageProviderConfig"("organizationId", "type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "StorageProviderConfig_organizationId_accountFingerprint_key" ON "StorageProviderConfig"("organizationId", "accountFingerprint");

-- CreateIndex
CREATE INDEX "OrgProviderConfiguration_organizationId_idx" ON "OrgProviderConfiguration"("organizationId");

-- CreateIndex
CREATE INDEX "OrgProviderConfiguration_organizationId_identifier_idx" ON "OrgProviderConfiguration"("organizationId", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "OrgProviderConfiguration_organizationId_identifier_name_ver_key" ON "OrgProviderConfiguration"("organizationId", "identifier", "name", "version");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_entity_idx" ON "AuditLog"("organizationId", "entity");

-- CreateIndex
CREATE INDEX "public_mastra_ai_spans_name_idx" ON "mastra_ai_spans"("name");

-- CreateIndex
CREATE INDEX "public_mastra_ai_spans_parentspanid_startedat_idx" ON "mastra_ai_spans"("parentSpanId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "public_mastra_ai_spans_spantype_startedat_idx" ON "mastra_ai_spans"("spanType", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "public_mastra_ai_spans_traceid_startedat_idx" ON "mastra_ai_spans"("traceId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "public_mastra_evals_agent_name_created_at_idx" ON "mastra_evals"("agent_name", "created_at" DESC);

-- CreateIndex
CREATE INDEX "public_mastra_messages_thread_id_createdat_idx" ON "mastra_messages"("thread_id", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "public_mastra_scores_trace_id_span_id_created_at_idx" ON "mastra_scorers"("traceId", "spanId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "public_mastra_threads_resourceid_createdat_idx" ON "mastra_threads"("resourceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "public_mastra_traces_name_starttime_idx" ON "mastra_traces"("name", "startTime" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "public_mastra_workflow_snapshot_workflow_name_run_id_key" ON "mastra_workflow_snapshot"("workflow_name", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthApp_clientId_key" ON "OAuthApp"("clientId");

-- CreateIndex
CREATE INDEX "OAuthApp_clientId_idx" ON "OAuthApp"("clientId");

-- CreateIndex
CREATE INDEX "OAuthApp_organizationId_idx" ON "OAuthApp"("organizationId");

-- CreateIndex
CREATE INDEX "OAuthApp_deletedAt_idx" ON "OAuthApp"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthApp_organizationId_deletedAt_key" ON "OAuthApp"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "OAuthAuthorization_accessToken_idx" ON "OAuthAuthorization"("accessToken");

-- CreateIndex
CREATE INDEX "OAuthAuthorization_authorizationCode_idx" ON "OAuthAuthorization"("authorizationCode");

-- CreateIndex
CREATE INDEX "OAuthAuthorization_oauthAppId_idx" ON "OAuthAuthorization"("oauthAppId");

-- CreateIndex
CREATE INDEX "OAuthAuthorization_userId_idx" ON "OAuthAuthorization"("userId");

-- CreateIndex
CREATE INDEX "OAuthAuthorization_organizationId_idx" ON "OAuthAuthorization"("organizationId");

-- CreateIndex
CREATE INDEX "OAuthAuthorization_revokedAt_idx" ON "OAuthAuthorization"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAuthorization_oauthAppId_userId_organizationId_key" ON "OAuthAuthorization"("oauthAppId", "userId", "organizationId");

-- CreateIndex
CREATE INDEX "AIProviderConfig_enabled_idx" ON "AIProviderConfig"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "AIProviderConfig_identifier_version_key" ON "AIProviderConfig"("identifier", "version");

-- CreateIndex
CREATE INDEX "AISystemSettings_activeProvider_idx" ON "AISystemSettings"("activeProvider");

-- CreateIndex
CREATE INDEX "AISpendLog_organizationId_scope_createdAt_idx" ON "AISpendLog"("organizationId", "scope", "createdAt");

-- CreateIndex
CREATE INDEX "AISpendLog_organizationId_createdAt_idx" ON "AISpendLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AISpendLog_provider_createdAt_idx" ON "AISpendLog"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "AISpendLog_scope_createdAt_idx" ON "AISpendLog"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "AISpendLog_userId_createdAt_idx" ON "AISpendLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AIOrgProviderConfig_organizationId_idx" ON "AIOrgProviderConfig"("organizationId");

-- CreateIndex
CREATE INDEX "AIOrgProviderConfig_enabled_idx" ON "AIOrgProviderConfig"("enabled");

-- CreateIndex
CREATE INDEX "AIOrgProviderConfig_organizationId_isActive_idx" ON "AIOrgProviderConfig"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AIOrgProviderConfig_organizationId_identifier_version_key" ON "AIOrgProviderConfig"("organizationId", "identifier", "version");

-- CreateIndex
CREATE INDEX "OrgShortLinkConfig_organizationId_idx" ON "OrgShortLinkConfig"("organizationId");

-- CreateIndex
CREATE INDEX "OrgShortLinkConfig_organizationId_isActive_idx" ON "OrgShortLinkConfig"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "OrgShortLinkConfig_organizationId_identifier_version_accoun_key" ON "OrgShortLinkConfig"("organizationId", "identifier", "version", "accountFingerprint");

-- CreateIndex
CREATE INDEX "ShortLink_organizationId_provider_idx" ON "ShortLink"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "ShortLink_organizationId_createdAt_idx" ON "ShortLink"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ShortLink_postId_idx" ON "ShortLink"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "ShortLink_organizationId_shortUrl_key" ON "ShortLink"("organizationId", "shortUrl");

-- CreateIndex
CREATE INDEX "ShortLinkSnapshot_organizationId_date_idx" ON "ShortLinkSnapshot"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ShortLinkSnapshot_shortLinkId_date_key" ON "ShortLinkSnapshot"("shortLinkId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");

-- CreateIndex
CREATE INDEX "ApiKey_userId_idx" ON "ApiKey"("userId");

-- CreateIndex
CREATE INDEX "ApiKey_hashedKey_idx" ON "ApiKey"("hashedKey");

-- CreateIndex
CREATE INDEX "AppRole_organizationId_idx" ON "AppRole"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AppRole_organizationId_key_key" ON "AppRole"("organizationId", "key");

-- CreateIndex
CREATE INDEX "Permission_resource_idx" ON "Permission"("resource");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_resource_action_key" ON "Permission"("resource", "action");

-- CreateIndex
CREATE INDEX "AppRolePermission_permissionId_idx" ON "AppRolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "UserProfile_pictureId_idx" ON "UserProfile"("pictureId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_previousTokenHash_idx" ON "Session"("previousTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuthProviderConfig_provider_version_key" ON "AuthProviderConfig"("provider", "version");

-- CreateIndex
CREATE INDEX "MediaProviderConfig_organizationId_idx" ON "MediaProviderConfig"("organizationId");

-- CreateIndex
CREATE INDEX "MediaProviderConfig_organizationId_isActive_idx" ON "MediaProviderConfig"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MediaProviderConfig_organizationId_identifier_version_key" ON "MediaProviderConfig"("organizationId", "identifier", "version");

-- CreateIndex
CREATE INDEX "OrgVpnConfig_organizationId_idx" ON "OrgVpnConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgVpnConfig_organizationId_identifier_version_key" ON "OrgVpnConfig"("organizationId", "identifier", "version");

-- CreateIndex
CREATE INDEX "ContentPackConfig_organizationId_idx" ON "ContentPackConfig"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPackConfig_organizationId_identifier_version_key" ON "ContentPackConfig"("organizationId", "identifier", "version");

-- CreateIndex
CREATE INDEX "AIBrandProfile_organizationId_idx" ON "AIBrandProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AIPromptTemplate_globalKey_key" ON "AIPromptTemplate"("globalKey");

-- CreateIndex
CREATE INDEX "AIPromptTemplate_organizationId_key_idx" ON "AIPromptTemplate"("organizationId", "key");

-- CreateIndex
CREATE INDEX "AIPromptTemplate_key_idx" ON "AIPromptTemplate"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AIPromptTemplate_organizationId_key_key" ON "AIPromptTemplate"("organizationId", "key");

-- CreateIndex
CREATE INDEX "AISettingsAudit_createdAt_idx" ON "AISettingsAudit"("createdAt");

-- CreateIndex
CREATE INDEX "AISettingsAudit_userId_createdAt_idx" ON "AISettingsAudit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AISettingsAudit_action_createdAt_idx" ON "AISettingsAudit"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AIMediaJob_organizationId_createdAt_idx" ON "AIMediaJob"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIMediaJob_organizationId_status_createdAt_idx" ON "AIMediaJob"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AIMediaJob_userId_createdAt_idx" ON "AIMediaJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AIMediaJob_provider_createdAt_idx" ON "AIMediaJob"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "AIPromptLibraryItem_organizationId_idx" ON "AIPromptLibraryItem"("organizationId");

-- CreateIndex
CREATE INDEX "AIPromptLibraryItem_organizationId_createdAt_idx" ON "AIPromptLibraryItem"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIContentIndex_organizationId_idx" ON "AIContentIndex"("organizationId");

-- CreateIndex
CREATE INDEX "AIContentIndex_organizationId_updatedAt_idx" ON "AIContentIndex"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "AIContentIndex_organizationId_sourceType_sourceId_idx" ON "AIContentIndex"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "AIContentIndex_contentHash_idx" ON "AIContentIndex"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "AIContentIndex_organizationId_sourceType_sourceId_chunkInde_key" ON "AIContentIndex"("organizationId", "sourceType", "sourceId", "chunkIndex");

-- CreateIndex
CREATE INDEX "MultipartUpload_organizationId_state_idx" ON "MultipartUpload"("organizationId", "state");

-- CreateIndex
CREATE INDEX "MultipartUpload_uploadId_idx" ON "MultipartUpload"("uploadId");

-- CreateIndex
CREATE INDEX "MultipartUpload_organizationId_uploadId_state_idx" ON "MultipartUpload"("organizationId", "uploadId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "MultipartUpload_organizationId_uploadId_key" ON "MultipartUpload"("organizationId", "uploadId");

-- CreateIndex
CREATE INDEX "WatchedAccount_organizationId_idx" ON "WatchedAccount"("organizationId");

-- CreateIndex
CREATE INDEX "WatchedAccount_deletedAt_idx" ON "WatchedAccount"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchedAccount_organizationId_provider_handle_key" ON "WatchedAccount"("organizationId", "provider", "handle");

-- CreateIndex
CREATE INDEX "WatchedAccountMetric_watchedAccountId_metric_capturedAt_idx" ON "WatchedAccountMetric"("watchedAccountId", "metric", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_shareToken_key" ON "Campaign"("shareToken");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_idx" ON "Campaign"("organizationId");

-- CreateIndex
CREATE INDEX "Campaign_deletedAt_idx" ON "Campaign"("deletedAt");

-- CreateIndex
CREATE INDEX "CampaignItem_organizationId_entityType_entityId_idx" ON "CampaignItem"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "CampaignItem_campaignId_entityType_idx" ON "CampaignItem"("campaignId", "entityType");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignItem_campaignId_entityType_entityId_key" ON "CampaignItem"("campaignId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "Design_organizationId_idx" ON "Design"("organizationId");

-- CreateIndex
CREATE INDEX "Design_createdById_idx" ON "Design"("createdById");

-- CreateIndex
CREATE INDEX "Design_campaignId_idx" ON "Design"("campaignId");

-- CreateIndex
CREATE INDEX "Design_deletedAt_idx" ON "Design"("deletedAt");

-- CreateIndex
CREATE INDEX "DesignTemplate_organizationId_idx" ON "DesignTemplate"("organizationId");

-- CreateIndex
CREATE INDEX "DesignTemplate_category_idx" ON "DesignTemplate"("category");

-- CreateIndex
CREATE INDEX "DesignTemplate_deletedAt_idx" ON "DesignTemplate"("deletedAt");

-- CreateIndex
CREATE INDEX "EmailLog_provider_providerMessageId_idx" ON "EmailLog"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "EmailLog_sentAt_idx" ON "EmailLog"("sentAt");

-- CreateIndex
CREATE INDEX "EmailLog_status_idx" ON "EmailLog"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationLedger_key_key" ON "MigrationLedger"("key");

-- CreateIndex
CREATE INDEX "MigrationLedger_appliedAt_idx" ON "MigrationLedger"("appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InngestFunctionRun_functionId_key" ON "InngestFunctionRun"("functionId");

-- CreateIndex
CREATE INDEX "InngestFunctionRun_updatedAt_idx" ON "InngestFunctionRun"("updatedAt");

-- CreateIndex
CREATE INDEX "_IntegrationToWebhooks_B_index" ON "_IntegrationToWebhooks"("B");

-- AddForeignKey
ALTER TABLE "Tags" ADD CONSTRAINT "Tags_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagsPosts" ADD CONSTRAINT "TagsPosts_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagsPosts" ADD CONSTRAINT "TagsPosts_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsedCodes" ADD CONSTRAINT "UsedCodes_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrganization" ADD CONSTRAINT "UserOrganization_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AppRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrganization" ADD CONSTRAINT "UserOrganization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOrganization" ADD CONSTRAINT "UserOrganization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "FileFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credits" ADD CONSTRAINT "Credits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "OrgProviderConfiguration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAnalyticsSnapshot" ADD CONSTRAINT "PostAnalyticsSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAnalyticsSnapshot" ADD CONSTRAINT "PostAnalyticsSnapshot_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signatures" ADD CONSTRAINT "Signatures_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signatures" ADD CONSTRAINT "Signatures_pictureId_fkey" FOREIGN KEY ("pictureId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comments" ADD CONSTRAINT "Comments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comments" ADD CONSTRAINT "Comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comments" ADD CONSTRAINT "Comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_parentPostId_fkey" FOREIGN KEY ("parentPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "AIBrandProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialComment" ADD CONSTRAINT "SocialComment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostCommentRead" ADD CONSTRAINT "PostCommentRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostCommentRead" ADD CONSTRAINT "PostCommentRead_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notifications" ADD CONSTRAINT "Notifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDigestQueue" ADD CONSTRAINT "NotificationDigestQueue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDigestQueue" ADD CONSTRAINT "NotificationDigestQueue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plugs" ADD CONSTRAINT "Plugs_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plugs" ADD CONSTRAINT "Plugs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExisingPlugData" ADD CONSTRAINT "ExisingPlugData_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhooks" ADD CONSTRAINT "Webhooks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoPost" ADD CONSTRAINT "AutoPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sets" ADD CONSTRAINT "Sets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Errors" ADD CONSTRAINT "Errors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Errors" ADD CONSTRAINT "Errors_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileFolder" ADD CONSTRAINT "FileFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FileFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileFolder" ADD CONSTRAINT "FileFolder_storageProviderId_fkey" FOREIGN KEY ("storageProviderId") REFERENCES "StorageProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileFolder" ADD CONSTRAINT "FileFolder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageProviderConfig" ADD CONSTRAINT "StorageProviderConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgProviderConfiguration" ADD CONSTRAINT "OrgProviderConfiguration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthApp" ADD CONSTRAINT "OAuthApp_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthApp" ADD CONSTRAINT "OAuthApp_pictureId_fkey" FOREIGN KEY ("pictureId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAuthorization" ADD CONSTRAINT "OAuthAuthorization_oauthAppId_fkey" FOREIGN KEY ("oauthAppId") REFERENCES "OAuthApp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAuthorization" ADD CONSTRAINT "OAuthAuthorization_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAuthorization" ADD CONSTRAINT "OAuthAuthorization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AISpendLog" ADD CONSTRAINT "AISpendLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AISpendLog" ADD CONSTRAINT "AISpendLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIOrgProviderConfig" ADD CONSTRAINT "AIOrgProviderConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgShortLinkConfig" ADD CONSTRAINT "OrgShortLinkConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortLinkSnapshot" ADD CONSTRAINT "ShortLinkSnapshot_shortLinkId_fkey" FOREIGN KEY ("shortLinkId") REFERENCES "ShortLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortLinkSnapshot" ADD CONSTRAINT "ShortLinkSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppRole" ADD CONSTRAINT "AppRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppRolePermission" ADD CONSTRAINT "AppRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AppRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppRolePermission" ADD CONSTRAINT "AppRolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_pictureId_fkey" FOREIGN KEY ("pictureId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaProviderConfig" ADD CONSTRAINT "MediaProviderConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaProviderConfig" ADD CONSTRAINT "MediaProviderConfig_storageProviderId_fkey" FOREIGN KEY ("storageProviderId") REFERENCES "StorageProviderConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgVpnConfig" ADD CONSTRAINT "OrgVpnConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPackConfig" ADD CONSTRAINT "ContentPackConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIBrandProfile" ADD CONSTRAINT "AIBrandProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIPromptTemplate" ADD CONSTRAINT "AIPromptTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AISettingsAudit" ADD CONSTRAINT "AISettingsAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIMediaJob" ADD CONSTRAINT "AIMediaJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIMediaJob" ADD CONSTRAINT "AIMediaJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIPromptLibraryItem" ADD CONSTRAINT "AIPromptLibraryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIContentIndex" ADD CONSTRAINT "AIContentIndex_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MultipartUpload" ADD CONSTRAINT "MultipartUpload_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchedAccount" ADD CONSTRAINT "WatchedAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchedAccountMetric" ADD CONSTRAINT "WatchedAccountMetric_watchedAccountId_fkey" FOREIGN KEY ("watchedAccountId") REFERENCES "WatchedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignItem" ADD CONSTRAINT "CampaignItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_previewFileId_fkey" FOREIGN KEY ("previewFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignTemplate" ADD CONSTRAINT "DesignTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignTemplate" ADD CONSTRAINT "DesignTemplate_thumbnailFileId_fkey" FOREIGN KEY ("thumbnailFileId") REFERENCES "File"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IntegrationToWebhooks" ADD CONSTRAINT "_IntegrationToWebhooks_A_fkey" FOREIGN KEY ("A") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IntegrationToWebhooks" ADD CONSTRAINT "_IntegrationToWebhooks_B_fkey" FOREIGN KEY ("B") REFERENCES "Webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

