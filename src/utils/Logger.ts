export class Logger {
    constructor(private readonly name: string, private readonly color = "#a6adc8") { }
    private out(level: "log" | "info" | "warn" | "error", args: unknown[]) {
        console[level](`%c Cat %c ${this.name} `, "background:#cba6f7;color:#000;border-radius:4px", `color:${this.color}`, ...args);
    }
    info(...a: unknown[]) { this.out("info", a); }
    warn(...a: unknown[]) { this.out("warn", a); }
    error(...a: unknown[]) { this.out("error", a); }
    debug(...a: unknown[]) { if (IS_DEV) this.out("log", a); }
}
