# Privacy notice

OBS Setup Assistant runs on your computer. You can enter an encoder and upload speed manually and get a recommendation offline.

| When you choose | What the app uses | Where it goes |
| --- | --- | --- |
| **Scan this PC** | CPU and GPU model names, core count, RAM, OBS version, canvas height, and available encoders. The scanner checks Windows and reads up to the first 8 MiB of each of up to three recent OBS logs as needed. It keeps only the listed fields from the log. | From the local app to this browser tab over the local computer address. |
| **Test sustained upload** | Generated test bytes and the timing of the HTTPS requests. Cloudflare receives the source IP address and standard connection and request information. Up to 256 MiB of test payload is sent. | Cloudflare's speed test endpoint. The app calculates the result on your PC. |
| **Recommend settings** | Your platform, content type, canvas, encoder, upload speed, and any upload ceiling. | Calculated in the browser tab. |
| **Copy settings** | The recommended OBS settings. | Your system clipboard. Windows may keep clipboard history or sync it if you enabled those features. |

The app keeps inputs and results in the current tab's memory. **Clear session** resets the displayed information and cancels the app's in-progress upload request. Reloading or closing the tab drops the current results. Previously copied settings stay in the system clipboard until replaced or cleared. Windows, the browser, and Cloudflare handle their own history and records.

The app includes no analytics, accounts, cookies, or saved profiles. It reads OBS logs for hardware detection and leaves OBS profile files alone. The only external request made by the app is the optional speed test. If you open an external reference link, your browser connects to that site.

Cloudflare handles information it receives under its own policy. For questions about Cloudflare's retention, processing locations, or your choices, consult the [Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/).

For project questions, use the [repository's issue tracker](https://github.com/theyallluvola/obs-setup-assistant/issues). GitHub issues are public. Describe the issue without including OBS logs, stream keys, IP addresses, or other private information.
