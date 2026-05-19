#!/usr/bin/env node
import { readFileSync } from 'fs';
import type * as srk from '@algoux/standard-ranklist';
import { diagnoseRanklist, RanklistDiagnosticIssue, RanklistDiagnosticsReport } from './diagnostics';

export interface CliIO {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

type CliOutputFormat = 'friendly' | 'json';
type BadgeTone = 'ok' | 'warn' | 'error' | 'info' | 'muted';

interface ParsedCliArgs {
  filePath: string;
  format: CliOutputFormat;
}

const USAGE = `Usage: srk-diagnose <srk-file-path> [--format friendly|json] [--json]

Run a comprehensive SRK diagnostics report for a ranklist JSON file.

Options:
  --format friendly   Print a human-friendly diagnostics report (default)
  --format json       Print the raw diagnoseRanklist() return object as JSON
  --json              Shortcut for --format json
  -h, --help          Show this help message
`;

function writeStdout(io: CliIO, text: string) {
  (io.stdout || ((output) => process.stdout.write(output)))(text);
}

function writeStderr(io: CliIO, text: string) {
  (io.stderr || ((output) => process.stderr.write(output)))(text);
}

function parseArgs(args: string[]): ParsedCliArgs | { help: true } | { error: string } {
  let filePath = '';
  let format: CliOutputFormat = 'friendly';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      return { help: true };
    }
    if (arg === '--json') {
      format = 'json';
      continue;
    }
    if (arg === '--format') {
      const value = args[++i];
      if (value !== 'friendly' && value !== 'json') {
        return { error: `Invalid output format "${value || ''}". Expected "friendly" or "json".` };
      }
      format = value;
      continue;
    }
    if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length);
      if (value !== 'friendly' && value !== 'json') {
        return { error: `Invalid output format "${value}". Expected "friendly" or "json".` };
      }
      format = value;
      continue;
    }
    if (arg.startsWith('-')) {
      return { error: `Unknown option "${arg}".` };
    }
    if (filePath) {
      return { error: 'Only one SRK file path can be provided.' };
    }
    filePath = arg;
  }
  if (!filePath) {
    return { error: 'Missing SRK file path.' };
  }
  return { filePath, format };
}

const TONE_COLORS: Record<BadgeTone, string> = {
  ok: '32',
  warn: '33',
  error: '31',
  info: '36',
  muted: '2',
};

function colorize(text: string, tone: BadgeTone): string {
  if (process.env.NO_COLOR !== undefined) {
    return text;
  }
  return `\x1b[${TONE_COLORS[tone]}m${text}\x1b[0m`;
}

function formatBadge(text: string, tone: BadgeTone): string {
  return colorize(text, tone);
}

function formatValidationStatus(report: RanklistDiagnosticsReport): string {
  if (report.summary.errorCount > 0) {
    return formatBadge('ERROR', 'error');
  }
  if (report.summary.warningCount > 0) {
    return formatBadge('WARN', 'warn');
  }
  return formatBadge('OK', 'ok');
}

function formatPresence(value: boolean): string {
  return value ? formatBadge('present', 'info') : formatBadge('missing', 'muted');
}

function formatAvailability(value: boolean): string {
  return value ? formatBadge('available', 'info') : formatBadge('not available', 'muted');
}

function formatDetection(value: boolean): string {
  return value ? formatBadge('detected', 'warn') : formatBadge('not detected', 'ok');
}

function formatConfidence(confidence: 'none' | 'partial' | 'full'): string {
  if (confidence === 'full') {
    return formatBadge('full', 'ok');
  }
  if (confidence === 'partial') {
    return formatBadge('partial', 'warn');
  }
  return formatBadge('none', 'muted');
}

function formatProblemStatisticsStatus(report: RanklistDiagnosticsReport): string {
  if (report.problemStatistics.skipped) {
    return formatBadge('skipped (no detailed solutions)', 'muted');
  }
  return formatConfidence(report.problemStatistics.confidence);
}

