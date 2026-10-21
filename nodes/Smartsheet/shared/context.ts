import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { smartsheetApiRequest, smartsheetApiRequestAllItems } from './transport';
import type { SmartsheetColumn } from './utils';

/** Per-execution cache so a loop over many items fetches columns once per sheet. */
export interface SheetMeta {
	sheetId: number;
	sheetName?: string;
	sheetPermalink?: string;
}

export class ExecutionCache {
	private columns = new Map<string, SmartsheetColumn[]>();

	private meta = new Map<string, SheetMeta>();

	/** Sheet name and permalink, fetched once per sheet per execution. */
	async getSheetMeta(ctx: IExecuteFunctions, sheetId: string): Promise<SheetMeta> {
		const cached = this.meta.get(sheetId);
		if (cached) return cached;
		let meta: SheetMeta = { sheetId: Number(sheetId) };
		try {
			const sheet = (await smartsheetApiRequest.call(ctx, 'GET', `/sheets/${sheetId}`, undefined, {
				pageSize: 1,
			})) as { name?: string; permalink?: string };
			meta = { sheetId: Number(sheetId), sheetName: sheet.name, sheetPermalink: sheet.permalink };
		} catch {
			// name is a convenience; never fail the operation over it
		}
		this.meta.set(sheetId, meta);
		return meta;
	}

	async getColumns(ctx: IExecuteFunctions, sheetId: string): Promise<SmartsheetColumn[]> {
		const cached = this.columns.get(sheetId);
		if (cached) return cached;
		const columns = (await smartsheetApiRequestAllItems.call(
			ctx,
			`/sheets/${sheetId}/columns`,
		)) as unknown as SmartsheetColumn[];
		this.columns.set(sheetId, columns);
		return columns;
	}

	invalidate(sheetId: string): void {
		this.columns.delete(sheetId);
		this.meta.delete(sheetId);
	}
}

export type ResourceExecutor = (
	this: IExecuteFunctions,
	operation: string,
	itemIndex: number,
	cache: ExecutionCache,
) => Promise<INodeExecutionData[]>;

export function getLocatorId(ctx: IExecuteFunctions, name: string, itemIndex: number): string {
	const value = ctx.getNodeParameter(name, itemIndex, undefined, { extractValue: true });
	return String(value ?? '').trim();
}

export function getDestination(
	ctx: IExecuteFunctions,
	prefix: string,
	itemIndex: number,
): { destinationType: 'home' | 'folder' | 'workspace'; destinationId?: number } {
	const destinationType = ctx.getNodeParameter(`${prefix}Type`, itemIndex) as
		| 'home'
		| 'folder'
		| 'workspace';
	if (destinationType === 'home') return { destinationType };
	const name = destinationType === 'folder' ? `${prefix}FolderId` : `${prefix}WorkspaceId`;
	return { destinationType, destinationId: Number(getLocatorId(ctx, name, itemIndex)) };
}
