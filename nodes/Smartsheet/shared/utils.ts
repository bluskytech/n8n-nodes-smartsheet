import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

export interface SmartsheetColumn {
	id: number;
	title: string;
	type: string;
	primary?: boolean;
	index?: number;
	options?: string[];
	hidden?: boolean;
	locked?: boolean;
	contactOptions?: Array<{ email: string; name?: string }>;
	systemColumnType?: string;
	formula?: string;
}

/** System columns (auto-number, created/modified by/date) and column formulas cannot be written. */
export function isReadOnlyColumn(column: SmartsheetColumn): boolean {
	return Boolean(column.systemColumnType) || Boolean(column.formula);
}

export interface SmartsheetCell {
	columnId: number;
	value?: unknown;
	displayValue?: string;
	objectValue?: IDataObject;
	formula?: string;
	hyperlink?: IDataObject;
	strict?: boolean;
}

export interface SmartsheetRow extends IDataObject {
	id: number;
	rowNumber?: number;
	sheetId?: number;
	parentId?: number;
	siblingId?: number;
	createdAt?: string;
	modifiedAt?: string;
	cells?: SmartsheetCell[];
}

export type RowValueSource = 'value' | 'displayValue';

/**
 * Turn a Smartsheet row (array of cells keyed by column ID) into a flat object
 * keyed by column title, similar to what Zapier presents.
 */
export function simplifyRow(
	row: SmartsheetRow,
	columns: SmartsheetColumn[],
	source: RowValueSource = 'value',
): IDataObject {
	const byId = new Map<number, SmartsheetColumn>();
	for (const column of columns) byId.set(column.id, column);

	const { cells, ...rest } = row;
	const result: IDataObject = { ...rest };
	for (const cell of cells ?? []) {
		const column = byId.get(cell.columnId);
		const key = column?.title ?? String(cell.columnId);
		let value: unknown;
		if (source === 'displayValue') {
			value = cell.displayValue ?? cell.value ?? null;
		} else if (cell.objectValue && isMultiObjectValue(cell.objectValue)) {
			value = flattenObjectValue(cell.objectValue);
		} else {
			value = cell.value ?? cell.displayValue ?? null;
		}
		result[key] = value as IDataObject[keyof IDataObject];
	}
	return result;
}

function isMultiObjectValue(objectValue: IDataObject): boolean {
	const type = objectValue.objectType as string | undefined;
	return type === 'MULTI_PICKLIST' || type === 'MULTI_CONTACT';
}

function flattenObjectValue(objectValue: IDataObject): unknown {
	const type = objectValue.objectType as string;
	const values = (objectValue.values as unknown[]) ?? [];
	if (type === 'MULTI_PICKLIST') return values;
	if (type === 'MULTI_CONTACT') {
		return values.map((v) => (v as IDataObject).email ?? (v as IDataObject).name);
	}
	return objectValue;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function splitList(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter((v) => v !== '');
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed.startsWith('[')) {
			try {
				const parsed = JSON.parse(trimmed) as unknown;
				if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim());
			} catch {
				// fall through to comma split
			}
		}
		return trimmed
			.split(',')
			.map((v) => v.trim())
			.filter((v) => v !== '');
	}
	if (value === null || value === undefined) return [];
	return [String(value)];
}

function toContact(raw: string): IDataObject {
	const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
	if (match) return { objectType: 'CONTACT', name: match[1].trim(), email: match[2].trim() };
	return { objectType: 'CONTACT', email: raw.trim() };
}

/**
 * Build a Smartsheet cell for a column from a user supplied value, converting
 * according to the column type.
 */
