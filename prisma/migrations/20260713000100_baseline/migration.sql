-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "phone" TEXT,
    "username" TEXT,
    "nickname" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "authProvider" TEXT NOT NULL DEFAULT 'password',
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "birthYear" INTEGER,
    "ageBand" TEXT,
    "learningGoal" TEXT,
    "preferredMode" TEXT NOT NULL DEFAULT 'standard',
    "fontScale" REAL NOT NULL DEFAULT 1.0,
    "notificationPreferences" TEXT NOT NULL DEFAULT '{}',
    "motto" TEXT,
    "bio" TEXT,
    "showProfile" TEXT NOT NULL DEFAULT '{}',
    "nicknameChangedAt" DATETIME,
    CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "coverColor" TEXT NOT NULL DEFAULT 'tide',
    "ownerId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'official',
    "authorUserId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "sharedStatus" TEXT NOT NULL DEFAULT 'private',
    "priceCredits" INTEGER,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "genStatus" TEXT,
    "template" TEXT,
    "modelUsed" TEXT,
    "qualityTier" TEXT NOT NULL DEFAULT 'standard',
    "premiumRenderCount" INTEGER NOT NULL DEFAULT 0,
    "deterministicRenderCount" INTEGER NOT NULL DEFAULT 0,
    "designJson" TEXT,
    "sourceDemandId" TEXT,
    "instructorName" TEXT,
    "reviewerName" TEXT,
    "disclaimer" TEXT,
    "contributorName" TEXT,
    "revenueSharePct" INTEGER,
    "updateCadence" TEXT,
    "totalDurationSec" INTEGER NOT NULL DEFAULT 0,
    "learnersCount" INTEGER NOT NULL DEFAULT 0,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATETIME,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "contentType" TEXT NOT NULL DEFAULT 'video',
    "videoAssetId" TEXT,
    "videoUrl" TEXT,
    "articleMd" TEXT,
    "blocksJson" TEXT,
    "htmlJson" TEXT,
    "htmlGenClaimedAt" DATETIME,
    "renderEngine" TEXT,
    "renderRejectReason" TEXT,
    "renderSourceHash" TEXT,
    "renderDurationMs" INTEGER,
    "genClaimedAt" DATETIME,
    "videoGenStatus" TEXT,
    "videoScriptJson" TEXT,
    "videoGenClaimedAt" DATETIME,
    "videoDurationSec" INTEGER,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "liveStartAt" DATETIME,
    "liveSeatLimit" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'published',
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lesson_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subtitle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lessonId" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'zh',
    "startSec" REAL NOT NULL,
    "endSec" REAL NOT NULL,
    "text" TEXT NOT NULL,
    CONSTRAINT "Subtitle_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseUpdateLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT,
    "updateType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseUpdateLog_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "progressSec" INTEGER NOT NULL DEFAULT 0,
    "lastSlideIndex" INTEGER,
    "completedAt" DATETIME,
    "lastPlayedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearningProgress_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearningProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CourseReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseReview_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CoursePurchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "priceCredits" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CoursePurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CoursePurchase_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "lessonId" TEXT,
    "timestampSec" INTEGER,
    "anchorRef" TEXT,
    "title" TEXT,
    "contentMd" TEXT NOT NULL,
    "excerpt" TEXT,
    "source" TEXT NOT NULL DEFAULT 'lesson',
    "sourceUrl" TEXT,
    "sourceText" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "captureUrl" TEXT,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "notebookId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Note_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Note_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Note_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NoteTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'accent',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NoteTagOnNote" (
    "noteId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("noteId", "tagId"),
    CONSTRAINT "NoteTagOnNote_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NoteTagOnNote_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "NoteTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Demand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'ai_skill',
    "desiredDepth" TEXT NOT NULL DEFAULT 'intro',
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "mergedToDemandId" TEXT,
    "officialReply" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'low',
    "launchedCourseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Demand_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DemandVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voteCount" INTEGER NOT NULL DEFAULT 1,
    "weekKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemandVote_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "Demand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DemandVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "demandId" TEXT,
    "parentId" TEXT,
    "contentMd" TEXT NOT NULL,
    "isOfficial" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "Comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "Demand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DemandFollow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemandFollow_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "Demand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DemandFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DemandStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demandId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemandStage_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "Demand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DemandStatusLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "demandId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "operatorId" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemandStatusLog_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "Demand" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "firstPriceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "channel" TEXT NOT NULL DEFAULT 'any',
    "scope" TEXT NOT NULL DEFAULT 'all',
    "highlight" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'percent',
    "value" INTEGER NOT NULL,
    "maxRedeem" INTEGER NOT NULL DEFAULT 0,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "planScope" TEXT NOT NULL DEFAULT 'any',
    "expiresAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RedemptionCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "planId" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "note" TEXT,
    "expiresAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RedemptionCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RedemptionRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "codeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedType" TEXT NOT NULL,
    "grantedValue" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RedemptionRecord_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "RedemptionCode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RedemptionRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InviteCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inviterId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InviteCode_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inviteCodeId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "rewardedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Referral_inviteCodeId_fkey" FOREIGN KEY ("inviteCodeId") REFERENCES "InviteCode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Referral_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Referral_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "externalOrderId" TEXT,
    "couponId" TEXT,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "subscriptionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "externalSubscriptionId" TEXT,
    "status" TEXT NOT NULL,
    "priceSnapshotCents" INTEGER NOT NULL DEFAULT 0,
    "billingRetryCount" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodStart" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" DATETIME NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceSubscriptionId" TEXT,
    "status" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'free',
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "snapshotJson" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Entitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Entitlement_sourceSubscriptionId_fkey" FOREIGN KEY ("sourceSubscriptionId") REFERENCES "Subscription" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentWebhookLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "processedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'received',
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FamilyGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "planId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiredAt" DATETIME
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "familyGroupId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "inviteStatus" TEXT NOT NULL DEFAULT 'pending',
    "joinedAt" DATETIME,
    CONSTRAINT "FamilyMember_familyGroupId_fkey" FOREIGN KEY ("familyGroupId") REFERENCES "FamilyGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "anonymousId" TEXT,
    "eventName" TEXT NOT NULL,
    "propertiesJson" TEXT NOT NULL DEFAULT '{}',
    "platform" TEXT NOT NULL DEFAULT 'web',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentCalendar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "lessonId" TEXT,
    "demandId" TEXT,
    "title" TEXT NOT NULL,
    "plannedPublishDate" DATETIME NOT NULL,
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "riskLevel" TEXT NOT NULL DEFAULT 'low',
    "delayReason" TEXT,
    CONSTRAINT "ContentCalendar_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "courseId" TEXT,
    "track" TEXT,
    "source" TEXT NOT NULL DEFAULT 'youdao_dict',
    "channelDetail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "assigneeId" TEXT,
    "followUpNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operatorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Streak" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActiveDay" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Streak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StreakDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "notes" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "StreakDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'Medal'
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportedSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "rawText" TEXT,
    "sourceUrl" TEXT,
    "assetId" TEXT,
    "charCount" INTEGER NOT NULL DEFAULT 0,
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "generatedCourseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportedSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "inputJson" TEXT NOT NULL DEFAULT '{}',
    "resultRef" TEXT,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "GenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "courseId" TEXT,
    "lessonId" TEXT,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL,
    "citationsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "noteId" TEXT,
    "courseId" TEXT,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "ease" REAL NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notebook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Notebook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotebookEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notebookId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "title" TEXT,
    "contentMd" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotebookEntry_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "refJson" TEXT NOT NULL DEFAULT '{}',
    "images" TEXT NOT NULL DEFAULT '[]',
    "topicTags" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rejectReason" TEXT,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "repostCount" INTEGER NOT NULL DEFAULT 0,
    "repostOfId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Post_repostOfId_fkey" FOREIGN KEY ("repostOfId") REFERENCES "Post" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostLike" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FocusSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT,
    "courseId" TEXT,
    "goal" TEXT,
    "startAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" DATETIME,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FocusSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditAccount" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "monthlyGrantKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreditAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "refId" TEXT,
    "reason" TEXT,
    "balanceAfter" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "scene" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "creditCost" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LlmUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "role" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("role", "permission")
);

