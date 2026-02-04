import { describe, it, expect } from 'vitest';
import { convertDriveComments } from '$lib/services/transformer';

describe('convertDriveComments', () => {
	it('converts a single comment with no replies', () => {
		const comments = [{
			id: 'AAAA',
			content: 'Nice paragraph',
			resolved: false,
			quotedFileContent: { value: 'highlighted text' },
			author: { displayName: 'Alice', emailAddress: 'alice@test.com' },
			replies: []
		}];

		const result = convertDriveComments(comments);
		expect(result).toHaveLength(1);
		expect(result[0].anchorId).toBe('c1');
		expect(result[0].quotedText).toBe('highlighted text');
		expect(result[0].resolved).toBe(false);
		expect(result[0].comments).toHaveLength(1);
		expect(result[0].comments[0].authorName).toBe('Alice');
		expect(result[0].comments[0].authorEmail).toBe('alice@test.com');
		expect(result[0].comments[0].content).toBe('Nice paragraph');
		expect(result[0].comments[0].isReply).toBe(false);
	});

	it('converts a comment with replies', () => {
		const comments = [{
			id: 'BBBB',
			content: 'I disagree with this',
			resolved: false,
			quotedFileContent: { value: 'some claim' },
			author: { displayName: 'Bob', emailAddress: 'bob@test.com' },
			replies: [
				{
					content: 'Why?',
					author: { displayName: 'Alice', emailAddress: 'alice@test.com' }
				},
				{
					content: 'Because reasons',
					author: { displayName: 'Bob', emailAddress: 'bob@test.com' }
				}
			]
		}];

		const result = convertDriveComments(comments);
		expect(result).toHaveLength(1);
		expect(result[0].comments).toHaveLength(3);
		expect(result[0].comments[0].isReply).toBe(false);
		expect(result[0].comments[1].isReply).toBe(true);
		expect(result[0].comments[1].content).toBe('Why?');
		expect(result[0].comments[2].isReply).toBe(true);
		expect(result[0].comments[2].content).toBe('Because reasons');
	});

	it('assigns sequential anchor IDs', () => {
		const comments = [
			{
				id: 'A', content: 'First', resolved: false,
				quotedFileContent: { value: 'text1' },
				author: { displayName: 'A', emailAddress: 'a@t.com' },
				replies: []
			},
			{
				id: 'B', content: 'Second', resolved: false,
				quotedFileContent: { value: 'text2' },
				author: { displayName: 'B', emailAddress: 'b@t.com' },
				replies: []
			},
			{
				id: 'C', content: 'Third', resolved: false,
				quotedFileContent: { value: 'text3' },
				author: { displayName: 'C', emailAddress: 'c@t.com' },
				replies: []
			}
		];

		const result = convertDriveComments(comments);
		expect(result.map(t => t.anchorId)).toEqual(['c1', 'c2', 'c3']);
	});

	it('filters out resolved comments without quoted text', () => {
		const comments = [
			{
				id: 'A', content: 'Still active', resolved: false,
				quotedFileContent: { value: 'text' },
				author: { displayName: 'A', emailAddress: 'a@t.com' },
				replies: []
			},
			{
				id: 'B', content: 'Done and gone', resolved: true,
				// No quotedFileContent
				author: { displayName: 'B', emailAddress: 'b@t.com' },
				replies: []
			}
		];

		const result = convertDriveComments(comments);
		expect(result).toHaveLength(1);
		expect(result[0].comments[0].content).toBe('Still active');
	});

	it('keeps resolved comments that have quoted text', () => {
		const comments = [{
			id: 'A', content: 'Resolved but anchored', resolved: true,
			quotedFileContent: { value: 'some text' },
			author: { displayName: 'A', emailAddress: 'a@t.com' },
			replies: []
		}];

		const result = convertDriveComments(comments);
		expect(result).toHaveLength(1);
		expect(result[0].resolved).toBe(true);
	});

	it('handles missing email address', () => {
		const comments = [{
			id: 'A', content: 'No email', resolved: false,
			quotedFileContent: { value: 'text' },
			author: { displayName: 'Anonymous' },
			replies: []
		}];

		const result = convertDriveComments(comments);
		expect(result[0].comments[0].authorEmail).toBe('');
	});

	it('handles comment with no quoted content', () => {
		const comments = [{
			id: 'A', content: 'Point comment', resolved: false,
			// No quotedFileContent at all
			author: { displayName: 'A', emailAddress: 'a@t.com' },
			replies: []
		}];

		const result = convertDriveComments(comments);
		expect(result).toHaveLength(1);
		expect(result[0].quotedText).toBe('');
	});

	it('returns empty array for empty input', () => {
		expect(convertDriveComments([])).toEqual([]);
	});
});
