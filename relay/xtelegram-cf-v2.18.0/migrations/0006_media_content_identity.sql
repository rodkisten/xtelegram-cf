PRAGMA foreign_keys = ON;

-- Exact and robustness-oriented content identity for media downloaded by the Worker.
ALTER TABLE media ADD COLUMN media_sha256 TEXT;
ALTER TABLE media ADD COLUMN media_fingerprint TEXT;
ALTER TABLE media ADD COLUMN media_fingerprint_version INTEGER;
ALTER TABLE media ADD COLUMN media_byte_length INTEGER;
ALTER TABLE media ADD COLUMN media_width INTEGER;
ALTER TABLE media ADD COLUMN media_height INTEGER;

CREATE INDEX IF NOT EXISTS idx_media_sha256
  ON media(media_sha256);

CREATE INDEX IF NOT EXISTS idx_media_fingerprint
  ON media(media_fingerprint_version, media_fingerprint);

CREATE INDEX IF NOT EXISTS idx_media_video_shape
  ON media(media_type, media_width, media_height, updated_at DESC);
