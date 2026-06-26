-- CreateTable
CREATE TABLE "PriorityProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SmartRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "priorityProfileId" TEXT NOT NULL,
    "ruleText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priorityWeight" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SmartRule_priorityProfileId_fkey" FOREIGN KEY ("priorityProfileId") REFERENCES "PriorityProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
