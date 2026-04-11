CREATE INDEX "idx_deploy_statuses_repo" ON "deploy_statuses" USING btree ("repo");--> statement-breakpoint
CREATE INDEX "idx_deploy_statuses_status" ON "deploy_statuses" USING btree ("status");