-- CreateTable
CREATE TABLE "CourseAccessRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "decidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NoteAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "noteId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NoteAttachment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "difficulty" TEXT NOT NULL DEFAULT 'basic',
    "status" TEXT NOT NULL DEFAULT 'ready',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Exam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExamQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "optionsJson" TEXT,
    "answer" TEXT NOT NULL,
    "explanation" TEXT,
    "sourceRef" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ExamQuestion_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExamAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "examId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answersJson" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "detailJson" TEXT,
    "finishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExamAttempt_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ExamAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExamMistake" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "userAnswer" TEXT NOT NULL,
    "sourceRef" TEXT,
    "courseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExamMistake_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'ios',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_slug_key" ON "Course"("slug");

-- CreateIndex
CREATE INDEX "Course_sharedStatus_lastUpdatedAt_idx" ON "Course"("sharedStatus", "lastUpdatedAt");

-- CreateIndex
CREATE INDEX "Course_authorUserId_idx" ON "Course"("authorUserId");

-- CreateIndex
CREATE INDEX "Lesson_courseId_sortOrder_idx" ON "Lesson"("courseId", "sortOrder");

-- CreateIndex
CREATE INDEX "Lesson_videoAssetId_idx" ON "Lesson"("videoAssetId");

-- CreateIndex
CREATE INDEX "Subtitle_lessonId_startSec_idx" ON "Subtitle"("lessonId", "startSec");

