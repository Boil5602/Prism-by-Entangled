# B-518: what Safari on the iPhone does on Facebook's feed (2026-11-22)

Looked at by the Mac session under rule 5 of `docs/safari-mac-session.md`. No shared code was changed. The Windows session makes
the fix from this.

## Short answers

1. **What Facebook does to the post when a video ad's video starts: nothing to that post.** The feed has one `<video>` element for
   the whole page. Facebook takes it out of the post it was in and puts it into the next post that should play (one node, moved
   15 times in 174 s, always the same node). The post that receives it is not replaced, its children are not redrawn and its style
   is not rewritten. The reading in the B-518 row (the post is swapped for a new copy when its video starts) is **refuted for the
   post that plays**. What is swapped is the posts **above** it: see 2.
2. **What happens to the cover: the cover of the playing post stays. Covers of posts above are taken out with their posts.**
   Facebook replaces posts it has scrolled past with fresh nodes, one for one, in a batch (10 batches in 174 s, 1 to 6 posts
   each). The old node goes with its cover inside it. PRISM puts a cover on the new node in the same turn (same millisecond in
   the log, same picture), but the new cover **starts at opacity 0 and fades to 1 over about 200 ms**. Twice in the run a replaced
   post was still partly on the screen (171 px and 99 px of it at the top), and the ad showed through its fading cover: opacity
   0.24 at 11 ms, 0.50 at 35 ms, 0.77 at 70 ms, 0.93 at 111 ms, 1 at 194 ms. That is the measured flash.
3. **The cover in place and the video still showing: not seen in the page's own readings.** At every video event and every frame
   in which the video was in a covered post, the cover was in place at opacity 1, it was the topmost element at the video's centre,
   and the video was the 5 by 6 px speck. The owner saw more flashes than the two fades the log holds (several covered video ads in
   a row at the end of the run). For those the page shows nothing wrong, so they are either a paint the page cannot report (the
   video drawn above the cover for a frame as its source changes) or fades the recorder left out (see Limits). Not settled here.
4. **Times, for the flash at 117.3 s:** see the table under "One flash, in order".

Two more things found on the way, both for the Windows session:

- **The speck stays on the video after it leaves a covered post.** In run 2 the shrink styles went onto the video at 78.258 s and
  were not taken off for the rest of the run (96 s). At 88.078 s the video moved into a post with no cover and played there as a
  5 by 6 px speck for 1.36 s (the post showed its poster picture, then nothing moving). In run 1 the styles were taken off twice
  (84.795 s and 95.999 s), each time just before a move, so it is not always so. The log does not say what decided it.
- **Facebook refuses PRISM's pictures from the network.** 39 console errors in run 2: "Refused to load
  https://prism.entangled.world/veil/art/... because it does not appear in the img-src directive of the Content Security Policy"
  (32 under `/veil/art/`, 5 under `/veil/art/cosmos/`, 2 under `/veil/art/gallery/`). Each new cover was first given a network
  picture and had its `background` rewritten to another one about 36 ms later (117.274 s added with `nasa-PIA07902.jpg`,
  117.310 s rewritten). On this site every cover costs one refused request and one change of picture.

## Method

