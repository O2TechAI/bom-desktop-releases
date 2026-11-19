"use strict";

/* Windows: keep a Chrome window out of the taskbar.
 *
 * Buy lab runs Chrome off screen, but a normal window still gets a taskbar
 * button (and Alt-Tab entry). Marking it a tool window removes both while the
 * window keeps rendering, so the stream stays alive; when a security check is
 * handed to the person the window still shows on screen, just without a
 * taskbar button.
 *
 * Pure cosmetics: nothing is injected into the page, and the browser itself
 * is untouched beyond its window style. Best effort — if it cannot find the
 * window in time it gives up quietly. */

const { execFile } = require("node:child_process");

const SCRIPT = `
param($Profile)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class O2Taskbar {
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
"@
$GWL_EXSTYLE = -20
$WS_EX_TOOLWINDOW = 0x00000080
$WS_EX_APPWINDOW = 0x00040000
$flags = 0x27
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  $found = $false
  $procs = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Profile) }
  foreach ($item in $procs) {
    $proc = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.MainWindowHandle -eq 0) { continue }
    $style = [O2Taskbar]::GetWindowLong($proc.MainWindowHandle, $GWL_EXSTYLE)
    $style = ($style -bor $WS_EX_TOOLWINDOW) -band (-bnot $WS_EX_APPWINDOW)
    [O2Taskbar]::SetWindowLong($proc.MainWindowHandle, $GWL_EXSTYLE, $style) | Out-Null
    [O2Taskbar]::SetWindowPos($proc.MainWindowHandle, [IntPtr]::Zero, 0, 0, 0, 0, $flags) | Out-Null
    $found = $true
  }
  if ($found) { break }
  Start-Sleep -Milliseconds 400
}
`;

/** Hide the Chrome window that uses `profilePath` from the taskbar. */
function hideChromeFromTaskbar(profilePath) {
  if (process.platform !== "win32" || !profilePath) return;
  try {
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT, profilePath],
      { windowsHide: true, timeout: 20000 },
      () => { /* best effort */ },
    );
    child.unref?.();
  } catch {
    /* no PowerShell: the window simply keeps its taskbar button */
  }
}


module.exports = { hideChromeFromTaskbar };
