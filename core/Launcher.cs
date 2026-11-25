using System;
using System.Diagnostics;
using System.IO;

// Launcher wrapper to run a batch script locally giving it an application style and icon.
class Launcher {
    static void Main() {
        string appDir = AppDomain.CurrentDomain.BaseDirectory;
        string batPath = Path.Combine(appDir, "Start-AbuZamelPOS.bat");

        if (File.Exists(batPath)) {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "cmd.exe";
            psi.Arguments = "/c \"" + batPath + "\"";
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = true;

            Process p = Process.Start(psi);
            p.WaitForExit();
        } else {
            Console.WriteLine("Could not find Start-AbuZamelPOS.bat in " + appDir);
            Console.ReadLine();
        }
    }
}
