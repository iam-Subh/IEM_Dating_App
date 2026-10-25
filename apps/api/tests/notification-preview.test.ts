import { test } from "node:test";
import assert from "node:assert/strict";
import { messagePreviewLine } from "../src/services/notification-feed.service";

const message = (extra: Partial<Parameters<typeof messagePreviewLine>[0]>) =>
  ({ content: null, type: "text", mediaKeys: [], photoUrl: null, metadata: null, ...extra });

test("the feed shows each message as the chat list says it", () => {
  assert.equal(messagePreviewLine(message({ content: "  see you at 5 " })), "see you at 5");
  assert.equal(messagePreviewLine(message({ type: "media", mediaKeys: ["a.png"] })), "📷 Photo");
  assert.equal(messagePreviewLine(message({ type: "media", mediaKeys: ["a.png", "b.jpg"], content: "us" })), "📷 2 photos · us");
  assert.equal(messagePreviewLine(message({ type: "media", mediaKeys: ["clip.mp4"] })), "🎥 Video");
  assert.equal(messagePreviewLine(message({ type: "voice", mediaKeys: ["v.m4a"] })), "🎤 Voice message");
  assert.equal(messagePreviewLine(message({ type: "document", metadata: { fileName: "notes.pdf" } })), "📄 notes.pdf");
  assert.equal(messagePreviewLine(message({ type: "story_reply", content: "where?" })), "Replied to your story: where?");
});
