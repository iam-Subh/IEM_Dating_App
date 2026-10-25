# Nudity check

Every profile photo, profile video, Story and chat photo or video is checked
for nudity by **Freepik's nsfw_image_detector** (MIT, licence in
`apps/face-service/models/FREEPIK_NSFW_LICENSE`). It runs in our own face
service (`POST /nudity`), so media never leaves our servers. The model sorts
an image into four levels - neutral, low (suggestive, e.g. swimwear), medium
(nudity), high (explicit) - and the score is p(medium) + p(high), from 0 to 1.
"Low" is allowed. Only the score is stored (`nudity_score`).

Bumble's Private Detector was used first and replaced: it let a nude collage
through at 0.36 and scored a clothed video 0.73. On the same images Freepik's
model gave the nudes 1.000 and every clothed photo and video 0.001-0.33.

## What the score does

| Score | Profile photo / video | Story | Chat media |
|---|---|---|---|
| under `NUDITY_REVIEW` (0.5) | shown | posted | shown |
| `NUDITY_REVIEW` to `NUDITY_BLOCK` (0.9) | held: not on the profile until the team approves; the owner sees it under "Being checked" in Edit profile and can remove it | held (`state = 'in_review'`), posted for a full 24 h once approved | arrives covered: "May contain nudity" with **View** and **Report** |
| `NUDITY_BLOCK` and over | refused at upload (`422 MEDIA_EXPLICIT`), files deleted | refused (`STORY_EXPLICIT`) | arrives covered |
| not checked (service down) | goes through as `unchecked` | goes through as `unchecked` | shown |

Chat media is never refused: a dating chat between consenting adults is the
receiver's choice, so it is covered rather than blocked.

**Videos:** up to 8 frames spread over the whole video (ffmpeg). The video's
score is its second highest frame (with 4 or more frames), so one odd frame
can't flag a clothed video, while anything explicit for more than a moment still does.

## The team

Admin panel > **Flagged media** (`GET /admin/panel/media`, `POST /admin/panel/media/:id/decide`):

- **Approve**: the photo is added (if the profile has fewer than 6), the video
  becomes the profile video, the Story is posted. The person is told.
- **Remove**: the files are deleted (also from the profile if it was already
  up), and the person is told, with the note if one was written.

## Edge cases

- **Service down:** the upload is never held up. It is saved as `unchecked` and
  `MediaModerationService.rescanUnchecked` (hourly, from the verification
  reminders worker) checks it later: clear → done; borderline → waits for the
  team (it stays up meanwhile); explicit → taken down and the person told.
- **Repeat offenders:** 3 refused uploads in 7 days open a high-priority report
  case on the person (`NudityService.recordStrike`), once. The case has no
  reports; the Reports page says it was opened automatically.
- **Withdraw:** the owner can remove a held photo or video
  (`DELETE /profile/pending-media/:id`); its files are deleted.
- **Existing media:** `npm run nudity:backfill -w apps/api` reports scores for
  everything already uploaded (add `-- --write` to act on them).

## Thresholds

`NUDITY_REVIEW` and `NUDITY_BLOCK` in the API `.env`. Set from real photos:
ordinary clothed photos scored 0.001-0.011, with one close-up lying on a
pillow at 0.33 (the pose, not nudity); explicit photos 1.000. If the team approves most of what reaches Flagged media, raise
`NUDITY_REVIEW`; if something explicit gets through, lower it. Run the backfill
report after changing them.

## The model

`apps/face-service/scripts/fetch-nudity-model.sh` downloads the model (an
EVA-02 vision transformer) and converts it to ONNX (`models/nsfw_freepik.onnx`,
~358 MB, not in git), checking the copy matches the original. Input: 448×448,
squashed, bicubic, CLIP mean/std. Output: logits for
`[neutral, low, medium, high]`. About 1 s per image on CPU.
