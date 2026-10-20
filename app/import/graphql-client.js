// Small GraphQL client shared by the sources: bearer token, timeout, and an
// error thrown for any failure (it shows with the job errors in the dashboard)
export function createClient({url, token, timeout=30000}){
	if(!url || !token) throw new Error('source not configured')

	return async function query(query, variables={}){
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json', // required by Apollo (CSRF prevention)
				Authorization: `Bearer ${token}`
			},
			body: JSON.stringify({query, variables}),
			signal: AbortSignal.timeout(timeout)
		})
			// "fetch failed" alone: the reason (DNS, refused, certificate…) is in the cause
			.catch(err => {
				throw new Error(`${url} → ${err.cause?.message || err.message}`)
			})

		// Apollo answers its errors in JSON, an HTTP 400 included
		const json = await res.json().catch(() => null)

		if(json?.errors?.length) throw new Error(json.errors.map(err => err.message).join(', '))
		if(!res.ok || !json) throw new Error(`${url} → HTTP ${res.status}`)

		return json.data
	}
}