Method A of the task: the real iPhone. iPhone on iOS 27.2.1, Safari, Facebook's feed signed in by the owner, the PRISM extension
from TestFlight (the build on the phone was not read; a remade cover kept its picture, which is 0.9.63's behaviour). The phone
was passed through to the VM over USB, Web Inspector turned on, and the tab opened from Safari's Develop menu on the Mac. No tool
was installed. A recorder was pasted into the inspector's console; it only observes. The owner scrolled; the log was printed to
the console and the console saved to a file.

The recorder (second version, used for run 2):

- a MutationObserver on `#screen-root` (childList, subtree, the `style` attribute with its old value), logging every added or
  removed node that is or holds a `<video>` or a `data-prism-veil` element, with the parent, how many nodes the same record added
  and removed, and rectangles;
- capture listeners for `emptied`, `loadstart`, `loadedmetadata`, `loadeddata`, `play`, `playing`, `pause`;
- once per frame: the video's post, its rectangle, the cover in that post (opacity, clip, picture) and the topmost element at
  the video's centre; and for every cover with 60 px or more on the screen, its opacity, picture and the topmost element at its
  centre. A line is logged when any of these changes.

Times are `performance.now()` in the page, given below in seconds from the start of the recording. Run 1 (414 events, 141 s) used
a first version without the per-frame readings; run 2 (538 events, 174 s, viewport 440 by 836) is the one quoted unless said.

## One flash, in order (run 2, 117.0 to 117.5 s)

Post A is the covered video ad the owner had stopped on (post 151, cover 152). Post B is the next covered video ad (post 153,
cover 154). The owner scrolls from A to B.

| Time (s) | After the move | What happened |
|---|---|---|
| 117.054 | | Video in A, playing, a speck. A is at top -397, so 334 px of it are still on the screen. Cover 152 at opacity 1. |
| 117.073 | 0 ms | Facebook removes the `<video>` from A's holder and adds the same node to B's holder (two childList records). |
| 117.081 | +8 ms | `emptied` on the video, now in B. B's cover 154 is at opacity 1 and topmost. The video is still a speck (the styles came with it). |
| 117.084 | +11 ms | `loadstart`. |
| 117.300 | +227 ms | Facebook replaces five posts above, A among them: on the feed container (97 children) five records, each one node out and one node in. A (node 151) goes out with cover 152 inside it. Its new copy (node 198) is at top -560: 171 px on the screen. |
| 117.300 | +227 ms | PRISM adds covers to the five new copies in the same turn. Cover 204 on A's copy has A's old picture. Its style goes `opacity: 0` then `1` in the same turn; the transition runs from there. |
| 117.311 | +238 ms | First frame with cover 204: opacity 0.24. The new copy of A shows through. |
| 117.317 | +244 ms | `play` on the video in B. Cover 154 at 1, topmost, video a speck. |
| 117.335 | +262 ms | Cover 204 at 0.50. |
| 117.368 | +295 ms | `playing` in B. Cover 204 at about 0.75. |
| 117.494 | +421 ms | Cover 204 at 1 (194 ms after it was added). |

So for the post that plays (B): the video element appears at 117.073, `play` at +244 ms, `playing` at +295 ms, and its cover never
goes. For the post just left (A): the cover goes at +227 ms with the post, comes back in the same turn, and is opaque 194 ms later.

The second fade on the screen: 128.802 s, two posts replaced 5033 ms after the last move of the video, one with 99 px on the
screen; its new cover was at 0.94 when first read 52 ms later and at 1 after 124 ms.

## The batches (run 2)

| Time (s) | Posts in | Replaced one for one | Since the video last moved | Covers added in the same turn | A replaced post on the screen |
|---|---|---|---|---|---|
| 23.604 | 1 | 1 | no move yet | 1 | no |
| 73.734 | 6 | 6 | 1511 ms | 6 | no |
| 74.741 | 1 | 1 | 2518 ms | 0 | no |
| 78.808 | 1 | 1 | 566 ms | 1 | no |
| 78.809 | 1 | 1 | 567 ms | 1 | no |
| 88.153 | 6 | 4 | 75 ms | 6 | no |
| 103.826 | 2 | 2 | 2540 ms | 2 | no |
| 103.827 | 3 | 3 | 2541 ms | 3 | yes, 52 px |
| 117.300 | 5 | 5 | 227 ms | 5 | yes, 171 px |
| 128.802 | 2 | 2 | 5033 ms | 2 | yes, 99 px |

The time since the video moved runs from 75 ms to 5 s, so the replacement is not tied to the video's start. It is Facebook
redrawing posts it has passed; whether one of them is still on the screen depends on how far the page has scrolled. Run 1 shows
the same: one video node moved five times, batches of new post nodes at 28.630, 39.497, 49.748, 57.360 and 82.908 s, each with
its covers added in the same millisecond.

## The first shrink of the video

The first time the video enters a covered post it is still full size: run 2, 78.250 s `emptied` at 440 by 550 under cover 71
(opacity 1, topmost at the video's centre), and the speck styles arrive at 78.258 s, 8 ms later, at `loadedmetadata`. Run 1: added
at 54.012 s at full size, the styles at 54.030 s, 18 ms later. The video had no frame yet in that window (`readyState` 0).

## What the owner saw

- A flash, then the cover steady again, on several covered video ads in a row near the end of run 2 (the owner stopped about five
  seconds on each). The log has two fades on the screen in that stretch (117.300 and 128.802 s) and no other change to a cover on
  the screen.
- In run 1, a Play button drawn on top of a cover. The recorder never read a Play button as the topmost element over a cover. In
  an uncovered post Facebook's `BUTTON` with the label "Play video" (56 by 56 px) is topmost at the video's centre while the video
  is paused, and a new copy of a post has it too, so it is what shows through a fading cover on a new copy.

## Limits

- The page's readings say what is in the tree, its styles and what a hit test returns. They do not say what was painted. Question
  3 is answered only as far as that goes.
- The per-frame reading left out covers with less than 60 px on the screen, and a fade is only caught if a frame falls in it. A
  fade on a thinner strip was not recorded (103.827 s had 52 px).
- The removals are the page's own records; the recorder cannot name the script that made them. That Facebook makes the batch
  replacements is read from their shape (the feed container's own children, one out and one in), not from a stack.
- Nothing was changed on the page or the account. The tab was reloaded once from the inspector between the runs.

## For the fix (the Windows session's to judge)

- A cover put back where one stood (the same-picture case of B-518) could come up at opacity 1 at once, with no fade.
- The speck's styles could come off the video when it leaves a covered element.
- On Facebook the first picture could be a bundled one, so no request is refused and no picture changes after the cover is up.
