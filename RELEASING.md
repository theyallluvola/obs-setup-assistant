# Publishing a release

1. Update the version in `package.json` and commit the release changes. Run `npm test`, then launch the Windows build and verify recommendations, profile creation, and stream testing using an isolated OBS profile folder.
2. On Windows x64, follow the build prerequisites in the [README](README.md) and run `./scripts/build-desktop.ps1` at that commit.
3. Create a ZIP named `OBS-Setup-Assistant-v<VERSION>-Windows-x64.zip`. Include `OBS-Setup-Assistant-Desktop.exe`, the project [LICENSE](LICENSE), [README.md](README.md), [PRIVACY.md](PRIVACY.md), and the license and notice files for the embedded Node.js and .NET runtimes, the WebView2 SDK, and the Silkscreen font. Use the notices from the actual versions used in the build.
4. Generate a SHA-256 checksum of the ZIP and include it in the release notes or attach a `.sha256` file.
5. Push the source commit and publish a GitHub release tagged `v<VERSION>` on that exact commit. Attach the Windows ZIP and add what changed, the WebView2 requirement, and the executable's signing status. GitHub supplies source archives for the tag.
6. Open the public [Releases page](https://github.com/theyallluvola/obs-setup-assistant/releases) and confirm that the Windows ZIP and source links appear under that version.
