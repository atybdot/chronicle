import * as p from "@clack/prompts";
import pc from "picocolors";
import { 
  getDevToolsUrl, 
  startDevToolsServer, 
  stopDevToolsServer, 
  getDevToolsStatus,
  viewDevToolsLogs
} from "../lib/agent";

interface DevInput {
  action?: "start" | "stop" | "status" | "restart" | "logs";
}

export async function handleDev(input: DevInput = {}): Promise<void> {
  const action = input.action ?? "start";

  switch (action) {
    case "start":
      await handleStart();
      break;
    case "stop":
      await handleStop();
      break;
    case "status":
      await handleStatus();
      break;
    case "restart":
      await handleStop();
      await handleStart();
      break;
    case "logs":
      await viewDevToolsLogs();
      break;
    default:
      console.log(pc.red(`  Unknown action: ${action}`));
      console.log(pc.dim("  Usage: chronicle dev [start|stop|status|restart|logs]"));
  }
}

async function handleStart(): Promise<void> {
  p.intro("🛠️  Chronicle DevTools");
  
  await startDevToolsServer();
  
  console.log(pc.cyan(`\n  URL: ${getDevToolsUrl()}`));
  console.log(pc.dim("  Opening browser...\n"));
  
  // Open browser
  const { exec } = await import("child_process");
  const openCommand = process.platform === "darwin" 
    ? "open" 
    : process.platform === "win32" 
    ? "start" 
    : "xdg-open";
    
  exec(`${openCommand} ${getDevToolsUrl()}`, () => {
    // Ignore errors opening browser
  });
  
  p.note(
    "DevTools is running in the background.\nUse `chronicle analyze --dev` to see agent activity.",
    "Status"
  );
}

async function handleStop(): Promise<void> {
  p.intro("🛑  Stopping DevTools");
  await stopDevToolsServer();
}

async function handleStatus(): Promise<void> {
  const status = await getDevToolsStatus();
  
  if (status.running) {
    console.log(pc.green("  ✓ DevTools is running"));
    console.log(pc.cyan(`  URL: ${status.url}`));
    console.log(pc.dim(`  PID: ${status.pid}`));
  } else {
    console.log(pc.yellow("  ✗ DevTools is not running"));
    console.log(pc.dim("  Run `chronicle dev start` to start it"));
  }
}
