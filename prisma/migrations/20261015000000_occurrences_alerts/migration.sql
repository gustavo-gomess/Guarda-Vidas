-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "OccurrenceCategory" (
    "id" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OccurrenceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccurrenceCategoryVersion" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL,
    "fields" JSONB NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OccurrenceCategoryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Occurrence" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "categoryVersionId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL DEFAULT '',
    "values" JSONB NOT NULL,

    CONSTRAINT "Occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OccurrenceAnnulment" (
    "id" UUID NOT NULL,
    "occurrenceId" UUID NOT NULL,
    "byId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OccurrenceAnnulment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReinforcementAlert" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "deviceTime" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "ReinforcementAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" UUID NOT NULL,
    "alertId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "fromStatus" "AlertStatus",
    "toStatus" "AlertStatus" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OccurrenceCategoryVersion_categoryId_version_key" ON "OccurrenceCategoryVersion"("categoryId", "version");

-- CreateIndex
CREATE INDEX "Occurrence_postId_occurredAt_idx" ON "Occurrence"("postId", "occurredAt");

-- CreateIndex
CREATE INDEX "Occurrence_categoryId_occurredAt_idx" ON "Occurrence"("categoryId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "OccurrenceAnnulment_occurrenceId_key" ON "OccurrenceAnnulment"("occurrenceId");

-- CreateIndex
CREATE INDEX "ReinforcementAlert_postId_status_idx" ON "ReinforcementAlert"("postId", "status");

-- CreateIndex
CREATE INDEX "ReinforcementAlert_status_createdAt_idx" ON "ReinforcementAlert"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AlertEvent_alertId_createdAt_idx" ON "AlertEvent"("alertId", "createdAt");

-- AddForeignKey
ALTER TABLE "OccurrenceCategory" ADD CONSTRAINT "OccurrenceCategory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccurrenceCategoryVersion" ADD CONSTRAINT "OccurrenceCategoryVersion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "OccurrenceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccurrenceCategoryVersion" ADD CONSTRAINT "OccurrenceCategoryVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "OccurrenceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occurrence" ADD CONSTRAINT "Occurrence_categoryVersionId_fkey" FOREIGN KEY ("categoryVersionId") REFERENCES "OccurrenceCategoryVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccurrenceAnnulment" ADD CONSTRAINT "OccurrenceAnnulment_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "Occurrence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OccurrenceAnnulment" ADD CONSTRAINT "OccurrenceAnnulment_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReinforcementAlert" ADD CONSTRAINT "ReinforcementAlert_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReinforcementAlert" ADD CONSTRAINT "ReinforcementAlert_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "ReinforcementAlert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Added by hand: operational records and alerts are part of the post's
-- history. Categories, versions, occurrences, annulments and alert events
-- are append-only; in alerts only "status" may change (each change is an
-- AlertEvent). Reuses "attendance_append_only"() from the attendance
-- migration.
CREATE FUNCTION "alert_status_only"() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'ReinforcementAlert data is immutable; only status may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReinforcementAlert_status_only"
  BEFORE UPDATE ON "ReinforcementAlert"
  FOR EACH ROW EXECUTE FUNCTION "alert_status_only"();
CREATE TRIGGER "ReinforcementAlert_no_delete"
  BEFORE DELETE ON "ReinforcementAlert"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "ReinforcementAlert_no_truncate"
  BEFORE TRUNCATE ON "ReinforcementAlert"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "AlertEvent_no_update_delete"
  BEFORE UPDATE OR DELETE ON "AlertEvent"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "AlertEvent_no_truncate"
  BEFORE TRUNCATE ON "AlertEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "OccurrenceCategory_no_update_delete"
  BEFORE UPDATE OR DELETE ON "OccurrenceCategory"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "OccurrenceCategory_no_truncate"
  BEFORE TRUNCATE ON "OccurrenceCategory"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "OccurrenceCategoryVersion_no_update_delete"
  BEFORE UPDATE OR DELETE ON "OccurrenceCategoryVersion"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "OccurrenceCategoryVersion_no_truncate"
  BEFORE TRUNCATE ON "OccurrenceCategoryVersion"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "Occurrence_no_update_delete"
  BEFORE UPDATE OR DELETE ON "Occurrence"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "Occurrence_no_truncate"
  BEFORE TRUNCATE ON "Occurrence"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "OccurrenceAnnulment_no_update_delete"
  BEFORE UPDATE OR DELETE ON "OccurrenceAnnulment"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "OccurrenceAnnulment_no_truncate"
  BEFORE TRUNCATE ON "OccurrenceAnnulment"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();
