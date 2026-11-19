# OBS Setup Assistant

A local Windows app that recommends OBS Studio settings for standard YouTube and Twitch streams. It checks the latest OBS log for available encoders, reads PC hardware, and combines the results with your upload speed, canvas, and stream content.

## Run on Windows

1. Download and extract the Windows x64 ZIP from [GitHub Releases](https://github.com/theyallluvola/obs-setup-assistant/releases/latest). Double-click **OBS-Setup-Assistant-Desktop.exe**. It uses the Microsoft Edge WebView2 Runtime installed on your PC.
2. Choose YouTube or Twitch, then Gameplay or Just Chatting. Enter a steady upload result or select **Test sustained upload**. You can set an optional upload ceiling if you know how the connection behaves after an initial speed burst.
3. Select **Recommend settings**. Copy the result or enter it in OBS under **Settings → Video** and **Settings → Output → Streaming (Advanced)**.
4. To save the recommendation to OBS, select **Create OBS profile**, review the values, and confirm. Reopen OBS if it was running, select the new profile from the **Profile** menu, and connect your streaming account or enter your key in OBS.
   To use your existing profile, select it in OBS and make sure its streaming service matches your recommendation. Close OBS, choose **Apply to current OBS profile**, review the profile name and settings, and confirm. The assistant saves a backup inside the profile folder and shows its location. Reopen OBS to use the updated settings.
5. After applying the settings, select **Start log check**. Start a test stream in OBS, run your usual scene for at least 30 seconds, then stop the stream and select **Check test results**. The assistant looks for network drops, rendering lag, and encoding skips in the new log entries.
6. Select **Settings still aren’t right** whenever you want the next fallback. It keeps the same base canvas and encoder and reduces the output resolution, frame rate, or video bitrate. Copy it, save it as a new profile, or apply it to the current profile, then test again.

Open OBS at least once and use **Scan this PC** to confirm the encoders. The encoder selector also accepts manual choices. Choose one OBS actually lists.

The sustained test uploads generated sample data to Cloudflare for about 20 seconds, with a 256 MiB cap. It excludes at least the first eight seconds, then reports the slower of two six-second measurement windows. If it reaches the data cap too early, enter a steady upload result manually. The app budgets 70% of the lower of the upload result and your optional ceiling, including audio.

The upload result measures the route to Cloudflare. The OBS log check covers frame statistics during a test stream. Review audio, visual quality, and viewer playback separately. The manual fallback works when OBS logs are missing or incomplete.

The app runs locally and keeps results in the current window or browser tab. Creating a profile writes a new profile under the standard Windows OBS configuration folder after you confirm. See the [privacy notice](PRIVACY.md) and [privacy and release review](COMPLIANCE.md). The current version covers SDR streams up to 1440p on YouTube and 1080p on standard Twitch broadcasting.

## Development

To run the browser version from source, use Node.js 22 or newer and double-click **Start OBS Setup.cmd**, or run `npm start` and open the local address printed in the terminal. Keep the launcher running while using this version. Run `npm test` for the automated tests. No npm runtime dependencies are required.

To build the desktop executable, use Windows x64 with Node.js **24.18.0** and a .NET SDK that targets **.NET 10**. Run `./scripts/build-desktop.ps1` in PowerShell. It builds the recommendation engine and bundles it with the WinForms window, the interface assets, and the .NET runtime. The desktop window talks to the engine over private process pipes. The unsigned executable is placed beside the project directory by default. Pass `-OutputPath` to set a different path.

See [Publishing a release](RELEASING.md) for packaging and uploading a versioned Windows build.

## References

- [YouTube live encoder settings](https://support.google.com/youtube/answer/2853702)
- [Twitch broadcasting guidelines](https://help.twitch.tv/s/article/broadcasting-guidelines?language=en_US)
- [OBS Studio connection troubleshooting](https://obsproject.com/kb/stream-connection-troubleshooting/)
- [Cloudflare speed test endpoints](https://github.com/cloudflare/speedtest)

## License

Copyright © 2026 Olaoluwa Igun. OBS Setup Assistant is licensed under the [GNU General Public License, version 3](LICENSE) (`GPL-3.0-only`).

You can use the app to configure OBS for monetized streams. You can also share or sell copies, including modified copies, under the GPLv3 terms. Recipients must receive or be able to obtain the corresponding source code and may redistribute it under the same license.
