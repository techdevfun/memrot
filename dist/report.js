export function buildReport(store, asOf, checks, version) {
    let errors = 0;
    let warnings = 0;
    for (const c of checks) {
        for (const f of c.findings) {
            if (f.severity === "error")
                errors++;
            else
                warnings++;
        }
    }
    return {
        tool: "memrot",
        version,
        store,
        asOf,
        checks,
        summary: { errors, warnings, total: errors + warnings, failed: errors > 0 },
    };
}
export function formatText(report) {
    const lines = [];
    lines.push(`memrot audit: ${report.store} (as of ${report.asOf})`);
    lines.push("");
    for (const c of report.checks) {
        if (c.skipped) {
            lines.push(`- ${c.name}: skipped (${c.skipped})`);
            continue;
        }
        if (c.findings.length === 0) {
            lines.push(`- ${c.name}: ok (0 findings)`);
            continue;
        }
        lines.push(`- ${c.name}: ${c.findings.length} finding(s) [${c.severity}]`);
        for (const f of c.findings) {
            lines.push(`  ${f.severity === "error" ? "ERROR" : "WARN"}  ${f.detail}`);
        }
    }
    lines.push("");
    const s = report.summary;
    lines.push(`${s.total} finding(s): ${s.errors} error(s), ${s.warnings} warning(s)`);
    lines.push(s.failed ? "audit: FAILED (exit 1)" : "audit: clean (exit 0)");
    return lines.join("\n");
}
export function formatJson(report) {
    return JSON.stringify(report, null, 2);
}
