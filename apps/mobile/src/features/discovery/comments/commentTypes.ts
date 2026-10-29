/** Kept in step with LIKE_COMMENT_MAX on the server. */
export const COMMENT_MAX = 140;

/** What a comment answers: one photo (as shown), or the bio. */
export type CommentAbout =
  | { kind: "photo"; photoUrl: string }
  | { kind: "bio"; text: string };

/** As the server returns it: on Likes You, and in a chat's first message. */
export type CommentShown = {
  id: string;
  text: string;
  about: { kind: "photo"; photoUrl: string | null } | { kind: "bio"; text: string | null };
};
