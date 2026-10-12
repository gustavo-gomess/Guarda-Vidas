-- CreateEnum
CREATE TYPE "ClosingStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CONSOLIDATED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "ClosingVersionKind" AS ENUM ('SUBMISSION', 'CONSOLIDATION', 'CORRECTION');

-- CreateTable
CREATE TABLE "DailyClosing" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "ClosingStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT NOT NULL DEFAULT '',
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyClosingVersion" (
    "id" UUID NOT NULL,
    "closingId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "ClosingVersionKind" NOT NULL,
    "summary" JSONB NOT NULL,
    "pendingCount" INTEGER NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyClosingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyClosing_date_idx" ON "DailyClosing"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyClosing_postId_date_key" ON "DailyClosing"("postId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyClosingVersion_closingId_version_key" ON "DailyClosingVersion"("closingId", "version");

-- AddForeignKey
ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyClosing" ADD CONSTRAINT "DailyClosing_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyClosingVersion" ADD CONSTRAINT "DailyClosingVersion_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "DailyClosing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyClosingVersion" ADD CONSTRAINT "DailyClosingVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Added by hand: a closing freezes summaries; it never rewrites them.
-- Versions are append-only; in "DailyClosing" only status, notes,
-- currentVersion and updatedAt change. Reuses "attendance_append_only"().
CREATE FUNCTION "daily_closing_progress_only"() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'notes' - 'currentVersion' - 'updatedAt')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'notes' - 'currentVersion' - 'updatedAt') THEN
    RAISE EXCEPTION 'DailyClosing identity is immutable; only its progress may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DailyClosing_progress_only"
  BEFORE UPDATE ON "DailyClosing"
  FOR EACH ROW EXECUTE FUNCTION "daily_closing_progress_only"();
CREATE TRIGGER "DailyClosing_no_delete"
  BEFORE DELETE ON "DailyClosing"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "DailyClosing_no_truncate"
  BEFORE TRUNCATE ON "DailyClosing"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "DailyClosingVersion_no_update_delete"
  BEFORE UPDATE OR DELETE ON "DailyClosingVersion"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "DailyClosingVersion_no_truncate"
  BEFORE TRUNCATE ON "DailyClosingVersion"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();
