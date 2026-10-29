-- A comment sent with a Like (or a Rose), about one photo or the bio, as on
-- Hinge. Shown on the recipient's Likes You; if they like back, it opens the
-- chat as the first message. Goes with its Like: a Rewind (which deletes the
-- swipe) takes the comment too.

CREATE TABLE like_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  swipe_id UUID NOT NULL UNIQUE REFERENCES swipes(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment VARCHAR(140) NOT NULL,
  -- 'photo' or 'bio'.
  about_kind VARCHAR(10) NOT NULL,
  -- The photo commented on. Kept as it was (the URL) even if it is later
  -- removed, so the comment still makes sense; the id says if it still exists.
  about_photo_id UUID REFERENCES profile_photos(id) ON DELETE SET NULL,
  about_photo_url VARCHAR(500),
  -- The start of the bio as it read then.
  about_text VARCHAR(160),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX like_comments_recipient_sender_idx ON like_comments (recipient_id, sender_id, created_at DESC);
