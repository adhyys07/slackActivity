using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SlackActivityTray
{
    internal static class Program
    {
        private static Mutex mutex;
        private static Process agentProcess;
        private static NotifyIcon tray;
        private static System.Threading.Timer monitorTimer;
        private const string AgentPayloadMarker = "SLACK_ACTIVITY_AGENT_PAYLOAD_V2";
        private static string logPath;
        private static bool cleanupStarted;

        [STAThread]
        private static void Main()
        {
            bool created;
            mutex = new Mutex(true, "SlackActivityLocalAgentTray", out created);
            if (!created)
            {
                MessageBox.Show(
                    "Slack Activity is already running in the system tray.",
                    "Slack Activity",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            logPath = Path.Combine(GetRuntimeDir(), "SlackActivityTray.log");
            Log("Tray starting from " + Application.ExecutablePath);

            StartAgent();
            CreateTray();
            SystemEvents.SessionEnding += delegate { Cleanup(); };
            monitorTimer = new System.Threading.Timer(CheckAgent, null, 5000, 5000);
            Application.Run();
            Cleanup();
        }

        private static void StartAgent()
        {
            string appDir = GetRuntimeDir();
            string agentPath = ExtractAgent(appDir);
            Log("Starting agent " + agentPath);

            agentProcess = new Process();
            agentProcess.StartInfo.FileName = agentPath;
            agentProcess.StartInfo.WorkingDirectory = appDir;
            agentProcess.StartInfo.UseShellExecute = false;
            agentProcess.StartInfo.CreateNoWindow = true;
            agentProcess.StartInfo.RedirectStandardInput = true;
            agentProcess.Start();
            Log("Started agent pid " + agentProcess.Id);
        }

        private static string GetRuntimeDir()
        {
            string portableDir = AppDomain.CurrentDomain.BaseDirectory;
            if (CanWriteToDirectory(portableDir)) return portableDir;

            string appDataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SlackActivity"
            );
            Directory.CreateDirectory(appDataDir);
            return appDataDir;
        }

        private static bool CanWriteToDirectory(string dir)
        {
            try
            {
                string testFile = Path.Combine(dir, ".slack-activity-write-test");
                File.WriteAllText(testFile, "ok");
                File.Delete(testFile);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static string ExtractAgent(string appDir)
        {
            string agentPath = Path.Combine(appDir, "slack-activity-agent-win-x64.exe");
            string selfPath = Application.ExecutablePath;
            byte[] exeBytes = File.ReadAllBytes(selfPath);
            byte[] markerBytes = Encoding.ASCII.GetBytes(AgentPayloadMarker);
            int footerLength = markerBytes.Length + 8;

            if (exeBytes.Length < footerLength)
            {
                ShowMissingAgentError();
            }

            int markerIndex = exeBytes.Length - markerBytes.Length;
            int sizeIndex = markerIndex - 8;

            for (int i = 0; i < markerBytes.Length; i++)
            {
                if (exeBytes[markerIndex + i] != markerBytes[i])
                {
                    ShowMissingAgentError();
                }
            }

            long payloadLengthLong = BitConverter.ToInt64(exeBytes, sizeIndex);
            Log("Extract footer payload length " + payloadLengthLong.ToString() + " from " + selfPath);
            if (payloadLengthLong <= 0 || payloadLengthLong > sizeIndex)
            {
                ShowMissingAgentError();
            }

            int payloadLength = (int)payloadLengthLong;
            int payloadStart = sizeIndex - payloadLength;
            byte[] payload = new byte[payloadLength];
            Buffer.BlockCopy(exeBytes, payloadStart, payload, 0, payloadLength);
            File.WriteAllBytes(agentPath, payload);
            Log("Wrote agent bytes " + payloadLength.ToString() + " to " + agentPath);

            return agentPath;
        }

        private static void Log(string message)
        {
            try
            {
                if (logPath == null) return;
                File.AppendAllText(logPath, "[" + DateTime.UtcNow.ToString("o") + "] " + message + Environment.NewLine);
            }
            catch {}
        }

        private static void ShowMissingAgentError()
        {
            MessageBox.Show(
                "The embedded local agent is missing from SlackActivity.exe.",
                "Slack Activity",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            Environment.Exit(1);
        }

        private static void CreateTray()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open Slack Activity", null, delegate { OpenUrl("https://slackactivity-c162e24cca07.herokuapp.com"); });
            menu.Items.Add("Restart Agent", null, delegate { RestartAgent(); });
            menu.Items.Add("Exit", null, delegate { Application.Exit(); });

            tray = new NotifyIcon();
            tray.Icon = SystemIcons.Application;
            tray.Text = "Slack Activity";
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            tray.DoubleClick += delegate { OpenUrl("https://slackactivity-c162e24cca07.herokuapp.com"); };
            tray.BalloonTipClicked += delegate { OpenUrl("https://slackactivity-c162e24cca07.herokuapp.com"); };
            tray.ShowBalloonTip(8000, "Slack Activity is running", "Use the tray icon to restart or exit. Click this message to open setup.", ToolTipIcon.Info);
            MessageBox.Show(
                "Slack Activity started and is running in the system tray.",
                "Slack Activity",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
        }

        private static void OpenUrl(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch {}
        }

        private static void RestartAgent()
        {
            StopAgent(false);

            StartAgent();
            tray.ShowBalloonTip(2000, "Slack Activity", "Local activity detection restarted.", ToolTipIcon.Info);
        }

        private static void CheckAgent(object state)
        {
            if (agentProcess == null || agentProcess.HasExited)
            {
                StartAgent();
                if (tray != null)
                {
                    tray.ShowBalloonTip(2000, "Slack Activity", "Local activity detection restarted after it stopped.", ToolTipIcon.Warning);
                }
            }
        }

        private static void Cleanup()
        {
            if (cleanupStarted) return;
            cleanupStarted = true;
            if (monitorTimer != null) monitorTimer.Dispose();

            if (tray != null)
            {
                tray.Visible = false;
                tray.Dispose();
            }

            StopAgent(true);

            if (mutex != null) mutex.Dispose();
        }

        private static void StopAgent(bool clearStatus)
        {
            if (agentProcess == null) return;

            if (!agentProcess.HasExited)
            {
                if (clearStatus)
                {
                    try
                    {
                        Log("Requesting graceful agent shutdown");
                        agentProcess.StandardInput.WriteLine("shutdown");
                        agentProcess.StandardInput.Flush();
                    }
                    catch (Exception ex)
                    {
                        Log("Failed to request graceful shutdown: " + ex.Message);
                    }

                    try
                    {
                        if (agentProcess.WaitForExit(5000))
                        {
                            Log("Agent exited gracefully");
                        }
                        else
                        {
                            Log("Agent did not exit gracefully before timeout");
                        }
                    }
                    catch (Exception ex)
                    {
                        Log("Failed waiting for agent shutdown: " + ex.Message);
                    }
                }

                if (!agentProcess.HasExited)
                {
                    try
                    {
                        agentProcess.Kill();
                        Log("Killed agent process");
                    }
                    catch (Exception ex)
                    {
                        Log("Failed to kill agent process: " + ex.Message);
                    }
                }
            }

            agentProcess.Dispose();
            agentProcess = null;
        }
    }
}
