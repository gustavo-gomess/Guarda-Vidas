-- CreateEnum
CREATE TYPE "ChecklistItemState" AS ENUM ('OK', 'MISSING', 'DAMAGED', 'INADEQUATE');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "ChecklistRevisionKind" AS ENUM ('DRAFT', 'SUBMISSION', 'CORRECTION');

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItemVersion" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "guidance" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistItemVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Checklist" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "currentRevisionId" UUID,

    CONSTRAINT "Checklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistLine" (
    "id" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "itemVersionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "guidance" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ChecklistLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistRevision" (
    "id" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "ChecklistRevisionKind" NOT NULL,
    "authorId" UUID NOT NULL,
    "generalNote" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistAnswer" (
    "revisionId" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "state" "ChecklistItemState",
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ChecklistAnswer_pkey" PRIMARY KEY ("revisionId","lineId")
);

-- CreateIndex
CREATE INDEX "ChecklistItem_postId_idx" ON "ChecklistItem"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItemVersion_itemId_version_key" ON "ChecklistItemVersion"("itemId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Checklist_journeyId_key" ON "Checklist"("journeyId");

-- CreateIndex
CREATE UNIQUE INDEX "Checklist_currentRevisionId_key" ON "Checklist"("currentRevisionId");

-- CreateIndex
CREATE INDEX "Checklist_postId_date_idx" ON "Checklist"("postId", "date");

-- CreateIndex
CREATE INDEX "Checklist_userId_date_idx" ON "Checklist"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistLine_checklistId_itemId_key" ON "ChecklistLine"("checklistId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistRevision_checklistId_number_key" ON "ChecklistRevision"("checklistId", "number");

-- CreateIndex
CREATE INDEX "ChecklistAnswer_lineId_idx" ON "ChecklistAnswer"("lineId");

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItemVersion" ADD CONSTRAINT "ChecklistItemVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItemVersion" ADD CONSTRAINT "ChecklistItemVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checklist" ADD CONSTRAINT "Checklist_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "ChecklistRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistLine" ADD CONSTRAINT "ChecklistLine_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistLine" ADD CONSTRAINT "ChecklistLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistLine" ADD CONSTRAINT "ChecklistLine_itemVersionId_fkey" FOREIGN KEY ("itemVersionId") REFERENCES "ChecklistItemVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRevision" ADD CONSTRAINT "ChecklistRevision_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistRevision" ADD CONSTRAINT "ChecklistRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistAnswer" ADD CONSTRAINT "ChecklistAnswer_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ChecklistRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistAnswer" ADD CONSTRAINT "ChecklistAnswer_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ChecklistLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Added by hand: checklists are evidence of the post's condition.
-- Items, item versions, lines, revisions and answers are append-only, so a
-- change to the list or a correction never rewrites what was recorded.
-- In "Checklist" only status, submittedAt and currentRevisionId change.
-- Reuses "attendance_append_only"() from the attendance migration.
CREATE FUNCTION "checklist_progress_only"() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'submittedAt' - 'currentRevisionId')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'submittedAt' - 'currentRevisionId') THEN
    RAISE EXCEPTION 'Checklist data is immutable; only its progress may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Checklist_progress_only"
  BEFORE UPDATE ON "Checklist"
  FOR EACH ROW EXECUTE FUNCTION "checklist_progress_only"();
CREATE TRIGGER "Checklist_no_delete"
  BEFORE DELETE ON "Checklist"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "Checklist_no_truncate"
  BEFORE TRUNCATE ON "Checklist"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "ChecklistItem_no_update_delete"
  BEFORE UPDATE OR DELETE ON "ChecklistItem"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "ChecklistItem_no_truncate"
  BEFORE TRUNCATE ON "ChecklistItem"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "ChecklistItemVersion_no_update_delete"
  BEFORE UPDATE OR DELETE ON "ChecklistItemVersion"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "ChecklistItemVersion_no_truncate"
  BEFORE TRUNCATE ON "ChecklistItemVersion"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "ChecklistLine_no_update_delete"
  BEFORE UPDATE OR DELETE ON "ChecklistLine"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "ChecklistLine_no_truncate"
  BEFORE TRUNCATE ON "ChecklistLine"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "ChecklistRevision_no_update_delete"
  BEFORE UPDATE OR DELETE ON "ChecklistRevision"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "ChecklistRevision_no_truncate"
  BEFORE TRUNCATE ON "ChecklistRevision"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "ChecklistAnswer_no_update_delete"
  BEFORE UPDATE OR DELETE ON "ChecklistAnswer"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "ChecklistAnswer_no_truncate"
  BEFORE TRUNCATE ON "ChecklistAnswer"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();
