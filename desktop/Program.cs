using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new AssistantWindow());
    }
}

internal sealed class AssistantWindow : Form
{
    private const string AppUrl = "https://obs-setup.invalid/";
    private const string PagePolicy = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
    private static readonly Assembly Assets = typeof(AssistantWindow).Assembly;
    private static readonly Dictionary<string, (string Name, string Type)> Resources = new()
    {
        ["/"] = ("index.html", "text/html; charset=utf-8"),
        ["/style.css"] = ("style.css", "text/css; charset=utf-8"),
        ["/app.js"] = ("app.js", "text/javascript; charset=utf-8"),
        ["/advisor.js"] = ("advisor.js", "text/javascript; charset=utf-8"),
        ["/assets/Silkscreen-Bold.ttf"] = ("Silkscreen-Bold.ttf", "font/ttf"),
        ["/assets/obs-setup.ico"] = ("obs-setup.ico", "image/x-icon")
    };
    private static readonly HashSet<string> Guides = new()
    {
        "https://www.cloudflare.com/privacypolicy/",
        "https://support.google.com/youtube/answer/2853702",
        "https://help.twitch.tv/s/article/broadcasting-guidelines?language=en_US",
        "https://obsproject.com/kb/stream-connection-troubleshooting/"
    };
    private readonly string sessionDirectory = Path.Combine(Path.GetTempPath(), $"obs-setup-{Guid.NewGuid():N}");
    private readonly WebView2 view = new() { Dock = DockStyle.Fill, AllowExternalDrop = false };
    private readonly Label startup = new()
    {
        Dock = DockStyle.Fill,
        Text = "Opening OBS Setup Assistant…",
        TextAlign = ContentAlignment.MiddleCenter
    };
    private readonly HashSet<int> pending = new();
    private Process? engine;
    private bool closing;

    public AssistantWindow()
    {
        Text = "OBS Setup Assistant";
        ClientSize = new Size(1240, 850);
        MinimumSize = new Size(420, 460);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        Icon = System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
        var dark = UsesDarkTheme();
        BackColor = startup.BackColor = view.DefaultBackgroundColor = dark ? Color.FromArgb(25, 26, 22) : Color.FromArgb(244, 239, 225);
        startup.ForeColor = dark ? Color.FromArgb(244, 239, 225) : Color.FromArgb(31, 30, 26);
        Controls.Add(view);
        Controls.Add(startup);
        startup.BringToFront();
        Shown += async (_, _) => await StartAsync();
    }

    private static bool UsesDarkTheme()
    {
        try
        {
            return Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                "AppsUseLightTheme", 1) is 0;
        }
        catch (System.Security.SecurityException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
        catch (IOException) { return false; }
    }

    private async Task StartAsync()
    {
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: Path.Combine(sessionDirectory, "display"),
                options: new CoreWebView2EnvironmentOptions("--disable-background-networking"));
            if (closing) return;
            await view.EnsureCoreWebView2Async(environment);
            if (closing) return;

