CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');
CREATE TYPE "PracticeStatus" AS ENUM ('NOT_STARTED', 'LEARNING', 'NEEDS_PRACTICE', 'READY');
CREATE TYPE "ChoirEventType" AS ENUM ('CONCERT', 'WORSHIP', 'PERFORMANCE', 'OTHER');
CREATE TYPE "DirectorTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE');
CREATE TYPE "SongResourceType" AS ENUM ('SHEET_MUSIC', 'PDF', 'AUDIO', 'SOPRANO_TRACK', 'ALTO_TRACK', 'TENOR_TRACK', 'BASS_TRACK', 'OTHER');

CREATE TABLE "Attendance" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "rehearsalId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Attendance_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attendance_rehearsalId_fkey" FOREIGN KEY ("rehearsalId") REFERENCES "Rehearsal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attendance_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "ChoirMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Attendance_rehearsalId_membershipId_key" ON "Attendance"("rehearsalId", "membershipId");
CREATE INDEX "Attendance_choirId_recordedAt_idx" ON "Attendance"("choirId", "recordedAt");
CREATE INDEX "Attendance_choirId_membershipId_idx" ON "Attendance"("choirId", "membershipId");

CREATE TABLE "RehearsalSong" (
    "rehearsalId" UUID NOT NULL,
    "songId" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RehearsalSong_pkey" PRIMARY KEY ("rehearsalId", "songId"),
    CONSTRAINT "RehearsalSong_rehearsalId_fkey" FOREIGN KEY ("rehearsalId") REFERENCES "Rehearsal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RehearsalSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RehearsalSong_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RehearsalSong_choirId_rehearsalId_idx" ON "RehearsalSong"("choirId", "rehearsalId");

CREATE TABLE "PracticeAssignment" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "songId" UUID NOT NULL,
    "sectionId" UUID,
    "membershipId" UUID,
    "status" "PracticeStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "note" TEXT,
    "dueAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PracticeAssignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PracticeAssignment_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeAssignment_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeAssignment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "VocalSection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PracticeAssignment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "ChoirMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PracticeAssignment_choirId_status_dueAt_idx" ON "PracticeAssignment"("choirId", "status", "dueAt");
CREATE INDEX "PracticeAssignment_choirId_sectionId_idx" ON "PracticeAssignment"("choirId", "sectionId");
CREATE INDEX "PracticeAssignment_choirId_membershipId_idx" ON "PracticeAssignment"("choirId", "membershipId");

CREATE TABLE "SongResource" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "songId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "SongResourceType" NOT NULL,
    "url" TEXT,
    "storageName" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SongResource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SongResource_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SongResource_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SongResource_choirId_songId_idx" ON "SongResource"("choirId", "songId");

CREATE TABLE "ChoirEvent" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ChoirEventType" NOT NULL DEFAULT 'OTHER',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3),
    "venue" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChoirEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChoirEvent_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChoirEvent_valid_time_range" CHECK ("endsAt" > "startsAt")
);
CREATE INDEX "ChoirEvent_choirId_startsAt_idx" ON "ChoirEvent"("choirId", "startsAt");

CREATE TABLE "EventSong" (
    "eventId" UUID NOT NULL,
    "songId" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EventSong_pkey" PRIMARY KEY ("eventId", "songId"),
    CONSTRAINT "EventSong_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ChoirEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventSong_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventSong_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EventSong_choirId_eventId_idx" ON "EventSong"("choirId", "eventId");

CREATE TABLE "EventParticipant" (
    "eventId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("eventId", "membershipId"),
    CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ChoirEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventParticipant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "ChoirMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventParticipant_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EventParticipant_choirId_membershipId_idx" ON "EventParticipant"("choirId", "membershipId");

CREATE TABLE "DirectorAnnouncement" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "targetSectionId" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DirectorAnnouncement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DirectorAnnouncement_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DirectorAnnouncement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DirectorAnnouncement_targetSectionId_fkey" FOREIGN KEY ("targetSectionId") REFERENCES "VocalSection"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DirectorAnnouncement_choirId_publishedAt_idx" ON "DirectorAnnouncement"("choirId", "publishedAt");
CREATE INDEX "DirectorAnnouncement_choirId_targetSectionId_idx" ON "DirectorAnnouncement"("choirId", "targetSectionId");

CREATE TABLE "DirectorTask" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "targetSectionId" UUID,
    "assignedToId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "DirectorTaskStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DirectorTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DirectorTask_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DirectorTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DirectorTask_targetSectionId_fkey" FOREIGN KEY ("targetSectionId") REFERENCES "VocalSection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DirectorTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "ChoirMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DirectorTask_choirId_status_dueAt_idx" ON "DirectorTask"("choirId", "status", "dueAt");
CREATE INDEX "DirectorTask_choirId_targetSectionId_idx" ON "DirectorTask"("choirId", "targetSectionId");
CREATE INDEX "DirectorTask_choirId_assignedToId_idx" ON "DirectorTask"("choirId", "assignedToId");

CREATE TABLE "DirectorNote" (
    "id" UUID NOT NULL,
    "choirId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "rehearsalId" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DirectorNote_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DirectorNote_choirId_fkey" FOREIGN KEY ("choirId") REFERENCES "Choir"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DirectorNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DirectorNote_rehearsalId_fkey" FOREIGN KEY ("rehearsalId") REFERENCES "Rehearsal"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "DirectorNote_choirId_createdAt_idx" ON "DirectorNote"("choirId", "createdAt");
