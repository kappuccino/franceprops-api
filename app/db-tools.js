export const collation = {
	locale: 'fr',
	strength: 1,
	caseLevel: false,
	numericOrdering: true
}

// Build a plain copy of a document, keeping only the schema fields that are
// not marked as _snapshot: false (used when freezing contact/company data into a document)
export function modelSnapshot(schema, doc){

	if(!doc) return doc

	const snapshot = {}

	for(let [field, value] of Object.entries(doc)){
		if(field === '__v') continue

		const path = schema.path(field)
		if(!path) continue

		// For array fields the flag is carried by the item options, not by the path itself
		const flag = path.options?._snapshot ?? path.options?.type?.[0]?._snapshot
		if(flag === false) continue

		snapshot[field] = value
	}

	return snapshot
}
