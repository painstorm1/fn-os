using System;
using System.Diagnostics;
using System.Net.Sockets;
using System.Threading;

class FnOsStart
{
    const string FnOsDir = @"D:\Codex_work\FN_WORK_APP\FN_OS";
    const string NodeExe = @"C:\Program Files\nodejs\node.exe";
    const string FnOsUrl = "http://localhost:3000";

    static int Main()
    {
        try
        {
            if (!IsPortOpen("127.0.0.1", 3000))
            {
                StartHidden(
                    NodeExe,
                    "\"node_modules\\next\\dist\\bin\\next\" dev -H 127.0.0.1 -p 3000",
                    FnOsDir,
                    "FN OS"
                );
            }

            WaitForPort(3000, 20000);
            OpenBrowser(FnOsUrl);
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine("FN OS start failed.");
            Console.WriteLine(ex.Message);
            Console.WriteLine();
            Console.WriteLine("Press Enter to close.");
            Console.ReadLine();
            return 1;
        }
    }

    static void StartHidden(string fileName, string arguments, string workingDir, string title)
    {
        var psi = new ProcessStartInfo(fileName, arguments)
        {
            WorkingDirectory = workingDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        psi.EnvironmentVariables["FN_OS_PROCESS_TITLE"] = title;
        Process.Start(psi);
    }

    static bool WaitForPort(int port, int timeoutMs)
    {
        var start = Environment.TickCount;
        while (Environment.TickCount - start < timeoutMs)
        {
            if (IsPortOpen("127.0.0.1", port)) return true;
            Thread.Sleep(500);
        }
        return false;
    }

    static bool IsPortOpen(string host, int port)
    {
        try
        {
            using (var client = new TcpClient())
            {
                var result = client.BeginConnect(host, port, null, null);
                var success = result.AsyncWaitHandle.WaitOne(250);
                if (!success) return false;
                client.EndConnect(result);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    static void OpenBrowser(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
}