-- CreateIndex
CREATE INDEX "CourseUpdateLog_courseId_publishedAt_idx" ON "CourseUpdateLog"("courseId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgress_userId_lessonId_key" ON "LearningProgress"("userId", "lessonId");

-- CreateIndex
CREATE INDEX "CourseReview_courseId_createdAt_idx" ON "CourseReview"("courseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourseReview_userId_courseId_key" ON "CourseReview"("userId", "courseId");

-- CreateIndex
CREATE INDEX "CoursePurchase_courseId_idx" ON "CoursePurchase"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CoursePurchase_userId_courseId_key" ON "CoursePurchase"("userId", "courseId");

-- CreateIndex
CREATE INDEX "Note_userId_createdAt_idx" ON "Note"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Note_userId_lessonId_idx" ON "Note"("userId", "lessonId");

-- CreateIndex
CREATE INDEX "Note_userId_pinned_updatedAt_idx" ON "Note"("userId", "pinned", "updatedAt");

-- CreateIndex
CREATE INDEX "Note_notebookId_idx" ON "Note"("notebookId");

-- CreateIndex
CREATE INDEX "Note_courseId_idx" ON "Note"("courseId");

-- CreateIndex
CREATE INDEX "NoteTag_userId_idx" ON "NoteTag"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NoteTag_userId_name_key" ON "NoteTag"("userId", "name");

-- CreateIndex
CREATE INDEX "NoteTagOnNote_tagId_idx" ON "NoteTagOnNote"("tagId");

-- CreateIndex
CREATE INDEX "Demand_category_status_idx" ON "Demand"("category", "status");

-- CreateIndex
CREATE INDEX "Demand_createdAt_idx" ON "Demand"("createdAt");

-- CreateIndex
CREATE INDEX "Demand_userId_idx" ON "Demand"("userId");

-- CreateIndex
CREATE INDEX "DemandVote_weekKey_userId_idx" ON "DemandVote"("weekKey", "userId");

-- CreateIndex
CREATE INDEX "DemandVote_demandId_idx" ON "DemandVote"("demandId");

-- CreateIndex
CREATE UNIQUE INDEX "DemandVote_demandId_userId_weekKey_key" ON "DemandVote"("demandId", "userId", "weekKey");

-- CreateIndex
CREATE INDEX "Comment_demandId_createdAt_idx" ON "Comment"("demandId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_userId_idx" ON "Comment"("userId");

-- CreateIndex
CREATE INDEX "DemandFollow_userId_idx" ON "DemandFollow"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DemandFollow_demandId_userId_key" ON "DemandFollow"("demandId", "userId");

-- CreateIndex
CREATE INDEX "DemandStage_demandId_idx" ON "DemandStage"("demandId");

-- CreateIndex
CREATE INDEX "DemandStatusLog_demandId_idx" ON "DemandStatusLog"("demandId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "CouponRedemption_userId_idx" ON "CouponRedemption"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_couponId_orderId_key" ON "CouponRedemption"("couponId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_couponId_userId_key" ON "CouponRedemption"("couponId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RedemptionCode_code_key" ON "RedemptionCode"("code");

-- CreateIndex
CREATE INDEX "RedemptionCode_batchId_idx" ON "RedemptionCode"("batchId");

-- CreateIndex
CREATE INDEX "RedemptionCode_status_expiresAt_idx" ON "RedemptionCode"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "RedemptionRecord_userId_idx" ON "RedemptionRecord"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RedemptionRecord_codeId_userId_key" ON "RedemptionRecord"("codeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_inviterId_key" ON "InviteCode"("inviterId");

-- CreateIndex
CREATE UNIQUE INDEX "InviteCode_code_key" ON "InviteCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_inviteeId_key" ON "Referral"("inviteeId");

-- CreateIndex
CREATE INDEX "Referral_inviterId_idx" ON "Referral"("inviterId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_externalOrderId_key" ON "Order"("externalOrderId");

-- CreateIndex
CREATE INDEX "Order_userId_status_createdAt_idx" ON "Order"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_currentPeriodEnd_idx" ON "Subscription"("userId", "status", "currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_userId_sourceSubscriptionId_key" ON "Entitlement"("userId", "sourceSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookLog_channel_externalId_key" ON "PaymentWebhookLog"("channel", "externalId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventName_createdAt_idx" ON "AnalyticsEvent"("eventName", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_eventName_createdAt_idx" ON "AnalyticsEvent"("userId", "eventName", "createdAt");

-- CreateIndex
CREATE INDEX "ContentCalendar_courseId_idx" ON "ContentCalendar"("courseId");

-- CreateIndex
CREATE INDEX "ContentCalendar_plannedPublishDate_idx" ON "ContentCalendar"("plannedPublishDate");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_assigneeId_idx" ON "Lead"("assigneeId");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_operatorId_idx" ON "AuditLog"("operatorId");

-- CreateIndex
CREATE UNIQUE INDEX "Streak_userId_key" ON "Streak"("userId");

-- CreateIndex
CREATE INDEX "StreakDay_userId_day_idx" ON "StreakDay"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "StreakDay_userId_day_key" ON "StreakDay"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_key_key" ON "Achievement"("key");

-- CreateIndex
CREATE INDEX "UserAchievement_userId_idx" ON "UserAchievement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "ImportedSource_userId_createdAt_idx" ON "ImportedSource"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationJob_userId_status_idx" ON "GenerationJob"("userId", "status");

-- CreateIndex
CREATE INDEX "ChatThread_userId_updatedAt_idx" ON "ChatThread"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewCard_userId_dueAt_idx" ON "ReviewCard"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "Notebook_userId_updatedAt_idx" ON "Notebook"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "NotebookEntry_notebookId_sortOrder_idx" ON "NotebookEntry"("notebookId", "sortOrder");

-- CreateIndex
CREATE INDEX "Post_status_createdAt_idx" ON "Post"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Post_userId_createdAt_idx" ON "Post"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_repostOfId_idx" ON "Post"("repostOfId");

-- CreateIndex
CREATE UNIQUE INDEX "PostLike_postId_userId_key" ON "PostLike"("postId", "userId");

-- CreateIndex
CREATE INDEX "FocusSession_userId_startAt_idx" ON "FocusSession"("userId", "startAt");

-- CreateIndex
CREATE INDEX "CreditLedger_userId_createdAt_idx" ON "CreditLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedger_type_refId_idx" ON "CreditLedger"("type", "refId");

-- CreateIndex
CREATE INDEX "LlmUsage_userId_createdAt_idx" ON "LlmUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LlmUsage_scene_idx" ON "LlmUsage"("scene");

-- CreateIndex
CREATE INDEX "RolePermission_role_idx" ON "RolePermission"("role");

-- CreateIndex
CREATE INDEX "CourseAccessRequest_ownerId_status_idx" ON "CourseAccessRequest"("ownerId", "status");

-- CreateIndex
CREATE INDEX "CourseAccessRequest_requesterId_status_idx" ON "CourseAccessRequest"("requesterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseAccessRequest_courseId_requesterId_key" ON "CourseAccessRequest"("courseId", "requesterId");

-- CreateIndex
CREATE INDEX "PostComment_postId_createdAt_idx" ON "PostComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "NoteAttachment_noteId_idx" ON "NoteAttachment"("noteId");

-- CreateIndex
CREATE INDEX "Exam_userId_createdAt_idx" ON "Exam"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ExamQuestion_examId_sortOrder_idx" ON "ExamQuestion"("examId", "sortOrder");

-- CreateIndex
CREATE INDEX "ExamAttempt_userId_finishedAt_idx" ON "ExamAttempt"("userId", "finishedAt");

-- CreateIndex
CREATE INDEX "ExamMistake_userId_createdAt_idx" ON "ExamMistake"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ExamMistake_userId_courseId_idx" ON "ExamMistake"("userId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamMistake_attemptId_questionId_key" ON "ExamMistake"("attemptId", "questionId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_token_key" ON "Device"("token");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");
