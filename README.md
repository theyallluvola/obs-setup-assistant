# OBS Setup Assistant

A local Windows app that recommends OBS Studio settings for standard YouTube and Twitch streams. It checks the latest OBS log for available encoders, reads PC hardware, and combines the results with your upload speed, canvas, and stream content.

## Run on Windows

1. Install [Node.js](https://nodejs.org/) version 22 or newer.
2. Download or clone the repository and double-click **Start OBS Setup.cmd**. Keep the launcher window open while using the app.
3. Choose YouTube or Twitch, then Gameplay or Just Chatting. Enter a steady upload result or select **Test sustained upload**. You can set an optional upload ceiling if you know how the connection behaves after an initial speed burst.
4. Select **Recommend settings**. Copy the result or enter it in OBS under **Settings → Video** and **Settings → Output → Streaming (Advanced)**.

Open OBS at least once and use **Scan again** if the app cannot confirm the encoders. The encoder selector also accepts manual choices. Choose one OBS actually lists.

The sustained test uploads generated sample data to Cloudflare for about 20 seconds, with a 256 MiB cap. It excludes at least the first eight seconds, then reports the slower of two six-second measurement windows. If it reaches the data cap too early, enter a steady upload result manually. The app budgets 70% of the lower of the upload result and your optional ceiling, including audio.

The result measures the route to Cloudflare. Test your actual scene against the streaming service and check dropped frames under **View → Stats**.

The app listens locally on your PC. It does not store scan results, read stream credentials, or change OBS profiles. The current version covers SDR streams up to 1440p on YouTube and 1080p on standard Twitch broadcasting.

## Development

Run `npm start` and open the local address printed in the terminal. Run `npm test` for the recommendation and detection tests. No npm dependencies are required.

## References

- [YouTube live encoder settings](https://support.google.com/youtube/answer/2853702)
- [Twitch broadcasting guidelines](https://help.twitch.tv/s/article/broadcasting-guidelines?language=en_US)
- [OBS Studio connection troubleshooting](https://obsproject.com/kb/stream-connection-troubleshooting/)
- [Cloudflare speed test endpoints](https://github.com/cloudflare/speedtest)
