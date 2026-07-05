import { spawn } from "node:child_process";

/** Open a file/URL in the default browser, cross-platform, with no dependencies. */
export function openInBrowser(target: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];

  if (platform === "darwin") {
    cmd = "open";
    args = [target];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", target];
  } else {
    cmd = "xdg-open";
    args = [target];
  }

  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {
    // Non-fatal: the file is already written; just inform the user.
    console.error(`Could not auto-open browser. Open the file manually: ${target}`);
  });
  child.unref();
}
