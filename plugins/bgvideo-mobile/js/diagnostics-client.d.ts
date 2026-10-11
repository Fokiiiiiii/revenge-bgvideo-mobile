export type DiagnosticClient = {
	expose(key: string, value: unknown): void
	disconnect(): void
}
export function connectDiagnostics(api: unknown): DiagnosticClient
