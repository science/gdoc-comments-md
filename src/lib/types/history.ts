/**
 * History entry metadata stored in localStorage
 */
export interface HistoryEntry {
	docId: string;
	docUrl: string;
	docTitle: string;
	commentCount: number;
	convertedAt: number; // unix ms
}