            var web = view.CoreWebView2;
            web.Settings.AreDevToolsEnabled = false;
            web.Settings.AreDefaultContextMenusEnabled = false;
            web.Settings.AreBrowserAcceleratorKeysEnabled = false;
            web.Settings.IsStatusBarEnabled = false;
            web.AddWebResourceRequestedFilter(AppUrl + "*", CoreWebView2WebResourceContext.All,
                CoreWebView2WebResourceRequestSourceKinds.Document);
            web.WebResourceRequested += ServeResource;
            web.NavigationStarting += (_, e) =>
            {
                if (e.Uri == AppUrl) return;
                e.Cancel = true;
                if (e.IsUserInitiated) OpenGuide(e.Uri);
            };
            web.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                if (e.IsUserInitiated) OpenGuide(e.Uri);
            };
            web.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            web.WebMessageReceived += OnMessage;

            web.NavigationCompleted += (_, e) =>
            {
                if (closing) return;
                if (e.IsSuccess) startup.Hide();
                else startup.Text = "The interface could not load. Close and reopen OBS Setup Assistant.";
            };
            web.Navigate(AppUrl);
        }
        catch (Exception error)
        {
            if (closing) return;
            var message = error is WebView2RuntimeNotFoundException
                ? "Microsoft Edge WebView2 Runtime is required. Install it, then reopen OBS Setup Assistant."
                : "OBS Setup Assistant could not open.\n\n" + error.Message;
            MessageBox.Show(this, message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private static Stream OpenResource(string name) =>
        Assets.GetManifestResourceStream(name) ?? throw new InvalidOperationException("Missing bundled resource.");

    private void ServeResource(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var environment = view.CoreWebView2.Environment;
        if (e.Request.Method == "GET" && Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) &&
            Resources.TryGetValue(uri.AbsolutePath, out var resource))
        {
            e.Response = environment.CreateWebResourceResponse(OpenResource(resource.Name), 200, "OK",
                $"Content-Type: {resource.Type}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: {PagePolicy}");
            return;
        }
        e.Response = environment.CreateWebResourceResponse(null, 404, "Not Found", "");
    }

    private static void OpenGuide(string uri)
    {
        if (!Guides.Contains(uri)) return;
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception) { }
    }

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (e.Source != AppUrl || e.WebMessageAsJson.Length > 8192) return;
        using var json = JsonDocument.Parse(e.WebMessageAsJson);
        var data = json.RootElement;
        if (data.ValueKind != JsonValueKind.Object) return;
        if (data.TryGetProperty("cancel", out var cancel) && cancel.ValueKind == JsonValueKind.Number &&
            cancel.TryGetInt32(out var canceled) && pending.Remove(canceled))
        {
            await SendAsync(e.WebMessageAsJson);
            return;
        }
        if (!data.TryGetProperty("id", out var value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetInt32(out var id) || id <= 0 || !data.TryGetProperty("path", out var route) ||
            route.ValueKind != JsonValueKind.String) return;

        switch (route.GetString())
        {
            case "/desktop/clipboard":
                if (!data.TryGetProperty("body", out var text) || text.ValueKind != JsonValueKind.String) return;
                var settings = text.GetString()!;
                if (settings.Length == 0) return;
                try { Clipboard.SetText(settings, TextDataFormat.UnicodeText); Reply(id, true, new { }); }
                catch (System.Runtime.InteropServices.ExternalException) { Reply(id, false, new { error = "Clipboard unavailable." }); }
                break;
            case "/api/hardware":
            case "/api/upload":
            case "/api/profile":
            case "/api/stream-test":
                if (pending.Count >= 8 || !pending.Add(id))
                {
                    Reply(id, false, new { error = "Another request is running. Try again." });
                    return;
                }
                if (!await SendAsync(e.WebMessageAsJson, id) && !closing && pending.Remove(id))
                    Reply(id, false, new { error = "The assistant engine is unavailable. Reopen the app to try again." });
                break;
        }
    }

    private readonly SemaphoreSlim pipeLock = new(1);

    private async Task StartEngineAsync()
    {
        Directory.CreateDirectory(sessionDirectory);
        var executable = Path.Combine(sessionDirectory, "engine.exe");
        await using (var resource = OpenResource("engine.exe"))
        await using (var file = File.Create(executable))
            await resource.CopyToAsync(file);
        if (closing) return;
        engine = Process.Start(new ProcessStartInfo(executable, "--desktop-bridge")
        {
            WorkingDirectory = sessionDirectory,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            StandardInputEncoding = new UTF8Encoding(false),
            StandardOutputEncoding = Encoding.UTF8,
            CreateNoWindow = true
        }) ?? throw new InvalidOperationException("The assistant engine could not start.");
        _ = ReadRepliesAsync(engine);
    }

    private async Task<bool> SendAsync(string message, int? requestId = null)
    {
        await pipeLock.WaitAsync();
        try
        {
            if (closing) return false;
            if (engine == null && requestId is not null) await StartEngineAsync();
            if (closing || engine == null || engine.HasExited) return false;
            if (requestId is int id && !pending.Contains(id)) return true;
            await engine.StandardInput.WriteLineAsync(message);
            return true;
        }
        catch (IOException) { return false; }
        catch (InvalidOperationException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
        catch (System.ComponentModel.Win32Exception) { return false; }
        finally { pipeLock.Release(); }
    }

    private async Task ReadRepliesAsync(Process process)
    {
        try
        {
            while (await process.StandardOutput.ReadLineAsync() is { } line && !closing)
            {
                using var json = JsonDocument.Parse(line);
                var id = json.RootElement.GetProperty("id").GetInt32();
                if (pending.Remove(id)) view.CoreWebView2.PostWebMessageAsJson(line);
            }
        }
        catch (IOException) { }
        catch (ObjectDisposedException) { }
        finally
        {
            if (!closing)
            {
                foreach (var id in pending) Reply(id, false, new { error = "The assistant engine closed. Reopen the app to try again." });
                pending.Clear();
            }
        }
    }

    private void Reply(int id, bool ok, object payload) =>
        view.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, ok, payload }));

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        closing = true;
        if (engine != null)
        {
            try
            {
                engine.StandardInput.Close();
                if (!engine.WaitForExit(800)) { engine.Kill(entireProcessTree: true); engine.WaitForExit(800); }
            }
            catch (InvalidOperationException) { }
            finally { engine.Dispose(); }
        }
        view.Dispose();
        try { Directory.Delete(sessionDirectory, recursive: true); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        base.OnFormClosed(e);
    }
}
