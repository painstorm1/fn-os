using System;
using System.Diagnostics;
using System.Net.Sockets;
using System.Threading;

class FnOsStart
{
    const string FnOsDir = @"D:\Codex_work\FN_WORK_APP\FN_OS";
    const string ImportErpDir = @"D:\Codex_work\FN_WORK_APP\수입ERP";
    const string PythonExe = @"C:\Users\pains\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe";
    const string FnOsUrl = "http://localhost:3000";

    static int Main()
    {
        try
        {
            if (!IsPortOpen("127.0.0.1", 5500))
            {
                StartCmd(
                    "FN Import ERP : localhost:5500",
                    ImportErpDir,
                    Quote(PythonExe) + " scripts\\run_local_sqlite.py"
                );
            }

            if (!IsPortOpen("127.0.0.1", 3000))
            {
                StartCmd(
                    "FN OS : localhost:3000",
                    FnOsDir,
                    "run-dev.bat"
                );
            }

            WaitForPort(5500, 20000);
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

    static void StartCmd(string title, string workingDir, string command)
    {
        var args = "/k \"title " + title + " && cd /d " + Quote(workingDir) + " && " + command + "\"";
        var psi = new ProcessStartInfo("cmd.exe", args)
        {
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Minimized,
        };
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

    static string Quote(string value)
    {
        return "\"" + value + "\"";
    }
}
