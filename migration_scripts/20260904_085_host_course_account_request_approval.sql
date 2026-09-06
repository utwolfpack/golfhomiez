ALTER TABLE host_account_requests
  ADD COLUMN approval_route VARCHAR(32) NOT NULL DEFAULT 'golfhomiez_admin' AFTER status,
  ADD COLUMN routed_host_account_id VARCHAR(191) NULL AFTER approval_route,
  ADD COLUMN routed_host_email VARCHAR(191) NULL AFTER routed_host_account_id,
  ADD COLUMN reviewed_by_host_account_id VARCHAR(191) NULL AFTER reviewed_by_admin_id;

CREATE INDEX idx_host_account_requests_route_status
  ON host_account_requests (approval_route, status, created_at);

CREATE INDEX idx_host_account_requests_routed_host
  ON host_account_requests (routed_host_account_id, status);