function formatICPCSeriesStatus(report: RanklistDiagnosticsReport): string {
  if (!report.series.icpc.hasICPCSeries) {
    return `${formatBadge('missing', 'warn')} (0)`;
  }
  const hasEmptyConfig = report.series.icpc.summaries.some((summary) => summary.isEmpty);
  const status = hasEmptyConfig ? formatBadge('configured with empty entries', 'warn') : formatBadge('configured', 'info');
  return `${status} (${report.series.icpc.seriesCount})`;
}

function formatICPCSeriesSummary(report: RanklistDiagnosticsReport): string {
  const summaries = report.series.icpc.summaries;
  if (!summaries.length) {
    return 'none';
  }
  return summaries
    .map((summary) => {
      const title = summary.title || '(untitled)';
      const parts = [`#${summary.seriesIndex} ${title}`];
      if (summary.hasCount) {
        parts.push(`count=${formatValue(summary.countValue)}`);
      }
      if (summary.hasRatio) {
        parts.push(`ratio=${formatValue(summary.ratioValue)}`);
      }
      if (summary.byMarker) {
        parts.push(`byMarker=${summary.byMarker}`);
      }
      if (summary.isEmpty) {
        parts.push(formatBadge('empty', 'warn'));
      }
      return parts.join(' ');
    })
    .join('; ');
}

function formatDetailedSolutions(report: RanklistDiagnosticsReport): string {
  if (!report.metadata.hasDetailedSolutions || report.metadata.solutionCoverage === 'none') {
    return formatBadge('missing', 'muted');
  }
  if (report.metadata.solutionCoverage === 'full') {
    return formatBadge('full coverage', 'ok');
  }
  return formatBadge('partial coverage', 'warn');
}

function formatRejectedResultDetail(report: RanklistDiagnosticsReport): string {
  if (report.metadata.hasFuzzyRJResults) {
    return formatBadge('fuzzy', 'warn');
  }
  if (report.metadata.hasPreciseSolutionResults) {
    return formatBadge('precise', 'ok');
  }
  if (report.metadata.hasCustomSolutionResults) {
    return formatBadge('custom', 'info');
  }
  return formatBadge('not available', 'muted');
}

function formatFBAvailability(report: RanklistDiagnosticsReport): string {
  const availability = report.metadata.FB.availability;
  if (availability === 'declared-valid') {
    return formatBadge(availability, 'ok');
  }
  if (availability === 'declared-invalid') {
    return formatBadge(availability, 'error');
  }
  if (availability === 'ambiguous' || availability === 'computed-only') {
    return formatBadge(availability, 'warn');
  }
  return formatBadge(availability, 'muted');
}

function formatFBFillAction(report: RanklistDiagnosticsReport): string {
  return report.FB.canEnhance ? formatBadge('fill available', 'warn') : formatBadge('no action', 'ok');
}

function formatFBOverrideAction(report: RanklistDiagnosticsReport): string {
  return report.FB.shouldOverride ? formatBadge('recommended', 'warn') : formatBadge('no action', 'ok');
}

function formatRowOrder(report: RanklistDiagnosticsReport): string {
  if (report.dataValidity.computed?.rowOrderMatches === undefined) {
    return formatBadge('unknown', 'muted');
  }
  return report.dataValidity.computed.rowOrderMatches ? formatBadge('OK', 'ok') : formatBadge('mismatch', 'warn');
}

function formatIssueSeverity(severity: RanklistDiagnosticIssue['severity']): string {
  if (severity === 'error') {
    return formatBadge(severity, 'error');
  }
  if (severity === 'warning') {
    return formatBadge(severity, 'warn');
  }
  return formatBadge(severity, 'info');
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return 'undefined';
  }
  return JSON.stringify(value);
}

function formatTimePrecision(report: RanklistDiagnosticsReport): string {
  if (!report.dataValidity.timePrecision?.checked) {
    return 'not available';
  }
  const possible = report.dataValidity.timePrecision.possible.map(
    (candidate) => `${candidate.timePrecision}/${candidate.timeRounding}`,
  );
  return possible.length ? possible.join(', ') : 'none';
}

