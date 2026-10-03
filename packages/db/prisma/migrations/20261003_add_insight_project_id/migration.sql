-- AlterTable
ALTER TABLE "insights" ADD COLUMN "projectId" TEXT;

-- CreateIndex
CREATE INDEX "insights_projectId_idx" ON "insights"("projectId");

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
