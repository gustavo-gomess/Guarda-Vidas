-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('OPERATING', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AvailabilityWindowStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'CHANGED');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "reason" TEXT;

-- AlterTable (edited by hand: keeps existing posts)
-- Existing posts get a provisional code from their id and keep their
-- situation: active -> OPERATING, inactive -> INACTIVE.
ALTER TABLE "Post" ADD COLUMN     "code" TEXT,
ADD COLUMN     "location" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "status" "PostStatus" NOT NULL DEFAULT 'OPERATING';

UPDATE "Post"
SET "code" = 'P-' || UPPER(SUBSTRING("id"::text, 1, 8)),
    "status" = CASE WHEN "active" THEN 'OPERATING'::"PostStatus" ELSE 'INACTIVE'::"PostStatus" END;

ALTER TABLE "Post" ALTER COLUMN "code" SET NOT NULL,
DROP COLUMN "active";

-- CreateTable
CREATE TABLE "AvailabilityWindow" (
    "id" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "status" "AvailabilityWindowStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Availability" (
    "windowId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "day1" BOOLEAN NOT NULL,
    "day2" BOOLEAN NOT NULL,
    "day3" BOOLEAN NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("windowId","userId")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "windowId" UUID NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'PROPOSED',
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleEntry" (
    "id" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityWindow_startDate_key" ON "AvailabilityWindow"("startDate");

-- CreateIndex
CREATE INDEX "Availability_userId_idx" ON "Availability"("userId");

-- CreateIndex
CREATE INDEX "Schedule_windowId_idx" ON "Schedule"("windowId");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_postId_windowId_key" ON "Schedule"("postId", "windowId");

-- CreateIndex
CREATE INDEX "ScheduleEntry_scheduleId_date_idx" ON "ScheduleEntry"("scheduleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleEntry_userId_date_key" ON "ScheduleEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Post_code_key" ON "Post"("code");

-- AddForeignKey
ALTER TABLE "AvailabilityWindow" ADD CONSTRAINT "AvailabilityWindow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "AvailabilityWindow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "AvailabilityWindow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEntry" ADD CONSTRAINT "ScheduleEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

