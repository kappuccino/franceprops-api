// Number shown to people: "42", or "42.1" for the first revision of #42
export function requestNumber(request){
	if(!request?.id) return null
	return request.revision ? `${request.id}.${request.revision}` : `${request.id}`
}
