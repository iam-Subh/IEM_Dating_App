# 2D face turn animation

The current introduction page uses only `face-front-2d.png`, a static front pose from the left source sheet. It has no video player or head rotation. The animation notes below describe the earlier asset.

Created with the built-in imagegen tool. The app uses the rendered local video.

Source sheets: face-turn-2d-sheet.png and face-turn-2d-right-sheet.png.
Video: face-turn-2d-v3.mp4. Static poster: face-turn-2d-v3-poster.png.

The build script crops the sheets and aligns the head at its neck pivot. A jaw reference for each pose excludes the generated neck. One fixed neck and shoulder layer sits below the moving head. Connected hair pixels preserve the hair behind the ears. The last left row is excluded because its smaller head makes the neck appear longer. The video contains 34 head poses in 219 frames at 30 frames per second. Each frame contains one head pose. The script does not blend faces, warp the portrait, or use a 3D model.

Build: node apps/mobile/scripts/build-face-turn-2d.cjs

## Left sequence prompt

Use case: identity-preserve
Input image: reference character. Keep this exact 2D character, face, short brown hair, warm light tan skin, plum shirt and drawing style.
Create a professional 2D head-turn animation sprite sheet with EXACTLY 5 columns and 5 rows, 25 equally sized square cells. Read left to right row by row. The sequence starts STRAIGHT FRONT in the top-left cell and gradually turns toward the viewer's LEFT until a mild 30 degree LEFT turn at the bottom-right. EVERY row continues from the previous row. This is ONE direction only, front to left, not a repeating cycle.
Top row: near-frontal poses, face almost symmetric and nose centered, head starts exactly straight at camera.
Second row: tiny left turns, both eyes fully visible, nose moves just a little left.
Third row: mild left turns, the right cheek becomes slightly wider, nose gradually moves left.
Fourth row: moderate left turns, distinct incremental changes in the hair silhouette, nose and far eye.
Fifth row: last five poses leading to a mild 30 degree left turn, not a profile and not a large three-quarter turn.
Draw every one of the 25 actual incremental face orientations: angles 0 through 30 degrees with tiny equal increments. Adjacent cells MUST look almost identical but the face changes by a tiny natural turn. Do NOT duplicate one three-quarter view across the whole sheet. Do NOT suddenly switch from front to side.
CRITICAL body invariants: shirt and shoulders are always absolutely FRONT FACING and identical in every cell. Only HEAD turns. Fixed neck base, fixed framing, fixed head height, no tilt, translation, camera movement or body rotation.
Match the attached character's proportions. Each head is centered at 50% cell width. Hair top at 6% cell height. Chin about 69% cell height, lower neck ends at 83%, shoulders below 82%. Solid completely flat #F3ECEE in every cell, no gradient, no texture, no cell borders, no white gutters, no captions, no text or numbers, no watermark.
Produce a square high resolution animation sheet. Clean 2D illustration, no 3D model.

## Right sequence prompt

Use case: identity-preserve
Input image 1 is the exact reference character. Input image 2 is the 25-frame LEFT turn sequence. Create the corresponding RIGHT turn sequence for the SAME character. Keep his identity, brown wavy hair arrangement, light warm tan complexion and plum shirt. Do not mirror the entire reference portrait; preserve the hairstyle's natural asymmetry.
Output one 5 by 5 sprite sheet with 25 equally sized square cells, read left to right row by row. Cell 1 is EXACTLY FRONT view, matching input image 1. Gradually turn ONLY the head toward the VIEWER'S RIGHT across the 25 cells, ending at a mild 30 degree RIGHT turn in cell 25. All intermediate head views must be incrementally different by tiny equal amounts. Face nose gradually moves to the RIGHT. The LEFT ear and LEFT cheek become more visible. The RIGHT ear and RIGHT eye gradually become less visible. The bottom-right pose faces RIGHT, not left.
Top row: face straight front becoming barely turned right. Second row: very slight right turns. Third row: mild right turns. Fourth row: moderate right turns. Fifth row: gentle 30 degree right turn. Each row CONTINUES the previous row; never reset to frontal at the start of a new row.
Shoulders and shirt face straight front and never rotate. Neck base fixed. Same head height and size. Same expression. Flat #F3ECEE background, no gutters, borders, captions, labels or decorations. Clean 2D editorial illustration. Head only turns on its neck, absolutely no camera movement, stretching, shoulder motion, tilt or zoom. Entire hair and ears inside each cell. High resolution square animation sprite sheet.
