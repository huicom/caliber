-- Add bond_required flag to job_drafts so posters can opt-in to Caliber
-- bonds at post-job time. /jobs/[id] reads this and conditionally renders
-- the CaliberBondPanel — when false (the default), the panel is hidden
-- entirely.
ALTER TABLE "job_drafts" ADD COLUMN "bond_required" boolean DEFAULT false NOT NULL;
