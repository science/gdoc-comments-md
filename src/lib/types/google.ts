/**
 * Google Docs API response types
 * https://developers.google.com/docs/api/reference/rest/v1/documents
 */

export interface GoogleDocsDocument {
	documentId: string;
	title: string;
	body: DocumentBody;
	documentStyle?: DocumentStyle;
	lists?: Record<string, DocList>;
}

export interface DocList {
	listProperties: ListProperties;
}

export interface ListProperties {
	nestingLevels: NestingLevel[];
}

export interface NestingLevel {
	glyphFormat?: string;
	glyphType?: string;
}

export interface DocumentBody {
	content: StructuralElement[];
}

export interface DocumentStyle {
	defaultHeaderId?: string;
	defaultFooterId?: string;
}

export interface StructuralElement {
	startIndex: number;
	endIndex: number;
	paragraph?: Paragraph;
	sectionBreak?: SectionBreak;
	table?: Table;
	tableOfContents?: TableOfContents;
}

export interface Paragraph {
	elements: ParagraphElement[];
	paragraphStyle?: ParagraphStyle;
	bullet?: Bullet;
}

export interface ParagraphStyle {
	namedStyleType?: string;
	headingId?: string;
}

export interface Bullet {
	listId: string;
	nestingLevel?: number;
}

export interface ParagraphElement {
	startIndex: number;
	endIndex: number;
	textRun?: TextRun;
	inlineObjectElement?: InlineObjectElement;
	pageBreak?: PageBreak;
}

export interface PageBreak {
	textStyle?: TextStyle;
}

export interface TextRun {
	content: string;
	textStyle?: TextStyle;
}

export interface TextStyle {
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	link?: Link;
}

export interface Link {
	url?: string;
	headingId?: string;
}

export interface InlineObjectElement {
	inlineObjectId: string;
}

export interface SectionBreak {
	sectionStyle?: SectionStyle;
}

export interface SectionStyle {
	columnSeparatorStyle?: string;
}

export interface Table {
	rows: number;
	columns: number;
	tableRows: TableRow[];
}

export interface TableRow {
	startIndex: number;
	endIndex: number;
	tableCells: TableCell[];
}

export interface TableCell {
	startIndex: number;
	endIndex: number;
	content: StructuralElement[];
}

export interface TableOfContents {
	content: StructuralElement[];
}

/**
 * Google Drive API comment types
 * https://developers.google.com/drive/api/v3/reference/comments
 */

export interface DriveCommentsResponse {
	kind: string;
	comments: DriveComment[];
	nextPageToken?: string;
}

export interface DriveComment {
	id: string;
	kind: string;
	createdTime: string;
	modifiedTime: string;
	author: CommentAuthor;
	htmlContent?: string;
	content: string;
	deleted: boolean;
	resolved: boolean;
	quotedFileContent?: QuotedFileContent;
	anchor?: string;
	replies: CommentReply[];
}

export interface CommentAuthor {
	kind: string;
	displayName: string;
	photoLink?: string;
	emailAddress?: string;
}

export interface QuotedFileContent {
	mimeType: string;
	value: string;
}

export interface CommentReply {
	id: string;
	kind: string;
	createdTime: string;
	modifiedTime: string;
	author: CommentAuthor;
	htmlContent?: string;
	content: string;
	deleted: boolean;
}

/**
 * Internal types for transformation
 */

export interface CommentThread {
	id: string;
	anchorId: string;
	quotedText: string;
	resolved: boolean;
	comments: ThreadComment[];
}

export interface ThreadComment {
	authorName: string;
	authorEmail: string;
	content: string;
	isReply: boolean;
}

export interface AnchoredText {
	startIndex: number;
	endIndex: number;
	text: string;
	anchorId: string;
}
