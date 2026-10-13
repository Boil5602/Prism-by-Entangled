# The page chrome watch

"Are we able to test different scenarios and find where adapters and examples of end user behaviors may be bringing websites and
chrome into the video players?" (2026-10-11)

## What it is

Every fifteen seconds the host asks each video window's page, in the page's own words, whether its video fills the window and what
stands over the middle of it (`MainWindow.ChromeWatch.cs`). The answer is logged to host.log when it changes, one line a window:

    page chrome youtube-tv-home-16x9-XL-w2: page, video 0%, /feed/library "Library - YouTube TV"
    page chrome screen: overlay, video 100%, over DIV.profile-gate "Who's watching?"
    page chrome screen: video, 100%

- **video**: the largest video element covers 60% or more of the window.
- **page**: it does not. A home page, a title page, a sign-in page, an error page, a search.
- **overlay**: the video is there, but the element at the middle of the window is not it and has words on it: a profile gate, a
  still-watching prompt, a banner. A player's own control bar over a paused video has no words at the middle and reads as video.

The hourly check (`scripts/breakwatch/hourly.py`) sums each window's time on a page or under an overlay, how many times, and the
last line. Nothing leaves the PC. The words logged are the page's own at the middle of the window, cut to sixty characters; a
report's log excerpt carries them like any line.

A page in its first minute (its own `performance.now()` under 60 s) is still loading and gives no reading: every restart had shown as a minute or two of page chrome.

## What came first

Five days of the break watch's recordings (every YouTube TV window, a picture a second with its words read) were swept for a page's
own chrome (`scripts/breakwatch/chrome_sweep.py`): sign-in pages, profile gates, home rows, error pages, cookie banners,
next-episode prompts, the service's navigation. None was found. Every match was broadcast content: a network's "Log in with your
TV provider" promo, an ad, a joke caption. The recordings cover YouTube TV alone, which is why the watch was built: the other
services, where gates and prompts live, are seen only this way.

## Not done

- Scenario walks per service (pausing, the end of an episode, the profile gate, a session expiring, a service's own popup) wait
  on what the watch shows. They would run on hidden pages, read-only, with trailers, never a show the household watches.
- The watch reads the window's page only: a cover Prism draws itself, a stage curtain or the Watch page are not pages and are not
  counted.
