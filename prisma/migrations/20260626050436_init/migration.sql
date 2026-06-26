-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "threadId" TEXT,
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "EmailClassification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailMessageId" TEXT NOT NULL,
    "priorityLevel" TEXT NOT NULL,
    "urgencyLevel" TEXT NOT NULL,
    "importanceScore" INTEGER NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "summary" TEXT NOT NULL,
    "whyThisMatters" TEXT NOT NULL,
    "recommendedNextStep" TEXT NOT NULL,
    "detectedDeadline" TEXT,
    "requiresResponse" BOOLEAN NOT NULL,
    "requiresDecision" BOOLEAN NOT NULL,
    "requiresPayment" BOOLEAN NOT NULL,
    "requiresScheduling" BOOLEAN NOT NULL,
    "needsFollowUp" BOOLEAN NOT NULL,
    "waitingOnReply" BOOLEAN NOT NULL,
    "riskIfIgnored" TEXT,
    "suggestedBucket" TEXT NOT NULL,
    "safeToIgnore" BOOLEAN NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailClassification_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailMessageId" TEXT NOT NULL,
    "feedbackType" TEXT NOT NULL,
    "feedbackNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserFeedback_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyEmailBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "briefingDate" DATETIME NOT NULL,
    "totalEmailsReviewed" INTEGER NOT NULL,
    "needsAttentionCount" INTEGER NOT NULL,
    "followUpCount" INTEGER NOT NULL,
    "deadlineCount" INTEGER NOT NULL,
    "moneyOrAccountCount" INTEGER NOT NULL,
    "waitingOnReplyCount" INTEGER NOT NULL,
    "readLaterCount" INTEGER NOT NULL,
    "lowPriorityCount" INTEGER NOT NULL,
    "safeToIgnoreCount" INTEGER NOT NULL,
    "needsReviewCount" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_sourceId_key" ON "EmailMessage"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailClassification_emailMessageId_key" ON "EmailClassification"("emailMessageId");