function formatIssue(issue: RanklistDiagnosticIssue): string {
  const lines = [`- [${formatIssueSeverity(issue.severity)}] ${issue.code} at ${issue.path}`, `  ${issue.message}`];
  if ('expected' in issue) {
    lines.push(`  Expected: ${formatValue(issue.expected)}`);
  }
  if ('actual' in issue) {
    lines.push(`  Actual: ${formatValue(issue.actual)}`);
  }
  return lines.join('\n');
}

function formatIssues(issues: RanklistDiagnosticIssue[]): string {
  if (!issues.length) {
    return 'No issues found.';
  }
  return issues.map(formatIssue).join('\n');
}

function formatFriendlyReport(report: RanklistDiagnosticsReport, filePath: string): string {
  const FBProblemsWithCandidates = report.FB.computedFB.filter((problem) => problem.candidates.length > 0).length;
  const lines = [
    'SRK Diagnostics Report',
    `File: ${filePath}`,
    '',
    'Summary',
    `- Issues: ${report.summary.issueCount}`,
    `- Errors: ${report.summary.errorCount}`,
    `- Warnings: ${report.summary.warningCount}`,
    `- Info: ${report.summary.infoCount}`,
    `- Validation status: ${formatValidationStatus(report)}`,
    '',
    'Metadata',
    `- Submission precision: ${report.metadata.submissionPrecision || 'unknown'}`,
    `- FB availability: ${formatFBAvailability(report)}`,
    `- Detailed solutions: ${formatDetailedSolutions(report)}`,
    `- Problem colors: ${formatPresence(report.metadata.hasProblemColors)} (${report.metadata.problemColorCount})`,
    `- Likely mocked solutions: ${formatDetection(report.metadata.solutionsAreLikelyMocked)}`,
    `- Rejected result detail: ${formatRejectedResultDetail(report)}`,
    `- Frozen submissions: ${formatDetection(report.metadata.hasFrozenSubmissions)}`,
    `- Team members: ${formatPresence(report.metadata.hasTeamMembers)}`,
    `- User avatars: ${formatPresence(report.metadata.hasUserAvatar)}`,
    `- User photos: ${formatPresence(report.metadata.hasUserPhoto)}`,
    '',
    'Problem Statistics',
    `- Status: ${formatProblemStatisticsStatus(report)}`,
    `- Computed: ${formatValue(report.problemStatistics.computed)}`,
    '',
    'Series',
    `- ICPC series: ${formatICPCSeriesStatus(report)}`,
    `- ICPC config summary: ${formatICPCSeriesSummary(report)}`,
    '',
    'FB',
    `- Declared FB: ${formatPresence(report.FB.hasDeclaredFB)}`,
    `- Computed FB: ${formatAvailability(report.FB.hasComputedFB)} (${FBProblemsWithCandidates} problem(s))`,
    `- Missing FB fill: ${formatFBFillAction(report)}`,
    `- FB result override: ${formatFBOverrideAction(report)}`,
    '',
    'Data Validity',
    `- Confidence: ${formatConfidence(report.dataValidity.confidence)}`,
    `- Score time precision candidates: ${formatTimePrecision(report)}`,
    `- Rows order: ${formatRowOrder(report)}`,
    '',
    'Issues',
    formatIssues(report.issues),
    '',
  ];
  return lines.join('\n');
}

function readRanklist(filePath: string): srk.Ranklist {
  return JSON.parse(readFileSync(filePath, 'utf8')) as srk.Ranklist;
}

export function runCli(args: string[], io: CliIO = {}): number {
  const parsed = parseArgs(args);
  if ('help' in parsed) {
    writeStdout(io, USAGE);
    return 0;
  }
  if ('error' in parsed) {
    writeStderr(io, `${parsed.error}\n\n${USAGE}`);
    return 1;
  }

  let ranklist: srk.Ranklist;
  try {
    ranklist = readRanklist(parsed.filePath);
  } catch (e) {
    writeStderr(io, `Failed to read or parse SRK file: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const report = diagnoseRanklist(ranklist);
  if (parsed.format === 'json') {
    writeStdout(io, `${JSON.stringify(report, null, 2)}\n`);
  } else {
    writeStdout(io, formatFriendlyReport(report, parsed.filePath));
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = runCli(process.argv.slice(2));
}
