// Session cookie holding the JWT, set by the api only (httpOnly): the front
// never reads it, the browser sends it on every request to the api domain.
import {sessionTTL} from './jwt.js'

// Configurable so two instances sharing a parent domain (e.g. XXO / FranceProps) never
// send each other's session: the browser orders same-name cookies by creation
// time, not by domain specificity.
export const SESSION_COOKIE = process.env.COOKIE_NAME || 'token'

function options(){
	return {
		httpOnly: true,
		secure: process.env.COOKIE_SECURE !== 'NO',
		sameSite: 'lax',
		domain: process.env.COOKIE_DOMAIN || undefined,
		path: '/'
	}
}

export function setSessionCookie(res, jwt){
	if(!res) return
	res.cookie(SESSION_COOKIE, jwt, {...options(), maxAge: sessionTTL() * 1000})
}

export function clearSessionCookie(res){
	if(!res) return
	res.clearCookie(SESSION_COOKIE, options())
}