export function buildCell(column: SmartsheetColumn, raw: unknown, strict: boolean): SmartsheetCell {
	const cell: SmartsheetCell = { columnId: column.id, strict };
	if (raw === undefined) return cell;
	if (raw === null || raw === '') {
		cell.value = '';
		return cell;
	}
	if (typeof raw === 'string' && raw.startsWith('=')) {
		cell.formula = raw;
		delete cell.strict;
		return cell;
	}

	switch (column.type) {
		case 'CHECKBOX': {
			if (typeof raw === 'boolean') cell.value = raw;
			else
				cell.value = ['true', '1', 'yes', 'y', 'on', 'checked'].includes(String(raw).toLowerCase());
			break;
		}
		case 'MULTI_PICKLIST': {
			cell.objectValue = { objectType: 'MULTI_PICKLIST', values: splitList(raw) };
			break;
		}
		case 'MULTI_CONTACT_LIST': {
			cell.objectValue = {
				objectType: 'MULTI_CONTACT',
				values: splitList(raw).map(toContact),
			};
			break;
		}
		case 'CONTACT_LIST': {
			const text = String(raw).trim();
			const contact = toContact(text);
			if (EMAIL_RE.test(contact.email as string)) {
				cell.objectValue = contact;
			} else {
				cell.value = text;
			}
			break;
		}
		case 'DATE': {
			cell.value = typeof raw === 'string' ? raw.slice(0, 10) : String(raw);
			break;
		}
		case 'DATETIME':
		case 'ABSTRACT_DATETIME': {
			cell.value = raw instanceof Date ? raw.toISOString() : String(raw);
			break;
		}
		case 'TEXT_NUMBER': {
			if (typeof raw === 'number' || typeof raw === 'boolean') cell.value = raw;
			else if (typeof raw === 'object') cell.value = JSON.stringify(raw);
			else cell.value = String(raw);
			break;
		}
		default: {
			if (typeof raw === 'object') cell.value = JSON.stringify(raw);
			else cell.value = raw as string | number | boolean;
		}
	}
	return cell;
}

/**
 * Build the cells array for a row from a {columnId|columnTitle: value} map.
 */
export function buildCells(
	columns: SmartsheetColumn[],
	values: Record<string, unknown>,
	strict: boolean,
): SmartsheetCell[] {
	const byId = new Map<string, SmartsheetColumn>();
	const byTitle = new Map<string, SmartsheetColumn>();
	for (const column of columns) {
		byId.set(String(column.id), column);
		byTitle.set(column.title.toLowerCase(), column);
	}
	const cells: SmartsheetCell[] = [];
	for (const [key, raw] of Object.entries(values)) {
		if (raw === undefined) continue;
		const column = byId.get(key) ?? byTitle.get(key.toLowerCase());
		if (!column || isReadOnlyColumn(column)) continue;
		cells.push(buildCell(column, raw, strict));
	}
	return cells;
}

export function cellValueOf(row: SmartsheetRow, columnId: number): unknown {
	const cell = (row.cells ?? []).find((c) => c.columnId === columnId);
	if (!cell) return undefined;
	if (cell.objectValue && isMultiObjectValue(cell.objectValue)) {
		return flattenObjectValue(cell.objectValue);
	}
	return cell.value ?? cell.displayValue;
}

export function matchesFilter(
	actual: unknown,
	expected: string,
	operator: string,
	caseInsensitive: boolean,
): boolean {
	const norm = (v: unknown) => {
		const s = Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v);
		return caseInsensitive ? s.toLowerCase() : s;
	};
	const a = norm(actual);
	const b = norm(expected);
	switch (operator) {
		case 'equals':
			return a === b;
		case 'notEquals':
			return a !== b;
		case 'contains':
			return a.includes(b);
		case 'notContains':
			return !a.includes(b);
		case 'startsWith':
			return a.startsWith(b);
		case 'endsWith':
			return a.endsWith(b);
		case 'isEmpty':
			return a === '';
		case 'isNotEmpty':
			return a !== '';
		default:
			return a === b;
	}
}

export function parseIdList(raw: unknown): number[] {
	return splitList(raw)
		.map((v) => Number(v))
		.filter((v) => Number.isFinite(v) && v > 0);
}

export function toExecutionData(
	data: IDataObject | IDataObject[],
	itemIndex: number,
): INodeExecutionData[] {
	const list = Array.isArray(data) ? data : [data];
	return list.map((json) => ({ json, pairedItem: { item: itemIndex } }));
}
