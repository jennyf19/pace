import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import {
    copyFile,
    readFile,
    stat,
    writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256File } from "./build-replay-manifest.mjs";
import {
    profileRunManifest,
    writeRunArtifacts
} from "./profile-run.mjs";
import {
    profileSession,
    writeProfileArtifacts
} from "./profile-session.mjs";

const SCHEMA_VERSION = "0.1";

function writeJson(path, value) {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function waitForFile(path, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    do {
        try {
            await stat(path);
            return;
        } catch {
            await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        }
    } while (Date.now() < deadline);
    throw new Error(`timed out waiting for ${path}`);
}

function runProcess(command, args, { cwd, timeoutMs }) {
    return new Promise((resolveProcess, rejectProcess) => {
        const child = spawn(command, args, {
            cwd,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        const timer = setTimeout(() => {
            child.kill();
            rejectProcess(new Error(`${command} timed out`));
        }, timeoutMs);
        child.on("error", (error) => {
            clearTimeout(timer);
            rejectProcess(error);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolveProcess({ code, stdout, stderr });
        });
    });
}

export async function readCopilotVersion(command, cwd) {
    const result = await runProcess(command, ["--version"], {
        cwd,
        timeoutMs: 30_000
    });
    if (result.code !== 0) {
        throw new Error(`cannot read Copilot CLI version: ${result.stderr}`);
    }
    const match = result.stdout.match(/GitHub Copilot CLI\s+([^\s]+)/);
    if (!match) throw new Error("cannot parse Copilot CLI version");
    return match[1].replace(/[.,;:]+$/, "");
}

export async function readFinalAssistantMessage(sessionDirectory) {
    const content = await readFile(
        join(sessionDirectory, "events.jsonl"),
        "utf8"
    );
    let finalMessage = null;
    for (const line of content.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            continue;
        }
        if (
            event.type === "assistant.message" &&
            typeof event.data?.content === "string" &&
            (!Array.isArray(event.data.toolRequests) ||
                event.data.toolRequests.length === 0)
        ) {
            finalMessage = event.data.content;
        }
    }
    if (finalMessage === null) {
        throw new Error("session has no final assistant.message");
    }
    return finalMessage;
}

export async function runCopilotSample({
    output,
    sampleName,
    workspaceFiles,
    prompt,
    model,
    runtimeVersion,
    maxAiCredits,
    copilotCommand,
    sessionName,
    runIdPrefix
}) {
    if (!Array.isArray(workspaceFiles) || workspaceFiles.length === 0) {
        throw new Error("workspaceFiles requires at least one file");
    }
    const sampleDirectory = join(output, "raw", sampleName);
    const workspace = join(sampleDirectory, "workspace");
    mkdirSync(workspace, { recursive: true });
    for (const file of workspaceFiles) {
        await copyFile(
            file.path,
            join(workspace, file.name ?? basename(file.path))
        );
    }
    const sessionId = randomUUID();
    const usagePath = join(sampleDirectory, "usage.json");
    const result = await runProcess(
        copilotCommand,
        [
            "-p",
            prompt,
            "-s",
            "--stream",
            "off",
            "--model",
            model,
            "--reasoning-effort",
            "medium",
            "--context",
            "default",
            "--session-id",
            sessionId,
            "--name",
            sessionName,
            "--max-ai-credits",
            String(maxAiCredits),
            "--usage-output-file",
            usagePath,
            "--allow-all-tools",
            "--available-tools=view",
            "--disable-builtin-mcps",
            "--no-custom-instructions",
            "--no-ask-user",
            "--no-auto-update",
            "--no-experimental",
            "--no-bash-env",
            "--no-remote",
            "--no-remote-export",
            "--no-color",
            "-C",
            workspace
        ],
        {
            cwd: workspace,
            timeoutMs: 10 * 60 * 1000
        }
    );
    await writeFile(join(sampleDirectory, "stdout.txt"), result.stdout, "utf8");
    await writeFile(join(sampleDirectory, "stderr.txt"), result.stderr, "utf8");
    if (result.code !== 0) {
        throw new Error(
            `${sampleName} failed with exit code ${result.code}: ${result.stderr.trim()}`
        );
    }

    const sessionDirectory = join(
        homedir(),
        ".copilot",
        "session-state",
        sessionId
    );
    await waitForFile(join(sessionDirectory, "events.jsonl"));
    const finalResponse = await readFinalAssistantMessage(sessionDirectory);
    await writeFile(
        join(sampleDirectory, "final-response.txt"),
        finalResponse,
        "utf8"
    );
    const sessionProfile = await profileSession(sessionDirectory, {
        declaredRuntimeVersion: runtimeVersion
    });
    writeProfileArtifacts(
        sessionProfile,
        join(output, "session-profiles")
    );
    const manifestPath = join(
        output,
        "run-manifests",
        `${sampleName}.json`
    );
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeJson(manifestPath, {
        schema_version: SCHEMA_VERSION,
        run_id: `${runIdPrefix}-${sampleName}-${sessionId}`,
        sessions: [
            {
                id: "primary",
                role: "primary",
                artifact: sessionDirectory,
                billing: "independent",
                declared_runtime_version: runtimeVersion
            }
        ]
    });
    const runProfile = await profileRunManifest(manifestPath);
    const runPaths = writeRunArtifacts(runProfile, join(output, "profiles"));
    const runProfileSha256 = (await sha256File(runPaths.jsonPath)).sha256;
    return {
        stdout: finalResponse,
        rendered_stdout: result.stdout.trim(),
        sessionProfile,
        runProfile,
        runPaths,
        runProfileSha256,
        sessionDirectory,
        sampleDirectory
    };
}
