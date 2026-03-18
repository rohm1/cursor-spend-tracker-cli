/**
 * CLI entrypoint for Cursor Spend Tracker — no VSCode dependency.
 * Run with: npx tsx cli.ts
 * Outputs a short summary to stdout (for use in shell scripts / notifications).
 */
import * as https from 'https';
import * as path from 'path';
import * as os from 'os';

interface UsageEvent {
    timestamp: string;
    model: string;
    kind: string;
    requestsCosts: number;
    chargedCents: number;
    tokenUsage?: { totalCents?: number };
}

interface DayStat {
    reqs: number;
    cents: number;
}

interface UsageData {
    onDemandUsed: number;
    onDemandLimit: number;
    onDemandRemaining: number;
    includedUsed: number;
    includedTotal: number;
    events: UsageEvent[];
    fetchedAt: number;
    numericUserId?: number;
}

function getStateDbPath(): string {
    const platform = os.platform();
    if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    } else if (platform === 'win32') {
        return path.join(process.env.APPDATA ?? '', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    }
    return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

async function readSessionTokenFromDb(): Promise<string | null> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const exec = promisify(execFile);
    try {
        const dbPath = getStateDbPath();
        const { stdout } = await exec('sqlite3', [dbPath, 'SELECT value FROM ItemTable WHERE key = "cursorAuth/accessToken"']);
        const jwt = stdout.trim();
        if (!jwt) {
            return null;
        }
        const payload = jwt.split('.')[1];
        const padded = payload + '=='.slice((payload.length % 4) || 4);
        const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
        const userId = (decoded.sub as string).split('|')[1];
        if (!userId) {
            return null;
        }
        return `${userId}::${jwt}`;
    } catch {
        return null;
    }
}

function httpsPost(url: string, token: string, body: object): Promise<string> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const urlObj = new URL(url);
        const req = https.request(
            {
                hostname: urlObj.hostname,
                path: urlObj.pathname,
                method: 'POST',
                headers: {
                    accept: '*/*',
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(payload),
                    origin: 'https://cursor.com',
                    referer: 'https://cursor.com/dashboard?tab=usage',
                    cookie: `WorkosCursorSessionToken=${encodeURIComponent(token)}`,
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () =>
                    res.statusCode && res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode}`)) : resolve(data)
                );
            }
        );
        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
        req.write(payload);
        req.end();
    });
}

function httpsGet(url: string, token: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = https.get(
            url,
            {
                headers: {
                    accept: '*/*',
                    referer: 'https://cursor.com/dashboard?tab=usage',
                    cookie: `WorkosCursorSessionToken=${encodeURIComponent(token)}`,
                },
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () =>
                    res.statusCode && res.statusCode >= 400 ? reject(new Error(`HTTP ${res.statusCode}`)) : resolve(body)
                );
            }
        );
        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}

async function fetchUsage(token: string): Promise<UsageData> {
    const [summaryBody, usageBody, eventsBody, meBody] = await Promise.all([
        httpsGet('https://cursor.com/api/usage-summary', token),
        httpsGet('https://cursor.com/api/usage', token),
        httpsPost('https://cursor.com/api/dashboard/get-filtered-usage-events', token, {
            startMs: 0,
            endMs: Date.now(),
            page: 1,
            pageSize: 500,
        }),
        httpsGet('https://cursor.com/api/auth/me', token),
    ]);

    const summary = JSON.parse(summaryBody);
    const usageData = JSON.parse(usageBody);
    const eventsData = JSON.parse(eventsBody);
    const me = JSON.parse(meBody);

    const individual = summary?.individualUsage?.overall ?? summary?.individualUsage?.onDemand ?? {};
    let includedUsed = 0,
        includedTotal = 0;
    for (const model of Object.values(usageData) as { numRequests?: number; maxRequestUsage?: number | null }[]) {
        if (model && typeof model === 'object' && 'numRequests' in model) {
            includedUsed += model.numRequests ?? 0;
            if ((model.maxRequestUsage ?? 0) > includedTotal) {
                includedTotal = model.maxRequestUsage ?? 0;
            }
        }
    }
    includedUsed = Math.min(includedUsed, includedTotal);

    const events: UsageEvent[] = (eventsData.usageEventsDisplay ?? []).map((e: Record<string, unknown>) => ({
        timestamp: e.timestamp as string,
        model: (e.model as string) ?? 'unknown',
        kind: (e.kind as string) ?? '',
        requestsCosts: (e.requestsCosts as number) ?? 0,
        chargedCents: (e.chargedCents as number) ?? 0,
        tokenUsage: e.tokenUsage as { totalCents?: number } | undefined,
    }));

    return {
        onDemandUsed: individual.used ?? 0,
        onDemandLimit: individual.limit ?? 0,
        onDemandRemaining: individual.remaining ?? 0,
        includedUsed,
        includedTotal,
        events,
        fetchedAt: Date.now(),
        numericUserId: me?.id,
    };
}

function fmtDollars(cents: number, decimals = 2): string {
    return `$${(cents / 100).toFixed(decimals)}`;
}

function startOfDayMs(daysAgo: number): number {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    return d.getTime();
}

function aggregateDay(events: UsageEvent[], startMs: number, endMs: number): DayStat {
    let reqs = 0,
        cents = 0;
    for (const e of events) {
        const ts = parseInt(e.timestamp);
        if (ts >= startMs && ts < endMs) {
            reqs++;
            cents += e.chargedCents;
        }
    }
    return { reqs, cents };
}

/** Build a short summary suitable for terminal or notification. */
function formatSummary(data: UsageData): string {
    const todayStart = startOfDayMs(0);
    const yesterdayStart = startOfDayMs(1);
    const evts = data.events ?? [];
    const today = aggregateDay(evts, todayStart, Date.now());
    const yesterday = aggregateDay(evts, yesterdayStart, todayStart);
    const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
    let last2hReqs = 0,
        last2hCents = 0;
    for (const e of evts) {
        const ts = parseInt(e.timestamp);
        if (ts >= twoHoursAgo) {
            last2hReqs++;
            last2hCents += e.chargedCents;
        }
    }

    const lines: string[] = [
        `Spend: ${fmtDollars(data.onDemandUsed)} / ${fmtDollars(data.onDemandLimit, 0)} (${fmtDollars(data.onDemandRemaining)} left)`,
    ];
    if (data.includedTotal > 0) {
        lines.push(`Included: ${data.includedUsed} / ${data.includedTotal}`);
    }
    lines.push(
        `Today: ${today.reqs} reqs, ${fmtDollars(today.cents)}`,
        `Yesterday: ${yesterday.reqs} reqs, ${fmtDollars(yesterday.cents)}`,
        `Last 2h: ${last2hReqs} reqs, ${fmtDollars(last2hCents)}`
    );
    return lines.join('\n');
}

async function main(): Promise<void> {
    const token = await readSessionTokenFromDb();
    if (!token) {
        console.error('Cursor: not logged in (could not read auth token from Cursor state DB).');
        process.exit(1);
    }
    try {
        const data = await fetchUsage(token);
        console.log(formatSummary(data));
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Cursor Spend: ${msg}`);
        process.exit(1);
    }
}

main();
