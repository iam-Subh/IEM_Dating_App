ALTER TABLE messages
  ADD COLUMN message_seq INTEGER,
  ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'text',
  ADD COLUMN metadata JSONB,
  ADD COLUMN reply_to_id UUID,
  ADD COLUMN story_id UUID,
  ADD COLUMN edited_at TIMESTAMP(3),
  ADD COLUMN deleted_for_everyone_at TIMESTAMP(3),
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN command_fingerprint VARCHAR(64);

ALTER TABLE chat_sessions
  ADD COLUMN last_message_seq INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_event_seq INTEGER NOT NULL DEFAULT 0;

WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY match_id ORDER BY sent_at,id)::int AS seq FROM messages
) UPDATE messages m SET message_seq=n.seq FROM numbered n WHERE m.id=n.id;
UPDATE chat_sessions c SET last_message_seq=x.max_seq FROM
  (SELECT match_id,max(message_seq) max_seq FROM messages GROUP BY match_id) x WHERE c.match_id=x.match_id;

CREATE UNIQUE INDEX messages_match_id_message_seq_key ON messages(match_id,message_seq);
CREATE INDEX messages_match_sent_id_idx ON messages(match_id,sent_at,id);

CREATE TABLE chat_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), match_id UUID NOT NULL, user_id UUID NOT NULL,
  unread_count INTEGER NOT NULL DEFAULT 0, last_read_message_seq INTEGER NOT NULL DEFAULT 0,
  last_delivered_message_seq INTEGER NOT NULL DEFAULT 0, muted_until TIMESTAMP(3), archived_at TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX chat_participants_match_id_user_id_key ON chat_participants(match_id,user_id);
CREATE INDEX chat_participants_user_id_updated_at_match_id_idx ON chat_participants(user_id,updated_at DESC,match_id);
INSERT INTO chat_participants(match_id,user_id,unread_count,last_read_message_seq)
SELECT m.id,u.user_id,
  count(msg.id) FILTER (WHERE msg.sender_id<>u.user_id AND msg.read_at IS NULL AND NOT msg.is_deleted)::int,
  COALESCE(max(msg.message_seq) FILTER (WHERE msg.sender_id<>u.user_id AND msg.read_at IS NOT NULL),0)
FROM matches m CROSS JOIN LATERAL (VALUES(m.user1_id),(m.user2_id)) u(user_id)
LEFT JOIN messages msg ON msg.match_id=m.id GROUP BY m.id,u.user_id;

CREATE TABLE message_receipts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), message_id UUID NOT NULL,
  recipient_id UUID NOT NULL, delivered_at TIMESTAMP(3), read_at TIMESTAMP(3));
CREATE UNIQUE INDEX message_receipts_message_id_recipient_id_key ON message_receipts(message_id,recipient_id);
CREATE INDEX message_receipts_recipient_id_read_at_idx ON message_receipts(recipient_id,read_at);
CREATE TABLE message_visibility (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),message_id UUID NOT NULL,user_id UUID NOT NULL,hidden_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX message_visibility_message_id_user_id_key ON message_visibility(message_id,user_id);
CREATE INDEX message_visibility_user_id_hidden_at_idx ON message_visibility(user_id,hidden_at);
CREATE TABLE message_reactions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),message_id UUID NOT NULL,user_id UUID NOT NULL,emoji VARCHAR(16) NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX message_reactions_message_id_user_id_key ON message_reactions(message_id,user_id);
CREATE INDEX message_reactions_message_id_updated_at_idx ON message_reactions(message_id,updated_at);
CREATE TABLE chat_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),match_id UUID NOT NULL,event_seq INTEGER NOT NULL,type VARCHAR(40) NOT NULL,actor_id UUID NOT NULL,audience_user_id UUID,entity_id UUID NOT NULL,entity_revision INTEGER NOT NULL DEFAULT 1,payload JSONB NOT NULL,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX chat_events_match_id_event_seq_key ON chat_events(match_id,event_seq);
CREATE INDEX chat_events_match_id_created_at_idx ON chat_events(match_id,created_at);

CREATE TABLE follows (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),follower_id UUID NOT NULL,followee_id UUID NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'pending',revision INTEGER NOT NULL DEFAULT 1,requested_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,responded_at TIMESTAMP(3),removed_at TIMESTAMP(3),cooldown_until TIMESTAMP(3));
CREATE UNIQUE INDEX follows_follower_id_followee_id_key ON follows(follower_id,followee_id);
CREATE INDEX follows_followee_id_status_requested_at_id_idx ON follows(followee_id,status,requested_at DESC,id);
CREATE INDEX follows_follower_id_status_followee_id_idx ON follows(follower_id,status,followee_id);
CREATE TABLE story_media_assets (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),owner_id UUID NOT NULL,object_key VARCHAR(500) NOT NULL UNIQUE,content_type VARCHAR(100) NOT NULL,max_bytes INTEGER NOT NULL,detected_type VARCHAR(100),checksum VARCHAR(128),status VARCHAR(24) NOT NULL DEFAULT 'requested',created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at TIMESTAMP(3) NOT NULL,processed_at TIMESTAMP(3));
CREATE INDEX story_media_assets_owner_id_status_idx ON story_media_assets(owner_id,status);
CREATE INDEX story_media_assets_status_expires_at_idx ON story_media_assets(status,expires_at);
CREATE TABLE stories (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),owner_id UUID NOT NULL,client_publish_id VARCHAR(100) NOT NULL,asset_id UUID NOT NULL,caption VARCHAR(200),audience VARCHAR(20) NOT NULL DEFAULT 'followers',state VARCHAR(20) NOT NULL DEFAULT 'published',revision INTEGER NOT NULL DEFAULT 1,published_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at TIMESTAMP(3) NOT NULL,deleted_at TIMESTAMP(3));
CREATE UNIQUE INDEX stories_owner_id_client_publish_id_key ON stories(owner_id,client_publish_id);
CREATE INDEX stories_owner_id_state_expires_at_idx ON stories(owner_id,state,expires_at);
CREATE INDEX stories_state_published_at_id_idx ON stories(state,published_at DESC,id);
CREATE TABLE story_views (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),story_id UUID NOT NULL,viewer_id UUID NOT NULL,first_visible_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX story_views_story_id_viewer_id_key ON story_views(story_id,viewer_id);
CREATE INDEX story_views_story_id_first_visible_at_id_idx ON story_views(story_id,first_visible_at DESC,id);
CREATE TABLE story_preferences (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),viewer_id UUID NOT NULL,author_id UUID NOT NULL,muted_until TIMESTAMP(3));
CREATE UNIQUE INDEX story_preferences_viewer_id_author_id_key ON story_preferences(viewer_id,author_id);
