# X / Twitter → VRChat

`twitter-to-vrc.user.js` is a Violentmonkey userscript. It adds a VRChat button to the right of **Share** on posts that contain a video.

## Repository

The published userscript and its updates are available in [neura-neura/userscripts](https://github.com/neura-neura/userscripts).

When clicked, it detects the highest-bitrate progressive MP4 variant that X returns in its API response, copies its URL to the clipboard, and shows a notification. Paste it into a VRChat video player's URL field.

## Installation

1. Install [Violentmonkey](https://violentmonkey.github.io/).
2. Open [twitter-to-vrc.user.js](./twitter-to-vrc.user.js) from File Explorer and accept its installation in Violentmonkey.
3. After installing or updating the script, reload the X/Twitter tab. Open a post with a video, play it for a few seconds, and click the new button next to **Share**.

## Notes

- The script does not use an intermediary server or download the video. It intercepts data that X already sends to the browser and selects the highest-bitrate progressive MP4.
- X's `<video>` element uses a local `blob:` URL that does not work in VRChat. X's HLS playlist uses fragmented MP4 segments and may be corrupted in external players, so the script does not copy it.
- If the notification says that X did not expose an MP4, reload the post after updating the script and play the video again. Interception must be active before X requests the post data.
- X changes its interface frequently. The button is anchored to the accessible Share button and supports both the classic action group and the current button row.
