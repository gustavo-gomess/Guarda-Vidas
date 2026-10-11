-- CreateEnum
CREATE TYPE "AttendanceKind" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "AttendanceOrigin" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('AWAITING_VALIDATION', 'VALIDATED', 'REJECTED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('CAPTURED', 'DENIED', 'UNAVAILABLE', 'TIMEOUT', 'UNSUPPORTED');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "proximityRadiusMeters" INTEGER;

-- CreateTable
CREATE TABLE "Journey" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "postId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" UUID NOT NULL,
    "journeyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "kind" "AttendanceKind" NOT NULL,
    "primaryKind" "AttendanceKind",
    "origin" "AttendanceOrigin" NOT NULL,
    "deviceTime" TIMESTAMP(3) NOT NULL,
    "clockOffsetMs" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locationStatus" "LocationStatus" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "distanceMeters" DOUBLE PRECISION,
    "flags" TEXT[],
    "payloadHash" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDecision" (
    "id" UUID NOT NULL,
    "recordId" UUID NOT NULL,
    "decidedById" UUID,
    "fromStatus" "AttendanceStatus",
    "toStatus" "AttendanceStatus" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Journey_postId_date_idx" ON "Journey"("postId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Journey_userId_date_key" ON "Journey"("userId", "date");

-- CreateIndex
CREATE INDEX "AttendanceRecord_postId_status_idx" ON "AttendanceRecord"("postId", "status");

-- CreateIndex
CREATE INDEX "AttendanceRecord_userId_receivedAt_idx" ON "AttendanceRecord"("userId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_journeyId_primaryKind_key" ON "AttendanceRecord"("journeyId", "primaryKind");

-- CreateIndex
CREATE INDEX "AttendanceDecision_recordId_createdAt_idx" ON "AttendanceDecision"("recordId", "createdAt");

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDecision" ADD CONSTRAINT "AttendanceDecision_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDecision" ADD CONSTRAINT "AttendanceDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Added by hand: presence data is evidence and must be preserved.
-- Journeys and decisions are append-only. In attendance records only
-- "status" may change (each change is also an AttendanceDecision); the
-- registered data is never updated, and nothing is deleted.
CREATE FUNCTION "attendance_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "attendance_record_status_only"() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'AttendanceRecord data is immutable; only status may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Journey_no_update_delete"
  BEFORE UPDATE OR DELETE ON "Journey"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "Journey_no_truncate"
  BEFORE TRUNCATE ON "Journey"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "AttendanceRecord_status_only"
  BEFORE UPDATE ON "AttendanceRecord"
  FOR EACH ROW EXECUTE FUNCTION "attendance_record_status_only"();
CREATE TRIGGER "AttendanceRecord_no_delete"
  BEFORE DELETE ON "AttendanceRecord"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "AttendanceRecord_no_truncate"
  BEFORE TRUNCATE ON "AttendanceRecord"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();

CREATE TRIGGER "AttendanceDecision_no_update_delete"
  BEFORE UPDATE OR DELETE ON "AttendanceDecision"
  FOR EACH ROW EXECUTE FUNCTION "attendance_append_only"();
CREATE TRIGGER "AttendanceDecision_no_truncate"
  BEFORE TRUNCATE ON "AttendanceDecision"
  FOR EACH STATEMENT EXECUTE FUNCTION "attendance_append_only"();
