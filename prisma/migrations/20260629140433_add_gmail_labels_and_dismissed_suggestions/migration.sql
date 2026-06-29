-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN "gmailLabels" TEXT;

-- CreateTable
CREATE TABLE "DismissedSuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signature" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "DismissedSuggestion_signature_key" ON "DismissedSuggestion"("signature");
